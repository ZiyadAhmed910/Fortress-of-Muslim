import type { Bindings } from './types';

export type EditorialRole = 'admin' | 'editor' | 'reviewer';

type EditorialContext = {
  env: Bindings;
  user: { id: string; name: string; email: string };
  role: EditorialRole;
  requestId: string;
};

const REVIEW_FIELDS = [
  'arabic', 'translation', 'transliteration', 'narrator', 'collection',
  'book', 'chapter', 'number', 'references', 'grades', 'formatting',
  'completeness', 'duplicate_detection',
] as const;

export async function handleEditorialPlane(
  request: Request,
  url: URL,
  context: EditorialContext,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/v1/admin/editorial')) return null;

  if (url.pathname === '/v1/admin/editorial/overview' && request.method === 'GET') {
    return overview(context);
  }
  if (url.pathname === '/v1/admin/editorial/queue' && request.method === 'GET') {
    return queue(context, url);
  }
  if (url.pathname === '/v1/admin/editorial/lookups' && request.method === 'GET') {
    return lookups(context);
  }
  if (url.pathname === '/v1/admin/editorial/records' && request.method === 'POST') {
    requireRole(context.role, ['editor', 'admin']);
    return createRecord(context, await readJson(request));
  }
  if (url.pathname === '/v1/admin/editorial/books' && request.method === 'GET') {
    return listBooks(context, url);
  }
  if (url.pathname === '/v1/admin/editorial/assignments' && request.method === 'GET') {
    return listAssignments(context);
  }
  if (url.pathname === '/v1/admin/editorial/assignments' && request.method === 'POST') {
    requireRole(context.role, ['editor', 'admin']);
    return createAssignment(context, await readJson(request));
  }
  if (url.pathname === '/v1/admin/editorial/batches' && request.method === 'GET') {
    return listBatches(context);
  }
  if (url.pathname === '/v1/admin/editorial/batches' && request.method === 'POST') {
    requireRole(context.role, ['editor', 'admin']);
    return createBatch(context, await readJson(request));
  }
  if (url.pathname === '/v1/admin/editorial/roles' && request.method === 'GET') {
    requireRole(context.role, ['editor', 'admin']);
    return listRoles(context);
  }
  if (url.pathname === '/v1/admin/editorial/roles' && request.method === 'PATCH') {
    requireRole(context.role, ['editor', 'admin']);
    return updateRole(context, await readJson(request));
  }

  const bookDecisionMatch = url.pathname.match(/^\/v1\/admin\/editorial\/books\/([^/]+)\/decision$/);
  if (bookDecisionMatch && request.method === 'POST') {
    requireRole(context.role, ['reviewer', 'editor', 'admin']);
    return decideBook(
      context,
      decodeURIComponent(bookDecisionMatch[1]!),
      await readJson(request),
    );
  }

  const recordMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)$/);
  if (recordMatch && request.method === 'GET') {
    return getRecord(context, decodeURIComponent(recordMatch[1]!));
  }
  const recordDuplicatesMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/duplicates$/);
  if (recordDuplicatesMatch && request.method === 'GET') {
    return findDuplicateCandidates(context, decodeURIComponent(recordDuplicatesMatch[1]!));
  }
  const revisionDetailMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/revisions\/([^/]+)$/);
  if (revisionDetailMatch && request.method === 'GET') {
    return getRevision(
      context,
      decodeURIComponent(revisionDetailMatch[1]!),
      decodeURIComponent(revisionDetailMatch[2]!),
    );
  }
  const revisionMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/revisions$/);
  if (revisionMatch && request.method === 'POST') {
    requireRole(context.role, ['editor', 'admin']);
    return createRevision(context, decodeURIComponent(revisionMatch[1]!), await readJson(request));
  }
  const fieldsMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/field-reviews$/);
  if (fieldsMatch && request.method === 'POST') {
    requireRole(context.role, ['reviewer', 'editor', 'admin']);
    return submitFieldReviews(context, decodeURIComponent(fieldsMatch[1]!), await readJson(request));
  }
  const decisionMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/decision$/);
  if (decisionMatch && request.method === 'POST') {
    return submitDecision(context, decodeURIComponent(decisionMatch[1]!), await readJson(request));
  }
  const referencesMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/references$/);
  if (referencesMatch && request.method === 'POST') {
    requireRole(context.role, ['editor', 'admin']);
    return addCanonicalReference(context, decodeURIComponent(referencesMatch[1]!), await readJson(request));
  }
  const referenceReviewMatch = url.pathname.match(
    /^\/v1\/admin\/editorial\/records\/([^/]+)\/references\/([^/]+)\/review$/,
  );
  if (referenceReviewMatch && request.method === 'POST') {
    requireRole(context.role, ['reviewer', 'editor', 'admin']);
    return reviewCanonicalReference(
      context,
      decodeURIComponent(referenceReviewMatch[1]!),
      decodeURIComponent(referenceReviewMatch[2]!),
      await readJson(request),
    );
  }

  const batchItemMatch = url.pathname.match(/^\/v1\/admin\/editorial\/batches\/([^/]+)\/items$/);
  if (batchItemMatch && request.method === 'POST') {
    requireRole(context.role, ['editor', 'admin']);
    return addBatchItems(context, decodeURIComponent(batchItemMatch[1]!), await readJson(request));
  }
  if (batchItemMatch && request.method === 'DELETE') {
    requireRole(context.role, ['editor', 'admin']);
    return removeBatchItems(context, decodeURIComponent(batchItemMatch[1]!), await readJson(request));
  }
  const batchDetailMatch = url.pathname.match(/^\/v1\/admin\/editorial\/batches\/([^/]+)$/);
  if (batchDetailMatch && request.method === 'GET') {
    return getBatch(context, decodeURIComponent(batchDetailMatch[1]!));
  }
  const batchActionMatch = url.pathname.match(/^\/v1\/admin\/editorial\/batches\/([^/]+)\/(validate|approve|publish)$/);
  if (batchActionMatch && request.method === 'POST') {
    const id = decodeURIComponent(batchActionMatch[1]!);
    if (batchActionMatch[2] === 'validate') {
      requireRole(context.role, ['editor', 'admin']);
      return validateBatch(context, id);
    }
    requireRole(context.role, ['admin']);
    return batchActionMatch[2] === 'approve' ? approveBatch(context, id) : publishBatch(context, id);
  }
  if (url.pathname === '/v1/admin/editorial/datasets' && request.method === 'GET') {
    return listDatasets(context);
  }
  const rollbackMatch = url.pathname.match(/^\/v1\/admin\/editorial\/datasets\/([^/]+)\/rollback$/);
  if (rollbackMatch && request.method === 'POST') {
    requireRole(context.role, ['admin']);
    return rollbackDataset(context, decodeURIComponent(rollbackMatch[1]!), await readJson(request));
  }

  return json({ error: { code: 'not_found', message: 'Editorial route was not found.' } }, 404);
}

async function overview({ env }: EditorialContext) {
  const [states, assignments, batches, publishedToday, reviewers] = await Promise.all([
    env.CONTENT_DB.prepare(`
      SELECT CASE
        WHEN workflow_state IN ('approved', 'published') THEN 'verified'
        WHEN workflow_state = 'changes_requested' THEN 'changes_requested'
        ELSE 'pending_review'
      END AS state, COUNT(*) AS count
      FROM editorial_record_state GROUP BY state
    `).all(),
    count(env.CONTENT_DB, "SELECT COUNT(*) AS count FROM editorial_assignments WHERE status = 'active'"),
    count(env.CONTENT_DB, "SELECT COUNT(*) AS count FROM publication_batches WHERE status IN ('draft','validated','approved')"),
    count(env.CONTENT_DB, "SELECT COUNT(*) AS count FROM canonical_publication_history WHERE event_type = 'published' AND occurred_at >= datetime('now','start of day')"),
    env.CONTENT_DB.prepare(`
      SELECT reviewer_external_id AS reviewerId, COUNT(*) AS decisions
      FROM review_decisions GROUP BY reviewer_external_id ORDER BY decisions DESC LIMIT 20
    `).all(),
  ]);
  return json({
    data: {
      queues: Object.fromEntries(states.results.map((row) => [
        String((row as Record<string, unknown>).state),
        Number((row as Record<string, unknown>).count),
      ])),
      activeAssignments: assignments,
      publicationQueue: batches,
      publishedToday,
      reviewerProgress: reviewers.results,
    },
  });
}

