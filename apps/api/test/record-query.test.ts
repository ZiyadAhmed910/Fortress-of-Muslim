import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeRecordQuery, type RecordQueryDefinition } from '../src/lib/record-query';

const definition: RecordQueryDefinition = {
  id: 'qry-test', queryKind: 'record_query', objectName: 'duas', selectedFields: ['id', 'title', 'sequence'],
  filters: [{ field: 'verificationStatus', operator: 'eq', source: 'parameter', value: 'status' }],
  sort: { field: 'sequence', direction: 'desc' }, maxRows: 25,
};

describe('record query compiler', () => {
  it('compiles allowlisted fields while binding caller parameters', async () => {
    let sql = ''; let bindings: unknown[] = [];
    const database = { prepare(statement: string) { sql = statement; return { bind(...values: unknown[]) { bindings = values; return { all: async () => ({ results: [{ id: 'dua.hisn.001', title: 'When waking up', sequence: 1 }] }) }; } }; } } as unknown as D1Database;
    const result = await executeRecordQuery(database, definition, { status: "verified' OR 1=1 --" });

    expect(sql).not.toContain("verified' OR 1=1");
    expect(sql).toContain('publication.verification_status = ?');
    expect(bindings).toEqual(["verified' OR 1=1 --", 25]);
    expect(result).toHaveLength(1);
  });

  it('rejects missing endpoint parameters', async () => {
    const database = {} as D1Database;
    await expect(executeRecordQuery(database, definition, {})).rejects.toThrow('Required query parameter is missing');
  });
});

// The mocked-database tests above only prove the SQL text and bindings look right -- they don't
// prove the query actually runs against the real schema. This is exactly the shape of bug
// CLAUDE.md's own lesson-learned section warns about (a mocked test passing while the real query
// doesn't match real tables/columns), so the Hadith support added here gets tested against the
// real migrated schema instead, same pattern as apps/api/tools/verify-migrations.mjs.
describe('record query execution against real schema (duas and Hadith)', () => {
  it('runs a dua record query against the real seeded Hisn dataset', async () => {
    const database = createContentDatabase();
    const rows = await executeRecordQuery(d1(database), {
      id: 'qry_dua_test',
      queryKind: 'record_query',
      objectName: 'duas',
      selectedFields: ['id', 'title', 'sequence'],
      filters: [],
      sort: { field: 'sequence', direction: 'asc' },
      maxRows: 3,
    }, {});
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ id: 'dua.hisn.001', sequence: 1 });
  });

  it('runs a Hadith record query with Hadith-only fields (narrator, grade, collection) against a real seeded record', async () => {
    const database = createContentDatabase();
    seedHadithRecord(database);

    const rows = await executeRecordQuery(d1(database), {
      id: 'qry_hadith_test',
      queryKind: 'record_query',
      objectName: 'hadith',
      selectedFields: ['id', 'title', 'narrator', 'grade', 'collection', 'verificationStatus'],
      filters: [{ field: 'collection', operator: 'eq', source: 'literal', value: 'test-hadith' }],
      sort: { field: 'sequence', direction: 'asc' },
      maxRows: 10,
    }, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'hadith.query-test.1',
      title: 'Intentions are the foundation of actions',
      narrator: 'Query test narrator',
      grade: 'Sahih',
      collection: 'test-hadith',
      verificationStatus: 'verified',
    });
  });

  it('a dua-scoped query never returns Hadith rows, and vice versa, even with matching field names', async () => {
    const database = createContentDatabase();
    seedHadithRecord(database);

    const duaRows = await executeRecordQuery(d1(database), {
      id: 'qry_scope_test', queryKind: 'record_query', objectName: 'duas',
      selectedFields: ['id', 'title'], filters: [], sort: { field: 'sequence', direction: 'asc' }, maxRows: 200,
    }, {});
    expect(duaRows.some((row) => String(row.id).startsWith('hadith.'))).toBe(false);

    const hadithRows = await executeRecordQuery(d1(database), {
      id: 'qry_scope_test_2', queryKind: 'record_query', objectName: 'hadith',
      selectedFields: ['id', 'title'], filters: [], sort: { field: 'sequence', direction: 'asc' }, maxRows: 200,
    }, {});
    expect(hadithRows.every((row) => String(row.id).startsWith('hadith.'))).toBe(true);
    expect(hadithRows).toHaveLength(1);
  });

  it('rejects a Hadith-only field (narrator) when the query is scoped to duas', async () => {
    const database = createContentDatabase();
    await expect(executeRecordQuery(d1(database), {
      id: 'qry_invalid_field', queryKind: 'record_query', objectName: 'duas',
      selectedFields: ['id'], filters: [{ field: 'narrator', operator: 'eq', source: 'literal', value: 'anyone' }],
      sort: { field: 'sequence', direction: 'asc' }, maxRows: 10,
    }, {})).rejects.toThrow('unsupported field');
  });
});

