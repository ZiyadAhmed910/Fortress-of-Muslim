import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleEditorialPlane, type EditorialRole } from '../src/editorial-plane';

const reviewFields = [
  'arabic', 'translation', 'transliteration', 'narrator', 'collection',
  'book', 'chapter', 'number', 'references', 'grades', 'formatting',
  'completeness', 'duplicate_detection',
];

describe('canonical editorial pilot', () => {
  it('rehearses assignment, separated review, publication, and rollback', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = {
      CONTENT_DB: d1(content),
      IDENTITY_DB: d1(identity),
    } as never;
    const users = {
      editor: context(env, 'pilot-editor', 'editor'),
      reviewerA: context(env, 'pilot-reviewer-a', 'reviewer'),
      reviewerB: context(env, 'pilot-reviewer-b', 'reviewer'),
      unassigned: context(env, 'pilot-reviewer-unassigned', 'reviewer'),
      senior: context(env, 'pilot-senior', 'senior_reviewer'),
      publisher: context(env, 'pilot-publisher', 'publisher'),
    };
    seedIdentity(identity, Object.values(users));

    const canonicalId = 'dua.hisn.001';
    await post(users.editor, '/v1/admin/editorial/assignments', {
      scopeType: 'record', assignedTo: users.reviewerA.user.id, canonicalId,
    }, 201);
    await post(users.editor, '/v1/admin/editorial/assignments', {
      scopeType: 'record', assignedTo: users.reviewerB.user.id, canonicalId,
    }, 201);

    const denied = await post(users.unassigned, `/v1/admin/editorial/records/${canonicalId}/field-reviews`, {
      reviews: reviewFields.map((field) => ({ field, decision: 'verified' })),
    }, 403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('forbidden');

    const referenceResponse = await post(users.editor, `/v1/admin/editorial/records/${canonicalId}/references`, {
      referenceType: 'primary',
      locator: 'Hisn al-Muslim 1',
    }, 201);
    const referenceId = ((await referenceResponse.json()) as { data: { id: string } }).data.id;
    await post(users.senior, `/v1/admin/editorial/records/${canonicalId}/references/${referenceId}/review`, {
      decision: 'verified',
    });

    for (const reviewer of [users.reviewerA, users.reviewerB]) {
      await post(reviewer, `/v1/admin/editorial/records/${canonicalId}/field-reviews`, {
        reviews: reviewFields.map((field) => ({ field, decision: 'verified' })),
      }, 201);
      await post(reviewer, `/v1/admin/editorial/records/${canonicalId}/decision`, {
        stage: 'independent_review',
        decision: 'approved',
      });
    }
    await post(users.senior, `/v1/admin/editorial/records/${canonicalId}/decision`, {
      stage: 'senior_approval',
      decision: 'approved',
    });

    const batchResponse = await post(users.editor, '/v1/admin/editorial/batches', {
      label: 'Automated editorial pilot',
    }, 201);
    const batchId = ((await batchResponse.json()) as { data: { id: string } }).data.id;
    await post(users.editor, `/v1/admin/editorial/batches/${batchId}/items`, {
      canonicalIds: [canonicalId],
    });
    const validation = await post(users.editor, `/v1/admin/editorial/batches/${batchId}/validate`, {});
    expect(((await validation.json()) as { data: unknown }).data).toMatchObject({ valid: true, itemCount: 1, invalidRecords: [] });
    await post(users.publisher, `/v1/admin/editorial/batches/${batchId}/approve`, {});
    const publication = await post(users.publisher, `/v1/admin/editorial/batches/${batchId}/publish`, {});
    const publicationData = ((await publication.json()) as { data: { datasetId: string; recordCount: number } }).data;

    expect(publicationData.recordCount).toBe(1);
    expect(scalar(content, "SELECT COUNT(*) FROM canonical_publications WHERE publication_status = 'published'")).toBe(1);
    expect(scalar(content, `SELECT COUNT(*) FROM canonical_dataset_items WHERE dataset_version_id = '${publicationData.datasetId}'`)).toBe(1);
    expect(scalar(content, "SELECT COUNT(*) FROM canonical_search_fts WHERE canonical_id = 'dua.hisn.001'")).toBe(1);

    const rollback = await post(
      users.publisher,
      '/v1/admin/editorial/datasets/canonical.bootstrap.2026-07-23/rollback',
      { reason: 'Complete the automated pilot by restoring the empty bootstrap snapshot.' },
    );
    const rollbackData = ((await rollback.json()) as { data: { recordCount: number } }).data;
    expect(rollbackData.recordCount).toBe(0);
    expect(scalar(content, "SELECT COUNT(*) FROM canonical_publications WHERE publication_status = 'published'")).toBe(0);
    expect(scalar(content, "SELECT COUNT(*) FROM canonical_search_fts")).toBe(0);
    expect(scalar(content, "SELECT COUNT(*) FROM canonical_dataset_versions WHERE publication_status = 'published' AND record_count = 0")).toBe(1);
    expect(scalar(content, "SELECT COUNT(*) FROM canonical_publication_history WHERE event_type = 'rolled_back'")).toBe(1);
  });
});

