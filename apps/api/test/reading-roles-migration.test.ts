import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1ContentRepository } from '../src/repositories/d1-content-repository';

// Migration 0018 rewrites published religious content, so it is tested against the real migration
// chain rather than a mock. The seeded records carry the exact text 0018 expects for four real Hisn
// readings -- three it must correct and one that has "drifted" and must be left alone -- because the
// migration's safety rests on refusing to touch anything that differs from what was reviewed.
// (It was also run against a full copy of the test D1 data before shipping; see the migration header.)
const MIGRATIONS = resolve(__dirname, '../migrations');
const ROLES_MIGRATION = '0018_hisn_reading_roles.sql';

// Mirrors the seed in canonical-withdrawal.test.ts / tools/verify-migrations.mjs: 0006 expects a
// candidate record to exist.
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

type Seed = { id: string; chapter: number; sequence: number; segments: Array<[kind: string, text: string]> };

// Texts in the planned slots are exactly what 0018 lists; the other segments are placeholders,
// since the guard only compares the segments it is about to change.
const SEEDS: Seed[] = [
  { id: 'dua.hisn.142', chapter: 45, sequence: 143, segments: [
    ['arabic', 'الْأَذَانُ'], ['transliteration', '--'], ['translation', "The call to prayer - 'Athan."],
  ] },
  { id: 'dua.hisn.146', chapter: 48, sequence: 147, segments: [
    ['arabic', 'أُعِيذُكُمَا بِكَلِمَاتِ اللَّهِ التَّامَّةِ'],
    ['transliteration', "The Prophet (ﷺ) used to seek Allah's protection for Al-Hasan and Al-Husain by saying:"],
    ['translation', 'I commend you two to the protection of Allah’s perfect words.'],
  ] },
  { id: 'dua.hisn.266', chapter: 131, sequence: 267, segments: [
    ['arabic', 'رَأَيْتُ النَّبِيَّ يَعْقِدُ التَّسْبِيحَ بِيَمِينِهِ'], ['translation', "Abdullah bin 'Amr (RA) said:"],
  ] },
  // Its text spans lines. A raw line break in the migration's literal became CR LF on a Windows
  // checkout and silently stopped matching, so the literal is built with char(10) instead.
  { id: 'dua.hisn.217', chapter: 105, sequence: 218, segments: [
    ['arabic', 'اللَّهُ أَكْبَرُ'], ['transliteration', 'From every elevated point say\nAllāhu Akbar (three times),\nand then recite:'], ['translation', 'Placeholder.'],
  ] },
  // Drifted: 0018 expects "--" here. Something else is present, so this record must not be revised.
  { id: 'dua.hisn.219', chapter: 107, sequence: 220, segments: [
    ['arabic', 'مَنْ صَلَّى عَلَيَّ صَلَاةً'], ['transliteration', 'edited since the migration was written'], ['translation', 'Placeholder.'],
  ] },
];

function seedHisnRecord(db: Database.Database, seed: Seed) {
  const revision = `revision.${seed.id}.1`;
  const chapter = `book.sunnah.hisn.1.chapter.c${seed.chapter}.00`;
  db.prepare(`INSERT OR IGNORE INTO chapters (id, book_id, chapter_number, title, position) VALUES (?, 'book.sunnah.hisn.1', ?, ?, ?)`)
    .run(chapter, String(seed.chapter), `Chapter ${seed.chapter}`, seed.chapter);
  db.prepare(`INSERT INTO content_records (id, dataset_id, content_type, sequence, title, verification_status, created_at, updated_at)
    VALUES (?, 'dataset.fortress.editorial.manual', 'dua', ?, ?, 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(`record.${seed.id}`, seed.sequence, `Chapter ${seed.chapter}`);
  db.prepare(`INSERT INTO canonical_records (canonical_id, content_type, current_revision_id) VALUES (?, 'dua', ?)`).run(seed.id, revision);
  db.prepare(`INSERT INTO content_revisions (id, canonical_id, record_id, revision_number, legacy_id, sequence, title, created_by_external_id)
    VALUES (?, ?, ?, 1, ?, ?, ?, 'importer')`).run(revision, seed.id, `record.${seed.id}`, seed.id.replace('dua.hisn.', 'dua-'), seed.sequence, `Chapter ${seed.chapter}`);
  db.prepare('INSERT INTO revision_parts (id, revision_id, position) VALUES (?, ?, 1)').run(`${revision}.part.1`, revision);
  seed.segments.forEach(([kind, text], index) => {
    const [language, script] = kind === 'arabic' ? ['ar', 'Arab'] : kind === 'transliteration' ? ['ar-Latn', 'Latn'] : ['en', 'Latn'];
    db.prepare(`INSERT INTO revision_segments (id, revision_part_id, position, kind, language_code, script_code, text) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(`${revision}.part.1.segment.${index + 1}`, `${revision}.part.1`, index + 1, kind, language, script, text);
  });
  db.prepare(`INSERT INTO revision_metadata (revision_id, collection_id, book_id, chapter_id, display_number) VALUES (?, 'collection.sunnah.hisn', 'book.sunnah.hisn.1', ?, ?)`)
    .run(revision, chapter, seed.id.replace('dua.hisn.', ''));
  db.prepare(`INSERT INTO canonical_references (id, canonical_id, revision_id, reference_type, locator, verification_status, verified_by_external_id, verified_at)
    VALUES (?, ?, ?, 'primary', 'Hisn al-Muslim', 'verified', 'reviewer', CURRENT_TIMESTAMP)`).run(`reference.${seed.id}`, seed.id, revision);
  db.prepare(`INSERT INTO editorial_record_state (canonical_id, revision_id, workflow_state, verified_by_external_id, verified_at)
    VALUES (?, ?, 'published', 'reviewer', CURRENT_TIMESTAMP)`).run(seed.id, revision);
  db.prepare(`INSERT INTO canonical_publications (canonical_id, revision_id, record_id, dataset_version_id, revision_number, publication_status, published_by_external_id, published_at)
    VALUES (?, ?, ?, 'canonical.hisn.verified.2026-07-23', 1, 'published', 'reviewer', CURRENT_TIMESTAMP)`).run(seed.id, revision, `record.${seed.id}`);
}

