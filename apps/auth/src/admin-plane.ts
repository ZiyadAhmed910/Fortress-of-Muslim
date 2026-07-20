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
  if (url.pathname === '/v1/admin/sources' && request.method === 'GET') return listSources(context, url);
  if (url.pathname === '/v1/admin/sources' && request.method === 'POST') {
    if (!canWrite(grant.role)) return forbidden();
    return createSource(context, await readJson(request));
  }
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
  if (contentMatch && request.method === 'GET') return getContent(context, decodeURIComponent(contentMatch[1]!));
  if (contentMatch && request.method === 'PATCH') {
    if (!canWrite(grant.role)) return forbidden();
    return updateContent(context, decodeURIComponent(contentMatch[1]!), await readJson(request));
  }

  const sourceMatch = url.pathname.match(/^\/v1\/admin\/sources\/([^/]+)$/);
  if (sourceMatch && request.method === 'GET') return getSource(context, decodeURIComponent(sourceMatch[1]!));
  if (sourceMatch && request.method === 'PATCH') {
    if (!canWrite(grant.role)) return forbidden();
    return updateSource(context, decodeURIComponent(sourceMatch[1]!), await readJson(request));
  }

  const referenceMatch = url.pathname.match(/^\/v1\/admin\/content\/([^/]+)\/references$/);
  if (referenceMatch && request.method === 'POST') {
    if (!canWrite(grant.role)) return forbidden();
    return createReference(context, decodeURIComponent(referenceMatch[1]!), await readJson(request));
  }
  const referenceStatusMatch = url.pathname.match(/^\/v1\/admin\/references\/([^/]+)$/);
  if (referenceStatusMatch && request.method === 'PATCH') {
    if (!canWrite(grant.role)) return forbidden();
    return updateReference(context, decodeURIComponent(referenceStatusMatch[1]!), await readJson(request));
  }

  const taxonomyMatch = url.pathname.match(/^\/v1\/admin\/content\/([^/]+)\/taxonomy$/);
  if (taxonomyMatch && request.method === 'POST') {
    if (!canWrite(grant.role)) return forbidden();
    return assignTaxonomy(context, decodeURIComponent(taxonomyMatch[1]!), await readJson(request));
  }
  const taxonomyDeleteMatch = url.pathname.match(/^\/v1\/admin\/content\/([^/]+)\/taxonomy\/([^/]+)$/);
  if (taxonomyDeleteMatch && request.method === 'DELETE') {
    if (!canWrite(grant.role)) return forbidden();
    return removeTaxonomy(context, decodeURIComponent(taxonomyDeleteMatch[1]!), decodeURIComponent(taxonomyDeleteMatch[2]!));
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
  const [[users, apiKeys, oauthClients, devices, mcpServers, pendingRequests], [content, sources, pendingEvidence], services, audit] = await Promise.all([
    Promise.all(identityQueries),
    Promise.all([
      count(env.CONTENT_DB, 'SELECT COUNT(*) AS count FROM content_records'),
      count(env.CONTENT_DB, 'SELECT COUNT(*) AS count FROM source_materials'),
      count(env.CONTENT_DB, "SELECT COUNT(*) AS count FROM source_references WHERE verification_status = 'pending'"),
    ]),
    env.IDENTITY_DB.prepare('SELECT service_key AS serviceKey, display_name AS displayName, status, enforcement, updated_at AS updatedAt FROM platform_services ORDER BY display_name').all(),
    env.IDENTITY_DB.prepare('SELECT occurred_at AS occurredAt, actor_type AS actorType, action, target_type AS targetType, target_id AS targetId, details FROM audit_events ORDER BY occurred_at DESC LIMIT 8').all(),
  ]);
  return json({ data: { counts: { users, apiKeys, oauthClients, devices, mcpServers, pendingRequests, content, sources, pendingEvidence }, services: services.results, audit: audit.results } });
}

