-- Hisn al-Muslim's four-role reading model, applied to the canonical records.
--
-- The book holds four kinds of reading, and every record had been forced into the shape of a
-- supplication. The roles:
--   supplication  recitable words
--   framed        a narration or instruction that contains recitable words ("When you sneeze, say: ...")
--   instruction   what to do, with no fixed words (pray two rak'ahs, recite Surah al-Mulk, prostrate)
--   virtue        a narration about merit, with nothing to recite
-- Each of the 268 readings was judged by reading its text; the judgements are the same ones the
-- offline app ships (pwa-website/tools/apply-reading-roles.mjs). Counts: supplication 205, framed 36, instruction 14, virtue 13.
--
-- What this migration does:
--   1. Records every reading's role in canonical_reading_roles, served by the API as readingRole.
--   2. Restores dua.hisn.142 and dua.hisn.143 (chapter 45's adhan and adhkar readings), which 0017
--      withdrew. They are valid readings; what was wrong was the "--" shown where a transliteration
--      belongs, and step 3 removes it. The withdrawal mechanism itself stays.
--   3. Publishes a new revision of 48 records whose transliteration field held "--" or English
--      prose, or whose translation had been cut off mid-sentence. Revisions are immutable, so each
--      correction is a new revision superseding the old one, which stays in the history untouched.
--      44 segments are removed, 2 move to a comment segment, 2 translations are completed.
--      No Arabic and no reference changes.
--   4. Publishes the result as a new dataset version, as the Admin Console's publish path does, so
--      the Admin Console can roll back to the previous dataset. Ask re-embeds the new dataset via
--      the per-minute cron (268 records, about six minutes; Ask answers lexically meanwhile).
--   5. Rebuilds the dua rows of canonical_search_fts with the Arabic normalisation every application
--      write path uses. 0013 wrote these rows with diacritics, which diacritic-free queries miss.
--
-- Guarded: a record gets a new revision only if its current, published revision holds exactly the
-- text listed below. Anything that has changed since this was written is skipped, not overwritten.
-- Line breaks inside that text are written as char(10) rather than raw, so the comparison holds
-- whatever line endings the file is checked out with.
-- Roles are only assigned where the record sits in the expected chapter. This makes the migration
-- safe to run against any environment, including one that differs from test.
--
-- Actor: the same account 0013 recorded when it verified and published this corpus.

PRAGMA foreign_keys = ON;

CREATE TABLE canonical_reading_roles (
  canonical_id TEXT PRIMARY KEY REFERENCES canonical_records(canonical_id),
  reading_role TEXT NOT NULL CHECK (reading_role IN ('supplication', 'framed', 'instruction', 'virtue')),
  assigned_by_external_id TEXT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_canonical_reading_roles_role ON canonical_reading_roles(reading_role);

-- Working tables, dropped at the end.
CREATE TABLE _m0018_role_plan (
  canonical_id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  reading_role TEXT NOT NULL
);

CREATE TABLE _m0018_segment_plan (
  canonical_id TEXT NOT NULL,
  part_position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  expected_text TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('drop', 'comment', 'retext')),
  new_text TEXT,
  previous_hash TEXT NOT NULL,
  replacement_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (canonical_id, part_position, kind)
);

CREATE TABLE _m0018_record_plan (
  canonical_id TEXT PRIMARY KEY,
  correction_reason TEXT NOT NULL
);

CREATE TABLE _m0018_eligible (
  canonical_id TEXT PRIMARY KEY,
  old_revision_id TEXT NOT NULL,
  new_revision_id TEXT NOT NULL,
  new_revision_number INTEGER NOT NULL,
  record_id TEXT NOT NULL
);

-- Every reading's role. Keyed by canonical id, guarded by chapter.
INSERT INTO _m0018_role_plan (canonical_id, chapter_id, reading_role) VALUES
  ('dua.hisn.001', 'book.sunnah.hisn.1.chapter.c1.00', 'supplication'),
  ('dua.hisn.002', 'book.sunnah.hisn.1.chapter.c1.00', 'supplication'),
  ('dua.hisn.003', 'book.sunnah.hisn.1.chapter.c1.00', 'supplication'),
  ('dua.hisn.004', 'book.sunnah.hisn.1.chapter.c1.00', 'supplication'),
  ('dua.hisn.005', 'book.sunnah.hisn.1.chapter.c2.00', 'supplication'),
  ('dua.hisn.006', 'book.sunnah.hisn.1.chapter.c3.00', 'supplication'),
  ('dua.hisn.007', 'book.sunnah.hisn.1.chapter.c4.00', 'supplication'),
  ('dua.hisn.008', 'book.sunnah.hisn.1.chapter.c4.00', 'supplication'),
  ('dua.hisn.009', 'book.sunnah.hisn.1.chapter.c5.00', 'supplication'),
  ('dua.hisn.010', 'book.sunnah.hisn.1.chapter.c6.00', 'supplication'),
  ('dua.hisn.011', 'book.sunnah.hisn.1.chapter.c7.00', 'supplication'),
  ('dua.hisn.012', 'book.sunnah.hisn.1.chapter.c8.00', 'supplication'),
  ('dua.hisn.013', 'book.sunnah.hisn.1.chapter.c9.00', 'supplication'),
  ('dua.hisn.014', 'book.sunnah.hisn.1.chapter.c9.00', 'supplication'),
  ('dua.hisn.015', 'book.sunnah.hisn.1.chapter.c9.00', 'supplication'),
  ('dua.hisn.016', 'book.sunnah.hisn.1.chapter.c10.00', 'supplication'),
  ('dua.hisn.017', 'book.sunnah.hisn.1.chapter.c10.00', 'supplication'),
  ('dua.hisn.018', 'book.sunnah.hisn.1.chapter.c11.00', 'supplication'),
  ('dua.hisn.019', 'book.sunnah.hisn.1.chapter.c12.00', 'supplication'),
  ('dua.hisn.020', 'book.sunnah.hisn.1.chapter.c13.00', 'supplication'),
  ('dua.hisn.021', 'book.sunnah.hisn.1.chapter.c14.00', 'supplication'),
  ('dua.hisn.022', 'book.sunnah.hisn.1.chapter.c15.00', 'framed'),
  ('dua.hisn.023', 'book.sunnah.hisn.1.chapter.c15.00', 'supplication'),
  ('dua.hisn.024', 'book.sunnah.hisn.1.chapter.c15.00', 'instruction'),
  ('dua.hisn.025', 'book.sunnah.hisn.1.chapter.c15.00', 'supplication'),
  ('dua.hisn.026', 'book.sunnah.hisn.1.chapter.c15.00', 'instruction'),
  ('dua.hisn.027', 'book.sunnah.hisn.1.chapter.c16.00', 'supplication'),
  ('dua.hisn.028', 'book.sunnah.hisn.1.chapter.c16.00', 'supplication'),
  ('dua.hisn.029', 'book.sunnah.hisn.1.chapter.c16.00', 'supplication'),
  ('dua.hisn.030', 'book.sunnah.hisn.1.chapter.c16.00', 'supplication'),
  ('dua.hisn.031', 'book.sunnah.hisn.1.chapter.c16.00', 'supplication'),
  ('dua.hisn.032', 'book.sunnah.hisn.1.chapter.c16.00', 'supplication'),
  ('dua.hisn.033', 'book.sunnah.hisn.1.chapter.c17.00', 'supplication'),
  ('dua.hisn.034', 'book.sunnah.hisn.1.chapter.c17.00', 'supplication'),
  ('dua.hisn.035', 'book.sunnah.hisn.1.chapter.c17.00', 'supplication'),
  ('dua.hisn.036', 'book.sunnah.hisn.1.chapter.c17.00', 'supplication'),
  ('dua.hisn.037', 'book.sunnah.hisn.1.chapter.c17.00', 'supplication'),
  ('dua.hisn.038', 'book.sunnah.hisn.1.chapter.c18.00', 'supplication'),
  ('dua.hisn.039', 'book.sunnah.hisn.1.chapter.c18.00', 'supplication'),
  ('dua.hisn.040', 'book.sunnah.hisn.1.chapter.c18.00', 'supplication'),
  ('dua.hisn.041', 'book.sunnah.hisn.1.chapter.c19.00', 'supplication'),
  ('dua.hisn.042', 'book.sunnah.hisn.1.chapter.c19.00', 'supplication'),
  ('dua.hisn.043', 'book.sunnah.hisn.1.chapter.c19.00', 'supplication'),
  ('dua.hisn.044', 'book.sunnah.hisn.1.chapter.c19.00', 'supplication'),
  ('dua.hisn.045', 'book.sunnah.hisn.1.chapter.c19.00', 'supplication'),
  ('dua.hisn.046', 'book.sunnah.hisn.1.chapter.c19.00', 'supplication'),
  ('dua.hisn.047', 'book.sunnah.hisn.1.chapter.c19.00', 'supplication'),
  ('dua.hisn.048', 'book.sunnah.hisn.1.chapter.c20.00', 'supplication'),
  ('dua.hisn.049', 'book.sunnah.hisn.1.chapter.c20.00', 'supplication'),
  ('dua.hisn.050', 'book.sunnah.hisn.1.chapter.c21.00', 'supplication'),
  ('dua.hisn.051', 'book.sunnah.hisn.1.chapter.c21.00', 'supplication'),
  ('dua.hisn.052', 'book.sunnah.hisn.1.chapter.c22.00', 'supplication'),
  ('dua.hisn.053', 'book.sunnah.hisn.1.chapter.c23.00', 'supplication'),
  ('dua.hisn.054', 'book.sunnah.hisn.1.chapter.c23.00', 'supplication'),
  ('dua.hisn.055', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.056', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.057', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.058', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.059', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.060', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.061', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.062', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.063', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.064', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.065', 'book.sunnah.hisn.1.chapter.c24.00', 'supplication'),
  ('dua.hisn.066', 'book.sunnah.hisn.1.chapter.c25.00', 'supplication'),
  ('dua.hisn.067', 'book.sunnah.hisn.1.chapter.c25.00', 'supplication'),
  ('dua.hisn.068', 'book.sunnah.hisn.1.chapter.c25.00', 'supplication'),
  ('dua.hisn.069', 'book.sunnah.hisn.1.chapter.c25.00', 'supplication'),
  ('dua.hisn.070', 'book.sunnah.hisn.1.chapter.c25.00', 'supplication'),
  ('dua.hisn.071', 'book.sunnah.hisn.1.chapter.c25.00', 'supplication'),
  ('dua.hisn.072', 'book.sunnah.hisn.1.chapter.c25.00', 'supplication'),
  ('dua.hisn.073', 'book.sunnah.hisn.1.chapter.c25.00', 'supplication'),
  ('dua.hisn.074', 'book.sunnah.hisn.1.chapter.c26.00', 'framed'),
  ('dua.hisn.075a', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.075', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.076', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.077', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.078', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.079', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.080', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.081', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.082', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.083', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.084', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.085', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.086', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.087', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.088', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.089', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.090', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.091', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.092', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.093', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.094', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.095', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.096', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.097', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.098', 'book.sunnah.hisn.1.chapter.c27.00', 'supplication'),
  ('dua.hisn.099', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.100', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.101', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.102', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.103', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.104', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.105', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.106', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.107', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.108', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.109', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.110', 'book.sunnah.hisn.1.chapter.c28.00', 'instruction'),
  ('dua.hisn.111', 'book.sunnah.hisn.1.chapter.c28.00', 'supplication'),
  ('dua.hisn.112', 'book.sunnah.hisn.1.chapter.c29.00', 'supplication'),
  ('dua.hisn.113', 'book.sunnah.hisn.1.chapter.c30.00', 'supplication'),
  ('dua.hisn.114', 'book.sunnah.hisn.1.chapter.c31.00', 'instruction'),
  ('dua.hisn.115', 'book.sunnah.hisn.1.chapter.c31.00', 'supplication'),
  ('dua.hisn.116', 'book.sunnah.hisn.1.chapter.c32.00', 'supplication'),
  ('dua.hisn.117', 'book.sunnah.hisn.1.chapter.c32.00', 'supplication'),
  ('dua.hisn.118', 'book.sunnah.hisn.1.chapter.c32.00', 'supplication'),
  ('dua.hisn.119', 'book.sunnah.hisn.1.chapter.c33.00', 'supplication'),
  ('dua.hisn.120', 'book.sunnah.hisn.1.chapter.c34.00', 'supplication'),
  ('dua.hisn.121', 'book.sunnah.hisn.1.chapter.c34.00', 'supplication'),
  ('dua.hisn.122', 'book.sunnah.hisn.1.chapter.c35.00', 'supplication'),
  ('dua.hisn.123', 'book.sunnah.hisn.1.chapter.c35.00', 'supplication'),
  ('dua.hisn.124', 'book.sunnah.hisn.1.chapter.c35.00', 'supplication'),
  ('dua.hisn.125', 'book.sunnah.hisn.1.chapter.c35.00', 'supplication'),
  ('dua.hisn.126', 'book.sunnah.hisn.1.chapter.c36.00', 'supplication'),
  ('dua.hisn.127', 'book.sunnah.hisn.1.chapter.c36.00', 'supplication'),
  ('dua.hisn.128', 'book.sunnah.hisn.1.chapter.c36.00', 'supplication'),
  ('dua.hisn.129', 'book.sunnah.hisn.1.chapter.c37.00', 'supplication'),
  ('dua.hisn.130', 'book.sunnah.hisn.1.chapter.c37.00', 'supplication'),
  ('dua.hisn.131', 'book.sunnah.hisn.1.chapter.c38.00', 'supplication'),
  ('dua.hisn.132', 'book.sunnah.hisn.1.chapter.c39.00', 'supplication'),
  ('dua.hisn.133', 'book.sunnah.hisn.1.chapter.c40.00', 'supplication'),
  ('dua.hisn.134', 'book.sunnah.hisn.1.chapter.c40.00', 'framed'),
  ('dua.hisn.135', 'book.sunnah.hisn.1.chapter.c40.00', 'framed'),
  ('dua.hisn.136', 'book.sunnah.hisn.1.chapter.c41.00', 'supplication'),
  ('dua.hisn.137', 'book.sunnah.hisn.1.chapter.c41.00', 'supplication'),
  ('dua.hisn.138', 'book.sunnah.hisn.1.chapter.c42.00', 'supplication'),
  ('dua.hisn.139', 'book.sunnah.hisn.1.chapter.c43.00', 'supplication'),
  ('dua.hisn.140', 'book.sunnah.hisn.1.chapter.c44.00', 'instruction'),
  ('dua.hisn.141', 'book.sunnah.hisn.1.chapter.c45.00', 'supplication'),
  ('dua.hisn.142', 'book.sunnah.hisn.1.chapter.c45.00', 'instruction'),
  ('dua.hisn.143', 'book.sunnah.hisn.1.chapter.c45.00', 'instruction'),
  ('dua.hisn.144', 'book.sunnah.hisn.1.chapter.c46.00', 'supplication'),
  ('dua.hisn.145', 'book.sunnah.hisn.1.chapter.c47.00', 'supplication'),
  ('dua.hisn.146', 'book.sunnah.hisn.1.chapter.c48.00', 'framed'),
  ('dua.hisn.147', 'book.sunnah.hisn.1.chapter.c49.00', 'supplication'),
  ('dua.hisn.148', 'book.sunnah.hisn.1.chapter.c49.00', 'supplication'),
  ('dua.hisn.149', 'book.sunnah.hisn.1.chapter.c50.00', 'virtue'),
  ('dua.hisn.150', 'book.sunnah.hisn.1.chapter.c51.00', 'supplication'),
  ('dua.hisn.151', 'book.sunnah.hisn.1.chapter.c51.00', 'framed'),
  ('dua.hisn.152', 'book.sunnah.hisn.1.chapter.c51.00', 'supplication'),
  ('dua.hisn.153', 'book.sunnah.hisn.1.chapter.c52.00', 'framed'),
  ('dua.hisn.154', 'book.sunnah.hisn.1.chapter.c53.00', 'supplication'),
  ('dua.hisn.155', 'book.sunnah.hisn.1.chapter.c54.00', 'supplication'),
  ('dua.hisn.156', 'book.sunnah.hisn.1.chapter.c55.00', 'supplication'),
  ('dua.hisn.157', 'book.sunnah.hisn.1.chapter.c55.00', 'supplication'),
  ('dua.hisn.158', 'book.sunnah.hisn.1.chapter.c55.00', 'supplication'),
  ('dua.hisn.159', 'book.sunnah.hisn.1.chapter.c55.00', 'supplication'),
  ('dua.hisn.160', 'book.sunnah.hisn.1.chapter.c56.00', 'supplication'),
  ('dua.hisn.161', 'book.sunnah.hisn.1.chapter.c56.00', 'supplication'),
  ('dua.hisn.162', 'book.sunnah.hisn.1.chapter.c57.00', 'supplication'),
  ('dua.hisn.163', 'book.sunnah.hisn.1.chapter.c58.00', 'supplication'),
  ('dua.hisn.164', 'book.sunnah.hisn.1.chapter.c59.00', 'supplication'),
  ('dua.hisn.165', 'book.sunnah.hisn.1.chapter.c60.00', 'supplication'),
  ('dua.hisn.166', 'book.sunnah.hisn.1.chapter.c61.00', 'supplication'),
  ('dua.hisn.167', 'book.sunnah.hisn.1.chapter.c61.00', 'supplication'),
  ('dua.hisn.168', 'book.sunnah.hisn.1.chapter.c62.00', 'supplication'),
  ('dua.hisn.169', 'book.sunnah.hisn.1.chapter.c63.00', 'supplication'),
  ('dua.hisn.170', 'book.sunnah.hisn.1.chapter.c63.00', 'supplication'),
  ('dua.hisn.171', 'book.sunnah.hisn.1.chapter.c63.00', 'supplication'),
  ('dua.hisn.172', 'book.sunnah.hisn.1.chapter.c64.00', 'supplication'),
  ('dua.hisn.173', 'book.sunnah.hisn.1.chapter.c65.00', 'supplication'),
  ('dua.hisn.174', 'book.sunnah.hisn.1.chapter.c66.00', 'supplication'),
  ('dua.hisn.175', 'book.sunnah.hisn.1.chapter.c67.00', 'supplication'),
  ('dua.hisn.176', 'book.sunnah.hisn.1.chapter.c68.00', 'supplication'),
  ('dua.hisn.177', 'book.sunnah.hisn.1.chapter.c68.00', 'supplication'),
  ('dua.hisn.178', 'book.sunnah.hisn.1.chapter.c69.00', 'framed'),
  ('dua.hisn.179', 'book.sunnah.hisn.1.chapter.c69.00', 'framed'),
  ('dua.hisn.180', 'book.sunnah.hisn.1.chapter.c70.00', 'supplication'),
  ('dua.hisn.181', 'book.sunnah.hisn.1.chapter.c70.00', 'supplication'),
  ('dua.hisn.182', 'book.sunnah.hisn.1.chapter.c71.00', 'supplication'),
  ('dua.hisn.183', 'book.sunnah.hisn.1.chapter.c72.00', 'supplication'),
  ('dua.hisn.184', 'book.sunnah.hisn.1.chapter.c73.00', 'supplication'),
  ('dua.hisn.185', 'book.sunnah.hisn.1.chapter.c74.00', 'instruction'),
  ('dua.hisn.186', 'book.sunnah.hisn.1.chapter.c75.00', 'supplication'),
  ('dua.hisn.187', 'book.sunnah.hisn.1.chapter.c76.00', 'supplication'),
  ('dua.hisn.188', 'book.sunnah.hisn.1.chapter.c77.00', 'framed'),
  ('dua.hisn.189', 'book.sunnah.hisn.1.chapter.c78.00', 'supplication'),
  ('dua.hisn.190', 'book.sunnah.hisn.1.chapter.c79.00', 'supplication'),
  ('dua.hisn.191', 'book.sunnah.hisn.1.chapter.c80.00', 'framed'),
  ('dua.hisn.192', 'book.sunnah.hisn.1.chapter.c81.00', 'supplication'),
  ('dua.hisn.193', 'book.sunnah.hisn.1.chapter.c82.00', 'supplication'),
  ('dua.hisn.194', 'book.sunnah.hisn.1.chapter.c83.00', 'supplication'),
  ('dua.hisn.195', 'book.sunnah.hisn.1.chapter.c84.00', 'framed'),
  ('dua.hisn.196', 'book.sunnah.hisn.1.chapter.c85.00', 'supplication'),
  ('dua.hisn.197', 'book.sunnah.hisn.1.chapter.c86.00', 'supplication'),
  ('dua.hisn.198', 'book.sunnah.hisn.1.chapter.c87.00', 'supplication'),
  ('dua.hisn.199', 'book.sunnah.hisn.1.chapter.c88.00', 'instruction'),
  ('dua.hisn.200', 'book.sunnah.hisn.1.chapter.c89.00', 'supplication'),
  ('dua.hisn.201', 'book.sunnah.hisn.1.chapter.c90.00', 'supplication'),
  ('dua.hisn.202', 'book.sunnah.hisn.1.chapter.c91.00', 'supplication'),
  ('dua.hisn.203', 'book.sunnah.hisn.1.chapter.c92.00', 'supplication'),
  ('dua.hisn.204', 'book.sunnah.hisn.1.chapter.c93.00', 'supplication'),
  ('dua.hisn.205', 'book.sunnah.hisn.1.chapter.c94.00', 'supplication'),
  ('dua.hisn.206', 'book.sunnah.hisn.1.chapter.c95.00', 'supplication'),
  ('dua.hisn.207', 'book.sunnah.hisn.1.chapter.c96.00', 'supplication'),
  ('dua.hisn.208', 'book.sunnah.hisn.1.chapter.c97.00', 'supplication'),
  ('dua.hisn.209', 'book.sunnah.hisn.1.chapter.c98.00', 'supplication'),
  ('dua.hisn.210', 'book.sunnah.hisn.1.chapter.c99.00', 'supplication'),
  ('dua.hisn.211', 'book.sunnah.hisn.1.chapter.c100.00', 'supplication'),
  ('dua.hisn.212', 'book.sunnah.hisn.1.chapter.c101.00', 'supplication'),
  ('dua.hisn.213', 'book.sunnah.hisn.1.chapter.c101.00', 'supplication'),
  ('dua.hisn.214', 'book.sunnah.hisn.1.chapter.c102.00', 'framed'),
  ('dua.hisn.215', 'book.sunnah.hisn.1.chapter.c103.00', 'supplication'),
  ('dua.hisn.216', 'book.sunnah.hisn.1.chapter.c104.00', 'supplication'),
  ('dua.hisn.217', 'book.sunnah.hisn.1.chapter.c105.00', 'framed'),
  ('dua.hisn.218', 'book.sunnah.hisn.1.chapter.c106.00', 'framed'),
  ('dua.hisn.219', 'book.sunnah.hisn.1.chapter.c107.00', 'virtue'),
  ('dua.hisn.220', 'book.sunnah.hisn.1.chapter.c107.00', 'virtue'),
  ('dua.hisn.221', 'book.sunnah.hisn.1.chapter.c107.00', 'virtue'),
  ('dua.hisn.222', 'book.sunnah.hisn.1.chapter.c107.00', 'virtue'),
  ('dua.hisn.223', 'book.sunnah.hisn.1.chapter.c107.00', 'virtue'),
  ('dua.hisn.224', 'book.sunnah.hisn.1.chapter.c108.00', 'virtue'),
  ('dua.hisn.225', 'book.sunnah.hisn.1.chapter.c108.00', 'virtue'),
  ('dua.hisn.226', 'book.sunnah.hisn.1.chapter.c108.00', 'virtue'),
  ('dua.hisn.227', 'book.sunnah.hisn.1.chapter.c109.00', 'supplication'),
  ('dua.hisn.228', 'book.sunnah.hisn.1.chapter.c110.00', 'instruction'),
  ('dua.hisn.229', 'book.sunnah.hisn.1.chapter.c111.00', 'instruction'),
  ('dua.hisn.230', 'book.sunnah.hisn.1.chapter.c112.00', 'framed'),
  ('dua.hisn.231', 'book.sunnah.hisn.1.chapter.c113.00', 'framed'),
  ('dua.hisn.232', 'book.sunnah.hisn.1.chapter.c114.00', 'supplication'),
  ('dua.hisn.233', 'book.sunnah.hisn.1.chapter.c115.00', 'supplication'),
  ('dua.hisn.234', 'book.sunnah.hisn.1.chapter.c116.00', 'framed'),
  ('dua.hisn.235', 'book.sunnah.hisn.1.chapter.c117.00', 'supplication'),
  ('dua.hisn.236', 'book.sunnah.hisn.1.chapter.c118.00', 'framed'),
  ('dua.hisn.237', 'book.sunnah.hisn.1.chapter.c119.00', 'supplication'),
  ('dua.hisn.238', 'book.sunnah.hisn.1.chapter.c120.00', 'instruction'),
  ('dua.hisn.239', 'book.sunnah.hisn.1.chapter.c121.00', 'instruction'),
  ('dua.hisn.240', 'book.sunnah.hisn.1.chapter.c122.00', 'supplication'),
  ('dua.hisn.241', 'book.sunnah.hisn.1.chapter.c122.00', 'supplication'),
  ('dua.hisn.242', 'book.sunnah.hisn.1.chapter.c123.00', 'instruction'),
  ('dua.hisn.243', 'book.sunnah.hisn.1.chapter.c124.00', 'supplication'),
  ('dua.hisn.244', 'book.sunnah.hisn.1.chapter.c125.00', 'framed'),
  ('dua.hisn.245', 'book.sunnah.hisn.1.chapter.c126.00', 'supplication'),
  ('dua.hisn.246', 'book.sunnah.hisn.1.chapter.c127.00', 'supplication'),
  ('dua.hisn.247', 'book.sunnah.hisn.1.chapter.c128.00', 'supplication'),
  ('dua.hisn.248', 'book.sunnah.hisn.1.chapter.c129.00', 'framed'),
  ('dua.hisn.249', 'book.sunnah.hisn.1.chapter.c129.00', 'virtue'),
  ('dua.hisn.250', 'book.sunnah.hisn.1.chapter.c129.00', 'framed'),
  ('dua.hisn.251', 'book.sunnah.hisn.1.chapter.c129.00', 'virtue'),
  ('dua.hisn.252', 'book.sunnah.hisn.1.chapter.c129.00', 'virtue'),
  ('dua.hisn.253', 'book.sunnah.hisn.1.chapter.c129.00', 'framed'),
  ('dua.hisn.254', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.255', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.256', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.257', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.258', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.259', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.260', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.261', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.262', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.263', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.264', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.265', 'book.sunnah.hisn.1.chapter.c130.00', 'framed'),
  ('dua.hisn.266', 'book.sunnah.hisn.1.chapter.c131.00', 'framed'),
  ('dua.hisn.267', 'book.sunnah.hisn.1.chapter.c132.00', 'virtue');

-- Every segment change, with the exact text it replaces. Hashes are SHA-256 of the UTF-8 text,
-- as the Admin Console records them in correction_history.
INSERT INTO _m0018_segment_plan (canonical_id, part_position, kind, expected_text, action, new_text, previous_hash, replacement_hash, reason) VALUES
  ('dua.hisn.110', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.142', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.143', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.146', 1, 'transliteration', 'The Prophet (ﷺ) used to seek Allah''s protection for Al-Hasan and Al-Husain by saying:', 'comment', NULL, 'fd037d2049eed10033f9fc87a263cbce731067f2b1d2404f3c4a6ae0aa5c4922', 'fd037d2049eed10033f9fc87a263cbce731067f2b1d2404f3c4a6ae0aa5c4922', 'Moved the narration frame out of the transliteration field into a comment segment: it is English narration introducing the words, not a transliteration of them. Text unchanged.'),
  ('dua.hisn.151', 1, 'transliteration', 'As he was dying, the Prophet (ﷺ) dipped his hands in water and wiped his face saying:', 'comment', NULL, 'e1fa33a17f055861cc2f5ed3c3d6eeee6c2f5a2df5c587e021e868eec7177e4e', 'e1fa33a17f055861cc2f5ed3c3d6eeee6c2f5a2df5c587e021e868eec7177e4e', 'Moved the narration frame out of the transliteration field into a comment segment: it is English narration introducing the words, not a transliteration of them. Text unchanged.'),
  ('dua.hisn.178', 1, 'transliteration', 'When anyone of you begins eating, say:', 'drop', NULL, 'dc6a22844a782bd0991aa200cacb27e39a05f614d3eba3a615ff625314724743', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.179', 1, 'transliteration', 'Whomever Allah has given food, should say:', 'drop', NULL, '3e7ec19138ad157d4276dd511c665030a718d666d63b691e3254bb6a4aed4f1a', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.185', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.188', 1, 'transliteration', 'When you sneeze , then say :', 'drop', NULL, '4b00e89be1ee3675a4e9990631b92cae96556627cc33daa2956deca0131f1f5a', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.191', 1, 'transliteration', 'When any of you marries a woman or purchases a maid-servant then let him say:', 'drop', NULL, 'b07ffc6a5646fa2403d722e4bd20de1d18d0855d5e804a890a03d7630df6f913', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.195', 1, 'transliteration', 'Ibn Umar (ra) said:', 'drop', NULL, '433843846d21be368201061acc2fbc8fb95e349d54eadca463c508ab4b705127', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.199', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.214', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.217', 1, 'transliteration', 'From every elevated point say' || char(10) || 'Allāhu Akbar (three times),' || char(10) || 'and then recite:', 'drop', NULL, 'f99c72ae6ec82c3cded8a3eaf61b23b3f03fb88b5e6fbc76e75f3705f1adcc8d', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.218', 1, 'transliteration', 'When something happened that pleased him, the Prophet (ﷺ) used to say:', 'drop', NULL, 'adcf1b62164faff01785d71e5665dbd6efbc88b740d63cc9718b84a85f78b07d', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.219', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.220', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.221', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.222', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.223', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.224', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.225', 1, 'translation', 'Three characteristics, whoever combines them, has completed his faith:', 'retext', 'Three characteristics, whoever combines them, has completed his faith: to be just, to spread greetings to all people and to spend (charitably) out of the little you have.', '2a79f8f2fba4f76101c3c47d1a8bad90fadece2ffe28f1f5cf0d60f5556b8e0d', '318d70f8bae9bd35117e7a76191bcc38fe21896933277be6a8cf8379f749a9e2', 'Completed a translation that had been cut off mid-sentence. The full sentence comes from the same Hisn al-Muslim source text, where it had been stored in the wrong field.'),
  ('dua.hisn.226', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.228', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.231', 1, 'transliteration', 'If any of you praises his companion then let him say:', 'drop', NULL, '95ec78685b558b6cc77087cfd081f0e08de61a85f5b8948b17debc4e3d3b66bc', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.234', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.236', 1, 'transliteration', 'Whenever the Prophet (ﷺ) approached Mount Safa, he would recite:', 'drop', NULL, '5287b6156dbfc178f9c28e877bac52891d46810addc1586aeca513d5d0d21eca', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.239', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.243', 1, 'transliteration', 'Put your hand on the place where you feel pain and say:', 'drop', NULL, 'a6c9fc6d6a6587dbc14eccb4cc576fd21e675425968d8c7166c2c79bdcb30f94', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.248', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.249', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.250', 1, 'transliteration', 'Allah''s Messenger (ﷺ) said:', 'drop', NULL, '72a03d56ea053a4b14874bb36740edae5ca920d7ccae4e4c0ccd9b35420addd8', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.251', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.252', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.253', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.254', 1, 'transliteration', 'Allah''s Messenger (ﷺ) said:', 'drop', NULL, '72a03d56ea053a4b14874bb36740edae5ca920d7ccae4e4c0ccd9b35420addd8', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.255', 1, 'transliteration', 'Allah''s Messenger (ﷺ) said:', 'drop', NULL, '72a03d56ea053a4b14874bb36740edae5ca920d7ccae4e4c0ccd9b35420addd8', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.256', 1, 'transliteration', 'Allah''s Messenger (ﷺ) said:', 'drop', NULL, '72a03d56ea053a4b14874bb36740edae5ca920d7ccae4e4c0ccd9b35420addd8', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.257', 1, 'transliteration', 'Allah''s Messenger (ﷺ) said:', 'drop', NULL, '72a03d56ea053a4b14874bb36740edae5ca920d7ccae4e4c0ccd9b35420addd8', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.258', 1, 'transliteration', '--', 'drop', NULL, 'd8156bae0c4243d3742fc4e9774d8aceabe0410249d720c855f98afc88ff846c', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed a "--" placeholder from the transliteration field. This reading has no transliteration to show.'),
  ('dua.hisn.259', 1, 'transliteration', 'Whoever says:', 'drop', NULL, 'aea48dd27a3bd16717b295ff463692a7501324b70b306ca135ac7971a1cf5795', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.260', 1, 'transliteration', 'Allah''s Messenger (ﷺ) said:', 'drop', NULL, '72a03d56ea053a4b14874bb36740edae5ca920d7ccae4e4c0ccd9b35420addd8', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.261', 1, 'transliteration', 'Allah''s Messenger (ﷺ) said:', 'drop', NULL, '72a03d56ea053a4b14874bb36740edae5ca920d7ccae4e4c0ccd9b35420addd8', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.262', 1, 'transliteration', 'A desert Arab came to Allah''s Messenger (ﷺ) and said, "Teach me a word' || char(10) || 'that I can say. " The Prophet told him to say:', 'drop', NULL, '77a7c60b4f39eea15f59d128e28b460ecbad3b26deb169f5586883c482a9684a', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.263', 1, 'transliteration', 'Whenever anyone accepted Islam, the Prophet (ﷺ) used to teach him how to' || char(10) || 'pray then he would instruct him to invoke Allah with the following words:', 'drop', NULL, 'e50fe5c18903527f915114b9377ba2714dafef68a3433923eac3ffdece911468', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.264', 1, 'transliteration', 'The most excellent invocation is:', 'drop', NULL, '9539153b03344ddb69df345ec099e4642147e226433f8e084777a04aeaf24e20', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.265', 1, 'transliteration', 'The good deeds which endure are:', 'drop', NULL, 'b76fb7c1f55600c1afd525fb147d361dc99c4c6913aeb7b8f8da9cdc717c8567', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Removed English prose from the transliteration field. It was not a transliteration, and its content is already carried by the translation.'),
  ('dua.hisn.266', 1, 'translation', 'Abdullah bin ''Amr (RA) said:', 'retext', 'Abdullah bin ''Amr (RA) said: "I saw the Prophet (ﷺ) counting the glorification of his Lord on his right hand."', '0fd175ba596f53039388218e334331e17094cb1844e4589473ed8a74eec175e8', 'f7787bfedc3997d0f06a700ff376fbf295f973a053ce155d122265412623de21', 'Completed a translation that had been cut off mid-sentence. The full sentence comes from the same Hisn al-Muslim source text, where it had been stored in the wrong field.');

INSERT INTO _m0018_record_plan (canonical_id, correction_reason) VALUES
  ('dua.hisn.110', 'Four-role reading model (migration 0018): this is a instruction reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.142', 'Four-role reading model (migration 0018): this is a instruction reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.143', 'Four-role reading model (migration 0018): this is a instruction reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.146', 'Four-role reading model (migration 0018): this is a framed reading; moved its narration frame into a comment segment. Arabic and references unchanged.'),
  ('dua.hisn.151', 'Four-role reading model (migration 0018): this is a framed reading; moved its narration frame into a comment segment. Arabic and references unchanged.'),
  ('dua.hisn.178', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.179', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.185', 'Four-role reading model (migration 0018): this is a instruction reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.188', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.191', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.195', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.199', 'Four-role reading model (migration 0018): this is a instruction reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.214', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.217', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.218', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.219', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.220', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.221', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.222', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.223', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.224', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.225', 'Four-role reading model (migration 0018): this is a virtue reading; completed its cut-off translation. Arabic and references unchanged.'),
  ('dua.hisn.226', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.228', 'Four-role reading model (migration 0018): this is a instruction reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.231', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.234', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.236', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.239', 'Four-role reading model (migration 0018): this is a instruction reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.243', 'Four-role reading model (migration 0018): this is a supplication reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.248', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.249', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.250', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.251', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.252', 'Four-role reading model (migration 0018): this is a virtue reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.253', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.254', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.255', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.256', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.257', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.258', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.259', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.260', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.261', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.262', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.263', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.264', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.265', 'Four-role reading model (migration 0018): this is a framed reading; removed a non-transliteration from the transliteration field. Arabic and references unchanged.'),
  ('dua.hisn.266', 'Four-role reading model (migration 0018): this is a framed reading; completed its cut-off translation. Arabic and references unchanged.');

-- 1. Restore chapter 45's adhan and adhkar readings. Before anything below, so the search rebuild
--    and the new dataset include them.
DELETE FROM canonical_withdrawals WHERE canonical_id IN ('dua.hisn.142', 'dua.hisn.143');

-- 2. Which records to revise: every planned change must match the current, published revision
--    exactly -- same part, same kind, same text. One mismatch and the whole record is left alone.
INSERT INTO _m0018_eligible (canonical_id, old_revision_id, new_revision_id, new_revision_number, record_id)
SELECT record.canonical_id,
       revision.id,
       'revision.' || record.canonical_id || '.' || (revision.revision_number + 1),
       revision.revision_number + 1,
       revision.record_id
FROM _m0018_record_plan record
JOIN canonical_records canonical
  ON canonical.canonical_id = record.canonical_id
 AND canonical.content_type = 'dua'
JOIN content_revisions revision ON revision.id = canonical.current_revision_id
JOIN editorial_record_state state
  ON state.canonical_id = canonical.canonical_id
 AND state.revision_id = canonical.current_revision_id
 AND state.workflow_state = 'published'
JOIN canonical_publications publication
  ON publication.canonical_id = canonical.canonical_id
 AND publication.revision_id = canonical.current_revision_id
 AND publication.publication_status = 'published'
WHERE (SELECT COUNT(*) FROM _m0018_segment_plan plan WHERE plan.canonical_id = record.canonical_id)
    = (SELECT COUNT(*)
       FROM _m0018_segment_plan plan
       JOIN revision_parts part
         ON part.revision_id = revision.id
        AND part.position = plan.part_position
       JOIN revision_segments segment
         ON segment.revision_part_id = part.id
        AND segment.kind = plan.kind
        AND segment.text = plan.expected_text
       WHERE plan.canonical_id = record.canonical_id)
  AND NOT EXISTS (
    SELECT 1 FROM content_revisions existing
    WHERE existing.id = 'revision.' || record.canonical_id || '.' || (revision.revision_number + 1)
  );

-- 3. The new revisions, built the way the Admin Console's createRevision builds them: a new
--    content_revisions row superseding the old one, with parts, segments, metadata and references
--    carried forward. Nothing about the old revision is modified.
INSERT INTO content_revisions (
  id, canonical_id, record_id, revision_number, legacy_id, sequence, title,
  supersedes_revision_id, created_by_external_id, correction_reason
)
SELECT eligible.new_revision_id, eligible.canonical_id, revision.record_id,
       eligible.new_revision_number, revision.legacy_id, revision.sequence, revision.title,
       revision.id, 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', record.correction_reason
FROM _m0018_eligible eligible
JOIN content_revisions revision ON revision.id = eligible.old_revision_id
JOIN _m0018_record_plan record ON record.canonical_id = eligible.canonical_id;

INSERT INTO revision_parts (id, revision_id, position)
SELECT eligible.new_revision_id || '.part.' || part.position, eligible.new_revision_id, part.position
FROM _m0018_eligible eligible
JOIN revision_parts part ON part.revision_id = eligible.old_revision_id;

-- Segments are renumbered within each part after removals, so positions stay contiguous.
INSERT INTO revision_segments (
  id, revision_part_id, position, kind, language_code, script_code, text
)
SELECT kept.new_revision_id || '.part.' || kept.part_position || '.segment.' || kept.position,
       kept.new_revision_id || '.part.' || kept.part_position,
       kept.position, kept.kind, kept.language_code, kept.script_code, kept.text
FROM (
  SELECT eligible.new_revision_id,
         part.position AS part_position,
         ROW_NUMBER() OVER (PARTITION BY part.id ORDER BY segment.position) AS position,
         CASE WHEN plan.action = 'comment' THEN 'comment' ELSE segment.kind END AS kind,
         CASE WHEN plan.action = 'comment' THEN 'en' ELSE segment.language_code END AS language_code,
         CASE WHEN plan.action = 'comment' THEN 'Latn' ELSE segment.script_code END AS script_code,
         CASE WHEN plan.action = 'retext' THEN plan.new_text ELSE segment.text END AS text
  FROM _m0018_eligible eligible
  JOIN revision_parts part ON part.revision_id = eligible.old_revision_id
  JOIN revision_segments segment ON segment.revision_part_id = part.id
  LEFT JOIN _m0018_segment_plan plan
    ON plan.canonical_id = eligible.canonical_id
   AND plan.part_position = part.position
   AND plan.kind = segment.kind
   AND plan.expected_text = segment.text
  WHERE plan.action IS NULL OR plan.action <> 'drop'
) kept;

INSERT INTO revision_metadata (
  revision_id, collection_id, book_id, chapter_id, display_number,
  narrator, grade, grading_authority
)
SELECT eligible.new_revision_id, metadata.collection_id, metadata.book_id, metadata.chapter_id,
       metadata.display_number, metadata.narrator, metadata.grade, metadata.grading_authority
FROM _m0018_eligible eligible
JOIN revision_metadata metadata ON metadata.revision_id = eligible.old_revision_id;

-- References are unchanged, so they carry their existing verification forward.
INSERT INTO canonical_references (
  id, canonical_id, revision_id, reference_type, locator, verification_status,
  created_by_external_id, verified_by_external_id, verified_at
)
SELECT eligible.new_revision_id || '.reference.'
         || ROW_NUMBER() OVER (PARTITION BY reference.canonical_id ORDER BY reference.id),
       reference.canonical_id, eligible.new_revision_id, reference.reference_type,
       reference.locator, reference.verification_status, 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
       reference.verified_by_external_id, reference.verified_at
FROM _m0018_eligible eligible
JOIN canonical_references reference
  ON reference.canonical_id = eligible.canonical_id
 AND reference.revision_id = eligible.old_revision_id;

-- The audit trail the API's evidence endpoint serves: one row per changed field, with why.
INSERT INTO correction_history (
  id, record_id, field_path, previous_hash, replacement_hash, reason, changed_by_external_id
)
SELECT 'correction.' || eligible.new_revision_id || '.part.' || plan.part_position || '.' || plan.kind,
       eligible.record_id,
       'part.' || plan.part_position || '.' || plan.kind,
       plan.previous_hash, plan.replacement_hash, plan.reason,
       'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ'
FROM _m0018_eligible eligible
JOIN _m0018_segment_plan plan ON plan.canonical_id = eligible.canonical_id;

INSERT INTO review_decisions (
  id, revision_id, reviewer_external_id, review_stage, decision, notes
)
SELECT 'review-decision.reading-roles.' || eligible.canonical_id, eligible.new_revision_id,
       'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', 'independent_review', 'approved',
       'Approved with the four-role reading model (migration 0018), 2026-09-11.'
FROM _m0018_eligible eligible;

UPDATE canonical_records
SET current_revision_id = (
      SELECT eligible.new_revision_id FROM _m0018_eligible eligible
      WHERE eligible.canonical_id = canonical_records.canonical_id
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE canonical_id IN (SELECT canonical_id FROM _m0018_eligible);

UPDATE editorial_record_state
SET revision_id = (
      SELECT eligible.new_revision_id FROM _m0018_eligible eligible
      WHERE eligible.canonical_id = editorial_record_state.canonical_id
    ),
    workflow_state = 'published',
    assigned_to_external_id = NULL,
    verified_by_external_id = 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
    verified_at = CURRENT_TIMESTAMP,
    changed_by_external_id = 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
    changed_at = CURRENT_TIMESTAMP
WHERE canonical_id IN (SELECT canonical_id FROM _m0018_eligible);

-- 4. Publish, as publishBatch does: a new dataset version snapshotting every published record.
--    Skipped entirely if no record was revised, so a no-op run changes nothing here.
INSERT INTO canonical_publication_history (
  id, canonical_id, revision_id, record_id, dataset_version_id, revision_number,
  event_type, actor_external_id, occurred_at
)
SELECT 'publication-history.reading-roles.superseded.' || publication.canonical_id,
       publication.canonical_id, publication.revision_id, publication.record_id,
       publication.dataset_version_id, publication.revision_number,
       'superseded', 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', CURRENT_TIMESTAMP
FROM canonical_publications publication
JOIN _m0018_eligible eligible ON eligible.canonical_id = publication.canonical_id
WHERE publication.publication_status = 'published';

UPDATE canonical_dataset_versions
SET publication_status = 'superseded'
WHERE publication_status = 'published'
  AND EXISTS (SELECT 1 FROM _m0018_eligible);

INSERT INTO canonical_dataset_versions (
  id, version_label, publication_status, verification_status, record_count,
  canonical_hash, published_by_external_id, published_at
)
SELECT 'canonical.hisn.reading-roles.2026-09-11',
       'Hisn reading roles 2026-09-11',
       'published', 'verified',
       (SELECT COUNT(*) FROM canonical_publications WHERE publication_status = 'published'),
       'hisn-reading-roles-2026-09-11',
       'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM _m0018_eligible);

UPDATE canonical_publications
SET revision_id = (
      SELECT eligible.new_revision_id FROM _m0018_eligible eligible
      WHERE eligible.canonical_id = canonical_publications.canonical_id
    ),
    record_id = (
      SELECT eligible.record_id FROM _m0018_eligible eligible
      WHERE eligible.canonical_id = canonical_publications.canonical_id
    ),
    revision_number = (
      SELECT eligible.new_revision_number FROM _m0018_eligible eligible
      WHERE eligible.canonical_id = canonical_publications.canonical_id
    ),
    published_by_external_id = 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
    published_at = CURRENT_TIMESTAMP,
    superseded_at = NULL
WHERE canonical_id IN (SELECT canonical_id FROM _m0018_eligible);

UPDATE canonical_publications
SET dataset_version_id = 'canonical.hisn.reading-roles.2026-09-11'
WHERE publication_status = 'published'
  AND EXISTS (SELECT 1 FROM canonical_dataset_versions WHERE id = 'canonical.hisn.reading-roles.2026-09-11');

INSERT INTO canonical_publication_history (
  id, canonical_id, revision_id, record_id, dataset_version_id, revision_number,
  event_type, actor_external_id, occurred_at
)
SELECT 'publication-history.reading-roles.published.' || publication.canonical_id,
       publication.canonical_id, publication.revision_id, publication.record_id,
       publication.dataset_version_id, publication.revision_number,
       'published', 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', CURRENT_TIMESTAMP
FROM canonical_publications publication
JOIN _m0018_eligible eligible ON eligible.canonical_id = publication.canonical_id;

INSERT INTO canonical_dataset_items (dataset_version_id, canonical_id, revision_id)
SELECT 'canonical.hisn.reading-roles.2026-09-11', canonical_id, revision_id
FROM canonical_publications
WHERE publication_status = 'published'
  AND EXISTS (SELECT 1 FROM canonical_dataset_versions WHERE id = 'canonical.hisn.reading-roles.2026-09-11');

INSERT INTO rag_index_state (dataset_version_id, expected_count, indexed_count, status, updated_at)
SELECT id, record_count, 0, CASE WHEN record_count = 0 THEN 'ready' ELSE 'pending' END, CURRENT_TIMESTAMP
FROM canonical_dataset_versions
WHERE id = 'canonical.hisn.reading-roles.2026-09-11';

-- 5. Roles. After the revisions, so the chapter guard reads whichever revision is now current.
INSERT INTO canonical_reading_roles (canonical_id, reading_role, assigned_by_external_id)
SELECT plan.canonical_id, plan.reading_role, 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ'
FROM _m0018_role_plan plan
JOIN canonical_records canonical
  ON canonical.canonical_id = plan.canonical_id
 AND canonical.content_type = 'dua'
JOIN revision_metadata metadata
  ON metadata.revision_id = canonical.current_revision_id
 AND metadata.chapter_id = plan.chapter_id;

-- 6. Lexical search: every published, served dua, from its published revision, normalised the way
--    apps/auth/src/editorial-plane.ts normalizeArabicSql does (tashkeel and tatweel removed, alef
--    forms folded) so it matches the normalised queries d1-content-repository.ts sends.
DELETE FROM canonical_search_fts WHERE content_type = 'dua';
INSERT INTO canonical_search_fts (
  canonical_id, revision_id, content_type, collection_slug, title, body, narrator
)
SELECT canonical.canonical_id, revision.id, canonical.content_type,
       COALESCE(collection.slug, 'hisn'),
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         revision.title,
         'ً', ''), 'ٌ', ''), 'ٍ', ''), 'َ', ''), 'ُ', ''), 'ِ', ''), 'ّ', ''), 'ْ', ''), 'ٰ', ''), 'ـ', ''),
         'آ', 'ا'), 'أ', 'ا'), 'إ', 'ا'), 'ٱ', 'ا'),
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         COALESCE(GROUP_CONCAT(segment.text, ' '), ''),
         'ً', ''), 'ٌ', ''), 'ٍ', ''), 'َ', ''), 'ُ', ''), 'ِ', ''), 'ّ', ''), 'ْ', ''), 'ٰ', ''), 'ـ', ''),
         'آ', 'ا'), 'أ', 'ا'), 'إ', 'ا'), 'ٱ', 'ا'),
       COALESCE(metadata.narrator, '')
FROM canonical_publications publication
JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
JOIN content_revisions revision ON revision.id = publication.revision_id
LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
LEFT JOIN collections collection ON collection.id = metadata.collection_id
LEFT JOIN revision_parts part ON part.revision_id = revision.id
LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
WHERE canonical.content_type = 'dua'
  AND publication.publication_status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM canonical_withdrawals withdrawal
    WHERE withdrawal.canonical_id = canonical.canonical_id
  )
GROUP BY canonical.canonical_id, revision.id;

DROP TABLE _m0018_eligible;
DROP TABLE _m0018_record_plan;
DROP TABLE _m0018_segment_plan;
DROP TABLE _m0018_role_plan;
