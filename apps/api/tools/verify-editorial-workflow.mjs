import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { withNodeSqliteCompatibility } from './node-sqlite-compat.mjs';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort();
const database = new DatabaseSync(':memory:');

database.exec('PRAGMA foreign_keys = ON;');
for (const migration of migrationFiles) {
  const sql = await readFile(new URL(migration, migrationsUrl), 'utf8');
  database.exec(withNodeSqliteCompatibility(sql));
}

const recordId = 'dua.hisn.001';
const sourceId = 'source.editorial-test';
const referenceId = 'reference.editorial-test';
const termId = 'term.mood.calm';

database.prepare(`INSERT INTO source_materials
  (id, source_type, title, license_status, authenticity_status)
  VALUES (?, 'book', 'Editorial workflow test source', 'unknown', 'unreviewed')`).run(sourceId);
database.prepare(`INSERT INTO source_references
  (id, record_id, source_id, reference_type, locator, verification_status)
  VALUES (?, ?, ?, 'primary', 'Page 1', 'pending')`).run(referenceId, recordId, sourceId);

assertEligibility(false, 'Pending evidence must not satisfy the verification gate.');

database.prepare(`UPDATE source_materials
  SET license_status = 'approved', authenticity_status = 'trusted' WHERE id = ?`).run(sourceId);
database.prepare("UPDATE source_references SET verification_status = 'verified' WHERE id = ?").run(referenceId);
assertEligibility(true, 'Trusted, license-approved, verified evidence must satisfy the gate.');

database.prepare(`INSERT INTO taxonomy_terms
  (id, taxonomy_type, slug, label, language_code, description)
  VALUES (?, 'mood', 'calm', 'Calm', 'en', 'Editorial workflow test term')`).run(termId);
database.prepare(`INSERT INTO record_taxonomy
  (record_id, term_id, assignment_source, confidence) VALUES (?, ?, 'editorial', 1)`).run(recordId, termId);
database.prepare(`INSERT INTO verification_records
  (id, target_type, target_id, status, reviewer_external_id, method, notes)
  VALUES ('verification.editorial-test', 'record', ?, 'verified', 'test-admin', 'editorial_review', 'Workflow verified')`).run(recordId);
database.prepare(`INSERT INTO content_audit_events
  (id, actor_type, actor_external_id, action, target_type, target_id, request_id, details_json)
  VALUES ('audit.editorial-test', 'admin', 'test-admin', 'record.verification_changed', 'record', ?, 'test-request', '{}')`).run(recordId);

assertCount('record_taxonomy', `record_id = '${recordId}' AND term_id = '${termId}'`, 1);
assertCount('verification_records', "id = 'verification.editorial-test'", 1);
assertCount('content_audit_events', "id = 'audit.editorial-test'", 1);

console.log('Verified evidence gating, taxonomy assignment, verification history, and content auditing.');

function assertEligibility(expected, message) {
  const result = database.prepare(`SELECT EXISTS (
    SELECT 1 FROM source_references reference
    JOIN source_materials source ON source.id = reference.source_id
    WHERE reference.record_id = ? AND reference.verification_status = 'verified'
      AND source.license_status = 'approved' AND source.authenticity_status = 'trusted'
  ) AS eligible`).get(recordId);
  if (Boolean(result.eligible) !== expected) throw new Error(message);
}

function assertCount(table, where, expected) {
  const actual = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get().count;
  if (actual !== expected) throw new Error(`${table}: expected ${expected}, received ${actual}`);
}