async function globalSearch({ env }: AdminContext, url: URL) {
  const query = cleanQuery(url.searchParams.get('q'));
  if (query.length < 2) return json({ data: [] });
  const like = `%${query}%`;
  const [users, keys, clients, devices, mcp, queries, content, sources] = await Promise.all([
    env.IDENTITY_DB.prepare('SELECT id, name AS label, email AS detail FROM "user" WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, COALESCE(name, start, id) AS label, start AS detail FROM apikey WHERE name LIKE ? OR start LIKE ? ORDER BY createdAt DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT clientId AS id, COALESCE(name, clientId) AS label, clientId AS detail FROM "oauthClient" WHERE name LIKE ? OR clientId LIKE ? ORDER BY createdAt DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, device_type AS detail FROM device_registrations WHERE name LIKE ? OR id LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, status AS detail FROM mcp_toolsets WHERE name LIKE ? OR slug LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.IDENTITY_DB.prepare('SELECT id, name AS label, operation AS detail FROM named_queries WHERE name LIKE ? OR slug LIKE ? ORDER BY created_at DESC LIMIT 8').bind(like, like).all(),
    env.CONTENT_DB.prepare('SELECT id, title AS label, verification_status AS detail FROM content_records WHERE title LIKE ? OR id LIKE ? OR legacy_id LIKE ? ORDER BY sequence LIMIT 12').bind(like, like, like).all(),
    env.CONTENT_DB.prepare('SELECT id, title AS label, COALESCE(publisher, source_type) AS detail FROM source_materials WHERE title LIKE ? OR publisher LIKE ? OR id LIKE ? ORDER BY title LIMIT 8').bind(like, like, like).all(),
  ]);
  return json({ data: [
    ...typed('user', users.results), ...typed('api-key', keys.results), ...typed('oauth-client', clients.results),
    ...typed('device', devices.results), ...typed('mcp-server', mcp.results), ...typed('named-query', queries.results),
    ...typed('content', content.results), ...typed('source', sources.results),
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

async function listSources({ env }: AdminContext, url: URL) {
  const query = cleanQuery(url.searchParams.get('q'));
  const status = cleanQuery(url.searchParams.get('status'));
  const like = `%${query}%`;
  const result = await env.CONTENT_DB.prepare(`
    SELECT source.id, source.title, source.source_type AS sourceType, source.publisher,
           source.license_name AS licenseName, source.license_status AS licenseStatus,
           source.authenticity_status AS authenticityStatus, source.updated_at AS updatedAt,
           COUNT(DISTINCT reference.id) AS referenceCount
    FROM source_materials source
    LEFT JOIN source_references reference ON reference.source_id = source.id
    WHERE (? = '' OR source.title LIKE ? OR source.publisher LIKE ? OR source.id LIKE ?)
      AND (? = '' OR source.license_status = ? OR source.authenticity_status = ?)
    GROUP BY source.id ORDER BY source.updated_at DESC LIMIT 150
  `).bind(query, like, like, like, status, status, status).all();
  return json({ data: result.results });
}

async function getSource({ env }: AdminContext, id: string) {
  const source = await env.CONTENT_DB.prepare(`
    SELECT id, source_type AS sourceType, title, original_title AS originalTitle, publisher, edition,
           publication_year AS publicationYear, source_url AS sourceUrl, license_name AS licenseName,
           license_url AS licenseUrl, license_status AS licenseStatus,
           authenticity_status AS authenticityStatus, machine_format AS machineFormat, notes,
           created_at AS createdAt, updated_at AS updatedAt
    FROM source_materials WHERE id = ?
  `).bind(id).first();
  if (!source) return json({ error: { code: 'not_found', message: 'Source was not found.' } }, 404);
  const [datasets, references] = await Promise.all([
    env.CONTENT_DB.prepare(`SELECT dataset_id AS datasetId, source_role AS sourceRole, import_locator AS importLocator,
      imported_at AS importedAt FROM dataset_sources WHERE source_id = ? ORDER BY imported_at DESC`).bind(id).all(),
    env.CONTENT_DB.prepare(`SELECT reference.id, reference.record_id AS recordId, record.title,
      reference.reference_type AS referenceType, reference.locator,
      reference.verification_status AS verificationStatus
      FROM source_references reference JOIN content_records record ON record.id = reference.record_id
      WHERE reference.source_id = ? ORDER BY record.sequence LIMIT 100`).bind(id).all(),
  ]);
  return json({ data: { source, datasets: datasets.results, references: references.results } });
}

async function createSource(context: AdminContext, body: Record<string, unknown>) {
  const parsed = parseSource(body);
  if (!parsed.ok) return invalid(parsed.message);
  if (requiresSourceAuthority(parsed.value) && context.grant.role !== 'super_admin') {
    return json({ error: { code: 'forbidden', message: 'Only a super administrator can approve source trust or licensing.' } }, 403);
  }
  const id = `source.${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`INSERT INTO source_materials
      (id, source_type, title, original_title, publisher, edition, publication_year, source_url,
       license_name, license_url, license_status, authenticity_status, machine_format, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, parsed.value.sourceType, parsed.value.title, parsed.value.originalTitle, parsed.value.publisher,
        parsed.value.edition, parsed.value.publicationYear, parsed.value.sourceUrl, parsed.value.licenseName,
        parsed.value.licenseUrl, parsed.value.licenseStatus, parsed.value.authenticityStatus,
        parsed.value.machineFormat, parsed.value.notes, now, now),
    contentAuditStatement(context, 'source.created', 'source', id, parsed.value, now),
  ]);
  await audit(context, 'source.created', 'source', id, parsed.value);
  return json({ data: { id, ...parsed.value, createdAt: now, updatedAt: now } }, 201);
}

async function updateSource(context: AdminContext, id: string, body: Record<string, unknown>) {
  const current = await context.env.CONTENT_DB.prepare(`SELECT source_type AS sourceType, title, original_title AS originalTitle,
    publisher, edition, publication_year AS publicationYear, source_url AS sourceUrl, license_name AS licenseName,
    license_url AS licenseUrl, license_status AS licenseStatus, authenticity_status AS authenticityStatus,
    machine_format AS machineFormat, notes FROM source_materials WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!current) return json({ error: { code: 'not_found', message: 'Source was not found.' } }, 404);
  const parsed = parseSource({ ...current, ...body });
  if (!parsed.ok) return invalid(parsed.message);
  const elevatesTrust = (parsed.value.licenseStatus === 'approved' && current.licenseStatus !== 'approved')
    || (parsed.value.authenticityStatus === 'trusted' && current.authenticityStatus !== 'trusted');
  if (elevatesTrust && context.grant.role !== 'super_admin') {
    return json({ error: { code: 'forbidden', message: 'Only a super administrator can approve source trust or licensing.' } }, 403);
  }
  const now = new Date().toISOString();
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`UPDATE source_materials SET source_type = ?, title = ?, original_title = ?,
      publisher = ?, edition = ?, publication_year = ?, source_url = ?, license_name = ?, license_url = ?,
      license_status = ?, authenticity_status = ?, machine_format = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .bind(parsed.value.sourceType, parsed.value.title, parsed.value.originalTitle, parsed.value.publisher,
        parsed.value.edition, parsed.value.publicationYear, parsed.value.sourceUrl, parsed.value.licenseName,
        parsed.value.licenseUrl, parsed.value.licenseStatus, parsed.value.authenticityStatus,
        parsed.value.machineFormat, parsed.value.notes, now, id),
    contentAuditStatement(context, 'source.updated', 'source', id,
      { previousLicenseStatus: current.licenseStatus, previousAuthenticityStatus: current.authenticityStatus, ...parsed.value }, now),
  ]);
  await audit(context, 'source.updated', 'source', id, parsed.value);
  return json({ data: { id, ...parsed.value, updatedAt: now } });
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
  const language = await context.env.CONTENT_DB.prepare('SELECT 1 FROM languages WHERE code = ? AND status = \'active\'').bind(languageCode).first();
  if (!language) return invalid('Choose an active language code.');
  const id = `term.${type}.${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await context.env.CONTENT_DB.batch([
      context.env.CONTENT_DB.prepare(`INSERT INTO taxonomy_terms
        (id, taxonomy_type, slug, label, language_code, description) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, type, slug, label, languageCode, description),
      contentAuditStatement(context, 'taxonomy.created', 'taxonomy', id, { type, slug, label, languageCode }, now),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return json({ error: { code: 'conflict', message: 'That taxonomy slug already exists for this type and language.' } }, 409);
    throw error;
  }
  await audit(context, 'taxonomy.created', 'taxonomy', id, { type, slug, label, languageCode });
  return json({ data: { id, type, slug, label, languageCode, description, recordCount: 0 } }, 201);
}

