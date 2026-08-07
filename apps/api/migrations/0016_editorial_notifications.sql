-- Review notifications (0.21 roadmap item): no notification system existed for editorial events
-- like "you were assigned a record to review" or "your record needs changes" -- a reviewer/editor
-- had to keep checking the dashboard to find out. Lives in CONTENT_DB (not IDENTITY_DB) so it can
-- be written in the same D1 batch() transaction as the editorial event that triggers it, the same
-- way audit statements already are.

CREATE TABLE editorial_notifications (
  id TEXT PRIMARY KEY,
  recipient_external_id TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('assignment_created', 'changes_requested')),
  message TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_editorial_notifications_recipient ON editorial_notifications(recipient_external_id, read_at, created_at DESC);
