PRAGMA foreign_keys = ON;

CREATE TABLE languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  native_name TEXT NOT NULL,
  script_code TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('ltr', 'rtl')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated'))
);

CREATE TABLE contributors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  contributor_type TEXT NOT NULL CHECK (contributor_type IN ('person', 'organization', 'system')),
  affiliation TEXT,
  public_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE source_materials (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('book', 'publication', 'digital_library', 'api', 'file', 'dataset')),
  title TEXT NOT NULL,
  original_title TEXT,
  publisher TEXT,
  edition TEXT,
  publication_year INTEGER,
  source_url TEXT,
  license_name TEXT,
  license_url TEXT,
  license_status TEXT NOT NULL DEFAULT 'unknown' CHECK (license_status IN ('unknown', 'reviewing', 'approved', 'restricted')),
  authenticity_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (authenticity_status IN ('unreviewed', 'trusted', 'rejected')),
  machine_format TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dataset_sources (
  dataset_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES source_materials(id),
  source_role TEXT NOT NULL CHECK (source_role IN ('primary', 'supplemental', 'verification')),
  import_locator TEXT NOT NULL,
  source_hash TEXT,
  imported_by TEXT REFERENCES contributors(id),
  imported_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, source_id, source_role)
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('dua', 'hadith')),
  title TEXT NOT NULL,
  title_arabic TEXT,
  source_id TEXT REFERENCES source_materials(id),
  default_language_code TEXT NOT NULL REFERENCES languages(code),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'deprecated')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE books (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  book_number TEXT,
  title TEXT NOT NULL,
  title_arabic TEXT,
  position INTEGER NOT NULL CHECK (position > 0),
  UNIQUE (collection_id, position)
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_number TEXT,
  title TEXT NOT NULL,
  title_arabic TEXT,
  position INTEGER NOT NULL CHECK (position > 0),
  UNIQUE (book_id, position)
);

CREATE TABLE record_placements (
  record_id TEXT PRIMARY KEY REFERENCES content_records(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  book_id TEXT REFERENCES books(id),
  chapter_id TEXT REFERENCES chapters(id),
  source_number TEXT,
  alternative_numbering_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE dua_metadata (
  record_id TEXT PRIMARY KEY REFERENCES content_records(id) ON DELETE CASCADE,
  repetition_count INTEGER CHECK (repetition_count > 0),
  timing_notes TEXT,
  occasion_notes TEXT
);

CREATE TABLE hadith_metadata (
  record_id TEXT PRIMARY KEY REFERENCES content_records(id) ON DELETE CASCADE,
  hadith_number TEXT NOT NULL,
  alternative_numbering_json TEXT NOT NULL DEFAULT '{}',
  narrator TEXT,
  grade TEXT,
  grading_authority TEXT,
  reference_edition TEXT,
  translator TEXT,
  license_name TEXT
);

CREATE TABLE segment_translations (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES content_segments(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  text TEXT NOT NULL,
  translator_contributor_id TEXT REFERENCES contributors(id),
  source_id TEXT REFERENCES source_materials(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'deprecated')),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (segment_id, language_code, revision)
);

CREATE TABLE taxonomy_terms (
  id TEXT PRIMARY KEY,
  taxonomy_type TEXT NOT NULL CHECK (taxonomy_type IN ('category', 'topic', 'tag', 'keyword', 'mood', 'occasion')),
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  language_code TEXT NOT NULL REFERENCES languages(code),
  description TEXT,
  parent_id TEXT REFERENCES taxonomy_terms(id),
  UNIQUE (taxonomy_type, slug, language_code)
);

CREATE TABLE record_taxonomy (
  record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES taxonomy_terms(id) ON DELETE CASCADE,
  assignment_source TEXT NOT NULL DEFAULT 'editorial' CHECK (assignment_source IN ('source', 'editorial', 'imported')),
  confidence REAL,
  PRIMARY KEY (record_id, term_id)
);

CREATE TABLE source_references (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES source_materials(id),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('primary', 'supporting', 'grading', 'cross_check')),
  locator TEXT NOT NULL,
  canonical_url TEXT,
  notes TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (record_id, source_id, reference_type, locator)
);

CREATE TABLE cross_references (
  from_record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  to_record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('related', 'duplicate', 'explains', 'supports', 'contrasts', 'supersedes')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (from_record_id, to_record_id, relationship),
  CHECK (from_record_id <> to_record_id)
);

CREATE TABLE verification_records (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('dataset', 'record', 'segment', 'translation', 'source')),
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'rejected', 'deprecated')),
  verifier_contributor_id TEXT REFERENCES contributors(id),
  reviewer_external_id TEXT,
  method TEXT NOT NULL,
  notes TEXT,
  content_hash TEXT,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_verification_target ON verification_records(target_type, target_id, reviewed_at DESC);

