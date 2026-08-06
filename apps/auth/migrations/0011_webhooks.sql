-- Developer-registered webhooks for record.published / record.verified (0.20+ D-item: webhooks).
-- Best-effort delivery, no retry queue: editorial-plane.ts fires each matching subscription
-- inline (awaited, short per-call timeout) right after the triggering publish/verify commits,
-- and logs one row per attempt here. A failed attempt is not automatically retried -- the
-- developer redelivers manually from the console. This deliberately avoids adding Cloudflare
-- Queues or a cron trigger as new billed infrastructure for what is, for now, a best-effort
-- notification feature.

CREATE TABLE webhook_subscriptions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_webhook_subscriptions_owner ON webhook_subscriptions(owner_user_id, created_at DESC);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  response_status INTEGER,
  response_snippet TEXT,
  attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_webhook_deliveries_subscription ON webhook_deliveries(subscription_id, attempted_at DESC);
