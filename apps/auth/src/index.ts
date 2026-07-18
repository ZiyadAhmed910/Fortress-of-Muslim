import { WorkerEntrypoint } from 'cloudflare:workers';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import { createAuthClient } from 'better-auth/client';
import { createAuth } from './auth';
import type { Bindings, KeyVerification, NamedQueryDefinition, TokenVerification } from './types';

const allowedMethods = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const allowedHeaders = 'Content-Type, Authorization, X-Fortress-API-Key';

export default class AuthWorker extends WorkerEntrypoint<Bindings> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        service: 'fortress-platform-auth',
        environment: this.env.PLATFORM_ENV,
        timestamp: new Date().toISOString(),
      });
    }

    const origin = request.headers.get('Origin');
    const allowedOrigin = origin === this.env.DEVELOPERS_URL || origin === this.env.ADMIN_URL ? origin : null;
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }

    const response = url.pathname.startsWith('/v1/control/')
      ? await this.handleControlPlane(request, url)
      : await createAuth(this.env).handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of corsHeaders(allowedOrigin)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  private async handleControlPlane(request: Request, url: URL): Promise<Response> {
    const session = await createAuth(this.env).api.getSession({ headers: request.headers });
    if (!session?.user) return json({ error: { code: 'unauthorized', message: 'Sign in is required.' } }, 401);

    if (url.pathname === '/v1/control/profile' && request.method === 'GET') {
      const profile = await this.env.IDENTITY_DB.prepare(
        'SELECT plan_code AS planCode, status, created_at AS createdAt FROM developer_profiles WHERE user_id = ?',
      ).bind(session.user.id).first();
      return json({ data: { user: session.user, plan: profile ?? { planCode: 'basic', status: 'active' } } });
    }

    if (url.pathname === '/v1/control/mcp-servers' && request.method === 'GET') {
      const result = await this.env.IDENTITY_DB.prepare(`
        SELECT id, slug, name, description, upstream_base_url AS upstreamBaseUrl,
               openapi_url AS openapiUrl, server_type AS serverType, source_type AS sourceType,
               named_query_id AS namedQueryId, status, created_at AS createdAt, updated_at AS updatedAt
        FROM mcp_server_registrations WHERE owner_user_id = ? ORDER BY created_at DESC
      `).bind(session.user.id).all();
      return json({ data: result.results });
    }

    if (url.pathname === '/v1/control/mcp-servers' && request.method === 'POST') {
      const body = await readJson(request);
      const parsed = parseMcpRegistration(body);
      if (!parsed.ok) return json({ error: { code: 'invalid_request', message: parsed.message } }, 400);
      if (parsed.value.namedQueryId) {
        const ownedQuery = await this.env.IDENTITY_DB.prepare(
          'SELECT 1 FROM named_queries WHERE id = ? AND owner_user_id = ? AND status = \'active\'',
        ).bind(parsed.value.namedQueryId, session.user.id).first();
        if (!ownedQuery) return json({ error: { code: 'invalid_request', message: 'Choose an active named query owned by this account.' } }, 400);
      }
      const id = `mcp_${crypto.randomUUID()}`;
      const upstreamBaseUrl = parsed.value.sourceType === 'named_query' ? this.env.API_AUDIENCE : parsed.value.upstreamBaseUrl;
      await this.env.IDENTITY_DB.prepare(`
        INSERT INTO mcp_server_registrations
          (id, owner_user_id, slug, name, description, upstream_base_url, openapi_url, server_type, source_type, named_query_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?)
      `).bind(id, session.user.id, parsed.value.slug, parsed.value.name, parsed.value.description,
        upstreamBaseUrl, parsed.value.openapiUrl, parsed.value.sourceType, parsed.value.namedQueryId).run();
      return json({ data: { id, ...parsed.value, upstreamBaseUrl, status: 'draft' } }, 201);
    }

    if (url.pathname === '/v1/control/devices' && request.method === 'GET') {
      const result = await this.env.IDENTITY_DB.prepare(`
        SELECT id, name, device_type AS deviceType, auth_method AS authMethod,
               oauth_client_id AS oauthClientId, jwks_uri AS jwksUri, status,
               last_seen_at AS lastSeenAt, created_at AS createdAt
        FROM device_registrations WHERE owner_user_id = ? ORDER BY created_at DESC
      `).bind(session.user.id).all();
      return json({ data: result.results });
    }

    if (url.pathname === '/v1/control/devices' && request.method === 'POST') {
      const parsed = parseDeviceRegistration(await readJson(request));
      if (!parsed.ok) return json({ error: { code: 'invalid_request', message: parsed.message } }, 400);
      const client = await this.env.IDENTITY_DB.prepare(`
        SELECT "tokenEndpointAuthMethod" AS authMethod, "grantTypes" AS grantTypes
        FROM "oauthClient" WHERE "clientId" = ? AND "userId" = ? AND (disabled IS NULL OR disabled = 0)
      `).bind(parsed.value.oauthClientId, session.user.id).first<{ authMethod: string | null; grantTypes: string | null }>();
      if (!client) return json({ error: { code: 'invalid_request', message: 'Choose a connected app owned by this account.' } }, 400);
      if (parsed.value.authMethod === 'private_key_jwt' && client.authMethod !== 'private_key_jwt') {
        return json({ error: { code: 'invalid_request', message: 'Choose a private-key JWT connected app.' } }, 400);
      }
      if (parsed.value.authMethod === 'client_credentials' && !String(client.grantTypes).includes('client_credentials')) {
        return json({ error: { code: 'invalid_request', message: 'Choose a connected app with the client credentials grant.' } }, 400);
      }
      const id = `dev_${crypto.randomUUID()}`;
      await this.env.IDENTITY_DB.prepare(`
        INSERT INTO device_registrations
          (id, owner_user_id, name, device_type, auth_method, oauth_client_id, jwks_uri)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, session.user.id, parsed.value.name, parsed.value.deviceType, parsed.value.authMethod,
        parsed.value.oauthClientId, parsed.value.jwksUri).run();
      return json({ data: { id, ...parsed.value, status: 'active' } }, 201);
    }

    const deviceMatch = url.pathname.match(/^\/v1\/control\/devices\/([^/]+)\/revoke$/);
    if (deviceMatch && request.method === 'POST') {
      const result = await this.env.IDENTITY_DB.prepare(`
        UPDATE device_registrations SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND owner_user_id = ? AND status = 'active'
      `).bind(deviceMatch[1], session.user.id).run();
      return result.meta.changes ? json({ data: { success: true } }) : json({ error: { code: 'not_found', message: 'Device was not found.' } }, 404);
    }

    if (url.pathname === '/v1/control/named-queries' && request.method === 'GET') {
      const result = await this.env.IDENTITY_DB.prepare(`
        SELECT id, slug, name, description, operation, parameters_json AS parametersJson,
               status, created_at AS createdAt, updated_at AS updatedAt
        FROM named_queries WHERE owner_user_id = ? ORDER BY created_at DESC
      `).bind(session.user.id).all();
      return json({ data: result.results.map((row) => ({ ...row, parameters: JSON.parse(String(row.parametersJson)), parametersJson: undefined })) });
    }

    if (url.pathname === '/v1/control/named-queries' && request.method === 'POST') {
      const parsed = parseNamedQuery(await readJson(request));
      if (!parsed.ok) return json({ error: { code: 'invalid_request', message: parsed.message } }, 400);
      const id = `qry_${crypto.randomUUID()}`;
      await this.env.IDENTITY_DB.prepare(`
        INSERT INTO named_queries (id, owner_user_id, slug, name, description, operation, parameters_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, session.user.id, parsed.value.slug, parsed.value.name, parsed.value.description,
        parsed.value.operation, JSON.stringify(parsed.value.parameters)).run();
      return json({ data: { id, ...parsed.value, status: 'active' } }, 201);
    }

    return json({ error: { code: 'not_found', message: 'Control-plane route was not found.' } }, 404);
  }

  async verifyApiKey(key: string, permissions?: Record<string, string[]>): Promise<KeyVerification> {
    const result = await createAuth(this.env).api.verifyApiKey({
      body: { key, permissions },
    });
    return result as KeyVerification;
  }

  async verifyBearerToken(token: string, scopes: string[] = []): Promise<TokenVerification> {
    try {
      const auth = createAuth(this.env);
      const resourceClient = createAuthClient({
        plugins: [oauthProviderResourceClient(auth)],
      });
      const payload = await resourceClient.verifyBearerToken(token, {
        verifyOptions: {
          issuer: `${this.env.AUTH_BASE_URL}/api/auth`,
          audience: this.env.API_AUDIENCE,
        },
        jwksUrl: `${this.env.AUTH_BASE_URL}/api/auth/jwks`,
        scopes,
      });
      return {
        valid: true,
        subject: typeof payload.sub === 'string' ? payload.sub : undefined,
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
        clientId: typeof payload.azp === 'string' ? payload.azp : undefined,
      };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Invalid access token.' };
    }
  }

  async getNamedQuery(id: string, ownerUserId: string): Promise<NamedQueryDefinition | null> {
    const row = await this.env.IDENTITY_DB.prepare(`
      SELECT id, owner_user_id AS ownerUserId, operation, parameters_json AS parametersJson
      FROM named_queries WHERE id = ? AND owner_user_id = ? AND status = 'active'
    `).bind(id, ownerUserId).first<Record<string, unknown>>();
    if (!row) return null;
    return {
      id: String(row.id),
      ownerUserId: String(row.ownerUserId),
      operation: row.operation as NamedQueryDefinition['operation'],
      parameters: JSON.parse(String(row.parametersJson)),
    };
  }
}

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': allowedMethods,
    'Access-Control-Allow-Headers': allowedHeaders,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseMcpRegistration(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const sourceType = body.sourceType === 'named_query' ? 'named_query' : 'openapi';
  const namedQueryId = sourceType === 'named_query' && typeof body.namedQueryId === 'string' ? body.namedQueryId : null;
  const upstreamBaseUrl = sourceType === 'named_query' ? null : validHttpsUrl(body.upstreamBaseUrl);
  const openapiUrl = body.openapiUrl ? validHttpsUrl(body.openapiUrl) : null;
  if (name.length < 3 || name.length > 80) return { ok: false as const, message: 'Name must be 3-80 characters.' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false as const, message: 'Slug must use lowercase letters, numbers, and hyphens.' };
  if (description.length < 10 || description.length > 500) return { ok: false as const, message: 'Description must be 10-500 characters.' };
  if (sourceType === 'openapi' && !upstreamBaseUrl) return { ok: false as const, message: 'A valid HTTPS upstream URL is required.' };
  if (sourceType === 'named_query' && !namedQueryId) return { ok: false as const, message: 'Choose a named query.' };
  if (body.openapiUrl && !openapiUrl) return { ok: false as const, message: 'OpenAPI URL must use HTTPS.' };
  return { ok: true as const, value: { name, slug, description, upstreamBaseUrl, openapiUrl, sourceType, namedQueryId } };
}

