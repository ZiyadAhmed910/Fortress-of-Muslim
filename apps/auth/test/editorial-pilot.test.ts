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
    expect(scalar(content, `SELECT COUNT(*) FROM field_reviews
      WHERE revision_id = (SELECT revision_id FROM editorial_record_state WHERE canonical_id = '${canonicalId}')
        AND reviewer_external_id = '${users.reviewer.user.id}' AND decision = 'verified'`)).toBe(13);

    const duplicate = await post(users.reviewer, `/v1/admin/editorial/records/${canonicalId}/decision`, {
      decision: 'approved',
    }, 409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe('conflict');
  });

  it('an overall approval fills in unreviewed fields but never overwrites a field this reviewer already reviewed individually', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = { CONTENT_DB: d1(content), IDENTITY_DB: d1(identity) } as never;
    const editor = context(env, 'field-editor', 'editor');
    const reviewer = context(env, 'field-reviewer', 'reviewer');
    seedIdentity(identity, [editor, reviewer]);

    const canonicalId = 'dua.hisn.002';
    content.prepare(`
      UPDATE editorial_record_state
      SET workflow_state = 'pending_review', verified_by_external_id = NULL, verified_at = NULL
      WHERE canonical_id = ?
    `).run(canonicalId);
    await post(editor, `/v1/admin/editorial/records/${canonicalId}/references`, {
      referenceType: 'primary',
      locator: 'Hisn al-Muslim 2',
    }, 201);

    await post(reviewer, `/v1/admin/editorial/records/${canonicalId}/field-reviews`, {
      reviews: [{ field: 'arabic', decision: 'correction_required', notes: 'Missing a diacritic.' }],
    }, 201);

    await post(reviewer, `/v1/admin/editorial/records/${canonicalId}/decision`, { decision: 'approved' });

    const revisionId = content.prepare(
      'SELECT revision_id FROM editorial_record_state WHERE canonical_id = ?',
    ).pluck().get(canonicalId) as string;
    expect(scalar(content, `SELECT COUNT(*) FROM field_reviews
      WHERE revision_id = '${revisionId}' AND reviewer_external_id = '${reviewer.user.id}'`)).toBe(13);
    expect(String(content.prepare(`SELECT decision FROM field_reviews
      WHERE revision_id = ? AND field_name = 'arabic' AND reviewer_external_id = ?`)
      .pluck().get(revisionId, reviewer.user.id))).toBe('correction_required');
    expect(String(content.prepare(`SELECT decision FROM field_reviews
      WHERE revision_id = ? AND field_name = 'translation' AND reviewer_external_id = ?`)
      .pluck().get(revisionId, reviewer.user.id))).toBe('verified');
  });

  it('suggests keyword-matched taxonomy terms and lets an editor confirm the assignment', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = { CONTENT_DB: d1(content), IDENTITY_DB: d1(identity) } as never;
    const editor = context(env, 'taxonomy-editor', 'editor');
    seedIdentity(identity, [editor]);

    const canonicalId = 'dua.hisn.001'; // seeded title: "When waking up"
    const suggestion = await request(editor, 'GET', `/v1/admin/editorial/records/${canonicalId}/taxonomy`);
    const suggestionBody = (await suggestion.json()) as {
      data: { assigned: Array<{ slug: string }>; suggested: Array<{ id: string; slug: string }> };
    };
    expect(suggestionBody.data.assigned).toEqual([]);
    expect(suggestionBody.data.suggested.map((term) => term.slug)).toContain('morning');
    const morningTermId = suggestionBody.data.suggested.find((term) => term.slug === 'morning')!.id;

    const assign = await post(editor, `/v1/admin/editorial/records/${canonicalId}/taxonomy`, {
      termIds: [morningTermId],
    });
    expect(assign.status).toBe(200);
    expect(scalar(content, `SELECT COUNT(*) FROM record_taxonomy
      WHERE term_id = '${morningTermId}' AND assignment_source = 'editorial'`)).toBe(1);

    const after = await request(editor, 'GET', `/v1/admin/editorial/records/${canonicalId}/taxonomy`);
    const afterBody = (await after.json()) as {
      data: { assigned: Array<{ id: string; slug: string }>; suggested: Array<{ slug: string }> };
    };
    expect(afterBody.data.assigned.map((term) => term.slug)).toEqual(['morning']);
    expect(afterBody.data.suggested.some((term) => term.slug === 'morning')).toBe(false);

    const cleared = await post(editor, `/v1/admin/editorial/records/${canonicalId}/taxonomy`, { termIds: [] });
    expect(cleared.status).toBe(200);
    expect(scalar(content, `SELECT COUNT(*) FROM record_taxonomy WHERE term_id = '${morningTermId}'`)).toBe(0);
  });

  it('records a correction_history row for each segment that actually changed, keyed to the stable record id', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = { CONTENT_DB: d1(content), IDENTITY_DB: d1(identity) } as never;
    const editor = context(env, 'correction-editor', 'editor');
    seedIdentity(identity, [editor]);

    const canonicalId = 'dua.hisn.001';
    const before = await request(editor, 'GET', `/v1/admin/editorial/records/${canonicalId}`);
    const beforeBody = (await before.json()) as {
      data: { segments: Array<{ partPosition: number; segmentPosition: number; kind: string; text: string }> };
    };
    // getRecord's response exposes the revision id, not the stable content_records.id that
    // correction_history keys on (the same identity backbone record_taxonomy uses) -- read it
    // straight from the fixture the way the taxonomy test above does for the same reason.
    const recordId = content.prepare(`
      SELECT revision.record_id FROM canonical_records canonical
      JOIN content_revisions revision ON revision.id = canonical.current_revision_id
      WHERE canonical.canonical_id = ?
    `).pluck().get(canonicalId) as string;
    const firstSegment = beforeBody.data.segments[0]!;
    const untouchedSegment = beforeBody.data.segments[1];

    await post(editor, `/v1/admin/editorial/records/${canonicalId}/revisions`, {
      reason: 'Fixing a transliteration typo in the first segment.',
      segments: [{ partPosition: firstSegment.partPosition, segmentPosition: firstSegment.segmentPosition, text: 'A corrected reading.' }],
    }, 201);

    expect(scalar(content, `SELECT COUNT(*) FROM correction_history WHERE record_id = '${recordId}'`)).toBe(1);
    const row = content.prepare(
      'SELECT field_path AS fieldPath, reason, previous_hash AS previousHash, replacement_hash AS replacementHash, changed_by_external_id AS changedBy FROM correction_history WHERE record_id = ?',
    ).get(recordId) as { fieldPath: string; reason: string; previousHash: string; replacementHash: string; changedBy: string };
    expect(row.fieldPath).toBe(`part.${firstSegment.partPosition}.segment.${firstSegment.segmentPosition}.${firstSegment.kind}`);
    expect(row.reason).toBe('Fixing a transliteration typo in the first segment.');
    expect(row.changedBy).toBe(editor.user.id);
    expect(row.previousHash).not.toBe(row.replacementHash);

    // Submitting the same (unchanged) text for a second segment must not create a correction row --
    // only fields whose value actually differs from what was already there count as a correction.
    if (untouchedSegment) {
      const noopEditor = context(env, 'correction-editor-2', 'editor');
      identity.prepare('INSERT INTO "user" (id, name, email, is_admin) VALUES (?, ?, ?, 0)').run(noopEditor.user.id, 'noop', 'noop@example.test');
      identity.prepare('INSERT INTO platform_role_grants (user_id, role, status) VALUES (?, ?, ?)').run(noopEditor.user.id, 'editor', 'active');
      await post(noopEditor, `/v1/admin/editorial/records/${canonicalId}/revisions`, {
        reason: 'No actual change, just re-saving.',
        segments: [{ partPosition: untouchedSegment.partPosition, segmentPosition: untouchedSegment.segmentPosition, text: untouchedSegment.text }],
      }, 201);
      expect(scalar(content, `SELECT COUNT(*) FROM correction_history WHERE record_id = '${recordId}'`)).toBe(1);
    }
  });

  it('notifies a reviewer when assigned, and a record creator when changes are requested', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = { CONTENT_DB: d1(content), IDENTITY_DB: d1(identity) } as never;
    const editor = context(env, 'notify-editor', 'editor');
    const reviewer = context(env, 'notify-reviewer', 'reviewer');
    seedIdentity(identity, [editor, reviewer]);
    // The seeded Hisn dataset ships already verified/published -- reopen this one record so it's
    // an eligible ("open") assignment target, same as the first test in this file does.
    content.prepare(`
      UPDATE editorial_record_state
      SET workflow_state = 'pending_review', verified_by_external_id = NULL, verified_at = NULL
      WHERE canonical_id = 'dua.hisn.001'
    `).run();

    const assign = await post(editor, '/v1/admin/editorial/assignments', {
      scopeType: 'record',
      assignedTo: reviewer.user.id,
      canonicalId: 'dua.hisn.001',
    }, 201);
    expect(((await assign.json()) as { data: { matchedRecords: number } }).data.matchedRecords).toBe(1);

    const reviewerNotifications = await request(reviewer, 'GET', '/v1/admin/editorial/notifications');
    const reviewerBody = (await reviewerNotifications.json()) as {
      data: { unreadCount: number; notifications: Array<{ id: string; notificationType: string; message: string; readAt: string | null }> };
    };
    expect(reviewerBody.data.unreadCount).toBe(1);
    expect(reviewerBody.data.notifications[0]).toMatchObject({ notificationType: 'assignment_created', readAt: null });
    const notificationId = reviewerBody.data.notifications[0]!.id;

    // The editor created the record (dua.hisn.001's seeded revision has no created_by_external_id,
    // so use a freshly created record where the editor is the real creator).
    const created = await post(editor, '/v1/admin/editorial/records', {
      contentType: 'dua', title: 'Test dua for notification', collectionId: 'collection.hisn.legacy',
      referenceType: 'primary', referenceLocator: 'Test 1',
      parts: [{ segments: [{ kind: 'translation', text: 'Test translation.' }] }],
    }, 201);
    const newCanonicalId = ((await created.json()) as { data: { canonicalId: string } }).data.canonicalId;
    await post(editor, `/v1/admin/editorial/records/${newCanonicalId}/references`, {
      referenceType: 'primary', locator: 'Test ref',
    }, 201);
    await post(reviewer, `/v1/admin/editorial/records/${newCanonicalId}/decision`, {
      decision: 'changes_requested', notes: 'Please fix the translation wording.',
    });

    const editorNotifications = await request(editor, 'GET', '/v1/admin/editorial/notifications');
    const editorBody = (await editorNotifications.json()) as {
      data: { unreadCount: number; notifications: Array<{ notificationType: string; message: string; targetId: string }> };
    };
    expect(editorBody.data.unreadCount).toBe(1);
    expect(editorBody.data.notifications[0]).toMatchObject({ notificationType: 'changes_requested', targetId: newCanonicalId });
    expect(editorBody.data.notifications[0]!.message).toContain('Please fix the translation wording.');

    // Reading one notification clears only that one; read-all clears the rest.
    await post(reviewer, `/v1/admin/editorial/notifications/${notificationId}/read`, {});
    const afterRead = (await (await request(reviewer, 'GET', '/v1/admin/editorial/notifications')).json()) as { data: { unreadCount: number } };
    expect(afterRead.data.unreadCount).toBe(0);

    await post(editor, '/v1/admin/editorial/notifications/read-all', {});
    const afterReadAll = (await (await request(editor, 'GET', '/v1/admin/editorial/notifications')).json()) as { data: { unreadCount: number } };
    expect(afterReadAll.data.unreadCount).toBe(0);
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
    expect(scalar(content, `SELECT COUNT(*) FROM field_reviews
      WHERE revision_id = (SELECT revision_id FROM editorial_record_state WHERE canonical_id = '${canonicalId}')
        AND reviewer_external_id = '${reviewer.user.id}' AND decision = 'verified'`)).toBe(13);
  });

  // Search normalization (see normalizeArabicSql in editorial-plane.ts) strips Arabic tashkeel and
  // folds alef-hamza variants before writing canonical_search_fts, because SQLite FTS5's
  // remove_diacritics tokenizer option does not cover Arabic combining marks -- verified empirically
  // against a real FTS5 table before this fix (a diacritic-free query does not match diacritic-bearing
  // stored text). This proves the real decideBook publish path leaves canonical_search_fts normalized,
  // not just the isolated normalizeArabicSql/normalizeArabicJs functions in a unit test.
  it('normalizes Arabic diacritics and alef-hamza variants when publishing a verified book into canonical_search_fts', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = { CONTENT_DB: d1(content), IDENTITY_DB: d1(identity) } as never;
    const editor = context(env, 'arabic-book-editor', 'editor');
    const reviewer = context(env, 'arabic-book-reviewer', 'reviewer');
    seedIdentity(identity, [editor, reviewer]);
    content.exec(`
      INSERT INTO collections (
        id, slug, content_type, title, default_language_code, verification_status
      ) VALUES ('collection.test.arabic', 'test-arabic', 'hadith', 'Test Arabic Hadith', 'en', 'pending');
      INSERT INTO books (
        id, collection_id, book_number, title, position
      ) VALUES ('book.test.arabic.1', 'collection.test.arabic', '1', 'Book of Testing', 1);
      INSERT INTO chapters (
        id, book_id, chapter_number, title, position
      ) VALUES ('chapter.test.arabic.1', 'book.test.arabic.1', '1', 'Chapter One', 1);
    `);

    const created = await post(editor, '/v1/admin/editorial/records', {
      contentType: 'hadith',
      title: 'Fasting is a shield',
      collectionId: 'collection.test.arabic',
      bookId: 'book.test.arabic.1',
      chapterId: 'chapter.test.arabic.1',
      displayNumber: '1',
      narrator: 'أَبُو هُرَيْرَة',
      grade: 'Sahih',
      referenceType: 'collection_number',
      referenceLocator: 'Test Arabic Hadith 1',
      parts: [{
        segments: [
          { kind: 'arabic', text: 'الصِّيَامُ جُنَّةٌ' },
          { kind: 'translation', text: 'Fasting is a shield.' },
        ],
      }],
    }, 201);
    const canonicalId = ((await created.json()) as { data: { canonicalId: string } }).data.canonicalId;

    await post(reviewer, '/v1/admin/editorial/books/book.test.arabic.1/decision', {
      decision: 'verified',
      notes: 'Verified against the test collection.',
    });

    const row = content.prepare(
      'SELECT body, narrator FROM canonical_search_fts WHERE canonical_id = ?',
    ).get(canonicalId) as { body: string; narrator: string };
    expect(row.body).toContain('الصيام جنة');
    expect(row.narrator).toBe('ابو هريرة');
    expect(row.body).not.toMatch(/\p{M}/u);
    expect(row.narrator).not.toMatch(/\p{M}/u);
    expect(row.narrator).not.toMatch(/[آأإٱ]/u);
    // canonical_search_fts is downgraded to a plain table by withNodeSqliteCompatibility in this
    // file's test harness (see below), so a real FTS5 MATCH query isn't exercised here -- that's
    // covered against a real FTS5 table in apps/api/test/arabic-search.test.ts via the actual
    // D1ContentRepository.searchForRag method this normalized data feeds.
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

  it('bulk reviews selected records and reports reviewer workload', async () => {
    const content = createContentDatabase();
    const identity = createIdentityDatabase();
    const env = { CONTENT_DB: d1(content), IDENTITY_DB: d1(identity) } as never;
    const editor = context(env, 'bulk-editor', 'editor');
    const reviewer = context(env, 'bulk-reviewer', 'reviewer');
    seedIdentity(identity, [editor, reviewer]);
    const canonicalIds: string[] = [];
    for (const sequence of [1, 2]) {
      const created = await post(editor, '/v1/admin/editorial/records', {
        contentType: 'dua',
        title: `Bulk review test ${sequence}`,
        collectionId: 'collection.hisn.legacy',
        referenceType: 'book_locator',
        referenceLocator: `Bulk test reference ${sequence}`,
        parts: [{ segments: [{ kind: 'translation', text: `Test translation ${sequence}` }] }],
      }, 201);
      canonicalIds.push(((await created.json()) as { data: { canonicalId: string } }).data.canonicalId);
    }
    content.prepare(`
      UPDATE editorial_record_state SET assigned_to_external_id = ?
      WHERE canonical_id IN (?, ?)
    `).run(reviewer.user.id, ...canonicalIds);
    content.prepare(`
      INSERT INTO editorial_assignments (
        id, scope_type, canonical_id, assigned_to_external_id, assigned_by_external_id
      ) VALUES ('assignment.bulk.active', 'record', ?, ?, ?)
    `).run(canonicalIds[0], reviewer.user.id, editor.user.id);
    content.prepare(`
      INSERT INTO editorial_assignments (
        id, scope_type, canonical_id, assigned_to_external_id, assigned_by_external_id,
        status, completed_at
      ) VALUES ('assignment.bulk.complete', 'record', ?, ?, ?,
        'completed', CURRENT_TIMESTAMP)
    `).run(canonicalIds[1], reviewer.user.id, editor.user.id);

    const bulk = await post(reviewer, '/v1/admin/editorial/records/bulk-decision', {
      canonicalIds,
      decision: 'approved',
    });
    expect((await bulk.json()) as { data: unknown }).toMatchObject({
      data: { requested: 2, succeeded: 2, failed: 0, decision: 'approved' },
    });
    expect(Number(content.prepare(`SELECT COUNT(*) FROM editorial_record_state
      WHERE canonical_id IN (?, ?) AND workflow_state = 'approved'
        AND verified_by_external_id = ?`).pluck().get(...canonicalIds, reviewer.user.id))).toBe(2);

    const workload = await request(reviewer, 'GET', '/v1/admin/editorial/workload');
    const workloadBody = await workload.json() as {
      data: Array<{
        reviewerId: string;
        activeAssignments: number;
        completedAssignments: number;
        decisionsLast30Days: number;
      }>;
    };
    expect(workloadBody.data.find((row) => row.reviewerId === reviewer.user.id)).toMatchObject({
      activeAssignments: 1,
      completedAssignments: 1,
      decisionsLast30Days: 2,
    });
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
    CREATE TABLE webhook_subscriptions (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      event_types_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE webhook_deliveries (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      response_status INTEGER,
      response_snippet TEXT,
      attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  body: unknown = undefined,
  expectedStatus = 200,
) {
  const httpRequest = new Request(`https://auth-test.fortressofmuslim.org${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
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
