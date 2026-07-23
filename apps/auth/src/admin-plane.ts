import type { Bindings } from './types';
import {
  EditorialForbiddenError,
  handleEditorialPlane,
  type EditorialRole,
} from './editorial-plane';

type AdminUser = { id: string; name: string; email: string; image?: string | null };
type AdminSession = { id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; ipAddress?: string | null; userAgent?: string | null; userId: string };
type AdminGrant = { role: 'super_admin' | 'admin' | 'analyst' };
type PlatformRole = 'admin' | 'editor' | 'reviewer' | 'developer';
type AdminContext = {
  env: Bindings;
  user: AdminUser;
  grant: AdminGrant;
  requestId: string;
};

export async function handleAdminPlane(
  request: Request,
  url: URL,
  env: Bindings,
  user: AdminUser,
  currentSession: AdminSession,
  requestId?: string,
): Promise<Response> {
  await bootstrapDefaultAdmin(env, user);
  const access = await env.IDENTITY_DB.prepare(`
    SELECT role.role, role.status, identity.is_admin AS isAdmin
    FROM "user" identity
    LEFT JOIN platform_role_grants role ON role.user_id = identity.id
    WHERE identity.id = ?
  `).bind(user.id).first<{ role: PlatformRole | null; status: string | null; isAdmin: number }>();
  if (
    !access
    || access.status !== 'active'
    || !access.role
    || access.role === 'developer'
    || (access.role === 'admin' && access.isAdmin !== 1)
  ) {
    return json({ error: { code: 'forbidden', message: 'An active Admin, Editor, or Reviewer role is required.' } }, 403);
  }
  const sessionStartedAt = new Date(currentSession.createdAt).getTime();
  if (Number.isFinite(sessionStartedAt) && Date.now() - sessionStartedAt > 12 * 60 * 60 * 1000) {
    await env.IDENTITY_DB.prepare('DELETE FROM "session" WHERE id = ?').bind(currentSession.id).run();
    return json({
      error: {
        code: 'admin_session_expired',
        message: 'Admin sessions expire after 12 hours. Sign in again to continue.',
      },
    }, 401);
  }
  const editorialRole = access.role as EditorialRole;
  const grant: AdminGrant = { role: access.role === 'admin' ? 'super_admin' : 'analyst' };
  const context: AdminContext = {
    env,
    user,
    grant,
    requestId: requestId ?? request.headers.get('CF-Ray') ?? crypto.randomUUID(),
  };

  if (url.pathname === '/v1/admin/session' && request.method === 'GET') {
    return json({
      data: {
        user,
        role: access.role,
        editorialRole,
        isAdmin: access.isAdmin === 1,
        environment: env.PLATFORM_ENV,
        security: {
          twoFactorEnabled: Boolean((user as AdminUser & { twoFactorEnabled?: boolean }).twoFactorEnabled),
          sessionId: currentSession.id,
          sessionExpiresAt: currentSession.expiresAt,
        },
      },
    });
  }

  try {
    const response = await handleEditorialPlane(request, url, {
      env,
      user,
      role: editorialRole,
      requestId: context.requestId,
    });
    if (response) return response;
  } catch (error) {
    if (error instanceof EditorialForbiddenError) {
      return json({ error: { code: 'forbidden', message: 'This editorial role cannot perform that action.' } }, 403);
    }
    throw error;
  }

  if (access.role !== 'admin') {
    return forbidden('Only administrators can access platform management.');
  }

  if (
    url.pathname.startsWith('/v1/admin/sources')
    || url.pathname.startsWith('/v1/admin/references')
    || url.pathname.startsWith('/v1/admin/content')
  ) {
    return json({ error: { code: 'not_found', message: 'This route is not exposed.' } }, 404);
  }

  if (url.pathname === '/v1/admin/overview' && request.method === 'GET') return overview(context);
  if (url.pathname === '/v1/admin/operations' && request.method === 'GET') return operations(context);
  if (url.pathname === '/v1/admin/sessions' && request.method === 'GET') return listSessions(context, user.id, currentSession.id);
  if (url.pathname === '/v1/admin/search' && request.method === 'GET') return globalSearch(context, url);
  if (url.pathname === '/v1/admin/users' && request.method === 'GET') return listUsers(context, url);
  if (url.pathname === '/v1/admin/resources' && request.method === 'GET') return listResources(context, url);
  if (url.pathname === '/v1/admin/taxonomy' && request.method === 'GET') return listTaxonomy(context, url);
  if (url.pathname === '/v1/admin/taxonomy' && request.method === 'POST') {
    if (!canWrite(grant.role)) return forbidden();
    return createTaxonomyTerm(context, await readJson(request));
  }
  if (url.pathname === '/v1/admin/services' && request.method === 'GET') return listServices(context);
  if (url.pathname === '/v1/admin/audit' && request.method === 'GET') return listAudit(context, url);

  const userMatch = url.pathname.match(/^\/v1\/admin\/users\/([^/]+)$/);
  if (userMatch && request.method === 'GET') return getUser(context, decodeURIComponent(userMatch[1]!));
  if (userMatch && request.method === 'PATCH') {
    if (!canWrite(grant.role)) return forbidden();
    return updateUser(context, decodeURIComponent(userMatch[1]!), await readJson(request));
  }

  const sessionMatch = url.pathname.match(/^\/v1\/admin\/sessions\/([^/]+)$/);
  if (sessionMatch && request.method === 'DELETE') {
    return revokeSession(context, decodeURIComponent(sessionMatch[1]!), currentSession.id);
  }

  const serviceMatch = url.pathname.match(/^\/v1\/admin\/services\/([a-z-]+)$/);
  if (serviceMatch && request.method === 'PATCH') {
    if (grant.role !== 'super_admin') return forbidden('Only a super administrator can change service state.');
    return updateService(context, serviceMatch[1]!, await readJson(request));
  }

  const actionMatch = url.pathname.match(
    /^\/v1\/admin\/(api-keys|oauth-clients|devices|mcp-servers|mcp-tools|named-queries)\/([^/]+)\/status$/,
  );
  if (actionMatch && request.method === 'POST') {
    if (!canWrite(grant.role)) return forbidden();
    return updateResourceStatus(context, actionMatch[1]!, decodeURIComponent(actionMatch[2]!), await readJson(request));
  }

  return json({ error: { code: 'not_found', message: 'Admin route was not found.' } }, 404);
}