function createContentDatabase() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const directory = resolve(process.cwd(), 'migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(withNodeSqliteCompatibility(readFileSync(resolve(directory, name), 'utf8')));
  }
  return database;
}

// better-sqlite3 (unlike Node's experimental node:sqlite build the tools/ scripts target) supports
// FTS5 natively, so this compatibility rewrite isn't strictly required here -- kept anyway so this
// test builds its schema the same way apps/api/tools/verify-migrations.mjs does, and to avoid
// importing a .mjs tool script into a typechecked test file.
function withNodeSqliteCompatibility(sql: string) {
  return sql.replace(
    /CREATE VIRTUAL TABLE content_search_fts USING fts5\([\s\S]*?\n\);/,
    'CREATE TABLE content_search_fts (logical_id TEXT, dataset_id TEXT, content_type TEXT, collection_slug TEXT, title TEXT, body TEXT, narrator TEXT);',
  ).replace(
    /CREATE VIRTUAL TABLE canonical_search_fts USING fts5\([\s\S]*?\n\);/,
    'CREATE TABLE canonical_search_fts (canonical_id TEXT, revision_id TEXT, content_type TEXT, collection_slug TEXT, title TEXT, body TEXT, narrator TEXT);',
  );
}

function seedHadithRecord(database: Database.Database) {
  database.exec(`
    INSERT INTO collections (id, slug, content_type, title, default_language_code, verification_status)
      VALUES ('collection.query-test', 'test-hadith', 'hadith', 'Test Hadith Collection', 'en', 'verified');
    INSERT INTO books (id, collection_id, book_number, title, position)
      VALUES ('book.query-test.1', 'collection.query-test', '1', 'Book of Testing', 1);

    -- content_revisions.record_id still references the legacy content_records identity backbone
    -- (see docs/project-overview.md's "Legacy tables still present" note) -- dataset.fortress.editorial.manual
    -- is the real migration-provisioned dataset_versions row for exactly this kind of manually-created record.
    INSERT INTO content_records (id, dataset_id, content_type, sequence, title, verification_status, created_at, updated_at)
      VALUES ('record.hadith.query-test.1', 'dataset.fortress.editorial.manual', 'hadith', 1, 'Intentions are the foundation of actions', 'verified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    INSERT INTO canonical_records (canonical_id, content_type, current_revision_id)
      VALUES ('hadith.query-test.1', 'hadith', 'revision.hadith.query-test.1.1');
    INSERT INTO content_revisions (id, canonical_id, record_id, revision_number, sequence, title, created_by_external_id)
      VALUES ('revision.hadith.query-test.1.1', 'hadith.query-test.1', 'record.hadith.query-test.1', 1, 1, 'Intentions are the foundation of actions', 'system');
    INSERT INTO revision_metadata (revision_id, collection_id, book_id, narrator, grade)
      VALUES ('revision.hadith.query-test.1.1', 'collection.query-test', 'book.query-test.1', 'Query test narrator', 'Sahih');
    INSERT INTO editorial_record_state (canonical_id, revision_id, workflow_state, verified_by_external_id, verified_at)
      VALUES ('hadith.query-test.1', 'revision.hadith.query-test.1.1', 'published', 'system', CURRENT_TIMESTAMP);
  `);
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
