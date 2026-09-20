import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { D1ContentRepository } from '../src/repositories/d1-content-repository';

// Backs Ask's exact-reference fast path (rag-reference.ts + rag.ts). Collections are editor-created
// with no fixed enum ("Sahih al-Bukhari" vs. "Bukhari" vs. slug "bukhari"), so this proves the fuzzy
// matching in findHadithByReference works against the real schema, not a mocked one.
describe('findHadithByReference against the real schema', () => {
  it('resolves a short collection hint against a longer real collection title', async () => {
    const database = createContentDatabase();
    seedHadithCollection(database, {
      collectionId: 'collection.bukhari-test', slug: 'bukhari', title: 'Sahih al-Bukhari',
      canonicalId: 'hadith.bukhari-test.1', displayNumber: '52', sequence: 1,
      title_: 'Actions are judged by intentions',
    });
    const repository = new D1ContentRepository(d1(database));

    const bySlug = await repository.findHadithByReference('Bukhari', '52');
    expect(bySlug?.id).toBe('hadith.bukhari-test.1');

    const byFullTitle = await repository.findHadithByReference('Sahih al-Bukhari', '52');
    expect(byFullTitle?.id).toBe('hadith.bukhari-test.1');
  });

  it('falls back to sequence when no display_number matches', async () => {
    const database = createContentDatabase();
    seedHadithCollection(database, {
      collectionId: 'collection.muslim-test', slug: 'muslim', title: 'Sahih Muslim',
      canonicalId: 'hadith.muslim-test.1', displayNumber: null, sequence: 7,
      title_: 'Intentions determine actions',
    });
    const repository = new D1ContentRepository(d1(database));

    const record = await repository.findHadithByReference('Muslim', '7');
    expect(record?.id).toBe('hadith.muslim-test.1');
  });

  it('returns undefined for an unrecognized collection hint rather than guessing', async () => {
    const database = createContentDatabase();
    seedHadithCollection(database, {
      collectionId: 'collection.bukhari-test', slug: 'bukhari', title: 'Sahih al-Bukhari',
      canonicalId: 'hadith.bukhari-test.1', displayNumber: '52', sequence: 1,
      title_: 'Actions are judged by intentions',
    });
    const repository = new D1ContentRepository(d1(database));

    expect(await repository.findHadithByReference('Nasai', '52')).toBeUndefined();
    expect(await repository.findHadithByReference('Bukhari', '9999')).toBeUndefined();
  });
});

function createContentDatabase() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const directory = resolve(process.cwd(), 'migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(readFileSync(resolve(directory, name), 'utf8'));
  }
  return database;
}

function seedHadithCollection(database: Database.Database, options: {
  collectionId: string; slug: string; title: string;
  canonicalId: string; displayNumber: string | null; sequence: number; title_: string;
}) {
  const recordId = `record.${options.canonicalId}`;
  const revisionId = `revision.${options.canonicalId}.1`;
  database.prepare(`
    INSERT INTO collections (id, slug, content_type, title, default_language_code, verification_status)
      VALUES (?, ?, 'hadith', ?, 'en', 'verified')
  `).run(options.collectionId, options.slug, options.title);
  database.prepare(`
    INSERT INTO content_records (id, dataset_id, content_type, sequence, title, verification_status, created_at, updated_at)
      VALUES (?, 'dataset.fortress.editorial.manual', 'hadith', ?, ?, 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(recordId, options.sequence, options.title_);
  database.prepare(`
    INSERT INTO canonical_records (canonical_id, content_type, current_revision_id)
      VALUES (?, 'hadith', ?)
  `).run(options.canonicalId, revisionId);
  database.prepare(`
    INSERT INTO content_revisions (id, canonical_id, record_id, revision_number, sequence, title, created_by_external_id)
      VALUES (?, ?, ?, 1, ?, ?, 'system')
  `).run(revisionId, options.canonicalId, recordId, options.sequence, options.title_);
  database.prepare(`
    INSERT INTO revision_metadata (revision_id, collection_id, narrator, grade, display_number)
      VALUES (?, ?, 'Test narrator', 'Sahih', ?)
  `).run(revisionId, options.collectionId, options.displayNumber);
  database.prepare(`
    INSERT INTO editorial_record_state (canonical_id, revision_id, workflow_state, verified_by_external_id, verified_at)
      VALUES (?, ?, 'published', 'system', CURRENT_TIMESTAMP)
  `).run(options.canonicalId, revisionId);
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
