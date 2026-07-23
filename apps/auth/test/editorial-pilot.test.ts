import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleEditorialPlane, type EditorialRole } from '../src/editorial-plane';

describe('canonical editorial pilot', () => {
  it('rehearses the simple one-person verification flow', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = {
      CONTENT_DB: d1(content),
      IDENTITY_DB: d1(identity),
    } as never;
    const users = {
      editor: context(env, 'pilot-editor', 'editor'),
      reviewer: context(env, 'pilot-reviewer', 'reviewer'),
      admin: context(env, 'pilot-admin', 'admin'),
      target: context(env, 'pilot-target', 'reviewer'),
    };
    seedIdentity(identity, Object.values(users));
    identity.prepare("UPDATE platform_role_grants SET role = 'developer' WHERE user_id = ?").run(users.target.user.id);

    await request(users.editor, 'PATCH', '/v1/admin/editorial/roles', {
      userId: users.target.user.id,
      role: 'reviewer',
      status: 'active',
    });
    expect(String(identity.prepare('SELECT role FROM platform_role_grants WHERE user_id = ?').pluck().get(users.target.user.id))).toBe('reviewer');
    await request(users.editor, 'PATCH', '/v1/admin/editorial/roles', {
      userId: users.target.user.id,
      role: 'admin',
      status: 'active',
    }, 400);

    const canonicalId = 'dua.hisn.001';
    content.prepare(`
      UPDATE editorial_record_state
      SET workflow_state = 'pending_review', verified_by_external_id = NULL, verified_at = NULL
      WHERE canonical_id = ?
    `).run(canonicalId);
    const referenceResponse = await post(users.editor, `/v1/admin/editorial/records/${canonicalId}/references`, {
      referenceType: 'primary',
      locator: 'Hisn al-Muslim 1',
    }, 201);
    const referenceId = ((await referenceResponse.json()) as { data: { id: string } }).data.id;

    const verification = await post(users.reviewer, `/v1/admin/editorial/records/${canonicalId}/decision`, {
      decision: 'approved',
    });
    expect(((await verification.json()) as { data: unknown }).data).toMatchObject({
      workflowState: 'approved',
      verifiedBy: users.reviewer.user.id,
    });
    expect(scalar(content, `SELECT COUNT(*) FROM review_decisions
      WHERE revision_id = (SELECT revision_id FROM editorial_record_state WHERE canonical_id = '${canonicalId}')
        AND reviewer_external_id = '${users.reviewer.user.id}' AND decision = 'approved'`)).toBe(1);
    expect(scalar(content, `SELECT COUNT(*) FROM canonical_references WHERE id = '${referenceId}' AND verification_status = 'verified'`)).toBe(1);
    expect(String(content.prepare(`SELECT verified_by_external_id FROM editorial_record_state WHERE canonical_id = ?`).pluck().get(canonicalId))).toBe(users.reviewer.user.id);

    const duplicate = await post(users.reviewer, `/v1/admin/editorial/records/${canonicalId}/decision`, {
      decision: 'approved',
    }, 409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe('conflict');
  });

  it('creates a Hadith record and verifies its complete book into the RAG corpus', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = { CONTENT_DB: d1(content), IDENTITY_DB: d1(identity) } as never;
    const editor = context(env, 'book-editor', 'editor');
    const reviewer = context(env, 'book-reviewer', 'reviewer');
    seedIdentity(identity, [editor, reviewer]);
    content.exec(`
      INSERT INTO collections (
        id, slug, content_type, title, default_language_code, verification_status
      ) VALUES ('collection.test.hadith', 'test-hadith', 'hadith', 'Test Hadith', 'en', 'pending');
      INSERT INTO books (
        id, collection_id, book_number, title, position
      ) VALUES ('book.test.hadith.1', 'collection.test.hadith', '1', 'Book of Testing', 1);
      INSERT INTO chapters (
        id, book_id, chapter_number, title, position
      ) VALUES ('chapter.test.hadith.1', 'book.test.hadith.1', '1', 'Chapter One', 1);
    `);

    const created = await post(editor, '/v1/admin/editorial/records', {
      contentType: 'hadith',
      title: 'Intentions are the foundation of actions',
      collectionId: 'collection.test.hadith',
      bookId: 'book.test.hadith.1',
      chapterId: 'chapter.test.hadith.1',
      displayNumber: '1',
      narrator: 'Test narrator',
      grade: 'Sahih',
      referenceType: 'collection_number',
      referenceLocator: 'Test Hadith 1',
      parts: [{
        segments: [
          { kind: 'arabic', text: 'Test Arabic text' },
          { kind: 'translation', text: 'Actions are judged by intentions.' },
        ],
      }],
    }, 201);
    const canonicalId = ((await created.json()) as { data: { canonicalId: string } }).data.canonicalId;
    expect(canonicalId).toMatch(/^hadith\.fortress\./);
    expect(scalar(content, `SELECT COUNT(*) FROM editorial_record_state
      WHERE canonical_id = '${canonicalId}' AND workflow_state = 'pending_review'`)).toBe(1);

    const verified = await post(reviewer, '/v1/admin/editorial/books/book.test.hadith.1/decision', {
      decision: 'verified',
      notes: 'Verified against the test collection.',
    });
    const result = (await verified.json()) as {
      data: { recordCount: number; datasetId: string; ragStatus: string };
    };
    expect(result.data).toMatchObject({ recordCount: 1, ragStatus: 'pending' });
    expect(scalar(content, `SELECT COUNT(*) FROM editorial_record_state
      WHERE canonical_id = '${canonicalId}' AND workflow_state = 'published'
        AND verified_by_external_id = '${reviewer.user.id}'`)).toBe(1);
    expect(scalar(content, `SELECT COUNT(*) FROM canonical_dataset_items
      WHERE dataset_version_id = '${result.data.datasetId}'`)).toBe(136);
    expect(scalar(content, `SELECT COUNT(*) FROM rag_index_state
      WHERE dataset_version_id = '${result.data.datasetId}' AND status = 'pending'`)).toBe(1);
    expect(String(content.prepare(
      "SELECT editorial_status FROM books WHERE id = 'book.test.hadith.1'",
    ).pluck().get())).toBe('verified');
  });

  it('lets a reviewer complete their own assignment and lets an editor cancel work', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = { CONTENT_DB: d1(content), IDENTITY_DB: d1(identity) } as never;
    const editor = context(env, 'assignment-editor', 'editor');
    const reviewer = context(env, 'assignment-reviewer', 'reviewer');
    seedIdentity(identity, [editor, reviewer]);
    content.prepare(`
      INSERT INTO editorial_assignments (
        id, scope_type, canonical_id, assigned_to_external_id, assigned_by_external_id
      ) VALUES (?, 'record', 'dua.hisn.001', ?, ?)
    `).run('assignment.complete', reviewer.user.id, editor.user.id);
    content.prepare(`
      INSERT INTO editorial_assignments (
        id, scope_type, canonical_id, assigned_to_external_id, assigned_by_external_id
      ) VALUES (?, 'record', 'dua.hisn.002', ?, ?)
    `).run('assignment.cancel', reviewer.user.id, editor.user.id);

    await post(reviewer, '/v1/admin/editorial/assignments/assignment.complete/status', {
      status: 'completed',
    });
    await post(editor, '/v1/admin/editorial/assignments/assignment.cancel/status', {
      status: 'cancelled',
    });

    expect(String(content.prepare(
      "SELECT status FROM editorial_assignments WHERE id = 'assignment.complete'",
    ).pluck().get())).toBe('completed');
    expect(String(content.prepare(
      "SELECT status FROM editorial_assignments WHERE id = 'assignment.cancel'",
    ).pluck().get())).toBe('cancelled');
    expect(scalar(content, "SELECT COUNT(*) FROM content_audit_events WHERE target_type = 'assignment'")).toBe(2);
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
      email TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE platform_role_grants (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      granted_by TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_type TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      request_id TEXT,
      details TEXT
    );
  `);
  return database;
}

function seedIdentity(database: Database.Database, contexts: ReturnType<typeof context>[]) {
  const insertUser = database.prepare('INSERT INTO "user" (id, name, email, is_admin) VALUES (?, ?, ?, ?)');
  const insertRole = database.prepare('INSERT INTO platform_role_grants (user_id, role, status) VALUES (?, ?, ?)');
  for (const item of contexts) {
    insertUser.run(item.user.id, item.user.name, item.user.email, item.role === 'admin' ? 1 : 0);
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
  return request(editorialContext, 'POST', path, body, expectedStatus);
}

async function request(
  editorialContext: ReturnType<typeof context>,
  method: string,
  path: string,
  body: unknown,
  expectedStatus = 200,
) {
  const httpRequest = new Request(`https://auth-test.fortressofmuslim.org${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await handleEditorialPlane(httpRequest, new URL(httpRequest.url), editorialContext);
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
