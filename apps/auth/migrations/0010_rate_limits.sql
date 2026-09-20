-- Enforceable per-key/per-plan rate limits (0.20 item 5). usage_events (0002_control_plane.sql)
-- is sampled telemetry by design and is not exact enough to enforce against; this is a separate,
-- exact counter, matching the platform's own architectural rule that rate enforcement and
-- analytics are separate responsibilities.

CREATE TABLE plan_limits (
  plan_code TEXT PRIMARY KEY,
  requests_per_minute INTEGER NOT NULL CHECK (requests_per_minute > 0),
  requests_per_day INTEGER NOT NULL CHECK (requests_per_day > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT REFERENCES "user"(id)
);

INSERT INTO plan_limits (plan_code, requests_per_minute, requests_per_day) VALUES
  ('basic', 100, 5000),
  ('premium', 500, 50000),
  ('enterprise', 2000, 200000);

CREATE TABLE rate_limit_counters (
  credential_id TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK (window_kind IN ('minute', 'day')),
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (credential_id, window_kind, window_start)
);
