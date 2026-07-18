CREATE TABLE developer_profiles (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  display_name TEXT,
  plan_code TEXT NOT NULL DEFAULT 'basic',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE access_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('plan_upgrade', 'rate_limit', 'scope', 'mcp_publish')),
  requested_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by TEXT REFERENCES "user"(id),
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);
CREATE INDEX access_requests_user_idx ON access_requests(user_id, created_at DESC);
CREATE INDEX access_requests_status_idx ON access_requests(status, created_at);

CREATE TABLE mcp_server_registrations (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  upstream_base_url TEXT NOT NULL,
  openapi_url TEXT,
  ownership_verification_method TEXT NOT NULL DEFAULT 'dns',
  ownership_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verification_pending', 'review_pending', 'published', 'rejected', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);
CREATE INDEX mcp_registrations_owner_idx ON mcp_server_registrations(owner_user_id, created_at DESC);
CREATE INDEX mcp_registrations_status_idx ON mcp_server_registrations(status, created_at);

CREATE TABLE mcp_tool_definitions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_server_registrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  output_mapping TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(server_id, name)
);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  user_id TEXT,
  credential_id TEXT,
  client_id TEXT,
  service TEXT NOT NULL,
  route TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  request_units INTEGER NOT NULL DEFAULT 1,
  environment TEXT NOT NULL
);
CREATE INDEX usage_events_owner_time_idx ON usage_events(user_id, occurred_at DESC);
CREATE INDEX usage_events_service_time_idx ON usage_events(service, occurred_at DESC);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id TEXT,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  request_id TEXT,
  ip_hash TEXT,
  details TEXT
);
CREATE INDEX audit_events_time_idx ON audit_events(occurred_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events(target_type, target_id, occurred_at DESC);