async function bootstrapDefaultAdmin(env: Bindings, user: AdminUser) {
  if (user.email.trim().toLowerCase() !== 'ziyadahmed910@gmail.com') return;
  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare('UPDATE "user" SET is_admin = 1 WHERE id = ?').bind(user.id),
    env.IDENTITY_DB.prepare(`
      INSERT INTO platform_role_grants (user_id, role, status)
      VALUES (?, 'admin', 'active')
      ON CONFLICT(user_id) DO UPDATE SET
        role = 'admin',
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    `).bind(user.id),
  ]);
}

async function overview({ env }: AdminContext) {
  const [identityCounts, editorialCounts, services, audit] = await Promise.all([
    Promise.all([
      count(env.IDENTITY_DB, 'SELECT COUNT(*) AS count FROM "user"'),
      count(env.IDENTITY_DB, "SELECT COUNT(*) AS count FROM apikey WHERE enabled = 1 AND (expiresAt IS NULL OR expiresAt > datetime('now'))"),
      count(env.IDENTITY_DB, 'SELECT COUNT(*) AS count FROM "oauthClient" WHERE disabled IS NULL OR disabled = 0'),
      count(env.IDENTITY_DB, "SELECT COUNT(*) AS count FROM device_registrations WHERE status = 'active'"),
      count(env.IDENTITY_DB, "SELECT COUNT(*) AS count FROM mcp_toolsets WHERE status = 'active'"),
      count(env.IDENTITY_DB, "SELECT COUNT(*) AS count FROM access_requests WHERE status = 'pending'"),
    ]),
    Promise.all([
      count(env.CONTENT_DB, 'SELECT COUNT(*) AS count FROM canonical_records'),
      count(env.CONTENT_DB, "SELECT COUNT(*) AS count FROM editorial_record_state WHERE workflow_state NOT IN ('published', 'superseded')"),
      count(env.CONTENT_DB, "SELECT COUNT(*) AS count FROM canonical_publications WHERE publication_status = 'published'"),
      count(env.CONTENT_DB, "SELECT COUNT(*) AS count FROM disagreement_queue WHERE status = 'open'"),
    ]),
    env.IDENTITY_DB.prepare(
      'SELECT service_key AS serviceKey, display_name AS displayName, status, enforcement, updated_at AS updatedAt FROM platform_services ORDER BY display_name',
    ).all(),
    env.IDENTITY_DB.prepare(
      'SELECT occurred_at AS occurredAt, actor_type AS actorType, action, target_type AS targetType, target_id AS targetId, details FROM audit_events ORDER BY occurred_at DESC LIMIT 8',
    ).all(),
  ]);
  const [users, apiKeys, oauthClients, devices, mcpServers, pendingRequests] = identityCounts;
  const [canonicalRecords, pendingEditorial, publishedRecords, disagreements] = editorialCounts;
  return json({
    data: {
      counts: {
        users,
        apiKeys,
        oauthClients,
        devices,
        mcpServers,
        pendingRequests,
        canonicalRecords,
        pendingEditorial,
        publishedRecords,
        disagreements,
      },
      services: services.results,
      audit: audit.results,
    },
  });
}

