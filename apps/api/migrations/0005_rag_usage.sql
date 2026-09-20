CREATE TABLE rag_daily_usage (
  usage_date TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usage_date, client_hash)
);

CREATE INDEX idx_rag_daily_usage_updated ON rag_daily_usage(updated_at);
