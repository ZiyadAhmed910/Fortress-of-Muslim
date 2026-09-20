// Proves a content bundle does what provisioning a fresh environment needs it to do, before it is
// ever pointed at one.
//
//   node apps/api/tools/verify-content-bundle.mjs .fortress-import/content-bundle-<digest>.sql
//   node apps/api/tools/verify-content-bundle.mjs <bundle> --against=fortress-platform-test
//
// It applies every migration to an empty in-memory database -- which is exactly what a first deploy
// does to an empty production D1 -- then applies the bundle on top, with foreign keys ON and no
// enclosing transaction, because that is how `wrangler d1 execute --file` will apply it: in chunks,
// each on its own. Then it compares the result against the database the bundle came from.
//
// Every one of those conditions is load-bearing, and each was learned by getting it wrong:
//
//   - Foreign keys ON caught that INSERT OR REPLACE deletes the conflicting row first, and that
//     deleting a dataset_versions row which content_records still reference fails the constraint.
//   - No transaction caught that deferring foreign keys only works inside one, so a bundle large
//     enough to be chunked gets no protection from it exactly when it would matter.
//   - Comparing against the source caught that the single-active-dataset index silently swallowed
//     the bundle's active dataset under INSERT OR IGNORE, leaving 14,357 hadith with nothing to
//     belong to.
//
// A bundle that passes this has been applied, in full, under the conditions production will apply
// it, and produced the same corpus the source environment serves.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withNodeSqliteCompatibility } from './node-sqlite-compat.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const bundleArgument = process.argv[2];
if (!bundleArgument) {
  console.error('Usage: node apps/api/tools/verify-content-bundle.mjs <bundle.sql> [--against=<database>]');
  process.exit(2);
}
const againstMatch = process.argv.find((value) => value.startsWith('--against='));
const against = againstMatch ? againstMatch.slice('--against='.length) : 'fortress-platform-test';

const windows = process.platform === 'win32';
const shellSafe = (value) => (windows && /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);
const query = (sql) => JSON.parse(execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', against, '--remote', '--json', '--command', sql].map(shellSafe),
  { cwd: repositoryRoot, encoding: 'utf8', shell: windows },
).match(/\[[\s\S]*\]/)[0])[0].results;

// Counted on both sides and compared. quran_ayahs is in the list precisely because the bundle does
// NOT carry it: it has to arrive from migrations 0025 and 0026, and a bundle that somehow started
// supplying it would be carrying content it has no business carrying.
const COUNTS = [
  'content_records',
  'content_parts',
  'content_segments',
  'content_revisions',
  'canonical_records',
  'canonical_references',
  'canonical_publications',
  'editorial_record_state',
  'hadith_metadata',
  'quran_ayahs',
];

const migrationsUrl = new URL('../migrations/', import.meta.url);
const db = new DatabaseSync(':memory:');
for (const migration of (await readdir(migrationsUrl)).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(withNodeSqliteCompatibility(await readFile(new URL(migration, migrationsUrl), 'utf8')));
}
console.log('Migrations applied to an empty database.');

db.exec('PRAGMA foreign_keys = ON;');
const bundle = await readFile(resolve(repositoryRoot, bundleArgument), 'utf8');
console.log(`Applying ${bundleArgument} with foreign keys on and no transaction...`);
db.exec(withNodeSqliteCompatibility(bundle));

const local = (sql) => db.prepare(sql).get().c;
const failures = [];

console.log(`\nComparing against ${against}:\n`);
console.log(`  ${'table'.padEnd(26)} ${'bundle'.padStart(8)} ${'source'.padStart(8)}`);
for (const table of COUNTS) {
  const mine = local(`SELECT COUNT(*) c FROM ${table}`);
  const theirs = query(`SELECT COUNT(*) AS c FROM ${table}`)[0].c;
  const ok = mine === theirs;
  if (!ok) failures.push(`${table}: bundle ${mine}, source ${theirs}`);
  console.log(`  ${table.padEnd(26)} ${String(mine).padStart(8)} ${String(theirs).padStart(8)} ${ok ? '' : '  MISMATCH'}`);
}

// Counts alone would not notice the corpus arriving unpublished, and an unpublished corpus is one
// Ask cannot retrieve a word of. api_ask_content is the view Ask actually reads.
const askable = local('SELECT COUNT(*) c FROM api_ask_content');
const askableSource = query('SELECT COUNT(*) AS c FROM api_ask_content')[0].c;
console.log(`\n  ${'api_ask_content'.padEnd(26)} ${String(askable).padStart(8)} ${String(askableSource).padStart(8)} ${askable === askableSource ? '' : '  MISMATCH'}`);
if (askable !== askableSource) failures.push(`api_ask_content: bundle ${askable}, source ${askableSource}`);

// Exactly one dataset may be active (idx_dataset_active), and which one decides what the API serves.
const active = db.prepare("SELECT id FROM dataset_versions WHERE publication_status = 'active'").all();
const activeSource = query("SELECT id FROM dataset_versions WHERE publication_status = 'active'");
console.log(`\n  active dataset: ${active.map((r) => r.id).join(', ') || '(none)'}`);
if (active.length !== 1) failures.push(`expected exactly one active dataset, found ${active.length}`);
else if (active[0].id !== activeSource[0]?.id) failures.push(`active dataset is ${active[0].id}, source has ${activeSource[0]?.id}`);

for (const [label, sql] of [
  ['orphan parts', 'SELECT COUNT(*) c FROM content_parts p LEFT JOIN content_records r ON r.id = p.record_id WHERE r.id IS NULL'],
  ['orphan segments', 'SELECT COUNT(*) c FROM content_segments s LEFT JOIN content_parts p ON p.id = s.part_id WHERE p.id IS NULL'],
]) {
  const n = local(sql);
  if (n !== 0) failures.push(`${label}: ${n}`);
  console.log(`  ${label}: ${n}`);
}

if (failures.length) {
  console.error('\nBundle did NOT verify:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nBundle verified: applies cleanly and reproduces the source corpus exactly.');
