import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { withNodeSqliteCompatibility } from './node-sqlite-compat.mjs';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort();
const database = new DatabaseSync(':memory:');
const legacy = { records: 135, parts: 320, segments: 1105, firstParts: 5 };

database.exec('PRAGMA foreign_keys = ON;');
for (const migration of migrationFiles) {
  if (migration === '0006_canonical_editorial.sql') {
    database.exec(`
      INSERT INTO dataset_versions (
        id, source_name, source_version, publication_status, verification_status,
        record_count, content_hash, imported_at
      ) VALUES (
        'dataset.candidate.overlap', 'Candidate overlap test', '1',
        'deprecated', 'pending', 1, 'overlap-hash', '2026-07-22T00:00:00.000Z'
      );
      INSERT INTO content_records (
        id, dataset_id, content_type, legacy_id, sequence, title,
        verification_status, created_at, updated_at, logical_id
      ) VALUES (
        'candidate.overlap.dua.1', 'dataset.candidate.overlap', 'dua', 'candidate-dua-1',
        1, 'Overlapping candidate revision', 'pending',
        '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', 'dua.hisn.001'
      );
      INSERT INTO content_parts (id, record_id, position)
        VALUES ('candidate.overlap.dua.1.part.1', 'candidate.overlap.dua.1', 1);
      INSERT INTO content_segments (
        id, part_id, position, kind, language_code, script_code, text
      ) VALUES (
        'candidate.overlap.dua.1.part.1.segment.1',
        'candidate.overlap.dua.1.part.1', 1, 'translation', 'en', 'Latn',
        'Candidate overlap verification text.'
      );
    `);
  }
  const sql = await readFile(new URL(migration, migrationsUrl), 'utf8');
  database.exec(withNodeSqliteCompatibility(sql));
}

assertCount('content_records', legacy.records + 1);
assertCount('content_parts', legacy.parts + 1);
assertCount('content_segments', legacy.segments + 1);
assertCount('dataset_versions', 2);
assertCount('languages', 3);
assertCount('source_materials', 0);
assertCount('dataset_sources', 0);
assertCount('collections', 1);
assertCount('record_placements', legacy.records);
assertCount('dua_metadata', legacy.records);
assertCount('record_search_metadata', legacy.records);
assertCount('publication_history', 2);
assertCount('verification_records', legacy.records + 1);
assertCount('canonical_records', legacy.records);
assertCount('content_revisions', legacy.records + 1);
assertCount('revision_parts', legacy.parts + 1);
assertCount('revision_segments', legacy.segments + 1);
assertCount('editorial_record_state', legacy.records);
assertCount('canonical_publications', legacy.records);
assertCount('canonical_dataset_versions', 2);
assertCount('canonical_references', 0);
for (const retiredTable of [
  'source_acquisitions',
  'source_artifacts',
  'import_runs',
  'import_issues',
  'source_record_identities',
]) {
  assertTableMissing(retiredTable);
}

const missingLogicalIds = database.prepare('SELECT COUNT(*) AS count FROM content_records WHERE logical_id IS NULL').get().count;
if (missingLogicalIds !== 0) throw new Error(`content_records: ${missingLogicalIds} logical IDs were not backfilled.`);

const orphanParts = database.prepare(`
  SELECT COUNT(*) AS count
  FROM content_parts part
  LEFT JOIN content_records record ON record.id = part.record_id
  WHERE record.id IS NULL
`).get().count;
const orphanSegments = database.prepare(`
  SELECT COUNT(*) AS count
  FROM content_segments segment
  LEFT JOIN content_parts part ON part.id = segment.part_id
  WHERE part.id IS NULL
`).get().count;

if (orphanParts !== 0 || orphanSegments !== 0) {
  throw new Error(`Orphaned rows found: parts=${orphanParts}, segments=${orphanSegments}`);
}

const first = database.prepare(`
  SELECT record.id, record.legacy_id, record.title, COUNT(DISTINCT part.id) AS part_count
  FROM content_records record
  JOIN content_parts part ON part.record_id = record.id
  WHERE record.id = 'dua.hisn.001'
  GROUP BY record.id
`).get();

if (first.id !== 'dua.hisn.001' || first.legacy_id !== 'dua-001' || first.part_count !== legacy.firstParts) {
  throw new Error('Canonical first-record verification failed.');
}

const pending = database.prepare(`
  SELECT COUNT(*) AS count FROM editorial_record_state WHERE workflow_state = 'pending_review'
`).get().count;
if (pending !== 0) throw new Error('Approved Hisn records must not remain pending review.');

const overlap = database.prepare(`
  SELECT canonical.current_revision_id AS currentRevisionId, COUNT(revision.id) AS revisionCount
  FROM canonical_records canonical
  JOIN content_revisions revision ON revision.canonical_id = canonical.canonical_id
  WHERE canonical.canonical_id = 'dua.hisn.001'
  GROUP BY canonical.canonical_id
`).get();
if (overlap.revisionCount !== 2 || overlap.currentRevisionId !== 'revision.dua.hisn.001.2') {
  throw new Error('Overlapping logical IDs must become ordered immutable revisions of one canonical record.');
}

const bootstrap = database.prepare(`
  SELECT publication_status, verification_status, record_count
  FROM canonical_dataset_versions WHERE id = 'canonical.bootstrap.2026-07-23'
`).get();
if (bootstrap.publication_status !== 'superseded' || bootstrap.verification_status !== 'verified' || bootstrap.record_count !== 0) {
  throw new Error('The empty bootstrap dataset must be retained as superseded history.');
}

const hisn = database.prepare(`
  SELECT publication_status, verification_status, record_count
  FROM canonical_dataset_versions WHERE id = 'canonical.hisn.verified.2026-07-23'
`).get();
if (hisn.publication_status !== 'published' || hisn.verification_status !== 'verified' || hisn.record_count !== legacy.records) {
  throw new Error('The approved Hisn dataset must be verified and published.');
}

console.log(`Verified ${migrationFiles.length} D1 migrations and ${legacy.records} published Hisn records.`);

function assertCount(table, expected) {
  const actual = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  if (actual !== expected) throw new Error(`${table}: expected ${expected}, received ${actual}`);
}

function assertTableMissing(table) {
  const row = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (row) throw new Error(`${table}: private acquisition table must not remain in the public content database.`);
}