CREATE TABLE correction_history (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES content_records(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  replacement_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by_contributor_id TEXT REFERENCES contributors(id),
  changed_by_external_id TEXT,
  from_dataset_id TEXT REFERENCES dataset_versions(id),
  to_dataset_id TEXT REFERENCES dataset_versions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_correction_record ON correction_history(record_id, created_at DESC);

CREATE TABLE publication_history (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('imported', 'validated', 'published', 'deprecated', 'rolled_back')),
  previous_dataset_id TEXT REFERENCES dataset_versions(id),
  actor_contributor_id TEXT REFERENCES contributors(id),
  actor_external_id TEXT,
  notes TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_publication_dataset ON publication_history(dataset_id, occurred_at DESC);

CREATE TABLE record_search_metadata (
  record_id TEXT PRIMARY KEY REFERENCES content_records(id) ON DELETE CASCADE,
  normalized_title TEXT NOT NULL,
  keywords_text TEXT NOT NULL DEFAULT '',
  language_codes TEXT NOT NULL DEFAULT '',
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_type TEXT NOT NULL,
  actor_external_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  request_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_content_audit_target ON content_audit_events(target_type, target_id, occurred_at DESC);

CREATE INDEX idx_dataset_sources_source ON dataset_sources(source_id);
CREATE INDEX idx_record_placements_collection ON record_placements(collection_id, book_id, chapter_id);
CREATE INDEX idx_record_taxonomy_term ON record_taxonomy(term_id, record_id);
CREATE INDEX idx_source_references_record ON source_references(record_id, verification_status);
CREATE INDEX idx_search_metadata_title ON record_search_metadata(normalized_title);

INSERT INTO languages (code, name, native_name, script_code, direction) VALUES
  ('ar', 'Arabic', 'Arabic', 'Arab', 'rtl'),
  ('ar-Latn', 'Arabic transliteration', 'Arabic transliteration', 'Latn', 'ltr'),
  ('en', 'English', 'English', 'Latn', 'ltr');

INSERT INTO contributors (id, display_name, contributor_type, affiliation)
VALUES ('contributor.fortress.legacy-importer', 'Fortress legacy import process', 'system', 'Fortress Platform');

INSERT INTO source_materials (
  id, source_type, title, machine_format, license_status, authenticity_status, notes
) VALUES (
  'source.hisn.user-docx.legacy', 'file', 'User-provided Fortress of Muslim document', 'DOCX',
  'unknown', 'unreviewed',
  'Legacy source retained for continuity. Publisher, edition, translator, license, and scholarly verification must be established before canonical verification.'
);

INSERT INTO dataset_sources (
  dataset_id, source_id, source_role, import_locator, source_hash, imported_by, imported_at
)
SELECT id, 'source.hisn.user-docx.legacy', 'primary', generated_from, content_hash,
       'contributor.fortress.legacy-importer', imported_at
FROM dataset_versions WHERE id = 'dataset.hisn.legacy.2026-07-11-v2';

INSERT INTO collections (
  id, slug, content_type, title, source_id, default_language_code, verification_status
) VALUES (
  'collection.hisn.legacy', 'hisn-muslim-legacy', 'dua', 'Fortress of Muslim (legacy import)',
  'source.hisn.user-docx.legacy', 'en', 'pending'
);

INSERT INTO record_placements (record_id, collection_id, source_number)
SELECT id, 'collection.hisn.legacy', CAST(sequence AS TEXT)
FROM content_records WHERE dataset_id = 'dataset.hisn.legacy.2026-07-11-v2';

INSERT INTO dua_metadata (record_id)
SELECT id FROM content_records
WHERE dataset_id = 'dataset.hisn.legacy.2026-07-11-v2' AND content_type = 'dua';

INSERT INTO record_search_metadata (record_id, normalized_title, language_codes)
SELECT id, lower(title), 'ar,ar-Latn,en'
FROM content_records WHERE dataset_id = 'dataset.hisn.legacy.2026-07-11-v2';

INSERT INTO publication_history (
  id, dataset_id, event_type, actor_contributor_id, notes, occurred_at
) SELECT 'publication.hisn.legacy.initial', id, 'imported',
         'contributor.fortress.legacy-importer',
         'Initial legacy dataset import; content remains pending editorial and source verification.', imported_at
  FROM dataset_versions WHERE id = 'dataset.hisn.legacy.2026-07-11-v2';

INSERT INTO publication_history (
  id, dataset_id, event_type, actor_contributor_id, notes, occurred_at
) SELECT 'publication.hisn.legacy.compatibility', id, 'published',
         'contributor.fortress.legacy-importer',
         'Published for legacy reader compatibility. Publication does not imply canonical verification.', imported_at
  FROM dataset_versions WHERE id = 'dataset.hisn.legacy.2026-07-11-v2';

INSERT INTO verification_records (
  id, target_type, target_id, status, verifier_contributor_id, method, notes, reviewed_at
) SELECT 'verification.' || id || '.legacy-import', 'record', id, 'pending',
         'contributor.fortress.legacy-importer', 'legacy_import',
         'Awaiting record-level citation, license, and editorial verification.', created_at
  FROM content_records WHERE dataset_id = 'dataset.hisn.legacy.2026-07-11-v2';

INSERT INTO verification_records (
  id, target_type, target_id, status, verifier_contributor_id, method, notes, reviewed_at
) SELECT 'verification.' || id || '.legacy-import', 'dataset', id, 'pending',
         'contributor.fortress.legacy-importer', 'legacy_import',
         'Awaiting source, license, and editorial verification.', imported_at
  FROM dataset_versions WHERE id = 'dataset.hisn.legacy.2026-07-11-v2';