async function getContent({ env }: AdminContext, id: string) {
  const record = await env.CONTENT_DB.prepare(`SELECT record.id, record.legacy_id AS legacyId, record.sequence,
    record.title, record.content_type AS contentType, record.verification_status AS status,
    record.dataset_id AS datasetId, record.updated_at AS updatedAt,
    collection.id AS collectionId, collection.title AS collectionTitle
    FROM content_records record
    LEFT JOIN record_placements placement ON placement.record_id = record.id
    LEFT JOIN collections collection ON collection.id = placement.collection_id
    WHERE record.id = ? OR record.legacy_id = ? LIMIT 1`).bind(id, id).first();
  if (!record) return json({ error: { code: 'not_found', message: 'Content record was not found.' } }, 404);
  const recordId = String(record.id);
  const [references, taxonomy, verification, corrections, sources, terms] = await Promise.all([
    env.CONTENT_DB.prepare(`SELECT reference.id, reference.source_id AS sourceId, source.title AS sourceTitle,
      reference.reference_type AS referenceType, reference.locator, reference.canonical_url AS canonicalUrl,
      reference.notes, reference.verification_status AS verificationStatus,
      source.license_status AS licenseStatus, source.authenticity_status AS authenticityStatus
      FROM source_references reference JOIN source_materials source ON source.id = reference.source_id
      WHERE reference.record_id = ? ORDER BY reference.created_at DESC`).bind(recordId).all(),
    env.CONTENT_DB.prepare(`SELECT term.id, term.taxonomy_type AS type, term.slug, term.label,
      term.language_code AS languageCode FROM record_taxonomy assignment
      JOIN taxonomy_terms term ON term.id = assignment.term_id WHERE assignment.record_id = ?
      ORDER BY term.taxonomy_type, term.label`).bind(recordId).all(),
    env.CONTENT_DB.prepare(`SELECT status, method, notes, reviewer_external_id AS reviewerExternalId,
      reviewed_at AS reviewedAt FROM verification_records WHERE target_type = 'record' AND target_id = ?
      ORDER BY reviewed_at DESC LIMIT 50`).bind(recordId).all(),
    env.CONTENT_DB.prepare(`SELECT field_path AS fieldPath, reason, created_at AS createdAt
      FROM correction_history WHERE record_id = ? ORDER BY created_at DESC LIMIT 50`).bind(recordId).all(),
    env.CONTENT_DB.prepare(`SELECT id, title, license_status AS licenseStatus,
      authenticity_status AS authenticityStatus FROM source_materials ORDER BY title LIMIT 250`).all(),
    env.CONTENT_DB.prepare(`SELECT id, taxonomy_type AS type, slug, label, language_code AS languageCode
      FROM taxonomy_terms ORDER BY taxonomy_type, label LIMIT 500`).all(),
  ]);
  const canVerify = references.results.some((item) => {
    const reference = item as Record<string, unknown>;
    return reference.verificationStatus === 'verified'
      && reference.licenseStatus === 'approved'
      && reference.authenticityStatus === 'trusted';
  });
  return json({ data: { record, references: references.results, taxonomy: taxonomy.results,
    verificationHistory: verification.results, corrections: corrections.results,
    availableSources: sources.results, availableTerms: terms.results, canVerify } });
}

