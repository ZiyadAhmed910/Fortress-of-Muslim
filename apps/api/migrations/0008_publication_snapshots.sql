CREATE TABLE IF NOT EXISTS canonical_dataset_items (
  dataset_version_id TEXT NOT NULL REFERENCES canonical_dataset_versions(id),
  canonical_id TEXT NOT NULL REFERENCES canonical_records(canonical_id),
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  PRIMARY KEY (dataset_version_id, canonical_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_dataset_items_record
  ON canonical_dataset_items(canonical_id, dataset_version_id);

INSERT OR IGNORE INTO canonical_dataset_items (dataset_version_id, canonical_id, revision_id)
SELECT dataset_version_id, canonical_id, revision_id
FROM canonical_publications
WHERE publication_status = 'published';
