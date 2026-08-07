import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { D1ContentRepository } from '../src/repositories/d1-content-repository';

// Proves the fix for a real bug, verified empirically before this test existed: SQLite FTS5's
// `remove_diacritics 2` tokenizer option (set on canonical_search_fts, see migration 0006) does NOT
// strip Arabic tashkeel (combining diacritics) or fold alef-hamza variants (أ إ آ ٱ -> ا) -- it only
// handles the Unicode categories that option actually covers, which excludes Arabic combining marks
// in the SQLite version bundled with better-sqlite3. A word stored with tashkeel does not match a
// plain query, and a word stored with one alef-hamza form does not match a query using another. This
// runs against the real migrated schema and the real repository method (not a mocked database),
// matching CLAUDE.md's lesson that mocked SQL tests don't prove real-schema behavior.
describe('Arabic search normalization against the real schema', () => {
  it('matches a diacritic-free, alef-normalized query against canonical_search_fts content', async () => {
    const database = createContentDatabase();
    seedPublishedHadith(database, {
      canonicalId: 'hadith.arabic-search-test.1',
      title: 'Fasting is a shield',
      body: normalizeArabicJs('الصِّيَامُ جُنَّةٌ'),
      narrator: normalizeArabicJs('أَبُو هُرَيْرَة'),
    });
    const repository = new D1ContentRepository(d1(database));

    const byPlainBody = await repository.searchForRag('الصيام جنة', 5);
    expect(byPlainBody.map((match) => match.id)).toContain('hadith.arabic-search-test.1');

    const byDiacriticQuery = await repository.searchForRag('الصِّيَامُ', 5);
    expect(byDiacriticQuery.map((match) => match.id)).toContain('hadith.arabic-search-test.1');

    const byAlternateAlefHamzaNarrator = await repository.searchForRag('ابو هريرة', 5);
    expect(byAlternateAlefHamzaNarrator.map((match) => match.id)).toContain('hadith.arabic-search-test.1');
  });

  it('does not match unrelated Arabic content just because diacritics were stripped', async () => {
    const database = createContentDatabase();
    seedPublishedHadith(database, {
      canonicalId: 'hadith.arabic-search-test.2',
      title: 'Patience is illumination',
      body: normalizeArabicJs('الصَّبْرُ ضِيَاءٌ'),
      narrator: normalizeArabicJs('أَبُو مَالِك'),
    });
    const repository = new D1ContentRepository(d1(database));

    const results = await repository.searchForRag('الصيام', 5);
    expect(results.map((match) => match.id)).not.toContain('hadith.arabic-search-test.2');
  });
});

// Local copy of the same normalization apps/auth/src/editorial-plane.ts applies (as
// normalizeArabicJs) before writing into canonical_search_fts -- this test seeds the FTS row the way
// the real publish path leaves it, then proves the query-side normalization in
// apps/api/src/repositories/d1-content-repository.ts meets it in the middle.
function normalizeArabicJs(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ـ/g, '').replace(/[آأإٱ]/g, 'ا');
}

function createContentDatabase() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const directory = resolve(process.cwd(), 'migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(readFileSync(resolve(directory, name), 'utf8'));
  }
  return database;
}

function seedPublishedHadith(
  database: Database.Database,
  record: { canonicalId: string; title: string; body: string; narrator: string },
) {
  const revisionId = `revision.${record.canonicalId}.1`;
  const recordId = `record.${record.canonicalId}`;
  database.prepare(`
    INSERT INTO content_records (id, dataset_id, content_type, sequence, title, verification_status, created_at, updated_at)
      VALUES (?, 'dataset.fortress.editorial.manual', 'hadith', 1, ?, 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(recordId, record.title);
  database.prepare(`
    INSERT INTO canonical_records (canonical_id, content_type, current_revision_id)
      VALUES (?, 'hadith', ?)
  `).run(record.canonicalId, revisionId);
  database.prepare(`
    INSERT INTO content_revisions (id, canonical_id, record_id, revision_number, sequence, title, created_by_external_id)
      VALUES (?, ?, ?, 1, 1, ?, 'system')
  `).run(revisionId, record.canonicalId, recordId, record.title);
  database.prepare(`
    INSERT INTO canonical_dataset_versions (id, version_label, publication_status, verification_status, record_count, created_at, published_at)
      VALUES ('dataset.arabic-search-test', 'arabic-search-test-v1', 'published', 'verified', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING
  `).run();
  database.prepare(`
    INSERT INTO canonical_publications (canonical_id, revision_id, record_id, dataset_version_id, revision_number, publication_status, published_by_external_id, published_at)
      VALUES (?, ?, ?, 'dataset.arabic-search-test', 1, 'published', 'system', CURRENT_TIMESTAMP)
  `).run(record.canonicalId, revisionId, recordId);
  database.prepare(`
    INSERT INTO canonical_search_fts (canonical_id, revision_id, content_type, collection_slug, title, body, narrator)
      VALUES (?, ?, 'hadith', 'arabic-search-test', ?, ?, ?)
  `).run(record.canonicalId, revisionId, record.title, record.body, record.narrator);
}

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

  async run() {
    const result = this.statement.run(...this.parameters);
    return { success: true, meta: { changes: result.changes } };
  }
}