async function operations({ env }: AdminContext) {
  const [traffic, routes, credentials, sessions, accessQueue, editorialQueue, services] = await Promise.all([
    env.IDENTITY_DB.prepare(`
      SELECT service,
        SUM(request_units) AS requests,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors,
        ROUND(AVG(duration_ms), 1) AS averageDurationMs,
        MAX(duration_ms) AS maximumDurationMs
      FROM usage_events
      WHERE occurred_at >= datetime('now', '-24 hours') AND environment = ?
      GROUP BY service ORDER BY requests DESC
    `).bind(env.PLATFORM_ENV).all(),
    env.IDENTITY_DB.prepare(`
      SELECT route, SUM(request_units) AS requests,
        SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END) AS rateLimited,
        SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS serverErrors,
        ROUND(AVG(duration_ms), 1) AS averageDurationMs
      FROM usage_events
      WHERE occurred_at >= datetime('now', '-24 hours') AND environment = ?
      GROUP BY route ORDER BY requests DESC LIMIT 12
    `).bind(env.PLATFORM_ENV).all(),
    env.IDENTITY_DB.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN enabled = 1 AND (expiresAt IS NULL OR expiresAt > datetime('now')) THEN 1 ELSE 0 END) AS active,
        COALESCE(SUM(requestCount), 0) AS requests,
        SUM(CASE WHEN rateLimitEnabled = 1 THEN 1 ELSE 0 END) AS rateLimitedKeys
      FROM apikey
    `).first(),
    env.IDENTITY_DB.prepare(`
      SELECT COUNT(*) AS active,
        COUNT(DISTINCT "userId") AS users,
        MIN(expiresAt) AS nextExpiry
      FROM "session" WHERE expiresAt > datetime('now')
    `).first(),
    env.IDENTITY_DB.prepare(`
      SELECT request_type AS type, COUNT(*) AS count
      FROM access_requests WHERE status = 'pending'
      GROUP BY request_type ORDER BY count DESC
    `).all(),
    env.CONTENT_DB.prepare(`
      SELECT workflow_state AS state, COUNT(*) AS count
      FROM editorial_record_state
      WHERE workflow_state NOT IN ('published', 'superseded')
      GROUP BY workflow_state ORDER BY count DESC
    `).all(),
    env.IDENTITY_DB.prepare(`
      SELECT service_key AS serviceKey, display_name AS displayName, service_type AS serviceType,
        base_url AS baseUrl, status, enforcement, updated_at AS updatedAt
      FROM platform_services ORDER BY display_name
    `).all(),
  ]);
  return json({
    data: {
      window: '24h',
      generatedAt: new Date().toISOString(),
      traffic: traffic.results,
      routes: routes.results,
      credentials,
      sessions,
      queues: {
        access: accessQueue.results,
        editorial: editorialQueue.results,
      },
      deployments: services.results,
    },
  });
}

async function listSessions({ env }: AdminContext, userId: string, currentSessionId: string) {
  const rows = await env.IDENTITY_DB.prepare(`
    SELECT id, createdAt, updatedAt, expiresAt, ipAddress, userAgent
    FROM "session" WHERE "userId" = ? AND expiresAt > datetime('now')
    ORDER BY updatedAt DESC
  `).bind(userId).all<Record<string, unknown>>();
  return json({
    data: rows.results.map((row) => ({
      ...row,
      current: row.id === currentSessionId,
    })),
  });
}

async function revokeSession(context: AdminContext, sessionId: string, currentSessionId: string) {
  if (sessionId === currentSessionId) {
    return invalid('Use Sign out to end the current Admin session.');
  }
  const session = await context.env.IDENTITY_DB.prepare(
    'SELECT id, "userId" AS userId FROM "session" WHERE id = ?',
  ).bind(sessionId).first<{ id: string; userId: string }>();
  if (!session) return json({ error: { code: 'not_found', message: 'Session was not found.' } }, 404);
  await context.env.IDENTITY_DB.prepare('DELETE FROM "session" WHERE id = ?').bind(sessionId).run();
  await audit(context, 'session.revoked', 'session', sessionId, { userId: session.userId });
  return new Response(null, { status: 204 });
}

async function globalSearch({ env }: AdminContext, url: URL) {
  const query = cleanQuery(url.searchParams.get('q'));
  if (query.length < 2) return json({ data: [] });
  const like = `%${query}%`;
  const [users, keys, clients, devices, mcp, queries, records] = await Promise.all([
    env.IDENTITY_DB.prepare('SELECT id, name AS label, email AS detail FROM "user" WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, COALESCE(name, start, id) AS label, start AS detail FROM apikey WHERE name LIKE ? OR start LIKE ? ORDER BY createdAt DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT clientId AS id, COALESCE(name, clientId) AS label, clientId AS detail FROM "oauthClient" WHERE name LIKE ? OR clientId LIKE ? ORDER BY createdAt DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, device_type AS detail FROM device_registrations WHERE name LIKE ? OR id LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, status AS detail FROM mcp_toolsets WHERE name LIKE ? OR slug LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, operation AS detail FROM named_queries WHERE name LIKE ? OR slug LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.CONTENT_DB.prepare(`
      SELECT record.canonical_id AS id, revision.title AS label, state.workflow_state AS detail
      FROM canonical_records record
      JOIN editorial_record_state state ON state.record_id = record.id
      JOIN content_revisions revision ON revision.id = state.current_revision_id
      WHERE revision.title LIKE ? OR record.id LIKE ? OR revision.legacy_id LIKE ?
      ORDER BY revision.sequence LIMIT 12
    `).bind(like, like, like).all(),
  ]);
  return json({
    data: [
      ...typed('user', users.results),
      ...typed('api-key', keys.results),
      ...typed('oauth-client', clients.results),
      ...typed('device', devices.results),
      ...typed('mcp-server', mcp.results),
      ...typed('named-query', queries.results),
      ...typed('editorial-record', records.results),
    ],
  });
}

async function listUsers({ env }: AdminContext, url: URL) {
  const query = cleanQuery(url.searchParams.get('q'));
  const status = url.searchParams.get('status') ?? '';
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
  `).bind(query, like, like, status, status).all();
  return json({ data: result.results });
}

