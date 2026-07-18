import { WorkerEntrypoint } from 'cloudflare:workers';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import { createAuthClient } from 'better-auth/client';
import { createAuth } from './auth';
import type { Bindings, KeyVerification, TokenVerification } from './types';

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
               openapi_url AS openapiUrl, status, created_at AS createdAt, updated_at AS updatedAt
        FROM mcp_server_registrations WHERE owner_user_id = ? ORDER BY created_at DESC
      `).bind(session.user.id).all();
      return json({ data: result.results });
    }

    if (url.pathname === '/v1/control/mcp-servers' && request.method === 'POST') {
      const body = await readJson(request);
      const parsed = parseMcpRegistration(body);
      if (!parsed.ok) return json({ error: { code: 'invalid_request', message: parsed.message } }, 400);
      const id = `mcp_${crypto.randomUUID()}`;
      await this.env.IDENTITY_DB.prepare(`
        INSERT INTO mcp_server_registrations
          (id, owner_user_id, slug, name, description, upstream_base_url, openapi_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, session.user.id, parsed.value.slug, parsed.value.name, parsed.value.description,
        parsed.value.upstreamBaseUrl, parsed.value.openapiUrl).run();
      return json({ data: { id, ...parsed.value, status: 'draft' } }, 201);
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
  const upstreamBaseUrl = validHttpsUrl(body.upstreamBaseUrl);
  const openapiUrl = body.openapiUrl ? validHttpsUrl(body.openapiUrl) : null;
  if (name.length < 3 || name.length > 80) return { ok: false as const, message: 'Name must be 3-80 characters.' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false as const, message: 'Slug must use lowercase letters, numbers, and hyphens.' };
  if (description.length < 10 || description.length > 500) return { ok: false as const, message: 'Description must be 10-500 characters.' };
  if (!upstreamBaseUrl) return { ok: false as const, message: 'A valid HTTPS upstream URL is required.' };
  if (body.openapiUrl && !openapiUrl) return { ok: false as const, message: 'OpenAPI URL must use HTTPS.' };
  return { ok: true as const, value: { name, slug, description, upstreamBaseUrl, openapiUrl } };
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
