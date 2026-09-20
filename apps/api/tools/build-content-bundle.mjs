// Builds the content bundle that provisions a fresh environment's canonical corpus.
//
//   node apps/api/tools/build-content-bundle.mjs            from the test database
//   node apps/api/tools/build-content-bundle.mjs --from=fortress-platform-production
//
// Why this exists
// ---------------
// Applying every migration to an empty database yields 135 duas and 6,236 ayahs, and no hadith at
// all. The 14,357 hadith were never in a migration: they were prepared from an approved source
// corpus that is deliberately not in this repository. `.gitignore` keeps that corpus and any
// generated import bundle local-only, docs/canonical-editorial-architecture.md says preparation
// provenance stays outside the public repository and its deployment artifacts, and
// tools/verify-public-canonical-boundary.mjs fails the build if an external record URL reaches a
// tracked public file. This repository is public, so that boundary is load-bearing.
//
// So the corpus cannot simply become migration 0029. What can be committed is this: the recipe.
// The bundle it writes goes to .fortress-import/, which is gitignored, and is delivered to
// production out of band (see docs/release-readiness.md). The script is reproducible and reviewable
// in the open; the data it moves is not published by doing so.
//
// It exports from a database that already holds the corpus rather than re-deriving it from the
// source corpus, deliberately. The ingestion that produced these rows is not in this repository
// either, so re-implementing it here would be writing a second importer that could silently
// disagree with the one whose output is actually serving traffic. Copying a known-good corpus has
// no such failure mode.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const outputDir = resolve(repositoryRoot, '.fortress-import');

const argument = (name, fallback) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};
const source = argument('from', 'fortress-platform-test');

// wrangler is an npx shim, so on Windows it has to be run through a shell -- and a shell re-splits
// every argument on whitespace unless it is quoted. An unquoted SQL statement arrives as a dozen
// unknown arguments, and an unquoted path breaks on the space in this repository's own name. Both
// of those have already happened here once each.
const windows = process.platform === 'win32';
const shellSafe = (value) => (windows && /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);
const wrangler = (args, options = {}) => execFileSync(
  'npx',
  ['wrangler', ...args].map(shellSafe),
  { cwd: repositoryRoot, shell: windows, ...options },
);

// The corpus and the editorial state that makes it readable, and nothing else.
//
// What is left out matters as much as what is in. ask_query_log holds questions people typed and
// has no business in another environment. ask_settings, ask_model_usage, rag_index_state,
// quran_index_state and rag_daily_usage are per-environment operational state -- copying an index
// status would tell production its Vectorize namespace was already populated when it is empty.
// quran_ayahs is excluded because migrations 0025 and 0026 already carry it, so every environment
// gets it for free.
// The order is load-bearing, not alphabetical or arbitrary: wrangler exports tables in the order it
// is given them, and every row has to land after the rows it references. The first version of this
// list put dataset_versions last and content_records fourth, and the bundle died on a foreign key
// the moment it was applied to anything.
//
// Ordering it properly, rather than wrapping the file in one transaction with deferred foreign
// keys, is deliberate. A 139 MB bundle is applied in chunks -- `wrangler d1 execute --file` splits
// it -- and a BEGIN in the first chunk does not hold over the rest, so deferral would buy nothing
// exactly when the file is big enough to need it. Satisfying the constraints as we go works whether
// the file is applied whole or in pieces.
//
// Two foreign key targets are deliberately absent: `languages`, which migration 0003 already
// populates in every environment, and `source_materials`, which is empty and referenced only by
// columns that are NULL throughout.
const TABLES = [
  'collections',
  'books',
  'chapters',
  'canonical_records',
  'canonical_reading_roles',
  'canonical_search_aliases',
  'dataset_versions',
  'content_records',
  'content_parts',
  'content_segments',
  'content_revisions',
  'revision_parts',
  'revision_segments',
  'revision_metadata',
  'canonical_references',
  'editorial_record_state',
  'hadith_metadata',
  'dua_metadata',
  'hadith_grades',
  'record_numberings',
  'canonical_dataset_versions',
  'canonical_publications',
  'canonical_dataset_items',
];

mkdirSync(outputDir, { recursive: true });
// Relative, and run from the repository root. Wrangler is invoked through a shell on Windows, and
// this repository's own path contains a space -- an absolute --output is split on it and the export
// fails with no usable error.
const rawRelative = '.fortress-import/content-bundle.raw.sql';
const raw = resolve(repositoryRoot, rawRelative);

console.log(`Exporting ${TABLES.length} tables from ${source}...`);
console.log('The source database is briefly unavailable to queries while D1 takes the export.');
wrangler([
  'd1', 'export', source,
  '--remote',
  '--no-schema',
  '--output', rawRelative,
  ...TABLES.flatMap((table) => ['--table', table]),
], { stdio: 'inherit' });