function parseDeviceRegistration(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const deviceType = typeof body.deviceType === 'string' ? body.deviceType : '';
  const authMethod = typeof body.authMethod === 'string' ? body.authMethod : '';
  const oauthClientId = typeof body.oauthClientId === 'string' && body.oauthClientId.trim() ? body.oauthClientId.trim() : null;
  const jwksUri = body.jwksUri ? validHttpsUrl(body.jwksUri) : null;
  if (name.length < 3 || name.length > 80) return { ok: false as const, message: 'Name must be 3-80 characters.' };
  if (!['iot', 'cli', 'tv', 'gateway', 'service'].includes(deviceType)) return { ok: false as const, message: 'Choose a supported device type.' };
  if (!['device_authorization', 'client_credentials', 'private_key_jwt'].includes(authMethod)) return { ok: false as const, message: 'Choose a supported authentication method.' };
  if (!oauthClientId) return { ok: false as const, message: 'An OAuth client ID is required.' };
  if (authMethod === 'private_key_jwt' && !jwksUri) return { ok: false as const, message: 'Private-key JWT devices require an HTTPS JWKS URL.' };
  return { ok: true as const, value: { name, deviceType, authMethod, oauthClientId, jwksUri } };
}

function parseNamedQuery(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const operation = typeof body.operation === 'string' ? body.operation : '';
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const duaId = typeof body.duaId === 'string' ? body.duaId.trim() : '';
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 20));
  if (name.length < 3 || name.length > 80) return { ok: false as const, message: 'Name must be 3-80 characters.' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false as const, message: 'Slug must use lowercase letters, numbers, and hyphens.' };
  if (description.length < 10 || description.length > 500) return { ok: false as const, message: 'Description must be 10-500 characters.' };
  if (!['list', 'search', 'get_by_id'].includes(operation)) return { ok: false as const, message: 'Choose a supported query operation.' };
  if (operation === 'search' && (query.length < 2 || query.length > 200)) return { ok: false as const, message: 'Search text must be 2-200 characters.' };
  if (operation === 'get_by_id' && !/^[a-zA-Z0-9._-]{3,100}$/.test(duaId)) return { ok: false as const, message: 'Enter a valid dua ID.' };
  const parameters = operation === 'search' ? { query, limit } : operation === 'get_by_id' ? { duaId } : { limit };
  return { ok: true as const, value: { name, slug, description, operation: operation as NamedQueryDefinition['operation'], parameters } };
}

function validHttpsUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
