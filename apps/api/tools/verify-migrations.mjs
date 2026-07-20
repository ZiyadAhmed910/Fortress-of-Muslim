import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { withNodeSqliteCompatibility } from './node-sqlite-compat.mjs';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort();
const source = JSON.parse(await readFile(new URL('../../../pwa-website/data/duas.json', import.meta.url), 'utf8'));
const database = new DatabaseSync(':memory:');

database.exec('PRAGMA foreign_keys = ON;');
for (const migration of migrationFiles) {
  const sql = await readFile(new URL(migration, migrationsUrl), 'utf8');
  database.exec(withNodeSqliteCompatibility(sql));
}

const expectedParts = source.entries.reduce((total, entry) => total + entry.parts.length, 0);
const expectedSegments = source.entries.reduce(
  (total, entry) => total + entry.parts.reduce((partTotal, part) => partTotal + part.length, 0),
  0,
);

assertCount('content_records', source.entries.length);
assertCount('content_parts', expectedParts);
assertCount('content_segments', expectedSegments);
assertCount('dataset_versions', 1);
assertCount('languages', 3);
assertCount('source_materials', 1);
assertCount('dataset_sources', 1);
assertCount('collections', 1);
assertCount('record_placements', source.entries.length);
assertCount('dua_metadata', source.entries.length);
assertCount('record_search_metadata', source.entries.length);
assertCount('publication_history', 2);
assertCount('verification_records', source.entries.length + 1);
assertCount('source_acquisitions', 0);
assertCount('source_artifacts', 0);
assertCount('import_runs', 0);

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
  WHERE record.sequence = 1
  GROUP BY record.id
`).get();

if (first.id !== 'dua.hisn.001' || first.legacy_id !== 'dua-001' || first.part_count !== source.entries[0].parts.length) {
  throw new Error('Canonical first-record verification failed.');
}

const provenance = database.prepare(`
  SELECT source.license_status, source.authenticity_status
  FROM dataset_sources dataset_source
  JOIN source_materials source ON source.id = dataset_source.source_id
  WHERE dataset_source.dataset_id = ?
`).get('dataset.hisn.legacy.2026-07-11-v2');
if (provenance.license_status !== 'unknown' || provenance.authenticity_status !== 'unreviewed') {
  throw new Error('Legacy provenance must remain explicitly unverified until editorial review.');
}

console.log(`Verified ${migrationFiles.length} D1 migrations: ${source.entries.length} records, ${expectedParts} parts, ${expectedSegments} segments.`);

function assertCount(table, expected) {
  const actual = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  if (actual !== expected) throw new Error(`${table}: expected ${expected}, received ${actual}`);
}