let sql = readFileSync(raw, 'utf8');

// D1's own export opens with this; the header below adds it back deliberately, so drop the copy
// rather than emitting the pragma twice.
sql = sql.replace(/^PRAGMA defer_foreign_keys=TRUE;\r?\n/, '');

// The bundle has to be safe to apply to a database the migrations have already touched -- migration
// 0013 publishes 135 duas, so a plain INSERT collides on the first of them and aborts everything
// after it.
//
// OR IGNORE, not OR REPLACE. REPLACE is the obvious choice and it is wrong here: it deletes the
// conflicting row before inserting, and rows that migrations created are already referenced by
// other rows migrations created. Deleting a dataset_versions row that content_records point at
// fails the foreign key, which is exactly what it did -- the bundle stopped 136 statements in.
//
// So rows a migration already established keep the migration's version, and the bundle supplies
// only what migrations do not carry. That is sound because it is the same rows either way: every
// environment runs the same migrations from the same files, so the 135 they seed are identical
// everywhere, and the bundle's copy of them is a copy of that. verify-content-bundle.mjs checks the
// result against the source database rather than taking this on trust.
//
// It also makes re-running the bundle a no-op rather than an error, so a provisioning run that
// fails halfway can simply be run again.
const inserts = (sql.match(/^INSERT INTO /gm) ?? []).length;
sql = sql.replace(/^INSERT INTO /gm, 'INSERT OR IGNORE INTO ');

// dataset_versions needs handling that INSERT OR IGNORE cannot give it, because of this, from
// migration 0001:
//
//   CREATE UNIQUE INDEX idx_dataset_active ON dataset_versions(publication_status)
//     WHERE publication_status = 'active';
//
// Exactly one dataset may be active. The migrations make the legacy Hisn dataset active; in a
// populated environment it has been deprecated and the approved dataset is active instead. So the
// bundle's active row conflicts on that index, OR IGNORE drops it silently, and then every
// content_records row pointing at it fails its foreign key -- which is precisely how this failed,
// 138 statements in, with an error naming content_records and not the dataset it was missing.
//
// So the active slot is cleared first, and the real statuses are set afterwards. Read from the
// source database rather than parsed back out of the SQL: the export quotes and escapes its values,
// and a regex over that is a bug waiting for the first apostrophe in a title.
const datasets = JSON.parse(wrangler([
  'd1', 'execute', source, '--remote', '--json',
  '--command', 'SELECT id, publication_status FROM dataset_versions ORDER BY id',
], { encoding: 'utf8' }).match(/\[[\s\S]*\]/)[0])[0].results;

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const active = datasets.filter((row) => row.publication_status === 'active');
const inactive = datasets.filter((row) => row.publication_status !== 'active');
const preamble = [
  '-- Free the single active-dataset slot before inserting, so the bundle\'s active dataset can land.',
  "UPDATE dataset_versions SET publication_status = 'deprecated' WHERE publication_status = 'active';",
  '',
].join('\n');
const postamble = [
  '',
  '-- Rows the migrations had already created kept their own status above; set the real ones now.',
  '-- Non-active first, so the one active dataset is the last thing to claim that slot.',
  ...[...inactive, ...active].map((row) =>
    `UPDATE dataset_versions SET publication_status = ${quote(row.publication_status)} WHERE id = ${quote(row.id)};`),
  '',
].join('\n');
sql = `${preamble}${sql}${postamble}`;

const digest = createHash('sha256').update(sql).digest('hex').slice(0, 16);
const header = [
  '-- Fortress Platform content bundle.',
  '--',
  '-- Generated by apps/api/tools/build-content-bundle.mjs -- do not edit by hand, and do not commit:',
  '-- this file carries the approved source corpus, which stays out of the public repository.',
  `-- Source database : ${source}`,
  `-- Generated at    : ${new Date().toISOString()}`,
  `-- Statements      : ${inserts}`,
  `-- Digest          : sha256:${digest}`,
  '--',
  '-- Apply to a database that has already had every migration run against it:',
  '--   npx wrangler d1 execute <database> --remote --file=<this file>',
  '--',
  '-- The statements are ordered so every foreign key is satisfied as the rows land, which is what',
  '-- makes this safe to apply in chunks. Re-running it is a no-op rather than an error.',
  '',
].join('\n');

const output = resolve(outputDir, `content-bundle-${digest}.sql`);
writeFileSync(output, `${header}${sql}`);

const megabytes = (statSync(output).size / 1024 / 1024).toFixed(1);
console.log(`\nWrote ${output}`);
console.log(`  ${inserts} statements, ${megabytes} MB, sha256:${digest}`);
console.log('\nThis file is gitignored on purpose. Deliver it out of band; never commit it.');
