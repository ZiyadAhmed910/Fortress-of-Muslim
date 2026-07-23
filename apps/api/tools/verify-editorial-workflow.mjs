import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { withNodeSqliteCompatibility } from './node-sqlite-compat.mjs';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort();
const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON;');
for (const migration of migrationFiles) {
  database.exec(withNodeSqliteCompatibility(await readFile(new URL(migration, migrationsUrl), 'utf8')));
}

const recordId = 'dua.hisn.001';
assertCount(
  'editorial_record_state',
  "workflow_state IN ('needs_second_review', 'needs_senior_approval')",
  0,
);
const revision = database.prepare(`
  SELECT state.revision_id AS revisionId, state.workflow_state AS workflowState
  FROM editorial_record_state state WHERE state.canonical_id = ?
`).get(recordId);
if (revision.workflowState !== 'published') throw new Error('Approved Hisn records must be published.');
assertCount('canonical_publications', "publication_status = 'published'", 135);
assertCount('review_decisions', `revision_id = '${revision.revisionId}' AND decision = 'approved'`, 1);

assertImmutable(
  "UPDATE content_revisions SET title = 'Changed' WHERE id = ?",
  [revision.revisionId],
  'Content revisions must be immutable.',
);
assertImmutable(
  "UPDATE review_decisions SET decision = 'changes_requested' WHERE id = 'review-decision.hisn-approved.dua.hisn.001'",
  [],
  'Review decisions must be immutable.',
);

const serviceSource = await readFile(new URL('../../auth/src/editorial-plane.ts', import.meta.url), 'utf8');
for (const invariant of [
  'Attach at least one canonical reference before verifying this record.',
  "verified_by_external_id = CASE WHEN ? = 'approved' THEN ? ELSE NULL END",
  'One verified editorial decision is required.',
  "reference.verification_status = 'verified'",
]) {
  if (!serviceSource.includes(invariant)) throw new Error(`Editorial service is missing invariant: ${invariant}`);
}

console.log('Verified approved Hisn publication, one-person verification rules, verifier stamping, and immutable history.');

function assertCount(table, where, expected) {
  const actual = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get().count;
  if (actual !== expected) throw new Error(`${table}: expected ${expected}, received ${actual}`);
}

function assertImmutable(sql, values, message) {
  try {
    database.prepare(sql).run(...values);
  } catch {
    return;
  }
  throw new Error(message);
}
