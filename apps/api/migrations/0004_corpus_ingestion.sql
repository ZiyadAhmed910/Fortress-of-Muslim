PRAGMA foreign_keys = ON;

ALTER TABLE content_records ADD COLUMN logical_id TEXT;
UPDATE content_records SET logical_id = id WHERE logical_id IS NULL;
CREATE UNIQUE INDEX idx_content_records_dataset_logical
  ON content_records(dataset_id, logical_id);

CREATE TABLE source_acquisitions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  acquisition_method TEXT NOT NULL,
  rights_status TEXT NOT NULL CHECK (rights_status IN ('proposed', 'rights_review', 'approved', 'restricted', 'rejected')),
  permission_reference TEXT NOT NULL,
  permitted_uses_json TEXT NOT NULL DEFAULT '[]',
  reviewed_by TEXT,
  reviewed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE source_artifacts (
  id TEXT PRIMARY KEY,
  acquisition_id TEXT NOT NULL REFERENCES source_acquisitions(id),
  source_id TEXT REFERENCES source_materials(id),
  source_url TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  importer_version TEXT NOT NULL,
  local_locator_hash TEXT NOT NULL,
  UNIQUE(acquisition_id, sha256)
);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  acquisition_id TEXT NOT NULL REFERENCES source_acquisitions(id),
  dataset_id TEXT REFERENCES dataset_versions(id),
  importer_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('building', 'validated', 'importing', 'completed', 'failed')),
  expected_record_count INTEGER NOT NULL CHECK (expected_record_count >= 0),
  imported_record_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_record_count >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  validation_report_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE import_issues (
  id TEXT PRIMARY KEY,
  import_run_id TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  source_record_id TEXT,
  field_path TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
  issue_code TEXT NOT NULL,
  message TEXT NOT NULL,
  evidence_hash TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open', 'accepted', 'resolved', 'rejected')),
  resolved_at TEXT
);

CREATE TABLE source_record_identities (
  id TEXT PRIMARY KEY,
  acquisition_id TEXT NOT NULL REFERENCES source_acquisitions(id),
  provider TEXT NOT NULL,
  collection_slug TEXT NOT NULL,
  provider_record_id TEXT NOT NULL,
  record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  artifact_id TEXT REFERENCES source_artifacts(id),
  source_url TEXT,
  raw_content_hash TEXT NOT NULL,
  UNIQUE(acquisition_id, collection_slug, provider_record_id, record_id),
  UNIQUE(record_id, provider)
);

CREATE TABLE record_numberings (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  scheme TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  position INTEGER NOT NULL DEFAULT 1 CHECK (position > 0),
  UNIQUE(record_id, scheme, value)
);

CREATE TABLE hadith_grades (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  raw_grade TEXT NOT NULL,
  normalized_grade TEXT,
  authority TEXT,
  source_id TEXT REFERENCES source_materials(id),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  UNIQUE(record_id, raw_grade, authority)
);

CREATE VIRTUAL TABLE content_search_fts USING fts5(
  logical_id UNINDEXED,
  dataset_id UNINDEXED,
  content_type UNINDEXED,
  collection_slug UNINDEXED,
  title,
  body,
  narrator,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX idx_source_artifacts_acquisition ON source_artifacts(acquisition_id, retrieved_at);
CREATE INDEX idx_import_runs_acquisition ON import_runs(acquisition_id, started_at DESC);
CREATE INDEX idx_import_issues_run ON import_issues(import_run_id, severity, resolution_status);
CREATE INDEX idx_source_identity_record ON source_record_identities(record_id);
CREATE INDEX idx_record_numberings_lookup ON record_numberings(scheme, value);
CREATE INDEX idx_hadith_metadata_number ON hadith_metadata(hadith_number);
CREATE INDEX idx_hadith_grades_record ON hadith_grades(record_id, verification_status);
