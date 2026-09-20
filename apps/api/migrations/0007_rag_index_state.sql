CREATE TABLE IF NOT EXISTS rag_index_state (
  dataset_version_id TEXT PRIMARY KEY,
  expected_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_count >= 0),
  indexed_count INTEGER NOT NULL DEFAULT 0 CHECK (indexed_count >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (dataset_version_id) REFERENCES canonical_dataset_versions(id)
);

INSERT OR IGNORE INTO rag_index_state (
  dataset_version_id, expected_count, indexed_count, status, completed_at
)
SELECT id, record_count, 0,
       CASE WHEN record_count = 0 THEN 'ready' ELSE 'pending' END,
       CASE WHEN record_count = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
FROM canonical_dataset_versions
WHERE publication_status = 'published';
