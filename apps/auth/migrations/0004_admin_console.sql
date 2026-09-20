CREATE TABLE platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'analyst')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  granted_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE platform_services (
  service_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'disabled')),
  enforcement TEXT NOT NULL DEFAULT 'none' CHECK (enforcement IN ('worker', 'external', 'none')),
  maintenance_message TEXT NOT NULL DEFAULT 'This service is temporarily unavailable.',
  updated_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_services (service_key, display_name, service_type, base_url, enforcement) VALUES
  ('api', 'Content API', 'worker', 'api', 'worker'),
  ('auth', 'Identity Service', 'worker', 'auth', 'none'),
  ('developers', 'Developer Portal', 'portal', 'developers', 'external'),
  ('status', 'Status Portal', 'portal', 'status', 'external'),
  ('pwa', 'Fortress PWA', 'static', 'test', 'external'),
  ('mcp', 'MCP Service', 'worker', 'mcp', 'none'),
  ('admin', 'Admin Console', 'portal', 'admin', 'none');

CREATE INDEX platform_services_status_idx ON platform_services(status);
CREATE INDEX platform_admins_status_idx ON platform_admins(status);
