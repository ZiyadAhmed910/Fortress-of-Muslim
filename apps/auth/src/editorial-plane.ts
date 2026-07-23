import type { Bindings } from './types';

export type EditorialRole =
  | 'viewer'
  | 'reviewer'
  | 'senior_reviewer'
  | 'editor'
  | 'publisher'
  | 'super_administrator';

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
  if (url.pathname === '/v1/admin/editorial/assignments' && request.method === 'GET') {
    return listAssignments(context);
  }
  if (url.pathname === '/v1/admin/editorial/assignments' && request.method === 'POST') {
    requireRole(context.role, ['editor', 'publisher', 'super_administrator']);
    return createAssignment(context, await readJson(request));
  }
  if (url.pathname === '/v1/admin/editorial/batches' && request.method === 'GET') {
    return listBatches(context);
  }
  if (url.pathname === '/v1/admin/editorial/batches' && request.method === 'POST') {
    requireRole(context.role, ['editor', 'publisher', 'super_administrator']);
    return createBatch(context, await readJson(request));
  }
  if (url.pathname === '/v1/admin/editorial/roles' && request.method === 'GET') {
    requireRole(context.role, ['super_administrator']);
    return listRoles(context);
  }
  if (url.pathname === '/v1/admin/editorial/roles' && request.method === 'PATCH') {
    requireRole(context.role, ['super_administrator']);
    return updateRole(context, await readJson(request));
  }

  const recordMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)$/);
  if (recordMatch && request.method === 'GET') {
    return getRecord(context, decodeURIComponent(recordMatch[1]!));
  }
  const revisionMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/revisions$/);
  if (revisionMatch && request.method === 'POST') {
    requireRole(context.role, ['editor', 'senior_reviewer', 'publisher', 'super_administrator']);
    return createRevision(context, decodeURIComponent(revisionMatch[1]!), await readJson(request));
  }
  const fieldsMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/field-reviews$/);
  if (fieldsMatch && request.method === 'POST') {
    requireRole(context.role, ['reviewer', 'senior_reviewer', 'editor', 'publisher', 'super_administrator']);
    return submitFieldReviews(context, decodeURIComponent(fieldsMatch[1]!), await readJson(request));
  }
  const decisionMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/decision$/);
  if (decisionMatch && request.method === 'POST') {
    return submitDecision(context, decodeURIComponent(decisionMatch[1]!), await readJson(request));
  }
  const referencesMatch = url.pathname.match(/^\/v1\/admin\/editorial\/records\/([^/]+)\/references$/);
  if (referencesMatch && request.method === 'POST') {
    requireRole(context.role, ['editor', 'senior_reviewer', 'publisher', 'super_administrator']);
    return addCanonicalReference(context, decodeURIComponent(referencesMatch[1]!), await readJson(request));
  }
  const referenceReviewMatch = url.pathname.match(
    /^\/v1\/admin\/editorial\/records\/([^/]+)\/references\/([^/]+)\/review$/,
  );
  if (referenceReviewMatch && request.method === 'POST') {
    requireRole(context.role, ['reviewer', 'senior_reviewer', 'editor', 'publisher', 'super_administrator']);
    return reviewCanonicalReference(
      context,
      decodeURIComponent(referenceReviewMatch[1]!),
      decodeURIComponent(referenceReviewMatch[2]!),
      await readJson(request),
    );
  }

  const batchItemMatch = url.pathname.match(/^\/v1\/admin\/editorial\/batches\/([^/]+)\/items$/);
  if (batchItemMatch && request.method === 'POST') {
    requireRole(context.role, ['editor', 'publisher', 'super_administrator']);
    return addBatchItems(context, decodeURIComponent(batchItemMatch[1]!), await readJson(request));
  }
  const batchActionMatch = url.pathname.match(/^\/v1\/admin\/editorial\/batches\/([^/]+)\/(validate|approve|publish)$/);
  if (batchActionMatch && request.method === 'POST') {
    const id = decodeURIComponent(batchActionMatch[1]!);
    if (batchActionMatch[2] === 'validate') {
      requireRole(context.role, ['editor', 'publisher', 'super_administrator']);
      return validateBatch(context, id);
    }
    requireRole(context.role, ['publisher', 'super_administrator']);
    return batchActionMatch[2] === 'approve' ? approveBatch(context, id) : publishBatch(context, id);
  }

  return json({ error: { code: 'not_found', message: 'Editorial route was not found.' } }, 404);
}

