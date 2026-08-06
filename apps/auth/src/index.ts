import { WorkerEntrypoint } from 'cloudflare:workers';
import { PLATFORM_VERSION } from '@fortress/contracts';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import { createAuthClient } from 'better-auth/client';
import { createAuth } from './auth';
import { handleAdminPlane } from './admin-plane';
import { hasOversizedBody, isMutation, isTrustedBrowserMutation } from './security';
import type { Bindings, KeyVerification, McpToolDefinition, NamedQueryDefinition, RateLimitResult, ServiceState, TokenVerification } from './types';

const allowedMethods = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const allowedHeaders = 'Content-Type, Authorization, X-Fortress-API-Key, X-Request-ID';
const MAX_MANAGEMENT_BODY_BYTES = 64 * 1024;
const STANDARD_MCP_TOOLS = [
  { name: 'find_dua', description: 'Use this first when a user names, describes, or misspells a dua title. Fuzzy-matches titles and returns the complete best dua records in one call; do not list all duas or call get_dua afterward.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Natural-language title or situation, such as "waking up", "entering mosqe", or "travel dua".' }, limit: { type: 'integer', minimum: 1, maximum: 3, default: 1 } }, required: ['query'] } },
  { name: 'search_duas', description: 'Use for broad searches inside Arabic, transliteration, translation, or commentary text. Returns summaries; for a title or situation lookup, prefer find_dua because it returns complete records in one call.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] } },
  { name: 'get_dua', description: 'Retrieve one complete dua by canonical or legacy ID.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'get_dua_evidence', description: 'Retrieve source provenance, references, taxonomy, verification history, and correction history for a dua. Use before making authenticity, attribution, or citation claims; report missing or pending evidence honestly.', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Canonical or legacy dua ID.' } }, required: ['id'] } },
  { name: 'list_duas', description: 'List published dua summaries in canonical order.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
  { name: 'random_dua', description: 'Retrieve one random complete published dua.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_collections', description: 'List published dua and Hadith collections with record, book, and chapter counts.', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['dua', 'hadith'] } } } },
  { name: 'list_hadith', description: 'List Hadith summaries, optionally restricted to a collection such as bukhari, muslim, or tirmidhi.', inputSchema: { type: 'object', properties: { collection: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
  { name: 'search_hadith', description: 'Full-text search across published Hadith Arabic, English, narrator, title, book, and chapter fields.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, collection: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] } },
  { name: 'get_hadith', description: 'Retrieve one complete Hadith by Fortress ID or provider record ID, including hierarchy, grading, text, and references.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'ask_fortress', description: 'Ask a natural-language question using semantic retrieval over active Fortress records. Returns a grounded answer with numbered source records and verification status.', inputSchema: { type: 'object', properties: { question: { type: 'string', minLength: 5, maxLength: 500 } }, required: ['question'] } },
  { name: 'current_dataset', description: 'Read active dataset provenance and verification metadata.', inputSchema: { type: 'object', properties: {} } },
];

export default class AuthWorker extends WorkerEntrypoint<Bindings> {
  async fetch(request: Request): Promise<Response> {
    const startedAt = performance.now();
    const requestId = requestIdFrom(request);
    let response: Response;
    try {
      response = await this.routeRequest(request, requestId);
    } catch (error) {
      console.error(JSON.stringify({ event: 'unhandled_error', service: 'auth', requestId, message: error instanceof Error ? error.message : 'Unknown error' }));
      response = json({ error: { code: 'internal_error', message: 'An unexpected error occurred.', requestId } }, 500);
    }
    const duration = Math.max(0, performance.now() - startedAt);
    const headers = new Headers(response.headers);
    applyOperationalHeaders(headers, requestId, duration);
    if (new URL(request.url).pathname === '/health') headers.set('Access-Control-Allow-Origin', '*');
    console.log(JSON.stringify({ event: 'http_request', service: 'auth', requestId, method: request.method,
      path: new URL(request.url).pathname, status: response.status, durationMs: Number(duration.toFixed(1)), environment: this.env.PLATFORM_ENV }));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  private async routeRequest(request: Request, requestId: string): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        service: 'fortress-platform-auth',
        version: PLATFORM_VERSION,
        environment: this.env.PLATFORM_ENV,
        timestamp: new Date().toISOString(),
      });
    }

    const origin = request.headers.get('Origin');
    const allowedOrigin = origin === this.env.DEVELOPERS_URL || origin === this.env.ADMIN_URL ? origin : null;
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }

    const customManagementRoute = url.pathname.startsWith('/v1/admin/') || url.pathname.startsWith('/v1/control/');
    if (customManagementRoute && isMutation(request.method)) {
      if (!isTrustedBrowserMutation(request, this.env)) {
        return json({ error: { code: 'forbidden_origin', message: 'This request did not originate from a trusted Fortress portal.' } }, 403);
      }
      if (await hasOversizedBody(request, MAX_MANAGEMENT_BODY_BYTES)) {
        return json({ error: { code: 'payload_too_large', message: 'Management requests are limited to 64 KB.' } }, 413);
      }
    }

    let response: Response;
    if (url.pathname.startsWith('/v1/admin/') || url.pathname.startsWith('/v1/control/')) {
      const session = await createAuth(this.env).api.getSession({ headers: request.headers });
      if (!session?.user) response = json({ error: { code: 'unauthorized', message: 'Sign in is required.' } }, 401);
      else if (url.pathname.startsWith('/v1/admin/')) response = await handleAdminPlane(request, url, this.env, session.user, session.session, requestId);
      else response = await this.handleControlPlane(request, url, session.user);
    } else if (isDeveloperManagementRoute(url.pathname)) {
      const session = await createAuth(this.env).api.getSession({ headers: request.headers });
      if (session?.user && !await this.isUserActive(session.user.id)) response = json({ error: { code: 'account_suspended', message: 'This developer account is not active.' } }, 403);
      else response = await createAuth(this.env).handler(request);
    } else response = await createAuth(this.env).handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of corsHeaders(allowedOrigin)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  private async handleControlPlane(request: Request, url: URL, user: { id: string; name: string; email: string }): Promise<Response> {
    if (!await this.isUserActive(user.id)) return json({ error: { code: 'account_suspended', message: 'This developer account is not active.' } }, 403);
    await this.env.IDENTITY_DB.prepare(`
      INSERT OR IGNORE INTO platform_role_grants (user_id, role, status)
      VALUES (?, 'developer', 'active')
    `).bind(user.id).run();

    if (url.pathname === '/v1/control/profile' && request.method === 'GET') {
      const profile = await this.env.IDENTITY_DB.prepare(
        'SELECT plan_code AS planCode, status, created_at AS createdAt FROM developer_profiles WHERE user_id = ?',
      ).bind(user.id).first();
      return json({ data: { user, plan: profile ?? { planCode: 'basic', status: 'active' } } });
    }

    if (url.pathname === '/v1/control/usage' && request.method === 'GET') {
      const planRow = await this.env.IDENTITY_DB.prepare(`
        SELECT COALESCE((SELECT plan_code FROM developer_profiles WHERE user_id = ?), 'basic') AS planCode
      `).bind(user.id).first<{ planCode: string }>();
      const planCode = planRow?.planCode ?? 'basic';
      let limitRow = await this.env.IDENTITY_DB.prepare(`
        SELECT requests_per_minute AS perMinute, requests_per_day AS perDay FROM plan_limits WHERE plan_code = ?
      `).bind(planCode).first<{ perMinute: number; perDay: number }>();
      if (!limitRow) {
        limitRow = await this.env.IDENTITY_DB.prepare(`
          SELECT requests_per_minute AS perMinute, requests_per_day AS perDay FROM plan_limits WHERE plan_code = 'basic'
        `).first<{ perMinute: number; perDay: number }>();
      }
      const limit = { perMinute: limitRow?.perMinute ?? 100, perDay: limitRow?.perDay ?? 5000 };

      // Reads the same counters checkRateLimit increments, without incrementing them --
      // a dashboard peek must never itself count as a request against the limit it displays.
      const now = new Date();
      const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
      const dayStart = now.toISOString().slice(0, 10);
      const [minuteRow, dayRow] = await Promise.all([
        this.env.IDENTITY_DB.prepare(
          `SELECT request_count AS count FROM rate_limit_counters WHERE credential_id = ? AND window_kind = 'minute' AND window_start = ?`,
        ).bind(user.id, minuteStart).first<{ count: number }>(),
        this.env.IDENTITY_DB.prepare(
          `SELECT request_count AS count FROM rate_limit_counters WHERE credential_id = ? AND window_kind = 'day' AND window_start = ?`,
        ).bind(user.id, dayStart).first<{ count: number }>(),
      ]);
      const usage = { perMinute: minuteRow?.count ?? 0, perDay: dayRow?.count ?? 0 };

      return json({
        data: {
          planCode,
          limit,
          usage,
          remaining: {
            perMinute: Math.max(0, limit.perMinute - usage.perMinute),
            perDay: Math.max(0, limit.perDay - usage.perDay),
          },
          windowResetAt: {
            minute: new Date(new Date(minuteStart).getTime() + 60_000).toISOString(),
            day: new Date(new Date(`${dayStart}T00:00:00Z`).getTime() + 86_400_000).toISOString(),
          },
        },
      });
    }

    if (url.pathname === '/v1/control/mcp-servers' && request.method === 'GET') {
      const result = await this.env.IDENTITY_DB.prepare(`
        SELECT id, slug, name, description, upstream_base_url AS upstreamBaseUrl,
               openapi_url AS openapiUrl, server_type AS serverType, source_type AS sourceType,
               named_query_id AS namedQueryId, status, created_at AS createdAt, updated_at AS updatedAt
        FROM mcp_server_registrations WHERE owner_user_id = ? ORDER BY created_at DESC
      `).bind(user.id).all();
      return json({ data: result.results });
    }

    if (url.pathname === '/v1/control/mcp-servers' && request.method === 'POST') {
      const body = await readJson(request);
      const parsed = parseMcpRegistration(body);
      if (!parsed.ok) return json({ error: { code: 'invalid_request', message: parsed.message } }, 400);
      if (parsed.value.namedQueryId) {
        const ownedQuery = await this.env.IDENTITY_DB.prepare(
          'SELECT 1 FROM named_queries WHERE id = ? AND owner_user_id = ? AND status = \'active\'',
        ).bind(parsed.value.namedQueryId, user.id).first();
        if (!ownedQuery) return json({ error: { code: 'invalid_request', message: 'Choose an active named query owned by this account.' } }, 400);
      }
      const id = `mcp_${crypto.randomUUID()}`;
      const upstreamBaseUrl = parsed.value.sourceType === 'named_query' ? this.env.API_AUDIENCE : parsed.value.upstreamBaseUrl;
      await this.env.IDENTITY_DB.prepare(`
        INSERT INTO mcp_server_registrations
          (id, owner_user_id, slug, name, description, upstream_base_url, openapi_url, server_type, source_type, named_query_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?)
      `).bind(id, user.id, parsed.value.slug, parsed.value.name, parsed.value.description,
        upstreamBaseUrl, parsed.value.openapiUrl, parsed.value.sourceType, parsed.value.namedQueryId).run();
      return json({ data: { id, ...parsed.value, upstreamBaseUrl, status: 'draft' } }, 201);
    }

    if (url.pathname === '/v1/control/devices' && request.method === 'GET') {
      const result = await this.env.IDENTITY_DB.prepare(`
        SELECT id, name, device_type AS deviceType, auth_method AS authMethod,
               oauth_client_id AS oauthClientId, jwks_uri AS jwksUri, status,
               last_seen_at AS lastSeenAt, created_at AS createdAt
        FROM device_registrations WHERE owner_user_id = ? ORDER BY created_at DESC
      `).bind(user.id).all();
      return json({ data: result.results });
    }

    if (url.pathname === '/v1/control/devices' && request.method === 'POST') {
      const parsed = parseDeviceRegistration(await readJson(request));
      if (!parsed.ok) return json({ error: { code: 'invalid_request', message: parsed.message } }, 400);
      const client = await this.env.IDENTITY_DB.prepare(`
        SELECT "tokenEndpointAuthMethod" AS authMethod, "grantTypes" AS grantTypes
        FROM "oauthClient" WHERE "clientId" = ? AND "userId" = ? AND (disabled IS NULL OR disabled = 0)
      `).bind(parsed.value.oauthClientId, user.id).first<{ authMethod: string | null; grantTypes: string | null }>();
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
      `).bind(id, user.id, parsed.value.name, parsed.value.deviceType, parsed.value.authMethod,
        parsed.value.oauthClientId, parsed.value.jwksUri).run();
      return json({ data: { id, ...parsed.value, status: 'active' } }, 201);
    }

    const deviceMatch = url.pathname.match(/^\/v1\/control\/devices\/([^/]+)\/revoke$/);
    if (deviceMatch && request.method === 'POST') {
      const result = await this.env.IDENTITY_DB.prepare(`
        UPDATE device_registrations SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND owner_user_id = ? AND status = 'active'
      `).bind(deviceMatch[1], user.id).run();
      return result.meta.changes ? json({ data: { success: true } }) : json({ error: { code: 'not_found', message: 'Device was not found.' } }, 404);
    }

    const oauthStatusMatch = url.pathname.match(/^\/v1\/control\/oauth-clients\/([^/]+)\/status$/);
    if (oauthStatusMatch && request.method === 'POST') {
      const status = String((await readJson(request)).status ?? '');
      if (!['active', 'disabled'].includes(status)) return invalidControlStatus();
      const clientId = decodeURIComponent(oauthStatusMatch[1]!);
      const result = await this.env.IDENTITY_DB.prepare(`
        UPDATE "oauthClient" SET disabled = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE "clientId" = ? AND "userId" = ?
      `).bind(status === 'disabled' ? 1 : 0, clientId, user.id).run();
      if (!result.meta.changes) return controlNotFound('Connected app');
      if (status === 'disabled') {
        await this.env.IDENTITY_DB.batch([
          this.env.IDENTITY_DB.prepare(`
            UPDATE "oauthAccessToken" SET revoked = CURRENT_TIMESTAMP
            WHERE "clientId" = ? AND revoked IS NULL
          `).bind(clientId),
          this.env.IDENTITY_DB.prepare(`
            UPDATE "oauthRefreshToken" SET revoked = CURRENT_TIMESTAMP
            WHERE "clientId" = ? AND revoked IS NULL
          `).bind(clientId),
        ]);
      }
      await this.auditDeveloperAction(user.id, `developer.oauth_client_${status}`, 'oauth-client', clientId);
      return json({ data: { clientId, status } });
    }

    if (url.pathname === '/v1/control/named-queries' && request.method === 'GET') {
      const result = await this.env.IDENTITY_DB.prepare(`
        SELECT id, slug, name, description, operation, parameters_json AS parametersJson,
               query_kind AS queryKind, object_name AS objectName, selected_fields_json AS selectedFieldsJson,
               filters_json AS filtersJson, sort_json AS sortJson, parameter_schema_json AS parameterSchemaJson,
               max_rows AS maxRows,
               status, created_at AS createdAt, updated_at AS updatedAt
        FROM named_queries WHERE owner_user_id = ? ORDER BY created_at DESC
      `).bind(user.id).all();
      return json({ data: result.results.map(toNamedQueryResponse) });
    }

    if (url.pathname === '/v1/control/named-queries' && request.method === 'POST') {
      const parsed = parseRecordQuery(await readJson(request));
      if (!parsed.ok) return json({ error: { code: 'invalid_request', message: parsed.message } }, 400);
      const id = `qry_${crypto.randomUUID()}`;
      await this.env.IDENTITY_DB.prepare(`
        INSERT INTO named_queries (id, owner_user_id, slug, name, description, operation, parameters_json,
          query_kind, object_name, selected_fields_json, filters_json, sort_json, parameter_schema_json, max_rows)
        VALUES (?, ?, ?, ?, ?, 'list', '{}', 'record_query', 'duas', ?, ?, ?, ?, ?)
      `).bind(id, user.id, parsed.value.slug, parsed.value.name, parsed.value.description,
        JSON.stringify(parsed.value.selectedFields), JSON.stringify(parsed.value.filters), JSON.stringify(parsed.value.sort),
        JSON.stringify(parsed.value.parameterSchema), parsed.value.maxRows).run();
      return json({ data: { id, ...parsed.value, status: 'active' } }, 201);
    }

    const queryStatusMatch = url.pathname.match(/^\/v1\/control\/named-queries\/([^/]+)\/status$/);
    if (queryStatusMatch && request.method === 'POST') {
      const status = String((await readJson(request)).status ?? '');
      if (!['active', 'disabled'].includes(status)) return invalidControlStatus();
      const id = decodeURIComponent(queryStatusMatch[1]!);
      const result = await this.env.IDENTITY_DB.prepare(`
        UPDATE named_queries SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND owner_user_id = ?
      `).bind(status, id, user.id).run();
      if (!result.meta.changes) return controlNotFound('Named query');
      await this.auditDeveloperAction(user.id, `developer.named_query_${status}`, 'named-query', id);
      return json({ data: { id, status } });
    }

    if (url.pathname === '/v1/control/mcp/catalog' && request.method === 'GET') return json({ data: STANDARD_MCP_TOOLS });

    if (url.pathname === '/v1/control/mcp/toolsets' && request.method === 'GET') {
      const toolsets = await this.env.IDENTITY_DB.prepare(`SELECT id, slug, name, description, status, created_at AS createdAt
        FROM mcp_toolsets WHERE owner_user_id = ? ORDER BY created_at DESC`).bind(user.id).all<Record<string, unknown>>();
      const tools = await this.env.IDENTITY_DB.prepare(`SELECT tool.id, tool.toolset_id AS toolsetId, tool.tool_name AS name,
        tool.description, tool.tool_type AS toolType, tool.standard_tool_name AS standardToolName,
        tool.named_query_id AS namedQueryId, tool.external_method AS externalMethod, tool.external_url AS externalUrl,
        tool.input_schema_json AS inputSchemaJson, tool.approval_status AS approvalStatus, tool.enabled
        FROM mcp_toolset_tools tool JOIN mcp_toolsets toolset ON toolset.id = tool.toolset_id
        WHERE toolset.owner_user_id = ? ORDER BY tool.created_at`).bind(user.id).all<Record<string, unknown>>();
      return json({ data: toolsets.results.map((toolset) => ({ ...toolset, tools: tools.results.filter((tool) => tool.toolsetId === toolset.id).map((tool) => ({ ...tool, inputSchema: JSON.parse(String(tool.inputSchemaJson)), inputSchemaJson: undefined })) })) });
    }

    if (url.pathname === '/v1/control/mcp/toolsets' && request.method === 'POST') {
      const body = await readJson(request); const name = String(body.name ?? '').trim(); const slug = String(body.slug ?? '').trim().toLowerCase(); const description = String(body.description ?? '').trim();
      if (name.length < 3 || description.length < 10 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: { code: 'invalid_request', message: 'Enter a name, a 10-character description, and a lowercase hyphenated slug.' } }, 400);
      const id = `set_${crypto.randomUUID()}`;
      await this.env.IDENTITY_DB.prepare('INSERT INTO mcp_toolsets (id, owner_user_id, slug, name, description) VALUES (?, ?, ?, ?, ?)').bind(id, user.id, slug, name, description).run();
      return json({ data: { id, name, slug, description, status: 'active', tools: [] } }, 201);
    }

    const toolsetStatusMatch = url.pathname.match(/^\/v1\/control\/mcp\/toolsets\/([^/]+)\/status$/);
    if (toolsetStatusMatch && request.method === 'POST') {
      const status = String((await readJson(request)).status ?? '');
      if (!['active', 'disabled'].includes(status)) return invalidControlStatus();
      const id = decodeURIComponent(toolsetStatusMatch[1]!);
      const result = await this.env.IDENTITY_DB.prepare(`
        UPDATE mcp_toolsets SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND owner_user_id = ?
      `).bind(status, id, user.id).run();
      if (!result.meta.changes) return controlNotFound('MCP toolset');
      await this.auditDeveloperAction(user.id, `developer.mcp_toolset_${status}`, 'mcp-toolset', id);
      return json({ data: { id, status } });
    }

    const toolMatch = url.pathname.match(/^\/v1\/control\/mcp\/toolsets\/([^/]+)\/tools$/);
    if (toolMatch && request.method === 'POST') {
      const toolset = await this.env.IDENTITY_DB.prepare("SELECT 1 FROM mcp_toolsets WHERE id = ? AND owner_user_id = ? AND status = 'active'").bind(toolMatch[1], user.id).first();
      if (!toolset) return json({ error: { code: 'not_found', message: 'Toolset was not found.' } }, 404);
      const parsed = await parseToolDefinition(await readJson(request), this.env.IDENTITY_DB, user.id);
      if (!parsed.ok) return json({ error: { code: 'invalid_request', message: parsed.message } }, 400);
      const id = `tool_${crypto.randomUUID()}`;
      await this.env.IDENTITY_DB.prepare(`INSERT INTO mcp_toolset_tools
        (id, toolset_id, tool_name, description, tool_type, standard_tool_name, named_query_id, external_method, external_url, input_schema_json, approval_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, toolMatch[1], parsed.value.name, parsed.value.description, parsed.value.toolType, parsed.value.standardToolName,
          parsed.value.namedQueryId, parsed.value.externalMethod, parsed.value.externalUrl, JSON.stringify(parsed.value.inputSchema), parsed.value.approvalStatus).run();
      return json({ data: { id, ...parsed.value, enabled: true } }, 201);
    }

    const toolStatusMatch = url.pathname.match(/^\/v1\/control\/mcp\/toolsets\/([^/]+)\/tools\/([^/]+)\/status$/);
    if (toolStatusMatch && request.method === 'POST') {
      const status = String((await readJson(request)).status ?? '');
      if (!['active', 'disabled'].includes(status)) return invalidControlStatus();
      const toolsetId = decodeURIComponent(toolStatusMatch[1]!);
      const toolId = decodeURIComponent(toolStatusMatch[2]!);
      const result = await this.env.IDENTITY_DB.prepare(`
        UPDATE mcp_toolset_tools SET enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND toolset_id = ? AND EXISTS (
          SELECT 1 FROM mcp_toolsets
          WHERE id = ? AND owner_user_id = ?
        )
      `).bind(status === 'active' ? 1 : 0, toolId, toolsetId, toolsetId, user.id).run();
      if (!result.meta.changes) return controlNotFound('MCP tool');
      await this.auditDeveloperAction(user.id, `developer.mcp_tool_${status}`, 'mcp-tool', toolId);
      return json({ data: { id: toolId, status } });
    }

    return json({ error: { code: 'not_found', message: 'Control-plane route was not found.' } }, 404);
  }

  async verifyApiKey(key: string, permissions?: Record<string, string[]>): Promise<KeyVerification> {
    const result = await createAuth(this.env).api.verifyApiKey({
      body: { key, permissions },
    });
    const verification = result as KeyVerification;
    if (verification.valid && verification.key && !await this.isUserActive(verification.key.referenceId)) {
      return { valid: false, key: null, error: { code: 'account_suspended', message: 'The credential owner is not active.' } };
    }
    return verification;
  }

  async recordUsage(event: {
    userId?: string;
    credentialId?: string;
    service: string;
    route: string;
    statusCode: number;
    durationMs: number;
    requestUnits?: number;
  }): Promise<void> {
    const insert = this.env.IDENTITY_DB.prepare(`
      INSERT INTO usage_events
        (id, occurred_at, user_id, credential_id, service, route, status_code, duration_ms, request_units, environment)
      VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      event.userId ?? null,
      event.credentialId ?? null,
      event.service.slice(0, 40),
      event.route.slice(0, 180),
      Math.trunc(event.statusCode),
      Math.max(0, Math.round(event.durationMs)),
      Math.max(1, Math.round(event.requestUnits ?? 1)),
      this.env.PLATFORM_ENV,
    );
    if (Math.random() < 0.01) {
      await this.env.IDENTITY_DB.batch([
        insert,
        this.env.IDENTITY_DB.prepare("DELETE FROM usage_events WHERE occurred_at < datetime('now', '-30 days')"),
      ]);
    } else {
      await insert.run();
    }
  }

  async verifyBearerToken(token: string, scopes: string[] = [], audience: 'api' | 'mcp' = 'api'): Promise<TokenVerification> {
    try {
      const auth = createAuth(this.env);
      const resourceClient = createAuthClient({
        plugins: [oauthProviderResourceClient(auth)],
      });
      const payload = await resourceClient.verifyBearerToken(token, {
        verifyOptions: {
          issuer: `${this.env.AUTH_BASE_URL}/api/auth`,
          audience: audience === 'mcp' ? this.env.MCP_AUDIENCE : this.env.API_AUDIENCE,
        },
        jwksUrl: `${this.env.AUTH_BASE_URL}/api/auth/jwks`,
        scopes,
      });
      const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
      if (subject && !await this.isUserActive(subject)) return { valid: false, error: 'The credential owner is not active.' };
      const clientId = typeof payload.azp === 'string' ? payload.azp : undefined;
      let ownerUserId = subject;
      if (clientId) {
        const client = await this.env.IDENTITY_DB.prepare('SELECT "userId" AS userId FROM "oauthClient" WHERE "clientId" = ?').bind(clientId).first<{ userId: string | null }>();
        if (client?.userId && !await this.isUserActive(client.userId)) return { valid: false, error: 'The credential owner is not active.' };
        if (client?.userId) ownerUserId = client.userId;
      }
      return {
        valid: true,
        subject,
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
        clientId,
        ownerUserId,
      };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Invalid access token.' };
    }
  }

  // Resolves the credential to a principal exactly like verifyApiKey/verifyBearerToken, then
  // enforces a plan-based limit with an exact atomic counter (usage_events is sampled telemetry
  // and is not precise enough to enforce against -- see the platform's own architectural rule
  // that rate enforcement and analytics are separate responsibilities). Anonymous requests never
  // reach this method; callers only invoke it when a credential is actually present.
  async checkRateLimit(credential: string): Promise<RateLimitResult> {
    let principalId: string | undefined;
    if (credential.startsWith('fom_')) {
      const result = await this.verifyApiKey(credential);
      if (result.valid && result.key) principalId = result.key.referenceId;
    } else {
      const result = await this.verifyBearerToken(credential);
      if (result.valid) principalId = result.ownerUserId ?? result.subject;
    }
    if (!principalId) return { valid: false };

    const planRow = await this.env.IDENTITY_DB.prepare(`
      SELECT COALESCE((SELECT plan_code FROM developer_profiles WHERE user_id = ?), 'basic') AS planCode
    `).bind(principalId).first<{ planCode: string }>();
    const planCode = planRow?.planCode ?? 'basic';

    let limitRow = await this.env.IDENTITY_DB.prepare(`
      SELECT requests_per_minute AS perMinute, requests_per_day AS perDay FROM plan_limits WHERE plan_code = ?
    `).bind(planCode).first<{ perMinute: number; perDay: number }>();
    if (!limitRow) {
      limitRow = await this.env.IDENTITY_DB.prepare(`
        SELECT requests_per_minute AS perMinute, requests_per_day AS perDay FROM plan_limits WHERE plan_code = 'basic'
      `).first<{ perMinute: number; perDay: number }>();
    }
    const limit = { perMinute: limitRow?.perMinute ?? 100, perDay: limitRow?.perDay ?? 5000 };

    const now = new Date();
    const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
    const dayStart = now.toISOString().slice(0, 10);

    const [minuteResult, dayResult] = await Promise.all([
      this.incrementRateLimitCounter(principalId, 'minute', minuteStart),
      this.incrementRateLimitCounter(principalId, 'day', dayStart),
    ]);

    const allowed = minuteResult <= limit.perMinute && dayResult <= limit.perDay;
    if (Math.random() < 0.01) {
      await this.env.IDENTITY_DB.prepare(
        "DELETE FROM rate_limit_counters WHERE (window_kind = 'minute' AND window_start < datetime('now', '-1 hour')) OR (window_kind = 'day' AND window_start < date('now', '-7 days'))",
      ).run();
    }

    return {
      valid: true,
      principalId,
      planCode,
      allowed,
      limit,
      remaining: {
        perMinute: Math.max(0, limit.perMinute - minuteResult),
        perDay: Math.max(0, limit.perDay - dayResult),
      },
      retryAfterSeconds: allowed ? undefined : (minuteResult > limit.perMinute ? 60 : 86400),
    };
  }

  private async incrementRateLimitCounter(credentialId: string, windowKind: 'minute' | 'day', windowStart: string): Promise<number> {
    const row = await this.env.IDENTITY_DB.prepare(`
      INSERT INTO rate_limit_counters (credential_id, window_kind, window_start, request_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT (credential_id, window_kind, window_start) DO UPDATE SET
        request_count = request_count + 1
      RETURNING request_count AS requestCount
    `).bind(credentialId, windowKind, windowStart).first<{ requestCount: number }>();
    return row?.requestCount ?? 1;
  }

  async getNamedQuery(id: string, ownerUserId: string): Promise<NamedQueryDefinition | null> {
    const row = await this.env.IDENTITY_DB.prepare(`
      SELECT id, owner_user_id AS ownerUserId, operation, parameters_json AS parametersJson,
        query_kind AS queryKind, object_name AS objectName, selected_fields_json AS selectedFieldsJson,
        filters_json AS filtersJson, sort_json AS sortJson, parameter_schema_json AS parameterSchemaJson,
        max_rows AS maxRows
      FROM named_queries WHERE (id = ? OR slug = ?) AND owner_user_id = ? AND status = 'active'
    `).bind(id, id, ownerUserId).first<Record<string, unknown>>();
    if (!row) return null;
    return {
      id: String(row.id),
      ownerUserId: String(row.ownerUserId),
      operation: row.operation as NamedQueryDefinition['operation'],
      parameters: JSON.parse(String(row.parametersJson)),
      queryKind: row.queryKind as NamedQueryDefinition['queryKind'],
      objectName: row.objectName as NamedQueryDefinition['objectName'],
      selectedFields: JSON.parse(String(row.selectedFieldsJson)),
      filters: JSON.parse(String(row.filtersJson)),
      sort: JSON.parse(String(row.sortJson)),
      parameterSchema: JSON.parse(String(row.parameterSchemaJson)),
      maxRows: Number(row.maxRows),
    };
  }

  async getServiceState(serviceKey: string): Promise<ServiceState> {
    const row = await this.env.IDENTITY_DB.prepare(`SELECT service_key AS serviceKey, status,
      maintenance_message AS message, enforcement FROM platform_services WHERE service_key = ?`).bind(serviceKey).first<ServiceState>();
    return row ?? { serviceKey, status: 'active', message: '', enforcement: 'none' };
  }

  async getMcpTools(ownerUserId: string, toolsetSlug?: string): Promise<McpToolDefinition[]> {
    const standard = toolsetSlug ? [] : STANDARD_MCP_TOOLS.map((tool) => ({ ...tool, toolType: 'standard' as const, standardToolName: tool.name }));
    const rows = await this.env.IDENTITY_DB.prepare(`SELECT tool.tool_name AS name, tool.description, tool.tool_type AS toolType,
      tool.standard_tool_name AS standardToolName, tool.named_query_id AS namedQueryId, tool.external_method AS externalMethod,
      tool.external_url AS externalUrl, tool.input_schema_json AS inputSchemaJson
      FROM mcp_toolset_tools tool JOIN mcp_toolsets toolset ON toolset.id = tool.toolset_id
      WHERE toolset.owner_user_id = ? AND toolset.status = 'active' AND tool.enabled = 1 AND tool.approval_status = 'approved'
        AND (? IS NULL OR toolset.slug = ?)`)
      .bind(ownerUserId, toolsetSlug ?? null, toolsetSlug ?? null).all<Record<string, unknown>>();
    return [...standard, ...rows.results.map((row) => ({ name: String(row.name), description: String(row.description), toolType: row.toolType as McpToolDefinition['toolType'], standardToolName: row.standardToolName ? String(row.standardToolName) : undefined, namedQueryId: row.namedQueryId ? String(row.namedQueryId) : undefined, externalMethod: row.externalMethod as McpToolDefinition['externalMethod'], externalUrl: row.externalUrl ? String(row.externalUrl) : undefined, inputSchema: JSON.parse(String(row.inputSchemaJson)) }))];
  }

  private async isUserActive(userId: string) {
    const profile = await this.env.IDENTITY_DB.prepare('SELECT status FROM developer_profiles WHERE user_id = ?').bind(userId).first<{ status: string }>();
    return !profile || profile.status === 'active';
  }

  private async auditDeveloperAction(userId: string, action: string, targetType: string, targetId: string) {
    await this.env.IDENTITY_DB.prepare(`
      INSERT INTO audit_events (
        id, actor_user_id, actor_type, action, target_type, target_id, details
      ) VALUES (?, ?, 'developer', ?, ?, ?, ?)
    `).bind(
      `audit_${crypto.randomUUID()}`,
      userId,
      action,
      targetType,
      targetId,
      JSON.stringify({ environment: this.env.PLATFORM_ENV }),
    ).run();
  }
}

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': allowedMethods,
    'Access-Control-Allow-Headers': allowedHeaders,
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'X-Request-ID, X-Fortress-Platform-Version, Server-Timing',
    Vary: 'Origin',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}

function requestIdFrom(request: Request) {
  const supplied = request.headers.get('X-Request-ID');
  if (supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return request.headers.get('CF-Ray') ?? crypto.randomUUID();
}

function applyOperationalHeaders(headers: Headers, requestId: string, duration: number) {
  headers.set('X-Request-ID', requestId);
  headers.set('X-Fortress-Platform-Version', PLATFORM_VERSION);
  headers.set('Server-Timing', `app;dur=${duration.toFixed(1)}`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function isDeveloperManagementRoute(pathname: string) {
  return pathname.startsWith('/api/auth/api-key/') || [
    '/api/auth/oauth2/create-client',
    '/api/auth/oauth2/get-clients',
    '/api/auth/oauth2/delete-client',
    '/api/auth/oauth2/update-client',
  ].includes(pathname);
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function invalidControlStatus() {
  return json({ error: { code: 'invalid_request', message: 'Choose active or disabled.' } }, 400);
}

function controlNotFound(resource: string) {
  return json({ error: { code: 'not_found', message: `${resource} was not found.` } }, 404);
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

function parseRecordQuery(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const allowedFields = ['id', 'legacyId', 'sequence', 'title', 'verificationStatus', 'partCount'];
  const selectedFields = Array.isArray(body.selectedFields) ? body.selectedFields.map(String).filter((field) => allowedFields.includes(field)) : [];
  const rawFilters = Array.isArray(body.filters) ? body.filters : [];
  const filters = rawFilters.slice(0, 10).map((item) => {
    const filter = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { field: String(filter.field ?? ''), operator: String(filter.operator ?? ''), source: filter.source === 'parameter' ? 'parameter' as const : 'literal' as const, value: String(filter.value ?? '').trim() };
  });
  const rawSort = body.sort && typeof body.sort === 'object' ? body.sort as Record<string, unknown> : {};
  const sort = { field: allowedFields.includes(String(rawSort.field)) ? String(rawSort.field) : 'sequence', direction: rawSort.direction === 'desc' ? 'desc' as const : 'asc' as const };
  const maxRows = Math.min(200, Math.max(1, Number(body.maxRows) || 50));
  if (name.length < 3 || name.length > 80) return { ok: false as const, message: 'Name must be 3-80 characters.' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false as const, message: 'Slug must use lowercase letters, numbers, and hyphens.' };
  if (description.length < 10 || description.length > 500) return { ok: false as const, message: 'Description must be 10-500 characters.' };
  if (!selectedFields.length) return { ok: false as const, message: 'Select at least one output field.' };
  const operators = ['eq', 'neq', 'contains', 'starts_with', 'gt', 'gte', 'lt', 'lte', 'in'];
  for (const filter of filters) {
    if (!allowedFields.includes(filter.field) || !operators.includes(filter.operator) || !filter.value) return { ok: false as const, message: 'Every filter needs an allowed field, operator, and value.' };
    if (filter.source === 'parameter' && !/^[a-z][a-zA-Z0-9_]{0,39}$/.test(filter.value)) return { ok: false as const, message: 'Parameter names must start with a letter and contain only letters, numbers, and underscores.' };
  }
  const parameterSchema = [...new Set(filters.filter((filter) => filter.source === 'parameter').map((filter) => filter.value))].map((parameterName) => ({
    name: parameterName,
    type: filters.some((filter) => filter.value === parameterName && filter.field === 'sequence') ? 'number' as const : 'string' as const,
    required: true,
  }));
  return { ok: true as const, value: { name, slug, description, objectName: 'duas' as const, selectedFields, filters, sort, parameterSchema, maxRows } };
}

function toNamedQueryResponse(row: Record<string, unknown>) {
  return {
    ...row,
    parameters: JSON.parse(String(row.parametersJson)),
    selectedFields: JSON.parse(String(row.selectedFieldsJson)),
    filters: JSON.parse(String(row.filtersJson)),
    sort: JSON.parse(String(row.sortJson)),
    parameterSchema: JSON.parse(String(row.parameterSchemaJson)),
    parametersJson: undefined, selectedFieldsJson: undefined, filtersJson: undefined, sortJson: undefined, parameterSchemaJson: undefined,
  };
}

async function parseToolDefinition(body: Record<string, unknown>, database: D1Database, ownerUserId: string) {
  const name = String(body.name ?? '').trim().toLowerCase(); const description = String(body.description ?? '').trim(); const toolType = String(body.toolType ?? '');
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(name)) return { ok: false as const, message: 'Tool names use lowercase letters, numbers, and underscores.' };
  if (description.length < 10 || description.length > 300) return { ok: false as const, message: 'Tool description must be 10-300 characters.' };
  if (toolType === 'standard') {
    const standardToolName = String(body.standardToolName ?? ''); const standard = STANDARD_MCP_TOOLS.find((tool) => tool.name === standardToolName);
    if (!standard) return { ok: false as const, message: 'Choose a standard Fortress tool.' };
    return { ok: true as const, value: { name, description, toolType, standardToolName, namedQueryId: null, externalMethod: null, externalUrl: null, inputSchema: standard.inputSchema, approvalStatus: 'approved' } };
  }
  if (toolType === 'named_query') {
    const namedQueryId = String(body.namedQueryId ?? ''); const query = await database.prepare("SELECT parameter_schema_json AS schema FROM named_queries WHERE id = ? AND owner_user_id = ? AND status = 'active'").bind(namedQueryId, ownerUserId).first<{ schema: string }>();
    if (!query) return { ok: false as const, message: 'Choose one of your active named queries.' };
    const parameters = JSON.parse(query.schema) as Array<{ name: string; type: string; required: boolean }>;
    const inputSchema = { type: 'object', properties: Object.fromEntries(parameters.map((parameter) => [parameter.name, { type: parameter.type }])), required: parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name) };
    return { ok: true as const, value: { name, description, toolType, standardToolName: null, namedQueryId, externalMethod: null, externalUrl: null, inputSchema, approvalStatus: 'approved' } };
  }
  if (toolType === 'external_api') {
    const externalMethod = ['GET', 'POST'].includes(String(body.externalMethod)) ? String(body.externalMethod) : 'GET'; const externalUrl = validHttpsUrl(body.externalUrl);
    if (!externalUrl) return { ok: false as const, message: 'External tools require a valid HTTPS endpoint.' };
    return { ok: true as const, value: { name, description, toolType, standardToolName: null, namedQueryId: null, externalMethod, externalUrl, inputSchema: { type: 'object', properties: {} }, approvalStatus: 'review_pending' } };
  }
  return { ok: false as const, message: 'Choose standard, named query, or external API.' };
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
