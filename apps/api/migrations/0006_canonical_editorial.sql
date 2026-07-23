PRAGMA foreign_keys = ON;

CREATE TABLE canonical_records (
  canonical_id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('dua', 'hadith')),
  current_revision_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_revisions (
  id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL REFERENCES canonical_records(canonical_id),
  record_id TEXT NOT NULL REFERENCES content_records(id),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  legacy_id TEXT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  title TEXT NOT NULL,
  supersedes_revision_id TEXT REFERENCES content_revisions(id),
  created_by_external_id TEXT,
  correction_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (canonical_id, revision_number)
);

CREATE TABLE revision_parts (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  position INTEGER NOT NULL CHECK (position > 0),
  UNIQUE (revision_id, position)
);

CREATE TABLE revision_segments (
  id TEXT PRIMARY KEY,
  revision_part_id TEXT NOT NULL REFERENCES revision_parts(id),
  position INTEGER NOT NULL CHECK (position > 0),
  kind TEXT NOT NULL CHECK (kind IN ('arabic', 'transliteration', 'translation', 'comment')),
  language_code TEXT NOT NULL,
  script_code TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE (revision_part_id, position)
);

CREATE TABLE revision_metadata (
  revision_id TEXT PRIMARY KEY REFERENCES content_revisions(id),
  collection_id TEXT REFERENCES collections(id),
  book_id TEXT REFERENCES books(id),
  chapter_id TEXT REFERENCES chapters(id),
  display_number TEXT,
  narrator TEXT,
  grade TEXT,
  grading_authority TEXT
);

CREATE TABLE editorial_record_state (
  canonical_id TEXT PRIMARY KEY REFERENCES canonical_records(canonical_id),
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  workflow_state TEXT NOT NULL DEFAULT 'imported' CHECK (workflow_state IN (
    'imported', 'pending_review', 'assigned', 'in_review', 'changes_requested',
    'needs_second_review', 'needs_senior_approval', 'approved', 'published', 'superseded'
  )),
  assigned_to_external_id TEXT,
  changed_by_external_id TEXT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE editorial_assignments (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('collection', 'book', 'chapter', 'record_range', 'record')),
  collection_id TEXT REFERENCES collections(id),
  book_id TEXT REFERENCES books(id),
  chapter_id TEXT REFERENCES chapters(id),
  canonical_id TEXT REFERENCES canonical_records(canonical_id),
  range_start INTEGER,
  range_end INTEGER,
  assigned_to_external_id TEXT NOT NULL,
  assigned_by_external_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  CHECK (range_start IS NULL OR range_start > 0),
  CHECK (range_end IS NULL OR range_end >= range_start)
);

CREATE TABLE field_reviews (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  field_name TEXT NOT NULL CHECK (field_name IN (
    'arabic', 'translation', 'transliteration', 'narrator', 'collection',
    'book', 'chapter', 'number', 'references', 'grades', 'formatting',
    'completeness', 'duplicate_detection'
  )),
  reviewer_external_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('verified', 'correction_required', 'not_applicable')),
  notes TEXT,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (revision_id, field_name, reviewer_external_id)
);

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  reviewer_external_id TEXT NOT NULL,
  review_stage TEXT NOT NULL CHECK (review_stage IN ('independent_review', 'senior_approval')),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  notes TEXT,
  decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (revision_id, reviewer_external_id, review_stage)
);

CREATE TABLE disagreement_queue (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  field_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution TEXT,
  resolved_by_external_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE canonical_dataset_versions (
  id TEXT PRIMARY KEY,
  version_label TEXT NOT NULL UNIQUE,
  publication_status TEXT NOT NULL CHECK (publication_status IN ('draft', 'published', 'superseded', 'rolled_back')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'verified')),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  canonical_hash TEXT,
  publication_batch_id TEXT,
  published_by_external_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE TABLE publication_batches (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'validating', 'validated', 'approved', 'published', 'failed', 'rolled_back'
  )),
  created_by_external_id TEXT NOT NULL,
  approved_by_external_id TEXT,
  published_by_external_id TEXT,
  validation_report_json TEXT NOT NULL DEFAULT '{}',
  dataset_version_id TEXT REFERENCES canonical_dataset_versions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  published_at TEXT
);

CREATE TABLE publication_batch_items (
  batch_id TEXT NOT NULL REFERENCES publication_batches(id) ON DELETE CASCADE,
  canonical_id TEXT NOT NULL REFERENCES canonical_records(canonical_id),
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  added_by_external_id TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id, canonical_id)
);