async function overview({ env }: EditorialContext) {
  const [states, assignments, batches, publishedToday, reviewers] = await Promise.all([
    env.CONTENT_DB.prepare(`
      SELECT workflow_state AS state, COUNT(*) AS count
      FROM editorial_record_state GROUP BY workflow_state
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
  const query = url.searchParams.get('q')?.trim().slice(0, 120) ?? '';
  const like = `%${query}%`;
  const rows = await env.CONTENT_DB.prepare(`
    SELECT canonical.canonical_id AS canonicalId, canonical.content_type AS contentType,
           revision.revision_number AS revisionNumber, revision.sequence, revision.title,
           state.workflow_state AS workflowState, state.assigned_to_external_id AS assignedTo,
           collection.slug AS collection, book.book_number AS bookNumber,
           chapter.chapter_number AS chapterNumber, state.changed_at AS changedAt
    FROM editorial_record_state state
    JOIN canonical_records canonical ON canonical.canonical_id = state.canonical_id
    JOIN content_revisions revision ON revision.id = state.revision_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    LEFT JOIN collections collection ON collection.id = metadata.collection_id
    LEFT JOIN books book ON book.id = metadata.book_id
    LEFT JOIN chapters chapter ON chapter.id = metadata.chapter_id
    WHERE (? = '' OR state.workflow_state = ?)
      AND (? = '' OR collection.slug = ?)
      AND (? = '' OR revision.title LIKE ? OR canonical.canonical_id LIKE ?)
    ORDER BY state.changed_at, revision.sequence LIMIT 200
  `).bind(state, state, collection, collection, query, like, like).all();
  return json({ data: rows.results });
}

async function getRecord({ env }: EditorialContext, canonicalId: string) {
  const record = await env.CONTENT_DB.prepare(`
    SELECT canonical.canonical_id AS canonicalId, canonical.content_type AS contentType,
           revision.id AS revisionId, revision.revision_number AS revisionNumber,
           revision.sequence, revision.title, revision.legacy_id AS legacyId,
           revision.created_by_external_id AS revisionAuthor,
           revision.correction_reason AS correctionReason, revision.created_at AS revisionCreatedAt,
           state.workflow_state AS workflowState, state.assigned_to_external_id AS assignedTo,
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
    SELECT 1 FROM editorial_role_grants
    WHERE user_id = ? AND status = 'active' AND role IN ('reviewer','senior_reviewer','editor','publisher','super_administrator')
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
  const assignmentTarget = assignmentStateStatement(context, {
    scopeType,
    assignedTo,
    canonicalId,
    collectionId,
    bookId,
    chapterId,
    rangeStart,
    rangeEnd,
  });
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
  return json({ data: { id, scopeType, assignedTo } }, 201);
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
  const filters: Record<string, { clause: string; values: unknown[] }> = {
    record: { clause: 'state.canonical_id = ?', values: [scope.canonicalId] },
    record_range: { clause: 'revision.sequence BETWEEN ? AND ?', values: [scope.rangeStart, scope.rangeEnd] },
    collection: { clause: 'metadata.collection_id = ?', values: [scope.collectionId] },
    book: { clause: 'metadata.book_id = ?', values: [scope.bookId] },
    chapter: { clause: 'metadata.chapter_id = ?', values: [scope.chapterId] },
  };
  const filter = filters[scope.scopeType]!;
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
  if (current.createdBy === context.user.id) return invalid('A correction author cannot review their own revision.');
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
  const current = await currentRevision(context.env.CONTENT_DB, canonicalId);
  if (!current) return notFound('Canonical record was not found.');
  const decision = String(body.decision ?? '');
  const stage = String(body.stage ?? 'independent_review');
  if (!['approved', 'changes_requested'].includes(decision)) return invalid('Choose approved or changes requested.');
  if (!['independent_review', 'senior_approval'].includes(stage)) return invalid('Choose a supported review stage.');
  if (current.createdBy === context.user.id) return invalid('A correction author cannot approve their own revision.');

  if (stage === 'independent_review') {
    requireRole(context.role, ['reviewer', 'senior_reviewer', 'editor', 'publisher', 'super_administrator']);
    if (!['pending_review', 'assigned', 'in_review', 'needs_second_review'].includes(current.workflowState)) {
      return conflict('This revision is not open for independent review.');
    }
    const fieldCount = await count(context.env.CONTENT_DB, `
      SELECT COUNT(DISTINCT field_name) AS count FROM field_reviews
      WHERE revision_id = '${sqlLiteral(current.revisionId)}'
        AND reviewer_external_id = '${sqlLiteral(context.user.id)}'
    `);
    if (fieldCount !== REVIEW_FIELDS.length) return invalid(`Complete all ${REVIEW_FIELDS.length} field checks before submitting an independent decision.`);
    const corrections = await context.env.CONTENT_DB.prepare(`
      SELECT COUNT(*) AS count FROM field_reviews
      WHERE revision_id = ? AND reviewer_external_id = ? AND decision = 'correction_required'
    `).bind(current.revisionId, context.user.id).first<{ count: number }>();
    if (decision === 'approved' && Number(corrections?.count ?? 0) > 0) {
      return invalid('A review containing required corrections cannot be approved.');
    }
  } else {
    requireRole(context.role, ['senior_reviewer', 'publisher', 'super_administrator']);
    if (current.workflowState !== 'needs_senior_approval') {
      return conflict('Senior approval is available only after two independent approvals.');
    }
    const independent = await context.env.CONTENT_DB.prepare(`
      SELECT COUNT(DISTINCT reviewer_external_id) AS count,
             SUM(CASE WHEN reviewer_external_id = ? THEN 1 ELSE 0 END) AS selfCount
      FROM review_decisions
      WHERE revision_id = ? AND review_stage = 'independent_review' AND decision = 'approved'
    `).bind(context.user.id, current.revisionId).first<{ count: number; selfCount: number }>();
    if (Number(independent?.count ?? 0) < 2) return invalid('Two independent reviewer approvals are required first.');
    if (Number(independent?.selfCount ?? 0) > 0) return invalid('Senior approval must be independent from both record reviewers.');
  }

  const id = `review-decision.${crypto.randomUUID()}`;
  try {
    await context.env.CONTENT_DB.batch([
      context.env.CONTENT_DB.prepare(`
        INSERT INTO review_decisions (
          id, revision_id, reviewer_external_id, review_stage, decision, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, current.revisionId, context.user.id, stage, decision, optionalText(body.notes, 2000)),
      auditStatement(context, 'editorial.review_decided', 'record', canonicalId, {
        revisionId: current.revisionId, stage, decision,
      }),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) return conflict('This reviewer already submitted an immutable decision for this stage.');
    throw error;
  }

  let nextState = 'changes_requested';
  if (decision === 'approved' && stage === 'senior_approval') {
    nextState = 'approved';
  } else if (decision === 'approved') {
    const approvals = await count(context.env.CONTENT_DB, `
      SELECT COUNT(DISTINCT reviewer_external_id) AS count FROM review_decisions
      WHERE revision_id = '${sqlLiteral(current.revisionId)}'
        AND review_stage = 'independent_review' AND decision = 'approved'
    `);
    nextState = approvals >= 2 ? 'needs_senior_approval' : 'needs_second_review';
  }
  const stateStatements = [
    context.env.CONTENT_DB.prepare(`
      UPDATE editorial_record_state SET workflow_state = ?,
        changed_by_external_id = ?, changed_at = CURRENT_TIMESTAMP WHERE canonical_id = ?
    `).bind(nextState, context.user.id, canonicalId),
  ];
  if (decision === 'changes_requested') {
    const priorApproval = await count(context.env.CONTENT_DB, `
      SELECT COUNT(*) AS count FROM review_decisions
      WHERE revision_id = '${sqlLiteral(current.revisionId)}' AND decision = 'approved'
    `);
    if (priorApproval > 0) {
      stateStatements.push(context.env.CONTENT_DB.prepare(`
        INSERT INTO disagreement_queue (id, revision_id)
        VALUES (?, ?)
      `).bind(`disagreement.${crypto.randomUUID()}`, current.revisionId));
    }
  }
  await context.env.CONTENT_DB.batch(stateStatements);
  return json({ data: { canonicalId, revisionId: current.revisionId, stage, decision, workflowState: nextState } });
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
        assigned_to_external_id = NULL, changed_by_external_id = ?, changed_at = CURRENT_TIMESTAMP
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

async function validateBatch(context: EditorialContext, batchId: string) {
  const batch = await context.env.CONTENT_DB.prepare(`
    SELECT status FROM publication_batches WHERE id = ?
  `).bind(batchId).first<{ status: string }>();
  if (!batch) return notFound('Publication batch was not found.');
  if (batch.status !== 'draft') return conflict('Only a draft batch can be validated.');
  const invalidRows = await context.env.CONTENT_DB.prepare(`
    SELECT item.canonical_id AS canonicalId
    FROM publication_batch_items item
    JOIN editorial_record_state state ON state.canonical_id = item.canonical_id
    WHERE item.batch_id = ? AND (
      state.workflow_state <> 'approved' OR state.revision_id <> item.revision_id
      OR NOT EXISTS (
        SELECT 1 FROM canonical_references reference
        WHERE reference.canonical_id = item.canonical_id
          AND reference.revision_id = item.revision_id
          AND reference.verification_status = 'verified'
      )
    )
  `).bind(batchId).all();
  const itemCount = await count(context.env.CONTENT_DB, `
    SELECT COUNT(*) AS count FROM publication_batch_items WHERE batch_id = '${sqlLiteral(batchId)}'
  `);
  const report = { valid: invalidRows.results.length === 0 && itemCount > 0, itemCount, invalidRecords: invalidRows.results };
  await context.env.CONTENT_DB.batch([
    context.env.CONTENT_DB.prepare(`
      UPDATE publication_batches SET status = ?, validation_report_json = ? WHERE id = ?
    `).bind(report.valid ? 'validated' : 'failed', JSON.stringify(report), batchId),
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

async function listRoles({ env }: EditorialContext) {
  const rows = await env.IDENTITY_DB.prepare(`
    SELECT user.id AS userId, user.name, user.email,
           COALESCE(role.role, 'viewer') AS role,
           COALESCE(role.status, 'inactive') AS status
    FROM "user" user LEFT JOIN editorial_role_grants role ON role.user_id = user.id
    ORDER BY user.name, user.email LIMIT 500
  `).all();
  return json({ data: rows.results });
}

async function updateRole(context: EditorialContext, body: Record<string, unknown>) {
  const userId = String(body.userId ?? '');
  const role = String(body.role ?? '');
  const status = String(body.status ?? 'active');
  if (!userId || !['viewer', 'reviewer', 'senior_reviewer', 'editor', 'publisher', 'super_administrator'].includes(role)) {
    return invalid('Choose a user and supported editorial role.');
  }
  if (!['active', 'inactive'].includes(status)) return invalid('Choose active or inactive.');
  if (userId === context.user.id && (role !== 'super_administrator' || status !== 'active')) {
    return invalid('A super administrator cannot remove their own active authority.');
  }
  await context.env.IDENTITY_DB.batch([
    context.env.IDENTITY_DB.prepare(`
      INSERT INTO editorial_role_grants (user_id, role, status, granted_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, status = excluded.status,
        granted_by = excluded.granted_by, updated_at = CURRENT_TIMESTAMP
    `).bind(userId, role, status, context.user.id),
    context.env.IDENTITY_DB.prepare(`
      INSERT INTO audit_events (
        id, actor_user_id, actor_type, action, target_type, target_id, request_id, details
      ) VALUES (?, ?, 'admin', 'editorial.role_changed', 'user', ?, ?, ?)
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