async function createReference(context: AdminContext, recordId: string, body: Record<string, unknown>) {
  const sourceId = String(body.sourceId ?? '');
  const referenceType = String(body.referenceType ?? 'primary');
  const locator = String(body.locator ?? '').trim();
  const canonicalUrl = optionalUrl(body.canonicalUrl);
  const notes = optionalText(body.notes, 1000);
  if (!['primary', 'supporting', 'grading', 'cross_check'].includes(referenceType)) return invalid('Choose a supported reference type.');
  if (!locator || locator.length > 240) return invalid('Enter a source locator of 240 characters or fewer.');
  if (canonicalUrl === false) return invalid('Canonical URL must use HTTPS.');
  const [record, source] = await Promise.all([
    context.env.CONTENT_DB.prepare('SELECT 1 FROM content_records WHERE id = ?').bind(recordId).first(),
    context.env.CONTENT_DB.prepare('SELECT 1 FROM source_materials WHERE id = ?').bind(sourceId).first(),
  ]);
  if (!record || !source) return invalid('Choose an existing content record and source.');
  const id = `reference.${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await context.env.CONTENT_DB.batch([
      context.env.CONTENT_DB.prepare(`INSERT INTO source_references
        (id, record_id, source_id, reference_type, locator, canonical_url, notes, verification_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .bind(id, recordId, sourceId, referenceType, locator, canonicalUrl || null, notes, now),
      contentAuditStatement(context, 'reference.created', 'record', recordId, { referenceId: id, sourceId, referenceType, locator }, now),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return json({ error: { code: 'conflict', message: 'This source reference is already attached.' } }, 409);
    throw error;
  }
  await audit(context, 'reference.created', 'content', recordId, { referenceId: id, sourceId, referenceType, locator });
  return json({ data: { id, recordId, sourceId, referenceType, locator, canonicalUrl: canonicalUrl || null, notes, verificationStatus: 'pending' } }, 201);
}

