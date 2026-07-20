import type { Bindings } from './types';

type AdminUser = { id: string; name: string; email: string; image?: string | null };
type AdminGrant = { role: 'super_admin' | 'admin' | 'analyst' };

export async function handleAdminPlane(request: Request, url: URL, env: Bindings, user: AdminUser): Promise<Response> {
  const grant = await env.IDENTITY_DB.prepare(
    "SELECT role FROM platform_admins WHERE user_id = ? AND status = 'active'",
  ).bind(user.id).first<AdminGrant>();
  if (!grant) return json({ error: { code: 'forbidden', message: 'An active platform administrator role is required.' } }, 403);

  const requestId = request.headers.get('CF-Ray') ?? crypto.randomUUID();
  const context = { env, user, grant, requestId };

  if (url.pathname === '/v1/admin/session' && request.method === 'GET') {
    return json({ data: { user, role: grant.role, environment: env.PLATFORM_ENV } });
  }
  if (url.pathname === '/v1/admin/overview' && request.method === 'GET') return overview(context);
  if (url.pathname === '/v1/admin/search' && request.method === 'GET') return globalSearch(context, url);
  if (url.pathname === '/v1/admin/users' && request.method === 'GET') return listUsers(context, url);
  if (url.pathname === '/v1/admin/resources' && request.method === 'GET') return listResources(context, url);
  if (url.pathname === '/v1/admin/content' && request.method === 'GET') return listContent(context, url);
  if (url.pathname === '/v1/admin/services' && request.method === 'GET') return listServices(context);
  if (url.pathname === '/v1/admin/audit' && request.method === 'GET') return listAudit(context, url);

  const userMatch = url.pathname.match(/^\/v1\/admin\/users\/([^/]+)$/);
  if (userMatch && request.method === 'GET') return getUser(context, decodeURIComponent(userMatch[1]!));
  if (userMatch && request.method === 'PATCH') {
    if (!canWrite(grant.role)) return forbidden();
    return updateUser(context, decodeURIComponent(userMatch[1]!), await readJson(request));
  }

  const serviceMatch = url.pathname.match(/^\/v1\/admin\/services\/([a-z-]+)$/);
  if (serviceMatch && request.method === 'PATCH') {
    if (grant.role !== 'super_admin') return json({ error: { code: 'forbidden', message: 'Only a super administrator can change service state.' } }, 403);
    return updateService(context, serviceMatch[1]!, await readJson(request));
  }

  const actionMatch = url.pathname.match(/^\/v1\/admin\/(api-keys|oauth-clients|devices|mcp-servers|mcp-tools|named-queries)\/([^/]+)\/status$/);
  if (actionMatch && request.method === 'POST') {
    if (!canWrite(grant.role)) return forbidden();
    return updateResourceStatus(context, actionMatch[1]!, decodeURIComponent(actionMatch[2]!), await readJson(request));
  }

  const contentMatch = url.pathname.match(/^\/v1\/admin\/content\/([^/]+)$/);
  if (contentMatch && request.method === 'PATCH') {
    if (!canWrite(grant.role)) return forbidden();
    return updateContent(context, decodeURIComponent(contentMatch[1]!), await readJson(request));
  }

  return json({ error: { code: 'not_found', message: 'Admin route was not found.' } }, 404);
}

type AdminContext = {
  env: Bindings;
  user: AdminUser;
  grant: AdminGrant;
  requestId: string;
};

