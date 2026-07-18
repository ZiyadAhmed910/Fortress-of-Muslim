PRAGMA foreign_keys = ON;

CREATE TABLE dataset_versions (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_version TEXT NOT NULL,
  generated_from TEXT,
  publication_status TEXT NOT NULL CHECK (publication_status IN ('draft', 'active', 'deprecated')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  content_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_dataset_active
  ON dataset_versions(publication_status)
  WHERE publication_status = 'active';

CREATE TABLE content_records (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('dua', 'hadith')),
  legacy_id TEXT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  title TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'verified', 'rejected', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (dataset_id, content_type, sequence),
  UNIQUE (dataset_id, legacy_id)
);

CREATE INDEX idx_content_records_listing
  ON content_records(dataset_id, content_type, sequence);

CREATE INDEX idx_content_records_title
  ON content_records(title);

CREATE TABLE content_parts (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  UNIQUE (record_id, position)
);

CREATE INDEX idx_content_parts_record
  ON content_parts(record_id, position);

CREATE TABLE content_segments (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES content_parts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  kind TEXT NOT NULL CHECK (kind IN ('arabic', 'transliteration', 'translation', 'comment')),
  language_code TEXT NOT NULL,
  script_code TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE (part_id, position)
);

CREATE INDEX idx_content_segments_part
  ON content_segments(part_id, position);