async function queue({ env }: EditorialContext, url: URL) {
  const state = url.searchParams.get('state')?.trim() ?? '';
  const collection = url.searchParams.get('collection')?.trim() ?? '';
  const contentType = url.searchParams.get('contentType')?.trim() ?? '';
  const assignment = url.searchParams.get('assignment')?.trim() ?? '';
  const query = url.searchParams.get('q')?.trim().slice(0, 120) ?? '';
  const limit = Math.min(100, Math.max(10, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const like = `%${query}%`;
  const predicate = `
    (? = ''
      OR (? = 'verified' AND state.workflow_state IN ('approved', 'published'))
      OR (? = 'changes_requested' AND state.workflow_state = 'changes_requested')
      OR (? = 'pending_review' AND state.workflow_state NOT IN ('approved', 'published', 'changes_requested')))
    AND (? = '' OR collection.slug = ?)
    AND (? = '' OR canonical.content_type = ?)
    AND (? = '' OR (? = 'assigned' AND state.assigned_to_external_id IS NOT NULL)
      OR (? = 'unassigned' AND state.assigned_to_external_id IS NULL))
    AND (? = '' OR revision.title LIKE ? OR canonical.canonical_id LIKE ?)
  `;
  const values = [
    state, state, state, state, collection, collection, contentType, contentType,
    assignment, assignment, assignment, query, like, like,
  ];
  const [rows, total] = await Promise.all([
    env.CONTENT_DB.prepare(`
    SELECT canonical.canonical_id AS canonicalId, canonical.content_type AS contentType,
           revision.revision_number AS revisionNumber, revision.sequence, revision.title,
           CASE
             WHEN state.workflow_state IN ('approved', 'published') THEN 'verified'
             WHEN state.workflow_state = 'changes_requested' THEN 'changes_requested'
             ELSE 'pending_review'
           END AS workflowState, state.assigned_to_external_id AS assignedTo,
           state.verified_by_external_id AS verifiedBy, state.verified_at AS verifiedAt,
           collection.slug AS collection, book.book_number AS bookNumber,
           chapter.chapter_number AS chapterNumber, state.changed_at AS changedAt
    FROM editorial_record_state state
    JOIN canonical_records canonical ON canonical.canonical_id = state.canonical_id
    JOIN content_revisions revision ON revision.id = state.revision_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    LEFT JOIN collections collection ON collection.id = metadata.collection_id
    LEFT JOIN books book ON book.id = metadata.book_id
    LEFT JOIN chapters chapter ON chapter.id = metadata.chapter_id
    WHERE ${predicate}
    ORDER BY state.changed_at, revision.sequence
    LIMIT ? OFFSET ?
  `).bind(...values, limit, offset).all(),
    env.CONTENT_DB.prepare(`
      SELECT COUNT(*) AS count
      FROM editorial_record_state state
      JOIN canonical_records canonical ON canonical.canonical_id = state.canonical_id
      JOIN content_revisions revision ON revision.id = state.revision_id
      LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      LEFT JOIN collections collection ON collection.id = metadata.collection_id
      WHERE ${predicate}
    `).bind(...values).first<{ count: number }>(),
  ]);
  return json({
    data: rows.results,
    pagination: { offset, limit, total: Number(total?.count ?? 0), hasMore: offset + rows.results.length < Number(total?.count ?? 0) },
  });
}

async function lookups({ env }: EditorialContext) {
  const [reviewers, collections, books, chapters] = await Promise.all([
    env.IDENTITY_DB.prepare(`
      SELECT role.user_id AS id, user.name, user.email, role.role
      FROM platform_role_grants role
      JOIN "user" user ON user.id = role.user_id
      WHERE role.status = 'active'
        AND role.role IN ('reviewer','editor','admin')
      ORDER BY user.name, user.email
    `).all(),
    env.CONTENT_DB.prepare(`
      SELECT id, slug, title, content_type AS contentType
      FROM collections ORDER BY content_type, title
    `).all(),
    env.CONTENT_DB.prepare(`
      SELECT book.id, book.book_number AS number, book.title,
             collection.id AS collectionId, collection.title AS collectionTitle
      FROM books book JOIN collections collection ON collection.id = book.collection_id
      ORDER BY collection.title, book.position LIMIT 1000
    `).all(),
    env.CONTENT_DB.prepare(`
      SELECT chapter.id, chapter.chapter_number AS number, chapter.title,
             chapter.book_id AS bookId, book.title AS bookTitle
      FROM chapters chapter JOIN books book ON book.id = chapter.book_id
      ORDER BY book.position, chapter.position LIMIT 2000
    `).all(),
  ]);
  return json({
    data: {
      reviewers: reviewers.results,
      collections: collections.results,
      books: books.results,
      chapters: chapters.results,
    },
  });
}

async function listBooks({ env }: EditorialContext, url: URL) {
  const collection = optionalText(url.searchParams.get('collection'), 80);
  const status = optionalText(url.searchParams.get('status'), 40);
  const values: unknown[] = [];
  const predicates = ["collection.content_type = 'hadith'"];
  if (collection) {
    predicates.push('collection.slug = ?');
    values.push(collection);
  }
  if (status && ['pending_review', 'verified', 'changes_requested'].includes(status)) {
    predicates.push('book.editorial_status = ?');
    values.push(status);
  }
  const rows = await env.CONTENT_DB.prepare(`
    SELECT book.id, book.book_number AS number, book.title,
           collection.slug AS collection, collection.title AS collectionTitle,
           book.editorial_status AS editorialStatus,
           book.verified_by_external_id AS verifiedBy, book.verified_at AS verifiedAt,
           COUNT(canonical.canonical_id) AS recordCount,
           SUM(CASE WHEN state.verified_at IS NOT NULL
                     AND state.workflow_state IN ('approved', 'published') THEN 1 ELSE 0 END) AS verifiedCount,
           SUM(CASE WHEN state.workflow_state = 'changes_requested' THEN 1 ELSE 0 END) AS changesRequestedCount
    FROM books book
    JOIN collections collection ON collection.id = book.collection_id
    LEFT JOIN revision_metadata metadata ON metadata.book_id = book.id
    LEFT JOIN content_revisions revision ON revision.id = metadata.revision_id
    LEFT JOIN canonical_records canonical
      ON canonical.current_revision_id = revision.id AND canonical.content_type = 'hadith'
    LEFT JOIN editorial_record_state state ON state.canonical_id = canonical.canonical_id
    WHERE ${predicates.join(' AND ')}
    GROUP BY book.id
    ORDER BY collection.title, book.position
    LIMIT 1000
  `).bind(...values).all();
  return json({ data: rows.results });
}

async function createRecord(context: EditorialContext, body: Record<string, unknown>) {
  const contentType = String(body.contentType ?? '');
  const title = String(body.title ?? '').trim();
  const collectionId = optionalText(body.collectionId, 180);
  const bookId = optionalText(body.bookId, 180);
  const chapterId = optionalText(body.chapterId, 180);
  const referenceType = optionalText(body.referenceType, 80);
  const referenceLocator = optionalText(body.referenceLocator, 500);
  const parts = Array.isArray(body.parts) ? body.parts : [];
  if (!['dua', 'hadith'].includes(contentType)) return invalid('Choose Dua or Hadith content.');
  if (title.length < 2 || title.length > 300) return invalid('Title must contain between 2 and 300 characters.');
  if (!collectionId) return invalid('Choose a canonical collection.');
  if (!referenceType || !referenceLocator) return invalid('A canonical reference is required.');
  if (parts.length < 1 || parts.length > 8) return invalid('Add between 1 and 8 reading parts.');

  const collection = await context.env.CONTENT_DB.prepare(
    'SELECT content_type AS contentType FROM collections WHERE id = ?',
  ).bind(collectionId).first<{ contentType: string }>();
  if (!collection || collection.contentType !== contentType) {
    return invalid('The selected collection does not match the content type.');
  }
  if (contentType === 'hadith' && !bookId) return invalid('Choose a book for a Hadith record.');
  if (bookId) {
    const book = await context.env.CONTENT_DB.prepare(
      'SELECT collection_id AS collectionId FROM books WHERE id = ?',
    ).bind(bookId).first<{ collectionId: string }>();
    if (!book || book.collectionId !== collectionId) return invalid('The selected book does not belong to this collection.');
  }
  if (chapterId) {
    const chapter = await context.env.CONTENT_DB.prepare(
      'SELECT book_id AS bookId FROM chapters WHERE id = ?',
    ).bind(chapterId).first<{ bookId: string }>();
    if (!chapter || chapter.bookId !== bookId) return invalid('The selected chapter does not belong to this book.');
  }

  const normalizedParts: Array<Array<{ kind: string; text: string; languageCode: string; scriptCode: string }>> = [];
  for (const rawPart of parts) {
    if (!isObject(rawPart) || !Array.isArray(rawPart.segments)) return invalid('Every part must contain segments.');
    const segments = rawPart.segments.map((raw) => {
      if (!isObject(raw)) return null;
      const kind = String(raw.kind ?? '');
      const text = String(raw.text ?? '').trim();
      if (!['arabic', 'transliteration', 'translation', 'comment'].includes(kind) || !text || text.length > 20_000) return null;
      const languageCode = kind === 'arabic' ? 'ar' : kind === 'transliteration' ? 'ar-Latn' : 'en';
      return { kind, text, languageCode, scriptCode: kind === 'arabic' ? 'Arab' : 'Latn' };
    });
    if (segments.length < 1 || segments.some((segment) => !segment)) return invalid('Every segment needs a supported type and text.');
    normalizedParts.push(segments as Array<{ kind: string; text: string; languageCode: string; scriptCode: string }>);
  }

  const suffix = crypto.randomUUID();
  const canonicalId = `${contentType}.fortress.${suffix}`;
  const recordId = `record.${canonicalId}`;
  const revisionId = `revision.${canonicalId}.1`;
  const sequenceRow = await context.env.CONTENT_DB.prepare(`
    SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
    FROM content_records WHERE dataset_id = 'dataset.fortress.editorial.manual' AND content_type = ?
  `).bind(contentType).first<{ sequence: number }>();
  const sequence = Number(sequenceRow?.sequence ?? 1);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    context.env.CONTENT_DB.prepare(`
      INSERT INTO content_records (
        id, dataset_id, content_type, sequence, title, verification_status,
        created_at, updated_at, logical_id
      ) VALUES (?, 'dataset.fortress.editorial.manual', ?, ?, ?, 'pending', ?, ?, ?)
    `).bind(recordId, contentType, sequence, title, now, now, canonicalId),
    context.env.CONTENT_DB.prepare(`
      UPDATE dataset_versions SET record_count = record_count + 1
      WHERE id = 'dataset.fortress.editorial.manual'
    `),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_records (canonical_id, content_type, current_revision_id)
      VALUES (?, ?, ?)
    `).bind(canonicalId, contentType, revisionId),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO content_revisions (
        id, canonical_id, record_id, revision_number, sequence, title,
        created_by_external_id, correction_reason
      ) VALUES (?, ?, ?, 1, ?, ?, ?, 'Created in Fortress Admin.')
    `).bind(revisionId, canonicalId, recordId, sequence, title, context.user.id),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO revision_metadata (
        revision_id, collection_id, book_id, chapter_id, display_number,
        narrator, grade, grading_authority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      revisionId, collectionId, bookId, chapterId,
      optionalText(body.displayNumber, 120), optionalText(body.narrator, 1000),
      optionalText(body.grade, 160), optionalText(body.gradingAuthority, 300),
    ),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO record_placements (
        record_id, collection_id, book_id, chapter_id, source_number
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(recordId, collectionId, bookId, chapterId, optionalText(body.displayNumber, 120)),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO editorial_record_state (
        canonical_id, revision_id, workflow_state, changed_by_external_id
      ) VALUES (?, ?, 'pending_review', ?)
    `).bind(canonicalId, revisionId, context.user.id),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_references (
        id, canonical_id, revision_id, reference_type, locator,
        verification_status, created_by_external_id
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).bind(`reference.${canonicalId}.1`, canonicalId, revisionId, referenceType, referenceLocator, context.user.id),
  ];
  normalizedParts.forEach((segments, partIndex) => {
    const position = partIndex + 1;
    const legacyPartId = `${recordId}.part.${position}`;
    const revisionPartId = `${revisionId}.part.${position}`;
    statements.push(
      context.env.CONTENT_DB.prepare('INSERT INTO content_parts (id, record_id, position) VALUES (?, ?, ?)')
        .bind(legacyPartId, recordId, position),
      context.env.CONTENT_DB.prepare('INSERT INTO revision_parts (id, revision_id, position) VALUES (?, ?, ?)')
        .bind(revisionPartId, revisionId, position),
    );
    segments.forEach((segment, segmentIndex) => {
      const segmentPosition = segmentIndex + 1;
      statements.push(
        context.env.CONTENT_DB.prepare(`
          INSERT INTO content_segments (
            id, part_id, position, kind, language_code, script_code, text
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          `${legacyPartId}.segment.${segmentPosition}`, legacyPartId, segmentPosition,
          segment.kind, segment.languageCode, segment.scriptCode, segment.text,
        ),
        context.env.CONTENT_DB.prepare(`
          INSERT INTO revision_segments (
            id, revision_part_id, position, kind, language_code, script_code, text
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          `${revisionPartId}.segment.${segmentPosition}`, revisionPartId, segmentPosition,
          segment.kind, segment.languageCode, segment.scriptCode, segment.text,
        ),
      );
    });
  });
  statements.push(auditStatement(context, 'editorial.record_created', 'record', canonicalId, {
    contentType, collectionId, bookId, chapterId, partCount: normalizedParts.length,
  }));
  await context.env.CONTENT_DB.batch(statements);
  return json({ data: { canonicalId, revisionId, workflowState: 'pending_review' } }, 201);
}

async function decideBook(context: EditorialContext, bookId: string, body: Record<string, unknown>) {
  const decision = String(body.decision ?? '');
  if (!['verified', 'changes_requested'].includes(decision)) {
    return invalid('Choose verified or changes requested.');
  }
  const book = await context.env.CONTENT_DB.prepare(`
    SELECT book.id, book.title, book.editorial_status AS editorialStatus,
           collection.id AS collectionId, collection.title AS collectionTitle
    FROM books book JOIN collections collection ON collection.id = book.collection_id
    WHERE book.id = ? AND collection.content_type = 'hadith'
  `).bind(bookId).first<{
    id: string;
    title: string;
    editorialStatus: string;
    collectionId: string;
    collectionTitle: string;
  }>();
  if (!book) return notFound('Hadith book was not found.');
  if (book.editorialStatus === 'verified') return conflict('This book is already verified.');
  const recordCount = await count(context.env.CONTENT_DB, `
    SELECT COUNT(*) AS count
    FROM canonical_records canonical
    JOIN content_revisions revision ON revision.id = canonical.current_revision_id
    JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    WHERE canonical.content_type = 'hadith' AND metadata.book_id = '${sqlLiteral(bookId)}'
  `);
  if (recordCount === 0) return invalid('This book has no Hadith records to review.');
  const notes = optionalText(body.notes, 2000);
  const now = new Date().toISOString();

  if (decision === 'changes_requested') {
    await context.env.CONTENT_DB.batch([
      context.env.CONTENT_DB.prepare(`
        UPDATE books SET editorial_status = 'changes_requested', editorial_notes = ?
        WHERE id = ?
      `).bind(notes, bookId),
      context.env.CONTENT_DB.prepare(`
        UPDATE editorial_record_state
        SET workflow_state = 'changes_requested', verified_by_external_id = NULL,
            verified_at = NULL, changed_by_external_id = ?, changed_at = ?
        WHERE canonical_id IN (
          SELECT canonical.canonical_id
          FROM canonical_records canonical
          JOIN content_revisions revision ON revision.id = canonical.current_revision_id
          JOIN revision_metadata metadata ON metadata.revision_id = revision.id
          WHERE canonical.content_type = 'hadith' AND metadata.book_id = ?
        ) AND workflow_state NOT IN ('approved', 'published')
      `).bind(context.user.id, now, bookId),
      auditStatement(context, 'editorial.book_changes_requested', 'book', bookId, { recordCount, notes }),
    ]);
    return json({ data: { bookId, decision, recordCount } });
  }

  const missingReferences = await count(context.env.CONTENT_DB, `
    SELECT COUNT(*) AS count
    FROM canonical_records canonical
    JOIN content_revisions revision ON revision.id = canonical.current_revision_id
    JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    WHERE canonical.content_type = 'hadith' AND metadata.book_id = '${sqlLiteral(bookId)}'
      AND NOT EXISTS (
        SELECT 1 FROM canonical_references reference
        WHERE reference.revision_id = revision.id
          AND reference.verification_status != 'rejected'
      )
  `);
  if (missingReferences > 0) {
    return invalid(`${missingReferences} Hadith record${missingReferences === 1 ? '' : 's'} need a canonical reference before this book can be verified.`);
  }

  const datasetId = `canonical.verified.${Date.now()}.${crypto.randomUUID().slice(0, 8)}`;
  const historyPrefix = `publication-history.${datasetId}`;
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`
      INSERT OR IGNORE INTO review_decisions (
        id, revision_id, reviewer_external_id, review_stage, decision, notes, decided_at
      )
      SELECT 'review-decision.book.' || ? || '.' || canonical.canonical_id,
             revision.id, ?, 'independent_review', 'approved', ?, ?
      FROM canonical_records canonical
      JOIN content_revisions revision ON revision.id = canonical.current_revision_id
      JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      WHERE canonical.content_type = 'hadith' AND metadata.book_id = ?
    `).bind(datasetId, context.user.id, notes ?? `Verified ${book.collectionTitle}: ${book.title}`, now, bookId),
    context.env.CONTENT_DB.prepare(`
      UPDATE canonical_references
      SET verification_status = 'verified', verified_by_external_id = ?, verified_at = ?
      WHERE revision_id IN (
        SELECT revision.id
        FROM canonical_records canonical
        JOIN content_revisions revision ON revision.id = canonical.current_revision_id
        JOIN revision_metadata metadata ON metadata.revision_id = revision.id
        WHERE canonical.content_type = 'hadith' AND metadata.book_id = ?
      ) AND verification_status = 'pending'
    `).bind(context.user.id, now, bookId),
    context.env.CONTENT_DB.prepare(`
      UPDATE editorial_record_state
      SET workflow_state = 'published', verified_by_external_id = ?, verified_at = ?,
          changed_by_external_id = ?, changed_at = ?
      WHERE canonical_id IN (
        SELECT canonical.canonical_id
        FROM canonical_records canonical
        JOIN content_revisions revision ON revision.id = canonical.current_revision_id
        JOIN revision_metadata metadata ON metadata.revision_id = revision.id
        WHERE canonical.content_type = 'hadith' AND metadata.book_id = ?
      )
    `).bind(context.user.id, now, context.user.id, now, bookId),
    context.env.CONTENT_DB.prepare(`
      UPDATE books
      SET editorial_status = 'verified', verified_by_external_id = ?,
          verified_at = ?, editorial_notes = ?
      WHERE id = ?
    `).bind(context.user.id, now, notes, bookId),
    context.env.CONTENT_DB.prepare(`
      UPDATE collections
      SET verification_status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM books candidate
          WHERE candidate.collection_id = collections.id
            AND candidate.editorial_status != 'verified'
        ) THEN 'verified' ELSE verification_status END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(book.collectionId),
    context.env.CONTENT_DB.prepare(`
      UPDATE canonical_dataset_versions
      SET publication_status = 'superseded'
      WHERE publication_status = 'published'
    `),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_dataset_versions (
        id, version_label, publication_status, verification_status, record_count,
        canonical_hash, published_by_external_id, published_at
      )
      SELECT ?, ?, 'published', 'verified', COUNT(*), ?, ?, ?
      FROM editorial_record_state
      WHERE verified_at IS NOT NULL AND workflow_state IN ('approved', 'published')
    `).bind(
      datasetId, `Verified corpus ${now}`, `verified-corpus-${now}`,
      context.user.id, now,
    ),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_publications (
        canonical_id, revision_id, record_id, dataset_version_id, revision_number,
        publication_status, published_by_external_id, published_at
      )
      SELECT canonical.canonical_id, revision.id, revision.record_id, ?,
             revision.revision_number, 'published', ?, ?
      FROM canonical_records canonical
      JOIN content_revisions revision ON revision.id = canonical.current_revision_id
      JOIN editorial_record_state state ON state.canonical_id = canonical.canonical_id
      WHERE state.verified_at IS NOT NULL AND state.workflow_state IN ('approved', 'published')
      ON CONFLICT(canonical_id) DO UPDATE SET
        revision_id = excluded.revision_id,
        record_id = excluded.record_id,
        dataset_version_id = excluded.dataset_version_id,
        revision_number = excluded.revision_number,
        publication_status = 'published',
        published_by_external_id = excluded.published_by_external_id,
        published_at = excluded.published_at,
        superseded_at = NULL
    `).bind(datasetId, context.user.id, now),
    context.env.CONTENT_DB.prepare(`
      INSERT OR IGNORE INTO canonical_publication_history (
        id, canonical_id, revision_id, record_id, dataset_version_id,
        revision_number, event_type, actor_external_id, occurred_at
      )
      SELECT ? || '.' || canonical.canonical_id, canonical.canonical_id,
             revision.id, revision.record_id, ?, revision.revision_number,
             'published', ?, ?
      FROM canonical_records canonical
      JOIN content_revisions revision ON revision.id = canonical.current_revision_id
      JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      WHERE canonical.content_type = 'hadith' AND metadata.book_id = ?
    `).bind(historyPrefix, datasetId, context.user.id, now, bookId),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_dataset_items (dataset_version_id, canonical_id, revision_id)
      SELECT ?, canonical.canonical_id, revision.id
      FROM canonical_records canonical
      JOIN content_revisions revision ON revision.id = canonical.current_revision_id
      JOIN editorial_record_state state ON state.canonical_id = canonical.canonical_id
      WHERE state.verified_at IS NOT NULL AND state.workflow_state IN ('approved', 'published')
    `).bind(datasetId),
    context.env.CONTENT_DB.prepare('DELETE FROM canonical_search_fts'),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_search_fts (
        canonical_id, revision_id, content_type, collection_slug, title, body, narrator
      )
      SELECT canonical.canonical_id, revision.id, canonical.content_type,
             COALESCE(collection.slug, CASE WHEN canonical.content_type = 'dua' THEN 'hisn' ELSE 'unknown' END),
             revision.title, COALESCE(GROUP_CONCAT(segment.text, ' '), ''),
             COALESCE(metadata.narrator, '')
      FROM canonical_records canonical
      JOIN content_revisions revision ON revision.id = canonical.current_revision_id
      JOIN editorial_record_state state ON state.canonical_id = canonical.canonical_id
      LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      LEFT JOIN collections collection ON collection.id = metadata.collection_id
      LEFT JOIN revision_parts part ON part.revision_id = revision.id
      LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
      WHERE state.verified_at IS NOT NULL AND state.workflow_state IN ('approved', 'published')
      GROUP BY canonical.canonical_id, revision.id
    `),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO rag_index_state (
        dataset_version_id, expected_count, indexed_count, status, updated_at
      )
      SELECT ?, record_count, 0, CASE WHEN record_count = 0 THEN 'ready' ELSE 'pending' END, ?
      FROM canonical_dataset_versions WHERE id = ?
    `).bind(datasetId, now, datasetId),
    auditStatement(context, 'editorial.book_verified', 'book', bookId, {
      datasetId, recordCount, verifier: context.user.id, notes,
    }),
  ]);
  return json({ data: { bookId, decision, recordCount, datasetId, ragStatus: 'pending' } });
}

async function getRecord({ env }: EditorialContext, canonicalId: string) {
  const record = await env.CONTENT_DB.prepare(`
    SELECT canonical.canonical_id AS canonicalId, canonical.content_type AS contentType,
           revision.id AS revisionId, revision.revision_number AS revisionNumber,
           revision.sequence, revision.title, revision.legacy_id AS legacyId,
           revision.created_by_external_id AS revisionAuthor,
           revision.correction_reason AS correctionReason, revision.created_at AS revisionCreatedAt,
           state.workflow_state AS workflowState, state.assigned_to_external_id AS assignedTo,
           state.verified_by_external_id AS verifiedBy, state.verified_at AS verifiedAt,
           metadata.display_number AS displayNumber, metadata.narrator, metadata.grade,
           metadata.grading_authority AS gradingAuthority,
           collection.slug AS collection, collection.title AS collectionTitle,
           book.book_number AS bookNumber, book.title AS bookTitle,
           chapter.chapter_number AS chapterNumber, chapter.title AS chapterTitle
    FROM canonical_records canonical
    JOIN editorial_record_state state ON state.canonical_id = canonical.canonical_id
    JOIN content_revisions revision ON revision.id = state.revision_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    LEFT JOIN collections collection ON collection.id = metadata.collection_id
    LEFT JOIN books book ON book.id = metadata.book_id
    LEFT JOIN chapters chapter ON chapter.id = metadata.chapter_id
    WHERE canonical.canonical_id = ?
  `).bind(canonicalId).first<Record<string, unknown>>();
  if (!record) return notFound('Canonical record was not found.');
  const revisionId = String(record.revisionId);
  const [segments, fieldReviews, decisions, references, revisions] = await Promise.all([
    env.CONTENT_DB.prepare(`
      SELECT part.position AS partPosition, segment.position AS segmentPosition,
             segment.kind, segment.language_code AS languageCode, segment.text
      FROM revision_parts part
      JOIN revision_segments segment ON segment.revision_part_id = part.id
      WHERE part.revision_id = ? ORDER BY part.position, segment.position
    `).bind(revisionId).all(),
    env.CONTENT_DB.prepare(`
      SELECT field_name AS fieldName, reviewer_external_id AS reviewerId,
             decision, notes, reviewed_at AS reviewedAt
      FROM field_reviews WHERE revision_id = ? ORDER BY reviewed_at
    `).bind(revisionId).all(),
    env.CONTENT_DB.prepare(`
      SELECT reviewer_external_id AS reviewerId, review_stage AS reviewStage,
             decision, notes, decided_at AS decidedAt
      FROM review_decisions WHERE revision_id = ? ORDER BY decided_at
    `).bind(revisionId).all(),
    env.CONTENT_DB.prepare(`
      SELECT id, reference_type AS referenceType, locator, verification_status AS verificationStatus,
             created_by_external_id AS createdBy, verified_by_external_id AS verifiedBy,
             verified_at AS verifiedAt
      FROM canonical_references WHERE canonical_id = ? AND revision_id = ?
      ORDER BY reference_type, locator
    `).bind(canonicalId, revisionId).all(),
    env.CONTENT_DB.prepare(`
      SELECT id, revision_number AS revisionNumber, correction_reason AS correctionReason,
             created_by_external_id AS createdBy, created_at AS createdAt
      FROM content_revisions WHERE canonical_id = ? ORDER BY revision_number DESC
    `).bind(canonicalId).all(),
  ]);
  return json({
    data: {
      record,
      segments: segments.results,
      fieldReviews: fieldReviews.results,
      decisions: decisions.results,
      references: references.results,
      revisions: revisions.results,
      requiredFields: REVIEW_FIELDS,
    },
  });
}

async function getRevision({ env }: EditorialContext, canonicalId: string, revisionId: string) {
  const revision = await env.CONTENT_DB.prepare(`
    SELECT id, canonical_id AS canonicalId, revision_number AS revisionNumber,
           sequence, title, correction_reason AS correctionReason,
           created_by_external_id AS createdBy, created_at AS createdAt
    FROM content_revisions
    WHERE id = ? AND canonical_id = ?
  `).bind(revisionId, canonicalId).first<Record<string, unknown>>();
  if (!revision) return notFound('Revision was not found for this canonical record.');
  const segments = await env.CONTENT_DB.prepare(`
    SELECT part.position AS partPosition, segment.position AS segmentPosition,
           segment.kind, segment.language_code AS languageCode, segment.text
    FROM revision_parts part
    JOIN revision_segments segment ON segment.revision_part_id = part.id
    WHERE part.revision_id = ?
    ORDER BY part.position, segment.position
  `).bind(revisionId).all();
  return json({ data: { revision, segments: segments.results } });
}

async function findDuplicateCandidates({ env }: EditorialContext, canonicalId: string) {
  const current = await env.CONTENT_DB.prepare(`
    SELECT canonical.content_type AS contentType, revision.title,
           metadata.collection_id AS collectionId
    FROM editorial_record_state state
    JOIN canonical_records canonical ON canonical.canonical_id = state.canonical_id
    JOIN content_revisions revision ON revision.id = state.revision_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    WHERE state.canonical_id = ?
  `).bind(canonicalId).first<{ contentType: string; title: string; collectionId: string | null }>();
  if (!current) return notFound('Canonical record was not found.');
  const rows = await env.CONTENT_DB.prepare(`
    SELECT candidate.canonical_id AS canonicalId, revision.title, revision.sequence,
           state.workflow_state AS workflowState
    FROM editorial_record_state state
    JOIN canonical_records candidate ON candidate.canonical_id = state.canonical_id
    JOIN content_revisions revision ON revision.id = state.revision_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    WHERE candidate.canonical_id <> ?
      AND candidate.content_type = ?
      AND (? IS NULL OR metadata.collection_id = ?)
    ORDER BY ABS(revision.sequence - (
      SELECT current_revision.sequence
      FROM editorial_record_state current_state
      JOIN content_revisions current_revision ON current_revision.id = current_state.revision_id
      WHERE current_state.canonical_id = ?
    ))
    LIMIT 500
  `).bind(canonicalId, current.contentType, current.collectionId, current.collectionId, canonicalId).all<{
    canonicalId: string;
    title: string;
    sequence: number;
    workflowState: string;
  }>();
  const normalizedTitle = normalizeTitle(current.title);
  const candidates = rows.results
    .map((row) => ({ ...row, score: titleSimilarity(normalizedTitle, normalizeTitle(row.title)) }))
    .filter((row) => row.score >= 0.45)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map((row) => ({ ...row, score: Number(row.score.toFixed(3)) }));
  return json({ data: candidates });
}

async function addCanonicalReference(
  context: EditorialContext,
  canonicalId: string,
  body: Record<string, unknown>,
) {
  const referenceType = String(body.referenceType ?? '').trim().slice(0, 80);
  const locator = String(body.locator ?? '').trim().slice(0, 500);
  if (!referenceType || !locator) return invalid('Reference type and canonical locator are required.');
  const state = await currentState(context.env.CONTENT_DB, canonicalId);
  if (!state) return notFound('Canonical record was not found.');
  if (['approved', 'published', 'superseded'].includes(state.workflowState)) {
    return conflict('Create a correction revision before changing references on an approved record.');
  }
  const id = `canonical-reference.${crypto.randomUUID()}`;
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_references (
        id, canonical_id, revision_id, reference_type, locator, verification_status,
        created_by_external_id
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).bind(id, canonicalId, state.revisionId, referenceType, locator, context.user.id),
    auditStatement(context, 'editorial.reference_added', 'canonical_reference', id, {
      canonicalId,
      referenceType,
      locator,
    }),
  ]);
  return json({ data: { id, canonicalId, revisionId: state.revisionId, referenceType, locator, verificationStatus: 'pending' } }, 201);
}

async function reviewCanonicalReference(
  context: EditorialContext,
  canonicalId: string,
  referenceId: string,
  body: Record<string, unknown>,
) {
  const decision = String(body.decision ?? '');
  if (!['verified', 'rejected'].includes(decision)) return invalid('Choose verified or rejected.');
  const reference = await context.env.CONTENT_DB.prepare(`
    SELECT reference.id, reference.revision_id AS revisionId,
           reference.created_by_external_id AS createdBy, state.workflow_state AS workflowState
    FROM canonical_references reference
    JOIN editorial_record_state state
      ON state.canonical_id = reference.canonical_id AND state.revision_id = reference.revision_id
    WHERE reference.id = ? AND reference.canonical_id = ?
  `).bind(referenceId, canonicalId).first<{
    id: string;
    revisionId: string;
    createdBy: string | null;
    workflowState: string;
  }>();
  if (!reference) return notFound('Canonical reference was not found on the current revision.');
  if (reference.createdBy === context.user.id) {
    return conflict('A contributor cannot verify their own canonical reference.');
  }
  if (['approved', 'published', 'superseded'].includes(reference.workflowState)) {
    return conflict('References on an approved revision are locked.');
  }
  const now = new Date().toISOString();
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`
      UPDATE canonical_references
      SET verification_status = ?, verified_by_external_id = ?, verified_at = ?
      WHERE id = ? AND canonical_id = ?
    `).bind(decision, context.user.id, now, referenceId, canonicalId),
    auditStatement(context, 'editorial.reference_reviewed', 'canonical_reference', referenceId, {
      canonicalId,
      decision,
    }),
  ]);
  return json({ data: { id: referenceId, canonicalId, verificationStatus: decision, verifiedAt: now } });
}

async function createAssignment(context: EditorialContext, body: Record<string, unknown>) {
  const scopeType = String(body.scopeType ?? '');
  const assignedTo = String(body.assignedTo ?? '').trim();
  if (!['collection', 'book', 'chapter', 'record_range', 'record'].includes(scopeType) || !assignedTo) {
    return invalid('Choose an assignment scope and reviewer.');
  }
  const reviewer = await context.env.IDENTITY_DB.prepare(`
    SELECT 1 FROM platform_role_grants
    WHERE user_id = ? AND status = 'active' AND role IN ('reviewer','editor','admin')
  `).bind(assignedTo).first();
  if (!reviewer) return invalid('The assignee must have an active editorial review role.');
  const id = `assignment.${crypto.randomUUID()}`;
  const rangeStart = optionalPositiveInteger(body.rangeStart);
  const rangeEnd = optionalPositiveInteger(body.rangeEnd);
  const canonicalId = optionalText(body.canonicalId, 180);
  const collectionId = optionalText(body.collectionId, 180);
  const bookId = optionalText(body.bookId, 180);
  const chapterId = optionalText(body.chapterId, 180);
  if (scopeType === 'record' && !canonicalId) return invalid('A canonical record ID is required for record scope.');
  if (scopeType === 'record_range' && (!rangeStart || !rangeEnd || rangeStart > rangeEnd)) {
    return invalid('A valid inclusive start and end are required for record range scope.');
  }
  if (scopeType === 'collection' && !collectionId) return invalid('A collection ID is required for collection scope.');
  if (scopeType === 'book' && !bookId) return invalid('A book ID is required for book scope.');
  if (scopeType === 'chapter' && !chapterId) return invalid('A chapter ID is required for chapter scope.');
  const scope = {
    scopeType,
    assignedTo,
    canonicalId,
    collectionId,
    bookId,
    chapterId,
    rangeStart,
    rangeEnd,
  };
  const matchedRecords = await assignmentTargetCount(context.env.CONTENT_DB, scope);
  if (matchedRecords === 0) return invalid('The assignment scope did not match any open editorial records.');
  const assignmentTarget = assignmentStateStatement(context, scope);
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`
      INSERT INTO editorial_assignments (
        id, scope_type, collection_id, book_id, chapter_id, canonical_id,
        range_start, range_end, assigned_to_external_id, assigned_by_external_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, scopeType, collectionId, bookId,
      chapterId, canonicalId, rangeStart, rangeEnd,
      assignedTo, context.user.id, optionalText(body.notes, 1000),
    ),
    assignmentTarget,
    auditStatement(context, 'editorial.assignment_created', 'assignment', id, { scopeType, assignedTo }),
  ]);
  return json({ data: { id, scopeType, assignedTo, matchedRecords } }, 201);
}