async function overview({ env }: AdminContext) {
  const identityQueries = [
    count(env.IDENTITY_DB, 'SELECT COUNT(*) AS count FROM "user"'),
    count(env.IDENTITY_DB, "SELECT COUNT(*) AS count FROM apikey WHERE enabled = 1 AND (expiresAt IS NULL OR expiresAt > datetime('now'))"),
    count(env.IDENTITY_DB, 'SELECT COUNT(*) AS count FROM "oauthClient" WHERE disabled IS NULL OR disabled = 0'),
    count(env.IDENTITY_DB, "SELECT COUNT(*) AS count FROM device_registrations WHERE status = 'active'"),
    count(env.IDENTITY_DB, "SELECT COUNT(*) AS count FROM mcp_toolsets WHERE status = 'active'"),
    count(env.IDENTITY_DB, "SELECT COUNT(*) AS count FROM access_requests WHERE status = 'pending'"),
  ];
  const [[users, apiKeys, oauthClients, devices, mcpServers, pendingRequests], content, services, audit] = await Promise.all([
    Promise.all(identityQueries),
    count(env.CONTENT_DB, 'SELECT COUNT(*) AS count FROM content_records'),
    env.IDENTITY_DB.prepare('SELECT service_key AS serviceKey, display_name AS displayName, status, enforcement, updated_at AS updatedAt FROM platform_services ORDER BY display_name').all(),
    env.IDENTITY_DB.prepare('SELECT occurred_at AS occurredAt, actor_type AS actorType, action, target_type AS targetType, target_id AS targetId, details FROM audit_events ORDER BY occurred_at DESC LIMIT 8').all(),
  ]);
  return json({ data: { counts: { users, apiKeys, oauthClients, devices, mcpServers, pendingRequests, content }, services: services.results, audit: audit.results } });
}