async function updateReference(context: AdminContext, id: string, body: Record<string, unknown>) {
  const status = String(body.status ?? '');
  if (!['pending', 'verified', 'rejected'].includes(status)) return invalid('Choose pending, verified, or rejected.');
  const reference = await context.env.CONTENT_DB.prepare(`SELECT reference.record_id AS recordId,
    source.license_status AS licenseStatus, source.authenticity_status AS authenticityStatus
    FROM source_references reference JOIN source_materials source ON source.id = reference.source_id
    WHERE reference.id = ?`).bind(id).first<{ recordId: string; licenseStatus: string; authenticityStatus: string }>();
  if (!reference) return json({ error: { code: 'not_found', message: 'Reference was not found.' } }, 404);
  if (status === 'verified' && (reference.licenseStatus !== 'approved' || reference.authenticityStatus !== 'trusted')) {
    return invalid('A reference can be verified only after its source is trusted and its license is approved.');
  }
  const now = new Date().toISOString();
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare('UPDATE source_references SET verification_status = ? WHERE id = ?').bind(status, id),
    contentAuditStatement(context, 'reference.status_changed', 'record', reference.recordId, { referenceId: id, status }, now),
  ]);
  await audit(context, 'reference.status_changed', 'content', reference.recordId, { referenceId: id, status });
  return json({ data: { id, status } });
}