let db: Database.Database;
let revisionsBefore: Map<string, string>;

const currentSegments = (id: string) => db.prepare(`
  SELECT segment.position, segment.kind, segment.language_code AS language, segment.text
  FROM canonical_records canonical
  JOIN revision_parts part ON part.revision_id = canonical.current_revision_id
  JOIN revision_segments segment ON segment.revision_part_id = part.id
  WHERE canonical.canonical_id = ? ORDER BY part.position, segment.position
`).all(id) as Array<{ position: number; kind: string; language: string; text: string }>;
const currentRevision = (id: string) => (db.prepare('SELECT current_revision_id AS id FROM canonical_records WHERE canonical_id = ?').get(id) as { id: string }).id;
const fingerprint = () => new Map((db.prepare(`
  SELECT revision.id, group_concat(segment.id || '|' || segment.kind || '|' || segment.text, char(10)) AS body
  FROM content_revisions revision
  LEFT JOIN revision_parts part ON part.revision_id = revision.id
  LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
  GROUP BY revision.id
`).all() as Array<{ id: string; body: string | null }>).map((row) => [row.id, row.body ?? '']));

/** The seeded database just before 0018, with its line endings forced one way or the other. */
function databaseBefore0018() {
  const database = new Database(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files.filter((name) => name < ROLES_MIGRATION)) {
    if (file === '0006_canonical_editorial.sql') database.exec(SEED_BEFORE_0006);
    database.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'));
  }
  database.exec(`
    INSERT OR IGNORE INTO collections (id, slug, content_type, title, default_language_code, verification_status)
      VALUES ('collection.sunnah.hisn', 'hisn', 'dua', 'Hisn al-Muslim', 'en', 'verified');
    INSERT OR IGNORE INTO books (id, collection_id, book_number, title, position)
      VALUES ('book.sunnah.hisn.1', 'collection.sunnah.hisn', '1', 'Hisn al-Muslim', 1);
  `);
  for (const seed of SEEDS) seedHisnRecord(database, seed);
  // As 0017 left chapter 45 on test: withdrawn.
  database.exec("INSERT INTO canonical_withdrawals (canonical_id, reason) VALUES ('dua.hisn.142', 'Withdrawn by 0017.')");
  return database;
}

const migrationWith = (lineBreak: string) =>
  readFileSync(resolve(MIGRATIONS, ROLES_MIGRATION), 'utf8').replace(/\r?\n/g, lineBreak);

beforeAll(() => {
  db = databaseBefore0018();
  revisionsBefore = fingerprint();
  // CR LF: what a Windows checkout with core.autocrlf hands to `wrangler d1 migrations apply`.
  db.exec(migrationWith('\r\n'));
});

