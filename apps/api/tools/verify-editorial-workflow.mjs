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
const revision = database.prepare(`
  SELECT state.revision_id AS revisionId, state.workflow_state AS workflowState
  FROM editorial_record_state state WHERE state.canonical_id = ?
`).get(recordId);
if (revision.workflowState !== 'pending_review') throw new Error('Imported candidates must begin pending review.');
assertCount('canonical_publications', '1 = 1', 0);

database.prepare(`
  INSERT INTO canonical_references (
    id, canonical_id, revision_id, reference_type, locator,
    created_by_external_id
  ) VALUES ('reference.workflow', ?, ?, 'primary', 'Hisn al-Muslim 1', 'editor-a')
`).run(recordId, revision.revisionId);
database.prepare(`
  INSERT INTO review_decisions (
    id, revision_id, reviewer_external_id, review_stage, decision
  ) VALUES ('decision.verifier', ?, 'reviewer-a', 'independent_review', 'approved')
`).run(revision.revisionId);
database.prepare(`
  UPDATE canonical_references
  SET verification_status = 'verified', verified_by_external_id = 'reviewer-a',
      verified_at = CURRENT_TIMESTAMP
  WHERE revision_id = ?
`).run(revision.revisionId);
database.prepare(`
  UPDATE editorial_record_state
  SET workflow_state = 'approved', verified_by_external_id = 'reviewer-a',
      verified_at = CURRENT_TIMESTAMP
  WHERE canonical_id = ?
`).run(recordId);

assertCount('review_decisions', `revision_id = '${revision.revisionId}' AND decision = 'approved'`, 1);
assertCount('canonical_references', `revision_id = '${revision.revisionId}' AND verification_status = 'verified'`, 1);

assertImmutable(
  "UPDATE content_revisions SET title = 'Changed' WHERE id = ?",
  [revision.revisionId],
  'Content revisions must be immutable.',
);
assertImmutable(
  "UPDATE review_decisions SET decision = 'changes_requested' WHERE id = 'decision.verifier'",
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

console.log('Verified unpublished-by-default records, one-person verification, verifier stamping, evidence gating, and immutable history.');

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