async function assignTaxonomy(context: AdminContext, recordId: string, body: Record<string, unknown>) {
  const termId = String(body.termId ?? '');
  const [record, term] = await Promise.all([
    context.env.CONTENT_DB.prepare('SELECT 1 FROM content_records WHERE id = ?').bind(recordId).first(),
    context.env.CONTENT_DB.prepare('SELECT 1 FROM taxonomy_terms WHERE id = ?').bind(termId).first(),
  ]);
  if (!record || !term) return invalid('Choose an existing content record and taxonomy term.');
  try {
    await context.env.CONTENT_DB.batch([
      context.env.CONTENT_DB.prepare(`INSERT INTO record_taxonomy
        (record_id, term_id, assignment_source, confidence) VALUES (?, ?, 'editorial', 1)`).bind(recordId, termId),
      contentAuditStatement(context, 'taxonomy.assigned', 'record', recordId, { termId }, new Date().toISOString()),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return json({ error: { code: 'conflict', message: 'That taxonomy term is already assigned.' } }, 409);
    throw error;
  }
  await audit(context, 'taxonomy.assigned', 'content', recordId, { termId });
  return json({ data: { recordId, termId } }, 201);
}

async function removeTaxonomy(context: AdminContext, recordId: string, termId: string) {
  const exists = await context.env.CONTENT_DB.prepare(
    'SELECT 1 FROM record_taxonomy WHERE record_id = ? AND term_id = ?',
  ).bind(recordId, termId).first();
  if (!exists) return json({ error: { code: 'not_found', message: 'Taxonomy assignment was not found.' } }, 404);
  const now = new Date().toISOString();
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare('DELETE FROM record_taxonomy WHERE record_id = ? AND term_id = ?').bind(recordId, termId),
    contentAuditStatement(context, 'taxonomy.removed', 'record', recordId, { termId }, now),
  ]);
  await audit(context, 'taxonomy.removed', 'content', recordId, { termId });
  return new Response(null, { status: 204 });
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

function contentAuditStatement(context: AdminContext, action: string, targetType: string, targetId: string, details: unknown, occurredAt: string) {
  return context.env.CONTENT_DB.prepare(`INSERT INTO content_audit_events
    (id, occurred_at, actor_type, actor_external_id, action, target_type, target_id, request_id, details_json)
    VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, ?)`)
    .bind(`caud_${crypto.randomUUID()}`, occurredAt, context.user.id, action, targetType, targetId, context.requestId, JSON.stringify(details));
}

type SourceInput = {
  sourceType: string;
  title: string;
  originalTitle: string | null;
  publisher: string | null;
  edition: string | null;
  publicationYear: number | null;
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  licenseStatus: string;
  authenticityStatus: string;
  machineFormat: string | null;
  notes: string | null;
};

function parseSource(body: Record<string, unknown>): { ok: true; value: SourceInput } | { ok: false; message: string } {
  const sourceType = String(body.sourceType ?? '');
  const title = String(body.title ?? '').trim();
  const publicationYearText = String(body.publicationYear ?? '').trim();
  const publicationYear = publicationYearText ? Number(publicationYearText) : null;
  const sourceUrl = optionalUrl(body.sourceUrl);
  const licenseUrl = optionalUrl(body.licenseUrl);
  const licenseStatus = String(body.licenseStatus ?? 'unknown');
  const authenticityStatus = String(body.authenticityStatus ?? 'unreviewed');
  if (!['book', 'publication', 'digital_library', 'api', 'file', 'dataset'].includes(sourceType)) return { ok: false, message: 'Choose a supported source type.' };
  if (title.length < 3 || title.length > 200) return { ok: false, message: 'Source title must contain 3 to 200 characters.' };
  if (publicationYear !== null && (!Number.isInteger(publicationYear) || publicationYear < 500 || publicationYear > new Date().getUTCFullYear() + 1)) return { ok: false, message: 'Publication year is invalid.' };
  if (sourceUrl === false || licenseUrl === false) return { ok: false, message: 'Source and license URLs must use HTTPS.' };
  if (!['unknown', 'reviewing', 'approved', 'restricted'].includes(licenseStatus)) return { ok: false, message: 'Choose a valid license status.' };
  if (!['unreviewed', 'trusted', 'rejected'].includes(authenticityStatus)) return { ok: false, message: 'Choose a valid authenticity status.' };
  return { ok: true, value: {
    sourceType, title, originalTitle: optionalText(body.originalTitle, 200),
    publisher: optionalText(body.publisher, 160), edition: optionalText(body.edition, 120), publicationYear,
    sourceUrl: sourceUrl || null, licenseName: optionalText(body.licenseName, 160), licenseUrl: licenseUrl || null,
    licenseStatus, authenticityStatus, machineFormat: optionalText(body.machineFormat, 80), notes: optionalText(body.notes, 2000),
  } };
}

function requiresSourceAuthority(source: SourceInput) {
  return source.licenseStatus === 'approved' || source.authenticityStatus === 'trusted';
}

function optionalText(value: unknown, maximum: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maximum) : null;
}

function optionalUrl(value: unknown): string | null | false {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.toString() : false;
  } catch {
    return false;
  }
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
