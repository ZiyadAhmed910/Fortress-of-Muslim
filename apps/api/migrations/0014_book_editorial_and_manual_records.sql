ALTER TABLE books
ADD COLUMN editorial_status TEXT NOT NULL DEFAULT 'pending_review'
CHECK (editorial_status IN ('pending_review', 'verified', 'changes_requested'));

ALTER TABLE books
ADD COLUMN verified_by_external_id TEXT;

ALTER TABLE books
ADD COLUMN verified_at TEXT;

ALTER TABLE books
ADD COLUMN editorial_notes TEXT;

CREATE INDEX idx_books_editorial_status
ON books(editorial_status, collection_id, position);

INSERT OR IGNORE INTO dataset_versions (
  id, source_name, source_version, generated_from, publication_status,
  verification_status, record_count, content_hash, imported_at
) VALUES (
  'dataset.fortress.editorial.manual',
  'Fortress Admin editorial records',
  '1',
  'admin-console',
  'draft',
  'pending',
  0,
  'manual-editorial-records',
  CURRENT_TIMESTAMP
);
