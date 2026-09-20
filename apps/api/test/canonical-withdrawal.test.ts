import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Withdrawal has to hold two things at once: the record stops being served anywhere, and the
// revision history survives untouched. Deleting would satisfy the first and destroy the second,
// which is why the schema forbids it -- so these tests assert both halves, against a database built
// from the real migrations rather than a mock.
const MIGRATIONS = resolve(__dirname, '../migrations');

// 0006 expects a candidate record to already exist so its overlap handling has something to chew
// on; mirrors the seed in tools/verify-migrations.mjs.
const SEED_BEFORE_0006 = `
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
`;

let db: Database.Database;
/** A record 0013 actually published, so the test withdraws something genuinely being served. */
let victim: string;

beforeAll(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    if (file === '0006_canonical_editorial.sql') db.exec(SEED_BEFORE_0006);
    db.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'));
  }
  victim = (db.prepare('SELECT canonical_id FROM api_published_content LIMIT 1').get() as { canonical_id: string }).canonical_id;
});

const inCurrent = (id: string) => db.prepare('SELECT COUNT(*) AS n FROM api_current_content WHERE canonical_id = ?').get(id) as { n: number };
const inPublished = (id: string) => db.prepare('SELECT COUNT(*) AS n FROM api_published_content WHERE canonical_id = ?').get(id) as { n: number };

describe('withdrawing a canonical record', () => {
  it('starts with the record visible through both public views', () => {
    expect(inCurrent(victim).n).toBe(1);
    expect(inPublished(victim).n).toBe(1);
  });

  it('removes it from every public view once withdrawn', () => {
    db.prepare('INSERT INTO canonical_withdrawals (canonical_id, reason) VALUES (?, ?)')
      .run(victim, 'Withdrawn by test.');
    expect(inCurrent(victim).n).toBe(0);
    expect(inPublished(victim).n).toBe(0);
  });

  it('leaves the revision, its parts and its text intact', () => {
    // The whole point of withdrawing rather than deleting: the record is unservable, not erased.
    const revision = db.prepare('SELECT COUNT(*) AS n FROM content_revisions WHERE canonical_id = ?').get(victim) as { n: number };
    expect(revision.n).toBeGreaterThan(0);
    const segments = db.prepare(`
      SELECT COUNT(*) AS n FROM revision_segments segment
      JOIN revision_parts part ON part.id = segment.revision_part_id
      JOIN content_revisions revision ON revision.id = part.revision_id
      WHERE revision.canonical_id = ?
    `).get(victim) as { n: number };
    expect(segments.n).toBeGreaterThan(0);
  });

  it('records why, so a withdrawal is never anonymous', () => {
    const row = db.prepare('SELECT reason, withdrawn_at FROM canonical_withdrawals WHERE canonical_id = ?').get(victim) as { reason: string; withdrawn_at: string };
    expect(row.reason).toBeTruthy();
    expect(row.withdrawn_at).toBeTruthy();
  });

  it('is reversible -- undoing the withdrawal restores the record', () => {
    db.prepare('DELETE FROM canonical_withdrawals WHERE canonical_id = ?').run(victim);
    expect(inCurrent(victim).n).toBe(1);
    expect(inPublished(victim).n).toBe(1);
  });

  it('still refuses to let anyone delete a revision', () => {
    // If this ever stops throwing, withdrawal has become optional and content can be destroyed.
    expect(() => db.prepare('DELETE FROM content_revisions WHERE canonical_id = ?').run(victim))
      .toThrow(/immutable/i);
  });

  it('leaves other records untouched', () => {
    const others = db.prepare('SELECT COUNT(*) AS n FROM api_published_content').get() as { n: number };
    db.prepare('INSERT INTO canonical_withdrawals (canonical_id, reason) VALUES (?, ?)')
      .run(victim, 'Withdrawn by test.');
    const after = db.prepare('SELECT COUNT(*) AS n FROM api_published_content').get() as { n: number };
    expect(after.n).toBe(others.n - 1);
    db.prepare('DELETE FROM canonical_withdrawals WHERE canonical_id = ?').run(victim);
  });
});