async function globalSearch({ env }: AdminContext, url: URL) {
  const query = cleanQuery(url.searchParams.get('q'));
  if (query.length < 2) return json({ data: [] });
  const like = `%${query}%`;
  const [users, keys, clients, devices, mcp, queries, content] = await Promise.all([
    env.IDENTITY_DB.prepare('SELECT id, name AS label, email AS detail FROM "user" WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, COALESCE(name, start, id) AS label, start AS detail FROM apikey WHERE name LIKE ? OR start LIKE ? ORDER BY createdAt DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT clientId AS id, COALESCE(name, clientId) AS label, clientId AS detail FROM "oauthClient" WHERE name LIKE ? OR clientId LIKE ? ORDER BY createdAt DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, device_type AS detail FROM device_registrations WHERE name LIKE ? OR id LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, status AS detail FROM mcp_toolsets WHERE name LIKE ? OR slug LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, operation AS detail FROM named_queries WHERE name LIKE ? OR slug LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.CONTENT_DB.prepare('SELECT id, title AS label, verification_status AS detail FROM content_records WHERE title LIKE ? OR id LIKE ? OR legacy_id LIKE ? ORDER BY sequence LIMIT 12').bind(like, like, like).all(),
  ]);
  return json({ data: [
    ...typed('user', users.results), ...typed('api-key', keys.results), ...typed('oauth-client', clients.results),
    ...typed('device', devices.results), ...typed('mcp-server', mcp.results), ...typed('named-query', queries.results),
    ...typed('content', content.results),
  ] });
}

async function listUsers({ env }: AdminContext, url: URL) {
  const query = cleanQuery(url.searchParams.get('q'));
  const status = url.searchParams.get('status');
  const like = `%${query}%`;
  const result = await env.IDENTITY_DB.prepare(`
    SELECT u.id, u.name, u.email, u.emailVerified AS emailVerified, u.createdAt AS createdAt,
           COALESCE(p.plan_code, 'basic') AS planCode, COALESCE(p.status, 'active') AS status,
           COUNT(DISTINCT k.id) AS apiKeyCount, COUNT(DISTINCT c.id) AS oauthClientCount
    FROM "user" u
    LEFT JOIN developer_profiles p ON p.user_id = u.id
    LEFT JOIN apikey k ON k.referenceId = u.id AND k.enabled = 1
    LEFT JOIN "oauthClient" c ON c.userId = u.id AND (c.disabled IS NULL OR c.disabled = 0)
    WHERE (? = '' OR u.name LIKE ? OR u.email LIKE ?)
      AND (? = '' OR COALESCE(p.status, 'active') = ?)
    GROUP BY u.id ORDER BY u.createdAt DESC LIMIT 100
  `).bind(query, like, like, status ?? '', status ?? '').all();
  return json({ data: result.results });
}

async function getUser({ env }: AdminContext, id: string) {
  const [user, keys, clients, devices, mcp, queries] = await Promise.all([
    env.IDENTITY_DB.prepare(`SELECT u.id, u.name, u.email, u.emailVerified AS emailVerified, u.createdAt AS createdAt,
      COALESCE(p.plan_code, 'basic') AS planCode, COALESCE(p.status, 'active') AS status
      FROM "user" u LEFT JOIN developer_profiles p ON p.user_id = u.id WHERE u.id = ?`).bind(id).first(),
    env.IDENTITY_DB.prepare('SELECT id, name, start, enabled, expiresAt, requestCount, createdAt FROM apikey WHERE referenceId = ? ORDER BY createdAt DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT clientId, name, disabled, grantTypes, createdAt FROM "oauthClient" WHERE userId = ? ORDER BY createdAt DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT id, name, device_type AS deviceType, status, created_at AS createdAt FROM device_registrations WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT id, name, status, created_at AS createdAt FROM mcp_toolsets WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT id, name, operation, status, created_at AS createdAt FROM named_queries WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 25').bind(id).all(),
  ]);
  if (!user) return json({ error: { code: 'not_found', message: 'User was not found.' } }, 404);
  return json({ data: { user, apiKeys: keys.results, oauthClients: clients.results, devices: devices.results, mcpServers: mcp.results, namedQueries: queries.results } });
}

async function updateUser(context: AdminContext, id: string, body: Record<string, unknown>) {
  const status = body.status;
  if (!['active', 'suspended', 'closed'].includes(String(status))) return invalid('Choose active, suspended, or closed.');
  if (id === context.user.id && status !== 'active') return invalid('You cannot suspend or close your own administrator account.');
  const exists = await context.env.IDENTITY_DB.prepare('SELECT 1 FROM "user" WHERE id = ?').bind(id).first();
  if (!exists) return json({ error: { code: 'not_found', message: 'User was not found.' } }, 404);
  await context.env.IDENTITY_DB.prepare(`INSERT INTO developer_profiles (user_id, status) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP`).bind(id, status).run();
  if (status !== 'active') await context.env.IDENTITY_DB.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(id).run();
  await audit(context, 'user.status_changed', 'user', id, { status });
  return json({ data: { id, status } });
}

async function listResources({ env }: AdminContext, url: URL) {
  const type = url.searchParams.get('type');
  const definitions: Record<string, string> = {
    'api-keys': 'SELECT k.id, k.name, k.start, k.enabled AS status, k.expiresAt, k.requestCount, k.createdAt, u.name AS ownerName, u.email AS ownerEmail FROM apikey k LEFT JOIN "user" u ON u.id = k.referenceId ORDER BY k.createdAt DESC LIMIT 100',
    'oauth-clients': 'SELECT c.clientId AS id, c.name, c.disabled AS status, c.grantTypes, c.createdAt, u.name AS ownerName, u.email AS ownerEmail FROM "oauthClient" c LEFT JOIN "user" u ON u.id = c.userId ORDER BY c.createdAt DESC LIMIT 100',
    devices: 'SELECT d.id, d.name, d.device_type AS detail, d.status, d.created_at AS createdAt, u.name AS ownerName, u.email AS ownerEmail FROM device_registrations d LEFT JOIN "user" u ON u.id = d.owner_user_id ORDER BY d.created_at DESC LIMIT 100',
    'mcp-servers': 'SELECT m.id, m.name, m.slug AS detail, m.status, m.created_at AS createdAt, u.name AS ownerName, u.email AS ownerEmail FROM mcp_toolsets m LEFT JOIN "user" u ON u.id = m.owner_user_id ORDER BY m.created_at DESC LIMIT 100',
    'mcp-tools': 'SELECT t.id, t.tool_name AS name, t.external_url AS detail, t.approval_status AS status, t.created_at AS createdAt, u.name AS ownerName, u.email AS ownerEmail FROM mcp_toolset_tools t JOIN mcp_toolsets s ON s.id = t.toolset_id LEFT JOIN "user" u ON u.id = s.owner_user_id WHERE t.tool_type = \'external_api\' ORDER BY t.created_at DESC LIMIT 100',
    'named-queries': 'SELECT q.id, q.name, q.operation AS detail, q.status, q.created_at AS createdAt, u.name AS ownerName, u.email AS ownerEmail FROM named_queries q LEFT JOIN "user" u ON u.id = q.owner_user_id ORDER BY q.created_at DESC LIMIT 100',
  };
  if (!type || !definitions[type]) return invalid('Choose a supported resource type.');
  const result = await env.IDENTITY_DB.prepare(definitions[type]).all();
  return json({ data: result.results });
}

async function updateResourceStatus(context: AdminContext, type: string, id: string, body: Record<string, unknown>) {
  const requested = String(body.status ?? '');
  const config: Record<string, { sql: string; allowed: string[] }> = {
    'api-keys': { sql: 'UPDATE apikey SET enabled = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', allowed: ['active', 'revoked'] },
    'oauth-clients': { sql: 'UPDATE "oauthClient" SET disabled = ?, updatedAt = CURRENT_TIMESTAMP WHERE clientId = ?', allowed: ['active', 'disabled'] },
    devices: { sql: "UPDATE device_registrations SET status = ?, revoked_at = CASE WHEN ? = 'revoked' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?", allowed: ['active', 'revoked'] },
    'mcp-servers': { sql: 'UPDATE mcp_toolsets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', allowed: ['active', 'disabled'] },
    'mcp-tools': { sql: 'UPDATE mcp_toolset_tools SET approval_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', allowed: ['review_pending', 'approved', 'rejected'] },
    'named-queries': { sql: 'UPDATE named_queries SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', allowed: ['active', 'disabled'] },
  };
  const item = config[type];
  if (!item || !item.allowed.includes(requested)) return invalid('Choose a valid resource status.');
  let result;
  if (type === 'api-keys') result = await context.env.IDENTITY_DB.prepare(item.sql).bind(requested === 'active' ? 1 : 0, id).run();
  else if (type === 'oauth-clients') result = await context.env.IDENTITY_DB.prepare(item.sql).bind(requested === 'active' ? 0 : 1, id).run();
  else if (type === 'devices') result = await context.env.IDENTITY_DB.prepare(item.sql).bind(requested, requested, id).run();
  else result = await context.env.IDENTITY_DB.prepare(item.sql).bind(requested, id).run();
  if (!result.meta.changes) return json({ error: { code: 'not_found', message: 'Resource was not found.' } }, 404);
  await audit(context, `${type}.status_changed`, type, id, { status: requested });
  return json({ data: { id, status: requested } });
}

async function listContent({ env }: AdminContext, url: URL) {
  const query = cleanQuery(url.searchParams.get('q'));
  const status = url.searchParams.get('status') ?? '';
  const like = `%${query}%`;
  const result = await env.CONTENT_DB.prepare(`SELECT id, legacy_id AS legacyId, sequence, title, content_type AS contentType,
    verification_status AS status, updated_at AS updatedAt FROM content_records
    WHERE (? = '' OR title LIKE ? OR id LIKE ? OR legacy_id LIKE ?) AND (? = '' OR verification_status = ?)
    ORDER BY sequence LIMIT 150`).bind(query, like, like, like, status, status).all();
  return json({ data: result.results });
}

async function updateContent(context: AdminContext, id: string, body: Record<string, unknown>) {
  const status = String(body.status ?? '');
  if (!['pending', 'verified', 'rejected', 'deprecated'].includes(status)) return invalid('Choose a valid verification status.');
  const current = await context.env.CONTENT_DB.prepare(
    'SELECT verification_status AS status FROM content_records WHERE id = ?',
  ).bind(id).first<{ status: string }>();
  if (!current) return json({ error: { code: 'not_found', message: 'Content record was not found.' } }, 404);

  if (status === 'verified') {
    const evidence = await context.env.CONTENT_DB.prepare(`
      SELECT COUNT(*) AS count
      FROM source_references reference
      JOIN source_materials source ON source.id = reference.source_id
      WHERE reference.record_id = ? AND reference.verification_status = 'verified'
        AND source.authenticity_status = 'trusted' AND source.license_status = 'approved'
    `).bind(id).first<{ count: number }>();
    if (!evidence?.count) return invalid('Add a verified reference from a trusted, approved source before verifying religious content.');
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null;
  const occurredAt = new Date().toISOString();
  const details = JSON.stringify({ previousStatus: current.status, status, notes });
  const [result] = await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(
      'UPDATE content_records SET verification_status = ?, updated_at = ? WHERE id = ?',
    ).bind(status, occurredAt, id),
    context.env.CONTENT_DB.prepare(`INSERT INTO verification_records
      (id, target_type, target_id, status, reviewer_external_id, method, notes, reviewed_at)
      VALUES (?, 'record', ?, ?, ?, 'admin_editorial_review', ?, ?)`)
      .bind(`verify_${crypto.randomUUID()}`, id, status, context.user.id, notes, occurredAt),
    context.env.CONTENT_DB.prepare(`INSERT INTO content_audit_events
      (id, occurred_at, actor_type, actor_external_id, action, target_type, target_id, request_id, details_json)
      VALUES (?, ?, 'admin', ?, 'content.verification_changed', 'record', ?, ?, ?)`)
      .bind(`caud_${crypto.randomUUID()}`, occurredAt, context.user.id, id, context.requestId, details),
  ]);
  if (!result?.meta.changes) return json({ error: { code: 'conflict', message: 'Content status was not changed.' } }, 409);
  await audit(context, 'content.verification_changed', 'content', id, { previousStatus: current.status, status, notes });
  return json({ data: { id, status } });
}

