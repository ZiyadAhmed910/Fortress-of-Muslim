ALTER TABLE "user"
ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));

CREATE TABLE platform_role_grants (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'developer'
    CHECK (role IN ('admin', 'editor', 'reviewer', 'developer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  granted_by TEXT REFERENCES "user"(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX platform_role_grants_status_idx
ON platform_role_grants(role, status);

INSERT INTO platform_role_grants (user_id, role, status)
SELECT id, 'developer', 'active' FROM "user";

INSERT INTO platform_role_grants (user_id, role, status, granted_by)
SELECT user_id,
       CASE
         WHEN role IN ('super_administrator', 'publisher') THEN 'admin'
         WHEN role = 'editor' THEN 'editor'
         WHEN role IN ('reviewer', 'senior_reviewer') THEN 'reviewer'
         ELSE 'developer'
       END,
       status,
       granted_by
FROM editorial_role_grants
WHERE true
ON CONFLICT(user_id) DO UPDATE SET
  role = excluded.role,
  status = excluded.status,
  granted_by = excluded.granted_by,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_role_grants (user_id, role, status, granted_by)
SELECT user_id, 'admin', status, granted_by FROM platform_admins
WHERE true
ON CONFLICT(user_id) DO UPDATE SET
  role = 'admin',
  status = excluded.status,
  granted_by = excluded.granted_by,
  updated_at = CURRENT_TIMESTAMP;

UPDATE "user"
SET is_admin = 1
WHERE id IN (
  SELECT user_id FROM platform_role_grants
  WHERE role = 'admin' AND status = 'active'
);

UPDATE "user"
SET is_admin = 1
WHERE lower(email) = 'ziyadahmed910@gmail.com';

INSERT INTO platform_role_grants (user_id, role, status)
SELECT id, 'admin', 'active'
FROM "user"
WHERE lower(email) = 'ziyadahmed910@gmail.com'
ON CONFLICT(user_id) DO UPDATE SET
  role = 'admin',
  status = 'active',
  updated_at = CURRENT_TIMESTAMP;
