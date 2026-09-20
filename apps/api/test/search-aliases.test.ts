import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The corpus says "bathroom" and never "toilet", so lexical search for a toilet returned nothing at
// all and the whole vocabulary gap fell on the embedding model. These aliases close it. They are
// search terms, never displayed and never part of a revision, so the bar they have to clear is:
// they must add words the book does not use, and must not quietly become content.
const aliases = JSON.parse(readFileSync(resolve(__dirname, '../data/search-aliases.json'), 'utf8')) as {
  chapters: Record<string, string[]>;
};
const migration = readFileSync(resolve(__dirname, '../migrations/0020_search_aliases.sql'), 'utf8');
const duas = JSON.parse(readFileSync(resolve(__dirname, '../../../pwa-website/data/duas.json'), 'utf8')) as {
  entries: Array<{ id: number; title: string }>;
};

describe('the alias data', () => {
  it('covers every chapter of the book', () => {
    expect(Object.keys(aliases.chapters)).toHaveLength(duas.entries.length);
    for (const entry of duas.entries) {
      expect(aliases.chapters[String(entry.id)], `chapter ${entry.id}`).toBeTruthy();
    }
  });

  it('carries only search terms -- lowercase, latin, short', () => {
    for (const [chapter, list] of Object.entries(aliases.chapters)) {
      for (const alias of list) {
        expect(alias, chapter).toBe(alias.toLowerCase());
        expect(alias, chapter).not.toMatch(/[؀-ۿ]/);   // no Arabic: this is not content
        expect(alias.length, `${chapter}: ${alias}`).toBeLessThanOrEqual(48);
      }
      expect(new Set(list).size, chapter).toBe(list.length);
    }
  });

  it('adds vocabulary rather than repeating the title it belongs to', () => {
    for (const entry of duas.entries) {
      for (const alias of aliases.chapters[String(entry.id)]!) {
        expect(entry.title.toLowerCase(), `chapter ${entry.id}`).not.toContain(alias);
      }
    }
  });

  it('is what the migration actually loads', () => {
    // The migration is generated from the JSON; this catches one being edited without the other.
    for (const [chapter, list] of Object.entries(aliases.chapters)) {
      const row = `('book.sunnah.hisn.1.chapter.c${chapter}.00', '${list.join(', ').replace(/'/g, "''")}')`;
      expect(migration, `chapter ${chapter}`).toContain(row);
    }
  });

  it('re-embeds the corpus, because the vectors were made from text without these', () => {
    expect(migration).toContain('UPDATE rag_index_state');
    expect(migration).toContain("status = 'pending'");
  });
});

describe('what the aliases do to lexical search', () => {
  const seeded = () => {
    const database = new Database(':memory:');
    database.exec('PRAGMA foreign_keys = OFF;');
    database.exec(`
      CREATE TABLE canonical_records (canonical_id TEXT PRIMARY KEY, content_type TEXT, current_revision_id TEXT);
      CREATE TABLE content_revisions (id TEXT PRIMARY KEY, canonical_id TEXT, title TEXT);
      CREATE TABLE revision_metadata (revision_id TEXT PRIMARY KEY, chapter_id TEXT, collection_id TEXT, narrator TEXT);
      CREATE TABLE revision_parts (id TEXT PRIMARY KEY, revision_id TEXT);
      CREATE TABLE revision_segments (id TEXT PRIMARY KEY, revision_part_id TEXT, text TEXT);
      CREATE TABLE collections (id TEXT PRIMARY KEY, slug TEXT);
      CREATE TABLE canonical_withdrawals (canonical_id TEXT PRIMARY KEY);
      CREATE TABLE canonical_publications (canonical_id TEXT PRIMARY KEY, revision_id TEXT, publication_status TEXT);
      CREATE TABLE canonical_dataset_versions (id TEXT PRIMARY KEY, publication_status TEXT);
      CREATE TABLE rag_index_state (dataset_version_id TEXT PRIMARY KEY, status TEXT, indexed_count INTEGER, last_error TEXT, updated_at TEXT);
      CREATE VIRTUAL TABLE canonical_search_fts USING fts5(
        canonical_id UNINDEXED, revision_id UNINDEXED, content_type UNINDEXED,
        collection_slug UNINDEXED, title, body, narrator,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      INSERT INTO canonical_records VALUES ('dua.hisn.015', 'dua', 'rev.15');
      INSERT INTO content_revisions VALUES ('rev.15', 'dua.hisn.015', 'Before entering the bathroom');
      INSERT INTO revision_metadata VALUES ('rev.15', 'book.sunnah.hisn.1.chapter.c6.00', NULL, NULL);
      INSERT INTO revision_parts VALUES ('part.15', 'rev.15');
      INSERT INTO revision_segments VALUES ('seg.15', 'part.15', 'In the Name of Allah. O Allah, I seek protection in You from evil.');
      INSERT INTO canonical_publications VALUES ('dua.hisn.015', 'rev.15', 'published');
      INSERT INTO canonical_dataset_versions VALUES ('dataset.test', 'published');
      INSERT INTO rag_index_state VALUES ('dataset.test', 'ready', 268, NULL, '2026-01-01');
    `);
    return database;
  };
  const find = (database: Database.Database, word: string) => database.prepare(
    'SELECT canonical_id FROM canonical_search_fts WHERE canonical_search_fts MATCH ?',
  ).all(`"${word}"*`) as Array<{ canonical_id: string }>;

  it('finds the bathroom reading when someone asks about a toilet', () => {
    const database = seeded();
    database.exec(migration);
    expect(find(database, 'toilet').map((row) => row.canonical_id)).toEqual(['dua.hisn.015']);
    expect(find(database, 'washroom')).toHaveLength(1);
    expect(find(database, 'loo')).toHaveLength(1);
  });

  it('still finds it by the words the book itself uses', () => {
    const database = seeded();
    database.exec(migration);
    expect(find(database, 'bathroom')).toHaveLength(1);
    expect(find(database, 'protection')).toHaveLength(1);
  });

  it('does not invent matches for anything unrelated', () => {
    const database = seeded();
    database.exec(migration);
    expect(find(database, 'mortgage')).toEqual([]);
    expect(find(database, 'jamarat')).toEqual([]);
  });

  it('queues the corpus to be embedded again', () => {
    const database = seeded();
    database.exec(migration);
    const state = database.prepare('SELECT status, indexed_count AS indexed FROM rag_index_state').get() as { status: string; indexed: number };
    expect(state).toEqual({ status: 'pending', indexed: 0 });
  });
});
