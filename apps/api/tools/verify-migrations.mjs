import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../migrations/0001_content_schema.sql', import.meta.url), 'utf8');
const seed = await readFile(new URL('../migrations/0002_import_legacy_dataset.sql', import.meta.url), 'utf8');
const source = JSON.parse(await readFile(new URL('../../../pwa-website/data/duas.json', import.meta.url), 'utf8'));
const database = new DatabaseSync(':memory:');

database.exec('PRAGMA foreign_keys = ON;');
database.exec(schema);
database.exec(seed);

const expectedParts = source.entries.reduce((total, entry) => total + entry.parts.length, 0);
const expectedSegments = source.entries.reduce(
  (total, entry) => total + entry.parts.reduce((partTotal, part) => partTotal + part.length, 0),
  0,
);

assertCount('content_records', source.entries.length);
assertCount('content_parts', expectedParts);
assertCount('content_segments', expectedSegments);
assertCount('dataset_versions', 1);

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

console.log(`Verified D1 migrations: ${source.entries.length} records, ${expectedParts} parts, ${expectedSegments} segments.`);

function assertCount(table, expected) {
  const actual = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  if (actual !== expected) throw new Error(`${table}: expected ${expected}, received ${actual}`);
}