CREATE TABLE canonical_publications (
  canonical_id TEXT PRIMARY KEY REFERENCES canonical_records(canonical_id),
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  record_id TEXT NOT NULL REFERENCES content_records(id),
  dataset_version_id TEXT NOT NULL REFERENCES canonical_dataset_versions(id),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  publication_status TEXT NOT NULL CHECK (publication_status IN ('published', 'superseded')),
  published_by_external_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  superseded_at TEXT
);

CREATE TABLE canonical_publication_history (
  id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL REFERENCES canonical_records(canonical_id),
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  record_id TEXT NOT NULL REFERENCES content_records(id),
  dataset_version_id TEXT NOT NULL REFERENCES canonical_dataset_versions(id),
  revision_number INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('published', 'superseded', 'rolled_back')),
  actor_external_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE canonical_references (
  id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL REFERENCES canonical_records(canonical_id),
  revision_id TEXT NOT NULL REFERENCES content_revisions(id),
  reference_type TEXT NOT NULL,
  locator TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_by_external_id TEXT,
  verified_by_external_id TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE canonical_search_fts USING fts5(
  canonical_id UNINDEXED,
  revision_id UNINDEXED,
  content_type UNINDEXED,
  collection_slug UNINDEXED,
  title,
  body,
  narrator,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER content_revisions_immutable_update
BEFORE UPDATE ON content_revisions
BEGIN
  SELECT RAISE(ABORT, 'Content revisions are immutable.');
END;

CREATE TRIGGER content_revisions_immutable_delete
BEFORE DELETE ON content_revisions
BEGIN
  SELECT RAISE(ABORT, 'Content revisions are immutable.');
END;

CREATE TRIGGER revision_parts_immutable_update
BEFORE UPDATE ON revision_parts
BEGIN
  SELECT RAISE(ABORT, 'Revision parts are immutable.');
END;

CREATE TRIGGER revision_parts_immutable_delete
BEFORE DELETE ON revision_parts
BEGIN
  SELECT RAISE(ABORT, 'Revision parts are immutable.');
END;

CREATE TRIGGER revision_segments_immutable_update
BEFORE UPDATE ON revision_segments
BEGIN
  SELECT RAISE(ABORT, 'Revision segments are immutable.');
END;

CREATE TRIGGER revision_segments_immutable_delete
BEFORE DELETE ON revision_segments
BEGIN
  SELECT RAISE(ABORT, 'Revision segments are immutable.');
END;

CREATE TRIGGER revision_metadata_immutable_update
BEFORE UPDATE ON revision_metadata
BEGIN
  SELECT RAISE(ABORT, 'Revision metadata is immutable.');
END;

CREATE TRIGGER revision_metadata_immutable_delete
BEFORE DELETE ON revision_metadata
BEGIN
  SELECT RAISE(ABORT, 'Revision metadata is immutable.');
END;

CREATE TRIGGER field_reviews_immutable_update
BEFORE UPDATE ON field_reviews
BEGIN
  SELECT RAISE(ABORT, 'Field reviews are append-only.');
END;

CREATE TRIGGER field_reviews_immutable_delete
BEFORE DELETE ON field_reviews
BEGIN
  SELECT RAISE(ABORT, 'Field reviews are append-only.');
END;

CREATE TRIGGER review_decisions_immutable_update
BEFORE UPDATE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'Review decisions are append-only.');
END;

CREATE TRIGGER review_decisions_immutable_delete
BEFORE DELETE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'Review decisions are append-only.');
END;

CREATE INDEX idx_editorial_state_queue ON editorial_record_state(workflow_state, changed_at);
CREATE INDEX idx_assignments_reviewer ON editorial_assignments(assigned_to_external_id, status);
CREATE INDEX idx_field_reviews_revision ON field_reviews(revision_id, reviewer_external_id);
CREATE INDEX idx_review_decisions_revision ON review_decisions(revision_id, review_stage);
CREATE INDEX idx_batch_status ON publication_batches(status, created_at);
CREATE INDEX idx_canonical_publication_dataset ON canonical_publications(dataset_version_id, publication_status);
CREATE INDEX idx_publication_history_record ON canonical_publication_history(canonical_id, occurred_at DESC);
CREATE INDEX idx_revision_parts_revision ON revision_parts(revision_id, position);
CREATE INDEX idx_revision_segments_part ON revision_segments(revision_part_id, position);

INSERT INTO canonical_records (canonical_id, content_type, current_revision_id, created_at, updated_at)
WITH ranked AS (
  SELECT id, COALESCE(logical_id, id) AS canonical_id, content_type, created_at, updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(logical_id, id)
           ORDER BY created_at, id
         ) AS revision_number
  FROM content_records
)
SELECT canonical_id, MIN(content_type),
       'revision.' || canonical_id || '.' || MAX(revision_number),
       MIN(created_at), MAX(updated_at)
FROM ranked
GROUP BY canonical_id;