async function listServices({ env }: AdminContext) {
  const result = await env.IDENTITY_DB.prepare('SELECT service_key AS serviceKey, display_name AS displayName, service_type AS serviceType, base_url AS baseUrl, status, enforcement, maintenance_message AS maintenanceMessage, updated_at AS updatedAt FROM platform_services ORDER BY display_name').all();
  return json({ data: result.results });
}

async function updateService(context: AdminContext, key: string, body: Record<string, unknown>) {
  const status = String(body.status ?? '');
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 240) : 'This service is temporarily unavailable.';
  if (!['active', 'maintenance', 'disabled'].includes(status)) return invalid('Choose active, maintenance, or disabled.');
  if (key === 'admin' && status !== 'active') return invalid('The Admin Console cannot disable itself.');
  const service = await context.env.IDENTITY_DB.prepare('SELECT enforcement FROM platform_services WHERE service_key = ?').bind(key).first<{ enforcement: string }>();
  if (!service) return json({ error: { code: 'not_found', message: 'Service was not found.' } }, 404);
  if (service.enforcement !== 'worker') return invalid('This service is monitored here but is not yet behind an enforceable Worker gate.');
  await context.env.IDENTITY_DB.prepare('UPDATE platform_services SET status = ?, maintenance_message = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE service_key = ?').bind(status, message, context.user.id, key).run();
  await audit(context, 'service.status_changed', 'service', key, { status, message });
  return json({ data: { serviceKey: key, status, maintenanceMessage: message } });
}