async function getUser({ env }: AdminContext, id: string) {
  const [user, keys, clients, devices, mcp, queries, sessions] = await Promise.all([
    env.IDENTITY_DB.prepare(`SELECT u.id, u.name, u.email, u.emailVerified AS emailVerified, u.createdAt AS createdAt,
      COALESCE(p.plan_code, 'basic') AS planCode, COALESCE(p.status, 'active') AS status
      FROM "user" u LEFT JOIN developer_profiles p ON p.user_id = u.id WHERE u.id = ?`).bind(id).first(),
    env.IDENTITY_DB.prepare('SELECT id, name, start, enabled, expiresAt, requestCount, createdAt FROM apikey WHERE referenceId = ? ORDER BY createdAt DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT clientId, name, disabled, grantTypes, createdAt FROM "oauthClient" WHERE userId = ? ORDER BY createdAt DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT id, name, device_type AS deviceType, status, created_at AS createdAt FROM device_registrations WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT id, name, status, created_at AS createdAt FROM mcp_toolsets WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT id, name, operation, status, created_at AS createdAt FROM named_queries WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 25').bind(id).all(),
    env.IDENTITY_DB.prepare('SELECT id, createdAt, updatedAt, expiresAt, ipAddress, userAgent FROM "session" WHERE "userId" = ? AND expiresAt > datetime(\'now\') ORDER BY updatedAt DESC LIMIT 25').bind(id).all(),
  ]);
  if (!user) return json({ error: { code: 'not_found', message: 'User was not found.' } }, 404);
  return json({ data: { user, apiKeys: keys.results, oauthClients: clients.results, devices: devices.results, mcpServers: mcp.results, namedQueries: queries.results, sessions: sessions.results } });
}