INSERT INTO content_revisions (
  id, canonical_id, record_id, revision_number, legacy_id, sequence, title, created_by_external_id,
  correction_reason, created_at
)
WITH ranked AS (
  SELECT record.*,
         COALESCE(record.logical_id, record.id) AS canonical_id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(record.logical_id, record.id)
           ORDER BY record.created_at, record.id
         ) AS revision_number
  FROM content_records record
)
SELECT 'revision.' || canonical_id || '.' || revision_number,
       canonical_id, id, revision_number, legacy_id, sequence, title, 'fortress-system',
       'Initial canonical candidate.', created_at
FROM ranked;

INSERT INTO revision_parts (id, revision_id, position)
WITH ranked AS (
  SELECT record.id,
         COALESCE(record.logical_id, record.id) AS canonical_id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(record.logical_id, record.id)
           ORDER BY record.created_at, record.id
         ) AS revision_number
  FROM content_records record
)
SELECT 'revision-part.' || part.id,
       'revision.' || ranked.canonical_id || '.' || ranked.revision_number, part.position
FROM content_parts part
JOIN ranked ON ranked.id = part.record_id;

INSERT INTO revision_segments (
  id, revision_part_id, position, kind, language_code, script_code, text
)
SELECT 'revision-segment.' || segment.id, 'revision-part.' || segment.part_id,
       segment.position, segment.kind, segment.language_code, segment.script_code, segment.text
FROM content_segments segment;

INSERT INTO revision_metadata (
  revision_id, collection_id, book_id, chapter_id, display_number,
  narrator, grade, grading_authority
)
WITH ranked AS (
  SELECT record.id,
         COALESCE(record.logical_id, record.id) AS canonical_id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(record.logical_id, record.id)
           ORDER BY record.created_at, record.id
         ) AS revision_number
  FROM content_records record
)
SELECT 'revision.' || ranked.canonical_id || '.' || ranked.revision_number,
       placement.collection_id, placement.book_id, placement.chapter_id, placement.source_number,
       metadata.narrator,
       COALESCE(grade.normalized_grade, grade.raw_grade, metadata.grade),
       COALESCE(grade.authority, metadata.grading_authority)
FROM ranked
LEFT JOIN record_placements placement ON placement.record_id = ranked.id
LEFT JOIN hadith_metadata metadata ON metadata.record_id = ranked.id
LEFT JOIN hadith_grades grade ON grade.id = (
  SELECT candidate.id FROM hadith_grades candidate
  WHERE candidate.record_id = ranked.id ORDER BY candidate.id LIMIT 1
);

INSERT INTO editorial_record_state (
  canonical_id, revision_id, workflow_state, changed_by_external_id, changed_at
)
SELECT canonical_id, current_revision_id, 'pending_review', 'fortress-system', created_at
FROM canonical_records;

INSERT INTO canonical_dataset_versions (
  id, version_label, publication_status, verification_status, record_count,
  canonical_hash, published_by_external_id, published_at
) VALUES (
  'canonical.bootstrap.2026-07-23', '0.16.0-bootstrap', 'published', 'verified', 0,
  NULL, 'fortress-system', CURRENT_TIMESTAMP
);

INSERT INTO canonical_references (
  id, canonical_id, revision_id, reference_type, locator, verification_status, created_at
)
WITH ranked AS (
  SELECT record.id,
         COALESCE(record.logical_id, record.id) AS canonical_id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(record.logical_id, record.id)
           ORDER BY record.created_at, record.id
         ) AS revision_number
  FROM content_records record
)
SELECT 'canonical.' || reference.id, ranked.canonical_id,
       'revision.' || ranked.canonical_id || '.' || ranked.revision_number,
       reference.reference_type, reference.locator, 'pending', reference.created_at
FROM source_references reference
JOIN ranked ON ranked.id = reference.record_id;

DELETE FROM source_references;
DELETE FROM dataset_sources;
UPDATE collections SET source_id = NULL;
UPDATE segment_translations SET source_id = NULL;
UPDATE hadith_grades SET source_id = NULL;

PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS import_issues;
DROP TABLE IF EXISTS source_record_identities;
DROP TABLE IF EXISTS import_runs;
DROP TABLE IF EXISTS source_artifacts;
DROP TABLE IF EXISTS source_acquisitions;
PRAGMA foreign_keys = ON;

DELETE FROM source_materials;

INSERT INTO content_audit_events (
  id, actor_type, actor_external_id, action, target_type, target_id, details_json
) VALUES (
  'audit.canonical-boundary.2026-07-23', 'system', 'fortress-system',
  'canonical.private_boundary_enforced', 'platform', 'canonical-publication',
  '{"importedRecordsPublished":false,"privateAcquisitionPurged":true}'
);