async function listAudit({ env }: AdminContext, url: URL) {
  const target = cleanQuery(url.searchParams.get('q'));
  const like = `%${target}%`;
  const result = await env.IDENTITY_DB.prepare(`SELECT a.id, a.occurred_at AS occurredAt, a.actor_user_id AS actorUserId,
    COALESCE(u.name, a.actor_type) AS actorName, a.action, a.target_type AS targetType, a.target_id AS targetId, a.request_id AS requestId, a.details
    FROM audit_events a LEFT JOIN "user" u ON u.id = a.actor_user_id
    WHERE (? = '' OR a.action LIKE ? OR a.target_id LIKE ? OR u.email LIKE ?)
    ORDER BY a.occurred_at DESC LIMIT 200`).bind(target, like, like, like).all();
  return json({ data: result.results });
}

async function audit(context: AdminContext, action: string, targetType: string, targetId: string, details: unknown) {
  await context.env.IDENTITY_DB.prepare(`INSERT INTO audit_events
    (id, actor_user_id, actor_type, action, target_type, target_id, request_id, details)
    VALUES (?, ?, 'admin', ?, ?, ?, ?, ?)`)
    .bind(`aud_${crypto.randomUUID()}`, context.user.id, action, targetType, targetId, context.requestId, JSON.stringify(details)).run();
}

async function count(db: D1Database, sql: string) {
  const row = await db.prepare(sql).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function typed(type: string, rows: unknown[]) {
  return rows.map((row) => ({ type, ...(row as Record<string, unknown>) }));
}

function canWrite(role: AdminGrant['role']) {
  return role === 'super_admin' || role === 'admin';
}

function cleanQuery(value: string | null) {
  return (value ?? '').trim().slice(0, 120);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
}

function forbidden() {
  return json({ error: { code: 'forbidden', message: 'This administrator role is read-only.' } }, 403);
}

function invalid(message: string) {
  return json({ error: { code: 'invalid_request', message } }, 400);
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
