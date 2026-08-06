-- Operational alerts (0.20 item 4) and the incident acknowledgement workflow (0.20 item 7)
-- share one table: an "alert" and an "incident" are the same record at different points in its
-- lifecycle (detected -> acknowledged -> resolved), so there is no reason to model them twice.
CREATE TABLE operational_alerts (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('service_down', 'service_maintenance', 'error_rate', 'queue_failure', 'unusual_usage')),
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  scope_key TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
  first_detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  acknowledged_by TEXT REFERENCES "user"(id),
  acknowledged_at TEXT,
  UNIQUE (alert_type, scope_key)
);

CREATE INDEX operational_alerts_status_idx ON operational_alerts(status, last_detected_at DESC);
