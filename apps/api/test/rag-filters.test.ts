import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { D1ContentRepository } from '../src/repositories/d1-content-repository';

// Proves metadata filtering (content type / collection) in searchForRag and searchCurrentForRag
// against the real schema -- both methods build their WHERE clause with optional (? IS NULL OR ...)
// conditions, which is easy to get backwards (excluding everything instead of nothing) when no
// filter is passed, so this checks both the filtered and unfiltered cases.
describe('Ask metadata filters against the real schema', () => {
  it('searchForRag only returns the requested content type and collection', async () => {
    const database = createContentDatabase();
    seedPublishedHadith(database, {
      canonicalId: 'hadith.filters-test.1', collectionId: 'collection.filters-bukhari',
      slug: 'bukhari-filters-test', title: 'Sahih al-Bukhari (filters test)',
      recordTitle: 'A zqxfshared zqxfkeyword hadith', body: 'zqxfshared zqxfkeyword content',
    });
    seedPublishedDua(database, {
      canonicalId: 'dua.filters-test.1', recordTitle: 'A zqxfshared zqxfkeyword dua', body: 'zqxfshared zqxfkeyword content',
    });
    const repository = new D1ContentRepository(d1(database));

    const unfiltered = await repository.searchForRag('zqxfshared zqxfkeyword', 10);
    expect(unfiltered.map((match) => match.id).sort()).toEqual(['dua.filters-test.1', 'hadith.filters-test.1']);

    const duaOnly = await repository.searchForRag('zqxfshared zqxfkeyword', 10, { contentType: 'dua' });
    expect(duaOnly.map((match) => match.id)).toEqual(['dua.filters-test.1']);

    const hadithOnly = await repository.searchForRag('zqxfshared zqxfkeyword', 10, { contentType: 'hadith' });
    expect(hadithOnly.map((match) => match.id)).toEqual(['hadith.filters-test.1']);

    const byCollection = await repository.searchForRag('zqxfshared zqxfkeyword', 10, { collection: 'bukhari-filters-test' });
    expect(byCollection.map((match) => match.id)).toEqual(['hadith.filters-test.1']);

    const byUnrelatedCollection = await repository.searchForRag('zqxfshared zqxfkeyword', 10, { collection: 'nonexistent' });
    expect(byUnrelatedCollection).toEqual([]);
  });

  it('searchCurrentForRag (unverified fallback) also respects content type filters', async () => {
    const database = createContentDatabase();
    seedUnpublishedHadith(database, {
      canonicalId: 'hadith.filters-test.2', collectionId: 'collection.filters-muslim',
      slug: 'muslim-filters-test', title: 'Sahih Muslim (filters test)',
      recordTitle: 'A zqxfpending zqxfkeyword hadith', body: 'zqxfpending zqxfkeyword content',
    });

    const repository = new D1ContentRepository(d1(database));
    const hadithMatches = await repository.searchCurrentForRag('zqxfpending zqxfkeyword', 10, { contentType: 'hadith' });
    expect(hadithMatches.map((match) => match.id)).toEqual(['hadith.filters-test.2']);

    const duaMatches = await repository.searchCurrentForRag('zqxfpending zqxfkeyword', 10, { contentType: 'dua' });
    expect(duaMatches).toEqual([]);
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

function seedPublishedHadith(database: Database.Database, options: {
  canonicalId: string; collectionId: string; slug: string; title: string; recordTitle: string; body: string;
}) {
  const recordId = `record.${options.canonicalId}`;
  const revisionId = `revision.${options.canonicalId}.1`;
  database.prepare(`
    INSERT INTO collections (id, slug, content_type, title, default_language_code, verification_status)
      VALUES (?, ?, 'hadith', ?, 'en', 'verified')
  `).run(options.collectionId, options.slug, options.title);
  database.prepare(`
    INSERT INTO content_records (id, dataset_id, content_type, sequence, title, verification_status, created_at, updated_at)
      VALUES (?, 'dataset.fortress.editorial.manual', 'hadith', 1, ?, 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(recordId, options.recordTitle);
  database.prepare(`
    INSERT INTO canonical_records (canonical_id, content_type, current_revision_id)
      VALUES (?, 'hadith', ?)
  `).run(options.canonicalId, revisionId);
  database.prepare(`
    INSERT INTO content_revisions (id, canonical_id, record_id, revision_number, sequence, title, created_by_external_id)
      VALUES (?, ?, ?, 1, 1, ?, 'system')
  `).run(revisionId, options.canonicalId, recordId, options.recordTitle);
  database.prepare(`
    INSERT INTO revision_metadata (revision_id, collection_id, narrator, grade, display_number)
      VALUES (?, ?, 'Test narrator', 'Sahih', '1')
  `).run(revisionId, options.collectionId);
  database.prepare(`
    INSERT INTO canonical_dataset_versions (id, version_label, publication_status, verification_status, record_count, created_at, published_at)
      VALUES ('dataset.rag-filters-test', 'rag-filters-test-v1', 'published', 'verified', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING
  `).run();
  database.prepare(`
    INSERT INTO canonical_publications (canonical_id, revision_id, record_id, dataset_version_id, revision_number, publication_status, published_by_external_id, published_at)
      VALUES (?, ?, ?, 'dataset.rag-filters-test', 1, 'published', 'system', CURRENT_TIMESTAMP)
  `).run(options.canonicalId, revisionId, recordId);
  database.prepare(`
    INSERT INTO canonical_search_fts (canonical_id, revision_id, content_type, collection_slug, title, body, narrator)
      VALUES (?, ?, 'hadith', ?, ?, ?, 'Test narrator')
  `).run(options.canonicalId, revisionId, options.slug, options.recordTitle, options.body);
}

function seedUnpublishedHadith(database: Database.Database, options: {
  canonicalId: string; collectionId: string; slug: string; title: string; recordTitle: string; body: string;
}) {
  const recordId = `record.${options.canonicalId}`;
  const revisionId = `revision.${options.canonicalId}.1`;
  database.prepare(`
    INSERT INTO collections (id, slug, content_type, title, default_language_code, verification_status)
      VALUES (?, ?, 'hadith', ?, 'en', 'pending')
  `).run(options.collectionId, options.slug, options.title);
  database.prepare(`
    INSERT INTO content_records (id, dataset_id, content_type, sequence, title, verification_status, created_at, updated_at)
      VALUES (?, 'dataset.fortress.editorial.manual', 'hadith', 1, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(recordId, options.recordTitle);
  database.prepare(`
    INSERT INTO canonical_records (canonical_id, content_type, current_revision_id)
      VALUES (?, 'hadith', ?)
  `).run(options.canonicalId, revisionId);
  database.prepare(`
    INSERT INTO content_revisions (id, canonical_id, record_id, revision_number, sequence, title, created_by_external_id)
      VALUES (?, ?, ?, 1, 1, ?, 'system')
  `).run(revisionId, options.canonicalId, recordId, options.recordTitle);
  database.prepare(`
    INSERT INTO revision_metadata (revision_id, collection_id, narrator, grade, display_number)
      VALUES (?, ?, 'Test narrator', 'Sahih', '1')
  `).run(revisionId, options.collectionId);
  database.prepare(`
    INSERT INTO revision_parts (id, revision_id, position) VALUES (?, ?, 1)
  `).run(`part.${options.canonicalId}.1`, revisionId);
  database.prepare(`
    INSERT INTO revision_segments (id, revision_part_id, position, kind, language_code, script_code, text)
      VALUES (?, ?, 1, 'translation', 'en', 'Latn', ?)
  `).run(`segment.${options.canonicalId}.1`, `part.${options.canonicalId}.1`, options.body);
  database.prepare(`
    INSERT INTO editorial_record_state (canonical_id, revision_id, workflow_state)
      VALUES (?, ?, 'pending_review')
  `).run(options.canonicalId, revisionId);
}

function seedPublishedDua(database: Database.Database, options: {
  canonicalId: string; recordTitle: string; body: string;
}) {
  const recordId = `record.${options.canonicalId}`;
  const revisionId = `revision.${options.canonicalId}.1`;
  database.prepare(`
    INSERT INTO content_records (id, dataset_id, content_type, sequence, title, verification_status, created_at, updated_at)
      VALUES (?, 'dataset.fortress.editorial.manual', 'dua', 1, ?, 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(recordId, options.recordTitle);
  database.prepare(`
    INSERT INTO canonical_records (canonical_id, content_type, current_revision_id)
      VALUES (?, 'dua', ?)
  `).run(options.canonicalId, revisionId);
  database.prepare(`
    INSERT INTO content_revisions (id, canonical_id, record_id, revision_number, sequence, title, created_by_external_id)
      VALUES (?, ?, ?, 1, 1, ?, 'system')
  `).run(revisionId, options.canonicalId, recordId, options.recordTitle);
  database.prepare(`
    INSERT INTO canonical_dataset_versions (id, version_label, publication_status, verification_status, record_count, created_at, published_at)
      VALUES ('dataset.rag-filters-test', 'rag-filters-test-v1', 'published', 'verified', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING
  `).run();
  database.prepare(`
    INSERT INTO canonical_publications (canonical_id, revision_id, record_id, dataset_version_id, revision_number, publication_status, published_by_external_id, published_at)
      VALUES (?, ?, ?, 'dataset.rag-filters-test', 1, 'published', 'system', CURRENT_TIMESTAMP)
  `).run(options.canonicalId, revisionId, recordId);
  database.prepare(`
    INSERT INTO canonical_search_fts (canonical_id, revision_id, content_type, collection_slug, title, body, narrator)
      VALUES (?, ?, 'dua', 'hisn', ?, ?, '')
  `).run(options.canonicalId, revisionId, options.recordTitle, options.body);
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