async function updateUser(context: AdminContext, id: string, body: Record<string, unknown>) {
  const status = String(body.status ?? '');
  if (!['active', 'suspended', 'closed'].includes(status)) return invalid('Choose active, suspended, or closed.');
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
    'mcp-tools': "SELECT t.id, t.tool_name AS name, t.external_url AS detail, t.approval_status AS status, t.created_at AS createdAt, u.name AS ownerName, u.email AS ownerEmail FROM mcp_toolset_tools t JOIN mcp_toolsets s ON s.id = t.toolset_id LEFT JOIN \"user\" u ON u.id = s.owner_user_id WHERE t.tool_type = 'external_api' ORDER BY t.created_at DESC LIMIT 100",
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

async function listTaxonomy({ env }: AdminContext, url: URL) {
  const query = cleanQuery(url.searchParams.get('q'));
  const type = cleanQuery(url.searchParams.get('type'));
  const like = `%${query}%`;
  const result = await env.CONTENT_DB.prepare(`SELECT term.id, term.taxonomy_type AS type, term.slug, term.label,
    term.language_code AS languageCode, term.description, COUNT(assignment.record_id) AS recordCount
    FROM taxonomy_terms term LEFT JOIN record_taxonomy assignment ON assignment.term_id = term.id
    WHERE (? = '' OR term.label LIKE ? OR term.slug LIKE ?) AND (? = '' OR term.taxonomy_type = ?)
    GROUP BY term.id ORDER BY term.taxonomy_type, term.label LIMIT 250`)
    .bind(query, like, like, type, type).all();
  return json({ data: result.results });
}

async function createTaxonomyTerm(context: AdminContext, body: Record<string, unknown>) {
  const type = String(body.type ?? '');
  const slug = String(body.slug ?? '').trim().toLocaleLowerCase();
  const label = String(body.label ?? '').trim();
  const languageCode = String(body.languageCode ?? 'en').trim();
  const description = optionalText(body.description, 500);
  if (!['category', 'topic', 'tag', 'keyword', 'mood', 'occasion'].includes(type)) return invalid('Choose a supported taxonomy type.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || label.length < 2 || label.length > 100) return invalid('Enter a label and a lowercase hyphenated slug.');
  const language = await context.env.CONTENT_DB.prepare("SELECT 1 FROM languages WHERE code = ? AND status = 'active'").bind(languageCode).first();
  if (!language) return invalid('Choose an active language code.');
  const id = `term.${type}.${crypto.randomUUID()}`;
  try {
    await context.env.CONTENT_DB.prepare(`INSERT INTO taxonomy_terms
      (id, taxonomy_type, slug, label, language_code, description) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, type, slug, label, languageCode, description).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) return json({ error: { code: 'conflict', message: 'That taxonomy slug already exists.' } }, 409);
    throw error;
  }
  await audit(context, 'taxonomy.created', 'taxonomy', id, { type, slug, label, languageCode });
  return json({ data: { id, type, slug, label, languageCode, description, recordCount: 0 } }, 201);
}

async function listServices({ env }: AdminContext) {
  const result = await env.IDENTITY_DB.prepare(
    'SELECT service_key AS serviceKey, display_name AS displayName, service_type AS serviceType, base_url AS baseUrl, status, enforcement, maintenance_message AS maintenanceMessage, updated_at AS updatedAt FROM platform_services ORDER BY display_name',
  ).all();
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
  await context.env.IDENTITY_DB.prepare(
    'UPDATE platform_services SET status = ?, maintenance_message = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE service_key = ?',
  ).bind(status, message, context.user.id, key).run();
  await audit(context, 'service.status_changed', 'service', key, { status, message });
  return json({ data: { serviceKey: key, status, maintenanceMessage: message } });
}

async function listAudit({ env }: AdminContext, url: URL) {
  const target = cleanQuery(url.searchParams.get('q'));
  const like = `%${target}%`;
  const [identity, content, users] = await Promise.all([
    env.IDENTITY_DB.prepare(`SELECT a.id, a.occurred_at AS occurredAt, a.actor_user_id AS actorUserId,
      COALESCE(u.name, a.actor_type) AS actorName, a.action, a.target_type AS targetType,
      a.target_id AS targetId, a.request_id AS requestId, a.details
      FROM audit_events a LEFT JOIN "user" u ON u.id = a.actor_user_id
      WHERE (? = '' OR a.action LIKE ? OR a.target_id LIKE ? OR u.email LIKE ?)
      ORDER BY a.occurred_at DESC LIMIT 200`).bind(target, like, like, like).all<Record<string, unknown>>(),
    env.CONTENT_DB.prepare(`
      SELECT id, occurred_at AS occurredAt, actor_external_id AS actorUserId,
             actor_type AS actorName, action, target_type AS targetType,
             target_id AS targetId, request_id AS requestId, details_json AS details
      FROM content_audit_events
      WHERE (? = '' OR action LIKE ? OR target_id LIKE ? OR actor_external_id LIKE ?)
      ORDER BY occurred_at DESC LIMIT 200
    `).bind(target, like, like, like).all<Record<string, unknown>>(),
    env.IDENTITY_DB.prepare('SELECT id, name, email FROM "user" LIMIT 1000').all<{
      id: string;
      name: string;
      email: string;
    }>(),
  ]);
  const identities = new Map(users.results.map((user) => [user.id, user]));
  const rows = [...identity.results, ...content.results]
    .map((row) => {
      const actor = identities.get(String(row.actorUserId ?? ''));
      return {
        ...row,
        occurredAt: String(row.occurredAt ?? ''),
        actorName: actor?.name ?? row.actorName,
        actorEmail: actor?.email ?? null,
      };
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 200);
  return json({ data: rows });
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

function optionalText(value: unknown, maximum: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maximum) : null;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    return {};
  }
}

function forbidden(message = 'This administrator role cannot perform that action.') {
  return json({ error: { code: 'forbidden', message } }, 403);
}

function invalid(message: string) {
  return json({ error: { code: 'invalid_request', message } }, 400);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
