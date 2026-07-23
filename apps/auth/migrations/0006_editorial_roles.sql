CREATE TABLE editorial_role_grants (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'viewer', 'reviewer', 'senior_reviewer', 'editor', 'publisher', 'super_administrator'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  granted_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX editorial_role_status_idx ON editorial_role_grants(role, status);

INSERT OR IGNORE INTO editorial_role_grants (user_id, role, status, granted_by)
SELECT user_id,
       CASE WHEN role = 'super_admin' THEN 'super_administrator' ELSE 'viewer' END,
       status, granted_by
FROM platform_admins;