function assignmentStateStatement(
  context: EditorialContext,
  scope: {
    scopeType: string;
    assignedTo: string;
    canonicalId: string | null;
    collectionId: string | null;
    bookId: string | null;
    chapterId: string | null;
    rangeStart: number | null;
    rangeEnd: number | null;
  },
) {
  const filter = assignmentFilter(scope);
  return context.env.CONTENT_DB.prepare(`
    UPDATE editorial_record_state AS state
    SET workflow_state = 'assigned', assigned_to_external_id = ?,
        changed_by_external_id = ?, changed_at = CURRENT_TIMESTAMP
    WHERE state.workflow_state IN ('imported','pending_review','changes_requested')
      AND EXISTS (
        SELECT 1 FROM content_revisions revision
        LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
        WHERE revision.id = state.revision_id AND ${filter.clause}
      )
  `).bind(scope.assignedTo, context.user.id, ...filter.values);
}

async function assignmentTargetCount(
  database: D1Database,
  scope: {
    scopeType: string;
    canonicalId: string | null;
    collectionId: string | null;
    bookId: string | null;
    chapterId: string | null;
    rangeStart: number | null;
    rangeEnd: number | null;
  },
) {
  const filter = assignmentFilter(scope);
  const row = await database.prepare(`
    SELECT COUNT(*) AS count
    FROM editorial_record_state state
    JOIN content_revisions revision ON revision.id = state.revision_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    WHERE state.workflow_state IN ('imported','pending_review','changes_requested','assigned','in_review','needs_second_review')
      AND ${filter.clause}
  `).bind(...filter.values).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function assignmentFilter(scope: {
  scopeType: string;
  canonicalId: string | null;
  collectionId: string | null;
  bookId: string | null;
  chapterId: string | null;
  rangeStart: number | null;
  rangeEnd: number | null;
}) {
  const filters: Record<string, { clause: string; values: unknown[] }> = {
    record: { clause: 'state.canonical_id = ?', values: [scope.canonicalId] },
    record_range: { clause: 'revision.sequence BETWEEN ? AND ?', values: [scope.rangeStart, scope.rangeEnd] },
    collection: { clause: 'metadata.collection_id = ?', values: [scope.collectionId] },
    book: { clause: 'metadata.book_id = ?', values: [scope.bookId] },
    chapter: { clause: 'metadata.chapter_id = ?', values: [scope.chapterId] },
  };
  return filters[scope.scopeType]!;
}

async function listAssignments({ env }: EditorialContext) {
  const rows = await env.CONTENT_DB.prepare(`
    SELECT id, scope_type AS scopeType, collection_id AS collectionId, book_id AS bookId,
           chapter_id AS chapterId, canonical_id AS canonicalId, range_start AS rangeStart,
           range_end AS rangeEnd, assigned_to_external_id AS assignedTo,
           assigned_by_external_id AS assignedBy, status, notes, created_at AS createdAt
    FROM editorial_assignments ORDER BY created_at DESC LIMIT 200
  `).all();
  return json({ data: rows.results });
}

async function submitFieldReviews(context: EditorialContext, canonicalId: string, body: Record<string, unknown>) {
  const current = await currentRevision(context.env.CONTENT_DB, canonicalId);
  if (!current) return notFound('Canonical record was not found.');
  if (!['pending_review', 'assigned', 'in_review', 'needs_second_review'].includes(current.workflowState)) {
    return conflict('This revision is not open for field review.');
  }
  const reviews = Array.isArray(body.reviews) ? body.reviews as Array<Record<string, unknown>> : [];
  if (reviews.length === 0) return invalid('Submit at least one field review.');
  const statements: D1PreparedStatement[] = [];
  for (const review of reviews) {
    const field = String(review.field ?? '');
    const decision = String(review.decision ?? '');
    if (!REVIEW_FIELDS.includes(field as typeof REVIEW_FIELDS[number])) return invalid(`Unsupported review field: ${field}`);
    if (!['verified', 'correction_required', 'not_applicable'].includes(decision)) return invalid(`Unsupported field decision: ${decision}`);
    statements.push(context.env.CONTENT_DB.prepare(`
      INSERT INTO field_reviews (
        id, revision_id, field_name, reviewer_external_id, decision, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      `field-review.${crypto.randomUUID()}`, current.revisionId, field, context.user.id,
      decision, optionalText(review.notes, 1000),
    ));
  }
  statements.push(
    context.env.CONTENT_DB.prepare(`
      UPDATE editorial_record_state SET workflow_state = 'in_review',
        changed_by_external_id = ?, changed_at = CURRENT_TIMESTAMP
      WHERE canonical_id = ? AND workflow_state IN ('pending_review','assigned','in_review','changes_requested')
    `).bind(context.user.id, canonicalId),
    auditStatement(context, 'editorial.fields_reviewed', 'record', canonicalId, { revisionId: current.revisionId, count: reviews.length }),
  );
  try {
    await context.env.CONTENT_DB.batch(statements);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return conflict('A field decision from this reviewer already exists and is immutable.');
    throw error;
  }
  return json({ data: { canonicalId, revisionId: current.revisionId, reviewedFields: reviews.length } }, 201);
}

async function submitDecision(context: EditorialContext, canonicalId: string, body: Record<string, unknown>) {
  requireRole(context.role, ['reviewer', 'editor', 'admin']);
  const current = await currentRevision(context.env.CONTENT_DB, canonicalId);
  if (!current) return notFound('Canonical record was not found.');
  const decision = String(body.decision ?? '');
  if (!['approved', 'changes_requested'].includes(decision)) return invalid('Choose approved or changes requested.');
  if (!['imported', 'pending_review', 'assigned', 'in_review', 'changes_requested', 'needs_second_review', 'needs_senior_approval'].includes(current.workflowState)) {
    return conflict('This revision is not open for verification.');
  }
  if (decision === 'approved') {
    const references = await count(context.env.CONTENT_DB, `
      SELECT COUNT(*) AS count FROM canonical_references
      WHERE revision_id = '${sqlLiteral(current.revisionId)}'
        AND verification_status != 'rejected'
    `);
    if (references < 1) return invalid('Attach at least one canonical reference before verifying this record.');
  }

  const id = `review-decision.${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await context.env.CONTENT_DB.batch([
      context.env.CONTENT_DB.prepare(`
        INSERT INTO review_decisions (
          id, revision_id, reviewer_external_id, review_stage, decision, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, current.revisionId, context.user.id, 'independent_review', decision, optionalText(body.notes, 2000)),
      context.env.CONTENT_DB.prepare(`
        UPDATE canonical_references
        SET verification_status = CASE WHEN ? = 'approved' THEN 'verified' ELSE verification_status END,
            verified_by_external_id = CASE WHEN ? = 'approved' THEN ? ELSE verified_by_external_id END,
            verified_at = CASE WHEN ? = 'approved' THEN ? ELSE verified_at END
        WHERE revision_id = ? AND verification_status = 'pending'
      `).bind(decision, decision, context.user.id, decision, now, current.revisionId),
      context.env.CONTENT_DB.prepare(`
        UPDATE editorial_record_state
        SET workflow_state = ?,
            verified_by_external_id = CASE WHEN ? = 'approved' THEN ? ELSE NULL END,
            verified_at = CASE WHEN ? = 'approved' THEN ? ELSE NULL END,
            changed_by_external_id = ?,
            changed_at = ?
        WHERE canonical_id = ?
      `).bind(
        decision === 'approved' ? 'approved' : 'changes_requested',
        decision,
        context.user.id,
        decision,
        now,
        context.user.id,
        now,
        canonicalId,
      ),
      auditStatement(context, 'editorial.review_decided', 'record', canonicalId, {
        revisionId: current.revisionId, stage: 'single_verification', decision,
      }),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return conflict('You already submitted an immutable verification for this revision.');
    throw error;
  }
  return json({
    data: {
      canonicalId,
      revisionId: current.revisionId,
      decision,
      workflowState: decision === 'approved' ? 'approved' : 'changes_requested',
      verifiedBy: decision === 'approved' ? context.user.id : null,
      verifiedAt: decision === 'approved' ? now : null,
    },
  });
}

async function createRevision(context: EditorialContext, canonicalId: string, body: Record<string, unknown>) {
  const current = await context.env.CONTENT_DB.prepare(`
    SELECT revision.id AS revisionId, revision.record_id AS recordId,
           revision.revision_number AS revisionNumber, revision.legacy_id AS legacyId,
           revision.sequence, revision.title
    FROM canonical_records canonical
    JOIN content_revisions revision ON revision.id = canonical.current_revision_id
    WHERE canonical.canonical_id = ?
  `).bind(canonicalId).first<{
    revisionId: string;
    recordId: string;
    revisionNumber: number;
    legacyId: string | null;
    sequence: number;
    title: string;
  }>();
  if (!current) return notFound('Canonical record was not found.');
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 10 || reason.length > 2000) return invalid('A correction reason between 10 and 2000 characters is required.');
  const [segments, metadata, references] = await Promise.all([
    context.env.CONTENT_DB.prepare(`
      SELECT part.position AS partPosition, segment.position AS segmentPosition,
             segment.kind, segment.language_code AS languageCode,
             segment.script_code AS scriptCode, segment.text
      FROM revision_parts part
      JOIN revision_segments segment ON segment.revision_part_id = part.id
      WHERE part.revision_id = ? ORDER BY part.position, segment.position
    `).bind(current.revisionId).all<Record<string, unknown>>(),
    context.env.CONTENT_DB.prepare('SELECT * FROM revision_metadata WHERE revision_id = ?')
      .bind(current.revisionId).first<Record<string, unknown>>(),
    context.env.CONTENT_DB.prepare(`
      SELECT reference_type AS referenceType, locator, verification_status AS verificationStatus
      FROM canonical_references WHERE canonical_id = ? AND revision_id = ?
    `).bind(canonicalId, current.revisionId).all<Record<string, unknown>>(),
  ]);
  const corrections = new Map(
    (Array.isArray(body.segments) ? body.segments as Array<Record<string, unknown>> : [])
      .map((item) => [`${item.partPosition}:${item.segmentPosition}`, String(item.text ?? '').trim()]),
  );
  if ([...corrections.values()].some((text) => !text)) return invalid('Corrected segment text cannot be empty.');

  const revisionNumber = current.revisionNumber + 1;
  const revisionId = `revision.${canonicalId}.${revisionNumber}`;
  const title = optionalText(body.title, 300) ?? current.title;
  const metadataChanges = isObject(body.metadata) ? body.metadata : {};
  const statements: D1PreparedStatement[] = [
    context.env.CONTENT_DB.prepare(`
      INSERT INTO content_revisions (
        id, canonical_id, record_id, revision_number, legacy_id, sequence, title,
        supersedes_revision_id, created_by_external_id, correction_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      revisionId, canonicalId, current.recordId, revisionNumber, current.legacyId,
      current.sequence, title, current.revisionId, context.user.id, reason,
    ),
  ];
  const partPositions = [...new Set(segments.results.map((item) => Number(item.partPosition)))];
  for (const position of partPositions) {
    statements.push(context.env.CONTENT_DB.prepare(`
      INSERT INTO revision_parts (id, revision_id, position) VALUES (?, ?, ?)
    `).bind(`${revisionId}.part.${position}`, revisionId, position));
  }
  for (const segment of segments.results) {
    const partPosition = Number(segment.partPosition);
    const segmentPosition = Number(segment.segmentPosition);
    const text = corrections.get(`${partPosition}:${segmentPosition}`) ?? String(segment.text);
    statements.push(context.env.CONTENT_DB.prepare(`
      INSERT INTO revision_segments (
        id, revision_part_id, position, kind, language_code, script_code, text
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `${revisionId}.part.${partPosition}.segment.${segmentPosition}`,
      `${revisionId}.part.${partPosition}`, segmentPosition, segment.kind,
      segment.languageCode, segment.scriptCode, text,
    ));
  }
  statements.push(context.env.CONTENT_DB.prepare(`
    INSERT INTO revision_metadata (
      revision_id, collection_id, book_id, chapter_id, display_number,
      narrator, grade, grading_authority
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    revisionId,
    metadataChanges.collectionId ?? metadata?.collection_id ?? null,
    metadataChanges.bookId ?? metadata?.book_id ?? null,
    metadataChanges.chapterId ?? metadata?.chapter_id ?? null,
    metadataChanges.displayNumber ?? metadata?.display_number ?? null,
    metadataChanges.narrator ?? metadata?.narrator ?? null,
    metadataChanges.grade ?? metadata?.grade ?? null,
    metadataChanges.gradingAuthority ?? metadata?.grading_authority ?? null,
  ));
  for (const [index, reference] of references.results.entries()) {
    statements.push(context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_references (
        id, canonical_id, revision_id, reference_type, locator, verification_status,
        created_by_external_id
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      `${revisionId}.reference.${index + 1}`, canonicalId, revisionId,
      reference.referenceType, reference.locator, context.user.id,
    ));
  }
  statements.push(
    context.env.CONTENT_DB.prepare(`
      UPDATE canonical_records SET current_revision_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE canonical_id = ?
    `).bind(revisionId, canonicalId),
    context.env.CONTENT_DB.prepare(`
      UPDATE editorial_record_state SET revision_id = ?, workflow_state = 'pending_review',
        assigned_to_external_id = NULL, verified_by_external_id = NULL, verified_at = NULL,
        changed_by_external_id = ?, changed_at = CURRENT_TIMESTAMP
      WHERE canonical_id = ?
    `).bind(revisionId, context.user.id, canonicalId),
    auditStatement(context, 'editorial.revision_created', 'record', canonicalId, {
      revisionId, revisionNumber, supersedes: current.revisionId, reason,
    }),
  );
  await context.env.CONTENT_DB.batch(statements);
  return json({ data: { canonicalId, revisionId, revisionNumber, workflowState: 'pending_review' } }, 201);
}

async function createBatch(context: EditorialContext, body: Record<string, unknown>) {
  const label = String(body.label ?? '').trim();
  if (label.length < 3 || label.length > 160) return invalid('Batch label must contain 3 to 160 characters.');
  const id = `batch.${crypto.randomUUID()}`;
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`
      INSERT INTO publication_batches (id, label, created_by_external_id) VALUES (?, ?, ?)
    `).bind(id, label, context.user.id),
    auditStatement(context, 'editorial.batch_created', 'publication_batch', id, { label }),
  ]);
  return json({ data: { id, label, status: 'draft' } }, 201);
}

async function listBatches({ env }: EditorialContext) {
  const rows = await env.CONTENT_DB.prepare(`
    SELECT batch.id, batch.label, batch.status, batch.created_by_external_id AS createdBy,
           batch.approved_by_external_id AS approvedBy, batch.published_by_external_id AS publishedBy,
           batch.validation_report_json AS validationReport, batch.created_at AS createdAt,
           batch.approved_at AS approvedAt, batch.published_at AS publishedAt,
           COUNT(item.canonical_id) AS itemCount
    FROM publication_batches batch
    LEFT JOIN publication_batch_items item ON item.batch_id = batch.id
    GROUP BY batch.id ORDER BY batch.created_at DESC LIMIT 100
  `).all();
  return json({ data: rows.results });
}

async function getBatch({ env }: EditorialContext, batchId: string) {
  const batch = await env.CONTENT_DB.prepare(`
    SELECT id, label, status, created_by_external_id AS createdBy,
           approved_by_external_id AS approvedBy, published_by_external_id AS publishedBy,
           validation_report_json AS validationReport, dataset_version_id AS datasetId,
           created_at AS createdAt, approved_at AS approvedAt, published_at AS publishedAt
    FROM publication_batches WHERE id = ?
  `).bind(batchId).first<Record<string, unknown>>();
  if (!batch) return notFound('Publication batch was not found.');
  const items = await env.CONTENT_DB.prepare(`
    SELECT item.canonical_id AS canonicalId, item.revision_id AS revisionId,
           revision.title, revision.revision_number AS revisionNumber,
           state.workflow_state AS workflowState
    FROM publication_batch_items item
    JOIN content_revisions revision ON revision.id = item.revision_id
    JOIN editorial_record_state state ON state.canonical_id = item.canonical_id
    WHERE item.batch_id = ?
    ORDER BY revision.sequence, item.canonical_id
  `).bind(batchId).all();
  return json({
    data: {
      batch: {
        ...batch,
        validationReport: parseJson(String(batch.validationReport ?? '{}')),
      },
      items: items.results,
    },
  });
}

async function addBatchItems(context: EditorialContext, batchId: string, body: Record<string, unknown>) {
  const ids = Array.isArray(body.canonicalIds)
    ? [...new Set(body.canonicalIds.map(String).filter(Boolean))].slice(0, 50)
    : [];
  if (ids.length === 0) return invalid('Add between 1 and 50 canonical record IDs.');
  const batch = await context.env.CONTENT_DB.prepare(`
    SELECT status FROM publication_batches WHERE id = ?
  `).bind(batchId).first<{ status: string }>();
  if (!batch) return notFound('Publication batch was not found.');
  if (batch.status !== 'draft') return conflict('Items can be changed only while a batch is in draft.');
  const statements: D1PreparedStatement[] = [];
  for (const id of ids) {
    const record = await context.env.CONTENT_DB.prepare(`
      SELECT state.revision_id AS revisionId FROM editorial_record_state state
      WHERE state.canonical_id = ? AND state.workflow_state = 'approved'
    `).bind(id).first<{ revisionId: string }>();
    if (!record) return invalid(`${id} is not approved for publication.`);
    statements.push(context.env.CONTENT_DB.prepare(`
      INSERT INTO publication_batch_items (
        batch_id, canonical_id, revision_id, added_by_external_id
      ) VALUES (?, ?, ?, ?)
    `).bind(batchId, id, record.revisionId, context.user.id));
  }
  statements.push(auditStatement(context, 'editorial.batch_items_added', 'publication_batch', batchId, { canonicalIds: ids }));
  try {
    await context.env.CONTENT_DB.batch(statements);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return conflict('One or more records are already in this batch.');
    throw error;
  }
  return json({ data: { batchId, added: ids.length } });
}

async function removeBatchItems(context: EditorialContext, batchId: string, body: Record<string, unknown>) {
  const ids = Array.isArray(body.canonicalIds)
    ? [...new Set(body.canonicalIds.map(String).filter(Boolean))].slice(0, 50)
    : [];
  if (ids.length === 0) return invalid('Choose between 1 and 50 canonical record IDs to remove.');
  const batch = await context.env.CONTENT_DB.prepare(`
    SELECT status FROM publication_batches WHERE id = ?
  `).bind(batchId).first<{ status: string }>();
  if (!batch) return notFound('Publication batch was not found.');
  if (batch.status !== 'draft') return conflict('Items can be changed only while a batch is in draft.');
  const statements = ids.map((id) => context.env.CONTENT_DB.prepare(`
    DELETE FROM publication_batch_items WHERE batch_id = ? AND canonical_id = ?
  `).bind(batchId, id));
  statements.push(auditStatement(context, 'editorial.batch_items_removed', 'publication_batch', batchId, { canonicalIds: ids }));
  const results = await context.env.CONTENT_DB.batch(statements);
  const removed = results.slice(0, -1).reduce((total, result) => total + Number(result.meta.changes ?? 0), 0);
  return json({ data: { batchId, removed } });
}

async function validateBatch(context: EditorialContext, batchId: string) {
  const batch = await context.env.CONTENT_DB.prepare(`
    SELECT status FROM publication_batches WHERE id = ?
  `).bind(batchId).first<{ status: string }>();
  if (!batch) return notFound('Publication batch was not found.');
  if (batch.status !== 'draft') return conflict('Only a draft batch can be validated.');
  const rows = await context.env.CONTENT_DB.prepare(`
    SELECT item.canonical_id AS canonicalId, item.revision_id AS revisionId,
           state.workflow_state AS workflowState,
           state.revision_id = item.revision_id AS revisionMatches,
           (SELECT COUNT(*) FROM canonical_references reference
             WHERE reference.canonical_id = item.canonical_id
               AND reference.revision_id = item.revision_id
               AND reference.verification_status = 'verified') AS verifiedReferences,
            (SELECT COUNT(DISTINCT reviewer_external_id) FROM review_decisions decision
              WHERE decision.revision_id = item.revision_id
                AND decision.review_stage = 'independent_review'
                AND decision.decision = 'approved') AS verifications
    FROM publication_batch_items item
    JOIN editorial_record_state state ON state.canonical_id = item.canonical_id
    WHERE item.batch_id = ?
  `).bind(batchId).all<{
    canonicalId: string;
    revisionId: string;
    workflowState: string;
    revisionMatches: number;
    verifiedReferences: number;
    verifications: number;
  }>();
  const invalidRecords = rows.results.flatMap((row) => {
    const issues: string[] = [];
    if (row.workflowState !== 'approved') issues.push(`Workflow state is ${row.workflowState}, not approved.`);
    if (!row.revisionMatches) issues.push('The batch revision is no longer current.');
    if (Number(row.verifiedReferences) < 1) issues.push('No independently verified canonical reference is attached.');
    if (Number(row.verifications) < 1) issues.push('One verified editorial decision is required.');
    return issues.length ? [{ canonicalId: row.canonicalId, revisionId: row.revisionId, issues }] : [];
  });
  const itemCount = rows.results.length;
  const report = { valid: invalidRecords.length === 0 && itemCount > 0, itemCount, invalidRecords };
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`
      UPDATE publication_batches SET status = ?, validation_report_json = ? WHERE id = ?
    `).bind(report.valid ? 'validated' : 'draft', JSON.stringify(report), batchId),
    auditStatement(context, 'editorial.batch_validated', 'publication_batch', batchId, report),
  ]);
  return json({ data: report }, report.valid ? 200 : 409);
}

async function approveBatch(context: EditorialContext, batchId: string) {
  const result = await context.env.CONTENT_DB.prepare(`
    UPDATE publication_batches SET status = 'approved', approved_by_external_id = ?,
      approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'validated'
  `).bind(context.user.id, batchId).run();
  if (!result.meta.changes) return conflict('Only a validated batch can be approved.');
  await context.env.CONTENT_DB.batch([
    auditStatement(context, 'editorial.batch_approved', 'publication_batch', batchId, {}),
  ]);
  return json({ data: { batchId, status: 'approved' } });
}

async function publishBatch(context: EditorialContext, batchId: string) {
  const batch = await context.env.CONTENT_DB.prepare(`
    SELECT status, approved_by_external_id AS approvedBy
    FROM publication_batches WHERE id = ?
  `).bind(batchId).first<{ status: string; approvedBy: string | null }>();
  if (!batch) return notFound('Publication batch was not found.');
  if (batch.status !== 'approved' || !batch.approvedBy) return conflict('The batch must be approved before publication.');
  const items = await context.env.CONTENT_DB.prepare(`
    SELECT item.canonical_id AS canonicalId, item.revision_id AS revisionId,
           revision.record_id AS recordId, revision.revision_number AS revisionNumber,
           canonical.content_type AS contentType, revision.title,
           COALESCE(collection.slug, '') AS collectionSlug,
           COALESCE(metadata.narrator, '') AS narrator,
           COALESCE(GROUP_CONCAT(segment.text, ' '), '') AS body
    FROM publication_batch_items item
    JOIN content_revisions revision ON revision.id = item.revision_id
    JOIN canonical_records canonical ON canonical.canonical_id = item.canonical_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    LEFT JOIN collections collection ON collection.id = metadata.collection_id
    LEFT JOIN revision_parts part ON part.revision_id = revision.id
    LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
    WHERE item.batch_id = ?
    GROUP BY item.canonical_id
    ORDER BY item.canonical_id
  `).bind(batchId).all<{
    canonicalId: string;
    revisionId: string;
    recordId: string;
    revisionNumber: number;
    contentType: string;
    title: string;
    collectionSlug: string;
    narrator: string;
    body: string;
  }>();
  if (items.results.length === 0) return conflict('The publication batch is empty.');
  const existingPublications = await context.env.CONTENT_DB.prepare(`
    SELECT canonical_id AS canonicalId, revision_id AS revisionId
    FROM canonical_publications WHERE publication_status = 'published'
  `).all<{ canonicalId: string; revisionId: string }>();
  const publicationSet = new Map(
    existingPublications.results.map((item) => [item.canonicalId, item.revisionId]),
  );
  for (const item of items.results) publicationSet.set(item.canonicalId, item.revisionId);
  const canonicalHash = await sha256(
    [...publicationSet].sort(([left], [right]) => left.localeCompare(right))
      .map(([canonicalId, revisionId]) => `${canonicalId}:${revisionId}`)
      .join('\n'),
  );
  const now = new Date().toISOString();
  const datasetId = `canonical.${now.slice(0, 10)}.${canonicalHash.slice(0, 12)}`;
  const totalPublishedCount = publicationSet.size;
  const statements: D1PreparedStatement[] = [
    context.env.CONTENT_DB.prepare(`
      UPDATE canonical_dataset_versions SET publication_status = 'superseded'
      WHERE publication_status = 'published'
    `),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_dataset_versions (
        id, version_label, publication_status, verification_status, record_count,
        canonical_hash, publication_batch_id, published_by_external_id, published_at
      ) VALUES (?, ?, 'published', 'verified', ?, ?, ?, ?, ?)
    `).bind(datasetId, datasetId, totalPublishedCount, canonicalHash, batchId, context.user.id, now),
    context.env.CONTENT_DB.prepare(`
      UPDATE canonical_publications SET dataset_version_id = ?
      WHERE publication_status = 'published'
    `).bind(datasetId),
  ];
  for (const item of items.results) {
    const previous = await context.env.CONTENT_DB.prepare(`
      SELECT revision_id AS revisionId, record_id AS recordId, revision_number AS revisionNumber,
             dataset_version_id AS datasetVersionId
      FROM canonical_publications WHERE canonical_id = ? AND publication_status = 'published'
    `).bind(item.canonicalId).first<{
      revisionId: string;
      recordId: string;
      revisionNumber: number;
      datasetVersionId: string;
    }>();
    if (previous) {
      statements.push(context.env.CONTENT_DB.prepare(`
        INSERT INTO canonical_publication_history (
          id, canonical_id, revision_id, record_id, dataset_version_id, revision_number,
          event_type, actor_external_id, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'superseded', ?, ?)
      `).bind(
        `publication-history.${crypto.randomUUID()}`, item.canonicalId, previous.revisionId,
        previous.recordId, previous.datasetVersionId, previous.revisionNumber, context.user.id, now,
      ));
    }
    statements.push(
      context.env.CONTENT_DB.prepare(`
        INSERT INTO canonical_publications (
          canonical_id, revision_id, record_id, dataset_version_id, revision_number,
          publication_status, published_by_external_id, published_at
        ) VALUES (?, ?, ?, ?, ?, 'published', ?, ?)
        ON CONFLICT(canonical_id) DO UPDATE SET
          revision_id = excluded.revision_id,
          record_id = excluded.record_id,
          dataset_version_id = excluded.dataset_version_id,
          revision_number = excluded.revision_number,
          publication_status = 'published',
          published_by_external_id = excluded.published_by_external_id,
          published_at = excluded.published_at,
          superseded_at = NULL
      `).bind(
        item.canonicalId, item.revisionId, item.recordId, datasetId,
        item.revisionNumber, context.user.id, now,
      ),
      context.env.CONTENT_DB.prepare(`
        INSERT INTO canonical_publication_history (
          id, canonical_id, revision_id, record_id, dataset_version_id, revision_number,
          event_type, actor_external_id, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)
      `).bind(
        `publication-history.${crypto.randomUUID()}`, item.canonicalId, item.revisionId,
        item.recordId, datasetId, item.revisionNumber, context.user.id, now,
      ),
      context.env.CONTENT_DB.prepare(`
        UPDATE editorial_record_state SET workflow_state = 'published',
          changed_by_external_id = ?, changed_at = ? WHERE canonical_id = ?
      `).bind(context.user.id, now, item.canonicalId),
      context.env.CONTENT_DB.prepare(`
        DELETE FROM canonical_search_fts WHERE canonical_id = ?
      `).bind(item.canonicalId),
      context.env.CONTENT_DB.prepare(`
        INSERT INTO canonical_search_fts (
          canonical_id, revision_id, content_type, collection_slug, title, body, narrator
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.canonicalId, item.revisionId, item.contentType, item.collectionSlug,
        item.title, item.body, item.narrator,
      ),
    );
  }
  statements.push(
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_dataset_items (dataset_version_id, canonical_id, revision_id)
      SELECT ?, canonical_id, revision_id
      FROM canonical_publications
      WHERE publication_status = 'published'
    `).bind(datasetId),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO rag_index_state (
        dataset_version_id, expected_count, indexed_count, status, updated_at
      ) VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP)
    `).bind(datasetId, totalPublishedCount, totalPublishedCount === 0 ? 'ready' : 'pending'),
    context.env.CONTENT_DB.prepare(`
      UPDATE publication_batches SET status = 'published', dataset_version_id = ?,
        published_by_external_id = ?, published_at = ? WHERE id = ?
    `).bind(datasetId, context.user.id, now, batchId),
    auditStatement(context, 'editorial.batch_published', 'publication_batch', batchId, {
      datasetId, canonicalHash, recordCount: totalPublishedCount,
    }),
  );
  await context.env.CONTENT_DB.batch(statements);
  return json({ data: { batchId, status: 'published', datasetId, canonicalHash, recordCount: totalPublishedCount } });
}

async function listDatasets({ env }: EditorialContext) {
  const rows = await env.CONTENT_DB.prepare(`
    SELECT dataset.id, dataset.version_label AS versionLabel,
           dataset.publication_status AS publicationStatus,
           dataset.verification_status AS verificationStatus,
           dataset.record_count AS recordCount, dataset.canonical_hash AS canonicalHash,
           dataset.publication_batch_id AS publicationBatchId,
           dataset.published_by_external_id AS publishedBy,
           dataset.created_at AS createdAt, dataset.published_at AS publishedAt,
           COUNT(item.canonical_id) AS snapshotCount
    FROM canonical_dataset_versions dataset
    LEFT JOIN canonical_dataset_items item ON item.dataset_version_id = dataset.id
    GROUP BY dataset.id
    ORDER BY COALESCE(dataset.published_at, dataset.created_at) DESC
    LIMIT 100
  `).all();
  return json({ data: rows.results });
}

async function rollbackDataset(context: EditorialContext, targetDatasetId: string, body: Record<string, unknown>) {
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 10 || reason.length > 1000) return invalid('A rollback reason containing 10 to 1000 characters is required.');
  const [target, current] = await Promise.all([
    context.env.CONTENT_DB.prepare(`
      SELECT id, record_count AS recordCount, canonical_hash AS canonicalHash
      FROM canonical_dataset_versions
      WHERE id = ? AND publication_status IN ('published','superseded','rolled_back')
    `).bind(targetDatasetId).first<{ id: string; recordCount: number; canonicalHash: string | null }>(),
    context.env.CONTENT_DB.prepare(`
      SELECT id, publication_batch_id AS publicationBatchId
      FROM canonical_dataset_versions WHERE publication_status = 'published' LIMIT 1
    `).first<{ id: string; publicationBatchId: string | null }>(),
  ]);
  if (!target) return notFound('Rollback target dataset was not found.');
  if (!current) return conflict('No current published dataset exists.');
  if (target.id === current.id) return conflict('The selected dataset is already current.');
  const snapshotCount = await count(context.env.CONTENT_DB, `
    SELECT COUNT(*) AS count FROM canonical_dataset_items
    WHERE dataset_version_id = '${sqlLiteral(target.id)}'
  `);
  if (snapshotCount !== Number(target.recordCount)) {
    return conflict('The rollback target does not have a complete immutable dataset snapshot.');
  }

  const now = new Date().toISOString();
  const datasetId = `canonical.rollback.${now.slice(0, 10)}.${crypto.randomUUID().slice(0, 12)}`;
  const statements: D1PreparedStatement[] = [
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_publication_history (
        id, canonical_id, revision_id, record_id, dataset_version_id, revision_number,
        event_type, actor_external_id, occurred_at
      )
      SELECT 'publication-history.' || lower(hex(randomblob(16))), canonical_id, revision_id,
             record_id, dataset_version_id, revision_number, 'rolled_back', ?, ?
      FROM canonical_publications WHERE publication_status = 'published'
    `).bind(context.user.id, now),
    context.env.CONTENT_DB.prepare(`
      UPDATE editorial_record_state SET workflow_state = 'superseded',
        changed_by_external_id = ?, changed_at = ?
      WHERE workflow_state = 'published'
    `).bind(context.user.id, now),
    context.env.CONTENT_DB.prepare(`
      UPDATE canonical_dataset_versions SET publication_status = 'rolled_back'
      WHERE id = ?
    `).bind(current.id),
    context.env.CONTENT_DB.prepare(`
      UPDATE publication_batches SET status = 'rolled_back'
      WHERE id = ?
    `).bind(current.publicationBatchId),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_dataset_versions (
        id, version_label, publication_status, verification_status, record_count,
        canonical_hash, published_by_external_id, published_at
      ) VALUES (?, ?, 'published', 'verified', ?, ?, ?, ?)
    `).bind(datasetId, datasetId, target.recordCount, target.canonicalHash, context.user.id, now),
    context.env.CONTENT_DB.prepare('DELETE FROM canonical_publications'),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_publications (
        canonical_id, revision_id, record_id, dataset_version_id, revision_number,
        publication_status, published_by_external_id, published_at
      )
      SELECT item.canonical_id, item.revision_id, revision.record_id, ?,
             revision.revision_number, 'published', ?, ?
      FROM canonical_dataset_items item
      JOIN content_revisions revision ON revision.id = item.revision_id
      WHERE item.dataset_version_id = ?
    `).bind(datasetId, context.user.id, now, target.id),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_dataset_items (dataset_version_id, canonical_id, revision_id)
      SELECT ?, canonical_id, revision_id
      FROM canonical_dataset_items WHERE dataset_version_id = ?
    `).bind(datasetId, target.id),
    context.env.CONTENT_DB.prepare(`
      UPDATE editorial_record_state SET workflow_state = 'published',
        revision_id = (
          SELECT item.revision_id FROM canonical_dataset_items item
          WHERE item.dataset_version_id = ? AND item.canonical_id = editorial_record_state.canonical_id
        ),
        changed_by_external_id = ?, changed_at = ?
      WHERE canonical_id IN (
        SELECT canonical_id FROM canonical_dataset_items WHERE dataset_version_id = ?
      )
    `).bind(target.id, context.user.id, now, target.id),
    context.env.CONTENT_DB.prepare('DELETE FROM canonical_search_fts'),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO canonical_search_fts (
        canonical_id, revision_id, content_type, collection_slug, title, body, narrator
      )
      SELECT item.canonical_id, item.revision_id, canonical.content_type,
             COALESCE(collection.slug, ''), revision.title,
             COALESCE(GROUP_CONCAT(segment.text, ' '), ''), COALESCE(metadata.narrator, '')
      FROM canonical_dataset_items item
      JOIN canonical_records canonical ON canonical.canonical_id = item.canonical_id
      JOIN content_revisions revision ON revision.id = item.revision_id
      LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
      LEFT JOIN collections collection ON collection.id = metadata.collection_id
      LEFT JOIN revision_parts part ON part.revision_id = revision.id
      LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
      WHERE item.dataset_version_id = ?
      GROUP BY item.canonical_id, item.revision_id
    `).bind(target.id),
    context.env.CONTENT_DB.prepare(`
      INSERT INTO rag_index_state (
        dataset_version_id, expected_count, indexed_count, status, updated_at
      ) VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP)
    `).bind(datasetId, target.recordCount, Number(target.recordCount) === 0 ? 'ready' : 'pending'),
    auditStatement(context, 'editorial.dataset_rolled_back', 'canonical_dataset', datasetId, {
      fromDatasetId: current.id,
      targetDatasetId: target.id,
      reason,
      recordCount: target.recordCount,
    }),
  ];
  await context.env.CONTENT_DB.batch(statements);
  return json({
    data: {
      datasetId,
      rolledBackFrom: current.id,
      restoredFrom: target.id,
      recordCount: target.recordCount,
      canonicalHash: target.canonicalHash,
    },
  });
}

async function listRoles({ env }: EditorialContext) {
  const rows = await env.IDENTITY_DB.prepare(`
    SELECT user.id AS userId, user.name, user.email,
           COALESCE(role.role, 'developer') AS role,
           COALESCE(role.status, 'active') AS status,
           user.is_admin AS isAdmin
    FROM "user" user LEFT JOIN platform_role_grants role ON role.user_id = user.id
    ORDER BY user.name, user.email LIMIT 500
  `).all();
  return json({ data: rows.results });
}

async function updateRole(context: EditorialContext, body: Record<string, unknown>) {
  const userId = String(body.userId ?? '');
  const role = String(body.role ?? '');
  const status = String(body.status ?? 'active');
  if (!userId || !['admin', 'editor', 'reviewer', 'developer'].includes(role)) {
    return invalid('Choose a user and supported platform role.');
  }
  if (!['active', 'inactive'].includes(status)) return invalid('Choose active or inactive.');
  const target = await context.env.IDENTITY_DB.prepare(`
    SELECT COALESCE(role.role, 'developer') AS role, user.email
    FROM "user" user LEFT JOIN platform_role_grants role ON role.user_id = user.id
    WHERE user.id = ?
  `).bind(userId).first<{ role: string; email: string }>();
  if (!target) return notFound('User was not found.');
  if (context.role === 'editor') {
    if (userId === context.user.id) return invalid('Editors cannot change their own role.');
    if (!['developer', 'reviewer'].includes(target.role) || !['developer', 'reviewer'].includes(role)) {
      return invalid('Editors can manage reviewer access only.');
    }
  }
  if (userId === context.user.id && (role !== 'admin' || status !== 'active')) {
    return invalid('An administrator cannot remove their own active authority.');
  }
  if (
    target.email.trim().toLowerCase() === 'ziyadahmed910@gmail.com'
    && (role !== 'admin' || status !== 'active')
  ) {
    return invalid('The default Fortress administrator must remain an active administrator.');
  }
  if (target.role === 'admin' && (role !== 'admin' || status !== 'active')) {
    const activeAdmins = await context.env.IDENTITY_DB.prepare(`
      SELECT COUNT(*) AS count FROM platform_role_grants
      WHERE role = 'admin' AND status = 'active'
    `).first<{ count: number }>();
    if (Number(activeAdmins?.count ?? 0) <= 1) {
      return invalid('Promote another active administrator before removing the final administrator.');
    }
  }
  await context.env.IDENTITY_DB.batch([
    context.env.IDENTITY_DB.prepare(`
      INSERT INTO platform_role_grants (user_id, role, status, granted_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, status = excluded.status,
        granted_by = excluded.granted_by, updated_at = CURRENT_TIMESTAMP
    `).bind(userId, role, status, context.user.id),
    context.env.IDENTITY_DB.prepare(`
      UPDATE "user" SET is_admin = CASE WHEN ? = 'admin' AND ? = 'active' THEN 1 ELSE 0 END
      WHERE id = ?
    `).bind(role, status, userId),
    context.env.IDENTITY_DB.prepare(`
      INSERT INTO audit_events (
        id, actor_user_id, actor_type, action, target_type, target_id, request_id, details
      ) VALUES (?, ?, 'admin', 'platform.role_changed', 'user', ?, ?, ?)
    `).bind(
      `audit.${crypto.randomUUID()}`, context.user.id, userId, context.requestId,
      JSON.stringify({ role, status }),
    ),
  ]);
  return json({ data: { userId, role, status } });
}

async function currentRevision(database: D1Database, canonicalId: string) {
  return database.prepare(`
    SELECT state.revision_id AS revisionId, state.workflow_state AS workflowState,
           revision.created_by_external_id AS createdBy
    FROM editorial_record_state state
    JOIN content_revisions revision ON revision.id = state.revision_id
    WHERE state.canonical_id = ?
  `).bind(canonicalId).first<{
    revisionId: string;
    workflowState: string;
    createdBy: string | null;
  }>();
}

async function currentState(database: D1Database, canonicalId: string) {
  return database.prepare(`
    SELECT revision_id AS revisionId, workflow_state AS workflowState
    FROM editorial_record_state WHERE canonical_id = ?
  `).bind(canonicalId).first<{ revisionId: string; workflowState: string }>();
}

function auditStatement(context: EditorialContext, action: string, targetType: string, targetId: string, details: unknown) {
  return context.env.CONTENT_DB.prepare(`
    INSERT INTO content_audit_events (
      id, occurred_at, actor_type, actor_external_id, action,
      target_type, target_id, request_id, details_json
    ) VALUES (?, CURRENT_TIMESTAMP, 'admin', ?, ?, ?, ?, ?, ?)
  `).bind(
    `content-audit.${crypto.randomUUID()}`, context.user.id, action,
    targetType, targetId, context.requestId, JSON.stringify(details),
  );
}

function requireRole(actual: EditorialRole, allowed: EditorialRole[]) {
  if (!allowed.includes(actual)) throw new EditorialForbiddenError();
}

export class EditorialForbiddenError extends Error {}

function optionalText(value: unknown, maximum: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maximum) : null;
}

function optionalPositiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeTitle(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftWords = new Set(left.split(' '));
  const rightWords = new Set(right.split(' '));
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  const tokenScore = union ? intersection / union : 0;
  const containment = left.includes(right) || right.includes(left) ? 0.85 : 0;
  return Math.max(tokenScore, containment);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value: string) {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
}

async function count(database: D1Database, sql: string) {
  const row = await database.prepare(sql).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function invalid(message: string) {
  return json({ error: { code: 'invalid_request', message } }, 400);
}

function conflict(message: string) {
  return json({ error: { code: 'conflict', message } }, 409);
}

function notFound(message: string) {
  return json({ error: { code: 'not_found', message } }, 404);
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
