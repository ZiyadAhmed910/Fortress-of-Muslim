import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HISN_CHAPTER_BY_READING } from '../src/lib/hisn-chapters';
import { D1ContentRepository } from '../src/repositories/d1-content-repository';

// A dua's link must open the dua. /hisn/chapter<n> is the app's page for one of the book's 132
// chapters; a dua record is one of its 268 readings. The link used the reading number as the chapter
// number, so Ask's citation for Istikharah (reading 074, chapter 26) opened /hisn/chapter74 -- a dua
// for someone fasting who is offered food. Reported from a real Ask answer on test; the text was
// right and the link was not.
//
// Against the real migrated schema, per CLAUDE.md. A database built from the migrations has the
// readings but no record_placements -- the same as production -- so this exercises the path
// production takes.

const APP_CHAPTERS = (JSON.parse(readFileSync(resolve(process.cwd(), '../../pwa-website/data/duas.json'), 'utf8')).entries as
  { sequence: number; title: string; parts: unknown[] }[]).sort((a, b) => a.sequence - b.sequence);

function createContentDatabase() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const directory = resolve(process.cwd(), 'migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(readFileSync(resolve(directory, name), 'utf8'));
  }
  return database;
}

class D1Statement {
  constructor(private readonly statement: Database.Statement, private readonly parameters: unknown[] = []) {}
  bind(...parameters: unknown[]) { return new D1Statement(this.statement, parameters); }
  async first<T>() { return (this.statement.get(...this.parameters) as T | undefined) ?? null; }
  async all<T>() { return { results: this.statement.all(...this.parameters) as T[] }; }
  async run() { const result = this.statement.run(...this.parameters); return { success: true, meta: { changes: result.changes } }; }
}

const d1 = (database: Database.Database) => ({
  prepare: (sql: string) => new D1Statement(database.prepare(sql)),
  batch: async (statements: D1Statement[]) => Promise.all(statements.map((statement) => statement.all())),
}) as unknown as D1Database;

const chapterOf = (url: string) => Number(url.match(/\/hisn\/chapter(\d+)$/)?.[1]);

describe('the reading-to-chapter table', () => {
  it('is what the app says: chapter parts, in order, one per reading', () => {
    const expected = APP_CHAPTERS.flatMap((entry) => entry.parts.map(() => entry.sequence));
    expect(HISN_CHAPTER_BY_READING).toEqual(expected);
    expect(HISN_CHAPTER_BY_READING).toHaveLength(268);
  });
});

describe('dua links', () => {
  const database = createContentDatabase();
  const repository = new D1ContentRepository(d1(database));

  it('link Istikharah to its chapter, not to the chapter numbered like the reading', async () => {
    const dua = await repository.getAskDua('dua.hisn.074');
    expect(dua?.canonicalUrl).toBe('https://fortressofmuslim.org/hisn/chapter26');
    expect(APP_CHAPTERS.find((entry) => entry.sequence === 26)?.title).toMatch(/seeking guidance/i);
  });

  it('place the other readings from the reported answer in their chapters', () => {
    // Not all of these are published by the migrations alone, so checked through the table, with
    // the reading numbers the test database holds for them: dua.hisn.071 is reading 71 ("After
    // salam", chapter 25) and dua.hisn.197 is reading 198 (chapter 86) -- its id and its reading
    // number differ, which is why the table is keyed by reading, never by id.
    expect(HISN_CHAPTER_BY_READING[71 - 1]).toBe(25);
    expect(HISN_CHAPTER_BY_READING[198 - 1]).toBe(86);
  });

  it('only ever link to a chapter the app has, and to the one that holds the reading', async () => {
    const chapters = new Set(APP_CHAPTERS.map((entry) => entry.sequence));
    const listed = await repository.listDuas(0, 500);
    expect(listed.length).toBeGreaterThan(0);
    for (const summary of listed) {
      const chapter = chapterOf(summary.canonicalUrl);
      expect(chapters.has(chapter), `${summary.id} -> ${summary.canonicalUrl}`).toBe(true);
      expect(chapter, summary.id).toBe(HISN_CHAPTER_BY_READING[summary.sequence - 1]);
    }
  });

  it('prefers a placement where the database has one', async () => {
    const placed = createContentDatabase();
    const revision = placed.prepare(`
      SELECT revision.record_id AS recordId FROM canonical_records canonical
      JOIN content_revisions revision ON revision.id = canonical.current_revision_id
      WHERE canonical.canonical_id = 'dua.hisn.074'
    `).get() as { recordId: string };
    const record = placed.prepare('SELECT collection_id AS collectionId FROM record_placements WHERE record_id = ?').get(revision.recordId) as { collectionId: string } | undefined;
    const collectionId = record?.collectionId ?? (placed.prepare('SELECT id FROM collections LIMIT 1').get() as { id: string }).id;
    placed.prepare("INSERT INTO books (id, collection_id, book_number, title, position) VALUES ('book.test', ?, '1', 'Test', 999)").run(collectionId);
    placed.prepare("INSERT INTO chapters (id, book_id, chapter_number, title, position) VALUES ('chapter.test', 'book.test', '26', 'Istikharah', 26)").run();
    placed.prepare(`INSERT INTO record_placements (record_id, collection_id, chapter_id) VALUES (?, ?, 'chapter.test')
      ON CONFLICT (record_id) DO UPDATE SET chapter_id = 'chapter.test'`).run(revision.recordId, collectionId);
    const dua = await new D1ContentRepository(d1(placed)).getAskDua('dua.hisn.074');
    expect(dua?.canonicalUrl).toBe('https://fortressofmuslim.org/hisn/chapter26');
  });

  it('give the same link in the evidence view', async () => {
    const evidence = await repository.getDuaEvidence('dua.hisn.074');
    if (evidence) expect(evidence.canonicalUrl).toBe('https://fortressofmuslim.org/hisn/chapter26');
  });
});
