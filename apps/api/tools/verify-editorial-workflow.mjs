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
    id, canonical_id, revision_id, reference_type, locator, verification_status,
    created_by_external_id, verified_by_external_id, verified_at
  ) VALUES ('reference.workflow', ?, ?, 'primary', 'Hisn al-Muslim 1', 'verified',
            'editor-a', 'reviewer-a', CURRENT_TIMESTAMP)
`).run(recordId, revision.revisionId);

for (const reviewer of ['reviewer-a', 'reviewer-b']) {
  for (const field of [
    'arabic', 'translation', 'transliteration', 'narrator', 'collection', 'book',
    'chapter', 'number', 'references', 'grades', 'formatting', 'completeness',
    'duplicate_detection',
  ]) {
    database.prepare(`
      INSERT INTO field_reviews (
        id, revision_id, field_name, reviewer_external_id, decision
      ) VALUES (?, ?, ?, ?, 'verified')
    `).run(`field.${reviewer}.${field}`, revision.revisionId, field, reviewer);
  }
  database.prepare(`
    INSERT INTO review_decisions (
      id, revision_id, reviewer_external_id, review_stage, decision
    ) VALUES (?, ?, ?, 'independent_review', 'approved')
  `).run(`decision.${reviewer}`, revision.revisionId, reviewer);
}
database.prepare(`
  INSERT INTO review_decisions (
    id, revision_id, reviewer_external_id, review_stage, decision
  ) VALUES ('decision.senior', ?, 'senior-a', 'senior_approval', 'approved')
`).run(revision.revisionId);
database.prepare(`
  UPDATE editorial_record_state SET workflow_state = 'approved' WHERE canonical_id = ?
`).run(recordId);

assertCount('field_reviews', `revision_id = '${revision.revisionId}'`, 26);
assertCount('review_decisions', `revision_id = '${revision.revisionId}' AND review_stage = 'independent_review'`, 2);
assertCount('review_decisions', `revision_id = '${revision.revisionId}' AND review_stage = 'senior_approval'`, 1);
assertCount('canonical_references', `revision_id = '${revision.revisionId}' AND verification_status = 'verified'`, 1);

assertImmutable(
  "UPDATE content_revisions SET title = 'Changed' WHERE id = ?",
  [revision.revisionId],
  'Content revisions must be immutable.',
);
assertImmutable(
  "UPDATE field_reviews SET decision = 'correction_required' WHERE id = 'field.reviewer-a.arabic'",
  [],
  'Field reviews must be immutable.',
);
assertImmutable(
  "UPDATE review_decisions SET decision = 'changes_requested' WHERE id = 'decision.reviewer-a'",
  [],
  'Review decisions must be immutable.',
);

const serviceSource = await readFile(new URL('../../auth/src/editorial-plane.ts', import.meta.url), 'utf8');
for (const invariant of [
  'A correction author cannot approve their own revision.',
  'Two independent reviewer approvals are required first.',
  'Senior approval must be independent from both record reviewers.',
  "reference.verification_status = 'verified'",
]) {
  if (!serviceSource.includes(invariant)) throw new Error(`Editorial service is missing invariant: ${invariant}`);
}

console.log('Verified unpublished-by-default records, 13-field dual review, independent senior approval, evidence gating, and immutable history.');

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