function createContentDatabase() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const directory = resolve(process.cwd(), '..', 'api', 'migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(withNodeSqliteCompatibility(readFileSync(resolve(directory, name), 'utf8')));
  }
  return database;
}

function createIdentityDatabase() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    );
    CREATE TABLE editorial_role_grants (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      granted_by TEXT
    );
  `);
  return database;
}

function seedIdentity(database: Database.Database, contexts: ReturnType<typeof context>[]) {
  const insertUser = database.prepare('INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)');
  const insertRole = database.prepare('INSERT INTO editorial_role_grants (user_id, role, status) VALUES (?, ?, ?)');
  for (const item of contexts) {
    insertUser.run(item.user.id, item.user.name, item.user.email);
    insertRole.run(item.user.id, item.role, 'active');
  }
}

function context(env: never, id: string, role: EditorialRole) {
  return {
    env,
    user: { id, name: id, email: `${id}@example.test` },
    role,
    requestId: `request-${id}`,
  };
}

async function post(
  editorialContext: ReturnType<typeof context>,
  path: string,
  body: unknown,
  expectedStatus = 200,
) {
  const request = new Request(`https://auth-test.fortressofmuslim.org${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await handleEditorialPlane(request, new URL(request.url), editorialContext);
  expect(response, path).not.toBeNull();
  expect(response!.status, `${path}: ${await response!.clone().text()}`).toBe(expectedStatus);
  return response!;
}

function d1(database: Database.Database) {
  return {
    prepare(sql: string) {
      return new D1Statement(database.prepare(sql));
    },
    async batch(statements: D1Statement[]) {
      return database.transaction(() => statements.map((statement) => statement.execute()))();
    },
  };
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
    return this.execute();
  }

  execute() {
    const result = this.statement.run(...this.parameters);
    return { success: true, meta: { changes: result.changes } };
  }
}

function scalar(database: Database.Database, sql: string) {
  return Number((database.prepare(sql).pluck().get() as number | bigint) ?? 0);
}

function withNodeSqliteCompatibility(sql: string) {
  return sql.replace(
    /CREATE VIRTUAL TABLE content_search_fts USING fts5\([\s\S]*?\n\);/,
    'CREATE TABLE content_search_fts (logical_id TEXT, dataset_id TEXT, content_type TEXT, collection_slug TEXT, title TEXT, body TEXT, narrator TEXT);',
  ).replace(
    /CREATE VIRTUAL TABLE canonical_search_fts USING fts5\([\s\S]*?\n\);/,
    'CREATE TABLE canonical_search_fts (canonical_id TEXT, revision_id TEXT, content_type TEXT, collection_slug TEXT, title TEXT, body TEXT, narrator TEXT);',
  );
}
