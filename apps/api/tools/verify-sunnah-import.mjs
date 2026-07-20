import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withNodeSqliteCompatibility } from './node-sqlite-compat.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputRoot = resolve(projectRoot, '.fortress-import');
const report = JSON.parse(await readFile(resolve(outputRoot, 'validation-report.json'), 'utf8'));
if (report.status !== 'validated') throw new Error('The corpus build has not passed validation.');

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON;');
const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrations = (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort();
for (const migration of migrations) {
  database.exec(withNodeSqliteCompatibility(await readFile(new URL(migration, migrationsUrl), 'utf8')));
}
database.exec(await readFile(resolve(outputRoot, 'sunnah-corpus.sql'), 'utf8'));

const dataset = database.prepare('SELECT id, record_count AS recordCount, publication_status AS status FROM dataset_versions WHERE id = ?').get(report.datasetId);
if (!dataset || dataset.status !== 'active' || dataset.recordCount !== report.totalRecords) {
  throw new Error(`Active dataset verification failed: ${JSON.stringify(dataset)}`);
}

const counts = Object.fromEntries(database.prepare(`
  SELECT collection.slug, COUNT(*) AS count
  FROM content_records record
  JOIN record_placements placement ON placement.record_id = record.id
  JOIN collections collection ON collection.id = placement.collection_id
  WHERE record.dataset_id = ? GROUP BY collection.slug
`).all(report.datasetId).map((row) => [row.slug, row.count]));
for (const [slug, expected] of Object.entries(report.counts)) {
  if (counts[slug] !== expected) throw new Error(`${slug}: expected ${expected}, received ${counts[slug] ?? 0}`);
}

const integrity = database.prepare('PRAGMA foreign_key_check').all();
if (integrity.length > 0) throw new Error(`Foreign key violations: ${JSON.stringify(integrity.slice(0, 10))}`);

const ftsCount = database.prepare('SELECT COUNT(*) AS count FROM content_search_fts WHERE dataset_id = ?').get(report.datasetId).count;
if (ftsCount !== report.totalRecords) throw new Error(`Search index: expected ${report.totalRecords}, received ${ftsCount}`);

console.log(`Verified local corpus import ${report.datasetId}: ${report.totalRecords} records across ${Object.keys(counts).length} collections.`);
