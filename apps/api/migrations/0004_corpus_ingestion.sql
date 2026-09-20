PRAGMA foreign_keys = ON;

-- Historical migration slot retained for D1 ordering. Only public content-model
-- extensions remain; candidate preparation is outside this repository.
ALTER TABLE content_records ADD COLUMN logical_id TEXT;
UPDATE content_records SET logical_id = id WHERE logical_id IS NULL;
CREATE UNIQUE INDEX idx_content_records_dataset_logical
  ON content_records(dataset_id, logical_id);

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

CREATE INDEX idx_record_numberings_lookup ON record_numberings(scheme, value);
CREATE INDEX idx_hadith_metadata_number ON hadith_metadata(hadith_number);
CREATE INDEX idx_hadith_grades_record ON hadith_grades(record_id, verification_status);
