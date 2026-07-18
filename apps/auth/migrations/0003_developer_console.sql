CREATE TABLE "deviceCode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceCode" TEXT NOT NULL,
  "userCode" TEXT NOT NULL,
  "userId" TEXT,
  "expiresAt" DATE NOT NULL,
  "status" TEXT NOT NULL,
  "lastPolledAt" DATE,
  "pollingInterval" INTEGER,
  "clientId" TEXT,
  "scope" TEXT
);
CREATE UNIQUE INDEX "deviceCode_deviceCode_idx" ON "deviceCode" ("deviceCode");
CREATE UNIQUE INDEX "deviceCode_userCode_idx" ON "deviceCode" ("userCode");

ALTER TABLE mcp_server_registrations ADD COLUMN server_type TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE mcp_server_registrations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'openapi';
ALTER TABLE mcp_server_registrations ADD COLUMN named_query_id TEXT;

CREATE TABLE device_registrations (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('iot', 'cli', 'tv', 'gateway', 'service')),
  auth_method TEXT NOT NULL CHECK (auth_method IN ('device_authorization', 'client_credentials', 'private_key_jwt')),
  oauth_client_id TEXT,
  jwks_uri TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);
CREATE INDEX device_registrations_owner_idx ON device_registrations(owner_user_id, created_at DESC);

CREATE TABLE named_queries (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organization(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('list', 'search', 'get_by_id')),
  parameters_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_user_id, slug)
);
CREATE INDEX named_queries_owner_idx ON named_queries(owner_user_id, created_at DESC);