describe('migration 0018: reading roles', () => {
  it('restores the withdrawn adhan reading as guidance, without its "--"', async () => {
    expect(db.prepare("SELECT COUNT(*) AS n FROM canonical_withdrawals WHERE canonical_id = 'dua.hisn.142'").get()).toEqual({ n: 0 });
    const dua = await new D1ContentRepository(d1(db)).getPublishedDua('dua.hisn.142');
    expect(dua?.readingRole).toBe('instruction');
    expect(dua?.revisionNumber).toBe(2);
    expect(dua?.parts[0]!.map((segment) => segment.kind)).toEqual(['arabic', 'translation']);
  });

  it('moves a narration frame out of the transliteration slot into a comment, text unchanged', () => {
    expect(currentSegments('dua.hisn.146')).toEqual([
      expect.objectContaining({ position: 1, kind: 'arabic' }),
      { position: 2, kind: 'comment', language: 'en', text: "The Prophet (ﷺ) used to seek Allah's protection for Al-Hasan and Al-Husain by saying:" },
      expect.objectContaining({ position: 3, kind: 'translation' }),
    ]);
  });

  it('completes a translation that stopped mid-sentence', () => {
    const translation = currentSegments('dua.hisn.266').find((segment) => segment.kind === 'translation');
    expect(translation?.text).toBe('Abdullah bin \'Amr (RA) said: "I saw the Prophet (ﷺ) counting the glorification of his Lord on his right hand."');
  });

  it('matches text that spans lines whatever line endings the file was checked out with', () => {
    expect(currentRevision('dua.hisn.217')).toBe('revision.dua.hisn.217.2');
    expect(currentSegments('dua.hisn.217').map((segment) => segment.kind)).toEqual(['arabic', 'translation']);
    const lf = databaseBefore0018();
    lf.exec(migrationWith('\n'));
    const revised = lf.prepare(`
      SELECT canonical_id AS id FROM content_revisions
      WHERE correction_reason LIKE 'Four-role reading model%' ORDER BY canonical_id
    `).all();
    expect(revised).toEqual([{ id: 'dua.hisn.142' }, { id: 'dua.hisn.146' }, { id: 'dua.hisn.217' }, { id: 'dua.hisn.266' }]);
  });

  it('leaves a record alone when its text is not what the migration expects', () => {
    expect(currentRevision('dua.hisn.219')).toBe('revision.dua.hisn.219.1');
    expect(currentSegments('dua.hisn.219').find((segment) => segment.kind === 'transliteration')?.text)
      .toBe('edited since the migration was written');
  });

  it('still assigns the drifted record its role, because its chapter is where expected', async () => {
    const dua = await new D1ContentRepository(d1(db)).getDua('dua.hisn.219');
    expect(dua?.readingRole).toBe('virtue');
  });

  it('never modifies an existing revision -- corrections are new revisions', () => {
    const after = fingerprint();
    for (const [id, body] of revisionsBefore) expect(after.get(id), id).toBe(body);
    expect(after.size - revisionsBefore.size).toBe(4);
    const newRevision = db.prepare("SELECT supersedes_revision_id AS supersedes, correction_reason AS reason FROM content_revisions WHERE id = 'revision.dua.hisn.146.2'").get() as { supersedes: string; reason: string };
    expect(newRevision.supersedes).toBe('revision.dua.hisn.146.1');
    expect(newRevision.reason).toMatch(/^Four-role reading model/);
  });

  it('keeps the new revisions under the same immutability as every other', () => {
    expect(() => db.prepare("DELETE FROM revision_segments WHERE id LIKE 'revision.dua.hisn.146.2.%'").run()).toThrow(/immutable/i);
  });

  it('records each correction in the audit trail with its reason', () => {
    const rows = db.prepare("SELECT field_path AS field, reason FROM correction_history WHERE id LIKE 'correction.revision.dua.hisn.%' ORDER BY id").all() as Array<{ field: string; reason: string }>;
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.reason.length).toBeGreaterThan(20);
  });

  it('publishes a new dataset and keeps the previous one as a complete rollback target', () => {
    const current = db.prepare("SELECT id, record_count AS count FROM canonical_dataset_versions WHERE publication_status = 'published'").all() as Array<{ id: string; count: number }>;
    expect(current).toEqual([{ id: 'canonical.hisn.reading-roles.2026-09-11', count: expect.any(Number) }]);
    const items = db.prepare('SELECT COUNT(*) AS n FROM canonical_dataset_items WHERE dataset_version_id = ?').get(current[0]!.id) as { n: number };
    expect(items.n).toBe(current[0]!.count);
    const disagreeing = db.prepare(`
      SELECT COUNT(*) AS n FROM canonical_publications publication
      JOIN editorial_record_state state USING (canonical_id)
      WHERE publication.canonical_id IN ('dua.hisn.142', 'dua.hisn.146', 'dua.hisn.266')
        AND (publication.revision_id <> state.revision_id OR state.workflow_state <> 'published')
    `).get() as { n: number };
    expect(disagreeing.n).toBe(0);
    expect(db.prepare('SELECT status FROM rag_index_state WHERE dataset_version_id = ?').get(current[0]!.id)).toEqual({ status: 'pending' });
  });

  it('makes the restored reading findable by a diacritic-free Arabic search', async () => {
    const matches = await new D1ContentRepository(d1(db)).searchForRag('الاذان', 5);
    expect(matches.map((match) => match.id)).toContain('dua.hisn.142');
  });

  it('drops its working tables', () => {
    const leftovers = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '\\_m0018\\_%' ESCAPE '\\'").all();
    expect(leftovers).toEqual([]);
  });
});

function d1(database: Database.Database) {
  return {
    prepare(sql: string) {
      return new D1Statement(database.prepare(sql));
    },
  } as unknown as D1Database;
}

class D1Statement {
  constructor(
    private readonly statement: Database.Statement,
    private readonly parameters: unknown[] = [],
  ) {}

  bind(...parameters: unknown[]) {
    return new D1Statement(this.statement, parameters);
  }

  async first<T>() {
    return (this.statement.get(...this.parameters) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.statement.all(...this.parameters) as T[] };
  }
}
