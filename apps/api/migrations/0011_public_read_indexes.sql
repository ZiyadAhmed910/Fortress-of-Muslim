CREATE INDEX IF NOT EXISTS idx_canonical_records_content_type
  ON canonical_records(content_type, canonical_id);

CREATE INDEX IF NOT EXISTS idx_content_revisions_sequence
  ON content_revisions(sequence, id);

CREATE INDEX IF NOT EXISTS idx_revision_metadata_collection
  ON revision_metadata(collection_id, revision_id);

CREATE INDEX IF NOT EXISTS idx_revision_parts_revision
  ON revision_parts(revision_id, position);
