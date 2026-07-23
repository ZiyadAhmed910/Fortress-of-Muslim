import type { Dua, Hadith } from '@fortress/contracts';
import type { ContentRepository } from './repositories/content-repository';
import type { Bindings } from './types';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const GENERATION_MODEL = '@cf/meta/llama-3.2-3b-instruct';
const DAILY_ASK_LIMIT = 20;
const MAX_CONTEXTS = 6;

type EmbeddingResponse = { data: number[][] };
type GenerationResponse = { response?: string };
type IndexRow = {
  recordId: string;
  contentType: 'dua' | 'hadith';
  collectionSlug: string;
  title: string;
  narrator: string | null;
  translation: string | null;
  arabic: string | null;
  datasetId: string;
};
type GroundedRecord = {
  record: Dua | Hadith;
  contentType: 'dua' | 'hadith';
  score: number;
  metadata?: Record<string, string>;
  retrieval: 'vector' | 'lexical';
};

export type RagSource = {
  index: number;
  id: string;
  contentType: 'dua' | 'hadith';
  title: string;
  collection: string;
  reference: string;
  canonicalUrl: string;
  verificationStatus: string;
  score: number;
};

export async function indexRecordBatch(env: Bindings, cursor: number, limit: number) {
  const dataset = await currentDatasetRow(env.CONTENT_DB);
  const rows = await env.CONTENT_DB.prepare(`
    SELECT publication.canonical_id AS recordId,
           canonical.content_type AS contentType,
           COALESCE(collection.slug, CASE WHEN canonical.content_type = 'dua' THEN 'hisn' ELSE 'unknown' END) AS collectionSlug,
           revision.title,
           metadata.narrator,
           publication.dataset_version_id AS datasetId,
           GROUP_CONCAT(CASE WHEN segment.kind = 'translation' THEN segment.text END, '\n') AS translation,
           GROUP_CONCAT(CASE WHEN segment.kind = 'arabic' THEN segment.text END, '\n') AS arabic
    FROM canonical_publications publication
    JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
    JOIN content_revisions revision ON revision.id = publication.revision_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    LEFT JOIN collections collection ON collection.id = metadata.collection_id
    LEFT JOIN revision_parts part ON part.revision_id = revision.id
    LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
    WHERE publication.publication_status = 'published'
      AND publication.dataset_version_id = ?
    GROUP BY publication.canonical_id, publication.revision_id
    ORDER BY canonical.content_type, revision.sequence, publication.canonical_id
    LIMIT ? OFFSET ?
  `).bind(dataset.id, limit, cursor).all<IndexRow>();

  if (rows.results.length > 0) {
    try {
      const texts = rows.results.map(indexText);
      const embeddings = await env.AI.run(EMBEDDING_MODEL, { text: texts }) as EmbeddingResponse;
      if (embeddings.data.length !== rows.results.length) {
        throw new Error('Embedding response count did not match the indexing batch.');
      }
      await env.VECTOR_INDEX.upsert(rows.results.map((row, index) => ({
        id: row.recordId,
        namespace: dataset.id,
        values: embeddings.data[index]!,
        metadata: {
          recordId: row.recordId,
          contentType: row.contentType,
          collection: row.collectionSlug,
          title: row.title.slice(0, 300),
          revisionDataset: row.datasetId,
        },
      })));
    } catch (error) {
      await updateIndexState(env.CONTENT_DB, dataset.id, dataset.recordCount, cursor, 'failed', errorMessage(error).slice(0, 1000));
      throw error;
    }
  }

  const indexedCount = cursor + rows.results.length;
  const complete = rows.results.length < limit || indexedCount >= dataset.recordCount;
  await updateIndexState(env.CONTENT_DB, dataset.id, dataset.recordCount, indexedCount, complete ? 'ready' : 'indexing', null);
  return {
    datasetId: dataset.id,
    expected: dataset.recordCount,
    indexed: rows.results.length,
    indexedTotal: indexedCount,
    nextCursor: complete ? null : indexedCount,
    complete,
  };
}

export async function indexNextPendingBatch(env: Bindings, limit = 50) {
  const dataset = await currentDatasetRow(env.CONTENT_DB);
  const state = await env.CONTENT_DB.prepare(`
    SELECT indexed_count AS indexedCount, status
    FROM rag_index_state
    WHERE dataset_version_id = ?
  `).bind(dataset.id).first<{
    indexedCount: number;
    status: 'pending' | 'indexing' | 'ready' | 'failed';
  }>();
  if (dataset.recordCount === 0 || state?.status === 'ready') {
    return { datasetId: dataset.id, skipped: true, reason: 'already_ready' };
  }
  return indexRecordBatch(env, state?.indexedCount ?? 0, limit);
}

export async function getRagStatus(env: Bindings, repository: ContentRepository) {
  const dataset = await repository.getCurrentDataset();
  const [state, counts] = await Promise.all([
    env.CONTENT_DB.prepare(`
    SELECT expected_count AS expectedCount, indexed_count AS indexedCount, status,
           last_error AS lastError, updated_at AS updatedAt, completed_at AS completedAt
    FROM rag_index_state
    WHERE dataset_version_id = ?
  `).bind(dataset.id).first<{
    expectedCount: number;
    indexedCount: number;
    status: 'pending' | 'indexing' | 'ready' | 'failed';
    lastError: string | null;
    updatedAt: string;
    completedAt: string | null;
    }>(),
    env.CONTENT_DB.prepare(`
      SELECT canonical.content_type AS contentType, COUNT(*) AS count
      FROM canonical_dataset_items item
      JOIN canonical_records canonical ON canonical.canonical_id = item.canonical_id
      WHERE item.dataset_version_id = ?
      GROUP BY canonical.content_type
    `).bind(dataset.id).all<{ contentType: 'dua' | 'hadith'; count: number }>(),
  ]);
  const contentCounts = Object.fromEntries(counts.results.map((row) => [row.contentType, row.count]));
  return {
    datasetId: dataset.id,
    recordCount: dataset.recordCount,
    contentCounts: {
      dua: Number(contentCounts.dua ?? 0),
      hadith: Number(contentCounts.hadith ?? 0),
    },
    status: dataset.recordCount === 0 ? 'empty' : (state?.status ?? 'pending'),
    indexedCount: state?.indexedCount ?? 0,
    expectedCount: state?.expectedCount ?? dataset.recordCount,
    lastError: state?.lastError ?? null,
    updatedAt: state?.updatedAt ?? null,
    completedAt: state?.completedAt ?? null,
  };
}

export async function answerQuestion(env: Bindings, repository: ContentRepository, question: string, clientAddress: string) {
  const dataset = await repository.getCurrentDataset();
  if (dataset.recordCount === 0) {
    return {
      answer: 'The current Fortress dataset has no published records yet. Ask will become available after an editorial batch is approved, published, and indexed.',
      sources: [],
      meta: {
        datasetId: dataset.id,
        model: null,
        remainingToday: DAILY_ASK_LIMIT,
        retrievalMode: 'empty_dataset',
        vectorAvailable: false,
      },
    };
  }

  const remaining = await consumeDailyAllowance(env.CONTENT_DB, clientAddress);
  const [vectorResult, lexicalRecords] = await Promise.all([
    retrieveVectorRecords(env, repository, dataset.id, question),
    retrieveLexicalRecords(repository, question),
  ]);
  const grounded = mergeGrounded(vectorResult.records, lexicalRecords);
  if (grounded.length === 0) {
    return {
      answer: 'I could not find a sufficiently grounded answer in the published Fortress sources.',
      sources: [],
      meta: {
        datasetId: dataset.id,
        model: null,
        remainingToday: remaining,
        retrievalMode: vectorResult.available ? 'hybrid' : 'lexical',
        vectorAvailable: vectorResult.available,
      },
    };
  }

  const contexts = grounded.map((item, index) => contextBlock(item.record, item.contentType, index + 1)).join('\n\n');
  const sources = grounded.map((item, index) => sourceFrom(item.record, item.contentType, item.score, index + 1));
  let answer: string;
  let model: string | null = GENERATION_MODEL;
  let generated = true;
  try {
    const response = await env.AI.run(GENERATION_MODEL, {
      messages: [
        {
          role: 'system',
          content: 'You are the Fortress of Muslim canonical source assistant. Answer only from the numbered published contexts. Cite every factual or religious claim with [n]. Never invent a ruling, grading, attribution, or quotation. If the contexts are insufficient, say so. Keep the answer concise and do not provide medical, legal, or religious verdicts.',
        },
        { role: 'user', content: `Question: ${question}\n\nSource contexts:\n${contexts}` },
      ],
      max_tokens: 650,
      temperature: 0.1,
    }) as GenerationResponse;
    answer = response.response?.trim() ?? '';
    if (!hasValidCitations(answer, sources.length)) {
      answer = groundedFallback(sources);
      generated = false;
      model = null;
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_generation_failed', datasetId: dataset.id, message: errorMessage(error) }));
    answer = groundedFallback(sources);
    generated = false;
    model = null;
  }

  return {
    answer,
    sources,
    meta: {
      datasetId: dataset.id,
      model,
      generated,
      remainingToday: remaining,
      retrievalMode: vectorResult.available && lexicalRecords.length > 0 ? 'hybrid' : vectorResult.available ? 'vector' : 'lexical',
      vectorAvailable: vectorResult.available,
    },
  };
}

async function retrieveVectorRecords(env: Bindings, repository: ContentRepository, datasetId: string, question: string) {
  try {
    const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [question] }) as EmbeddingResponse;
    if (!embedding.data[0]) throw new Error('Question embedding was not returned.');
    const matches = await env.VECTOR_INDEX.query(embedding.data[0], {
      namespace: datasetId,
      topK: MAX_CONTEXTS,
      returnMetadata: 'all',
    });
    const records = await Promise.all(matches.matches.map(async (match) => {
      const metadata = match.metadata as Record<string, string> | undefined;
      const id = metadata?.recordId ?? match.id;
      const contentType: 'dua' | 'hadith' = metadata?.contentType === 'dua' ? 'dua' : 'hadith';
      const record = contentType === 'dua'
        ? await repository.getPublishedDua(id)
        : await repository.getPublishedHadith(id);
      return record ? { record, contentType, score: match.score, metadata, retrieval: 'vector' as const } : null;
    }));
    return {
      available: true,
      records: records.filter((item): item is NonNullable<typeof item> => Boolean(item)),
    };
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_vector_retrieval_failed', datasetId, message: errorMessage(error) }));
    return { available: false, records: [] as GroundedRecord[] };
  }
}

async function retrieveLexicalRecords(repository: ContentRepository, question: string): Promise<GroundedRecord[]> {
  let candidates: Awaited<ReturnType<ContentRepository['searchForRag']>>;
  try {
    candidates = await repository.searchForRag(question, MAX_CONTEXTS);
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_lexical_retrieval_failed', message: errorMessage(error) }));
    return [];
  }
  const records = await Promise.all(candidates.map(async (candidate) => {
    const record = candidate.contentType === 'dua'
      ? await repository.getPublishedDua(candidate.id)
      : await repository.getPublishedHadith(candidate.id);
    return record ? {
      record,
      contentType: candidate.contentType,
      score: candidate.score,
      retrieval: 'lexical' as const,
    } : null;
  }));
  return records.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function mergeGrounded(vector: GroundedRecord[], lexical: GroundedRecord[]) {
  const merged = new Map<string, GroundedRecord>();
  for (const item of [...vector, ...lexical]) {
    const current = merged.get(item.record.id);
    if (!current || item.score > current.score) merged.set(item.record.id, item);
  }
  const ranked = [...merged.values()].sort((left, right) => right.score - left.score);
  const bestScore = ranked[0]?.score ?? 0;
  const evidenceFloor = Math.max(0.58, bestScore - 0.18);
  return ranked.filter((item) => item.score >= evidenceFloor).slice(0, MAX_CONTEXTS);
}

async function consumeDailyAllowance(database: D1Database, clientAddress: string) {
  const date = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${date}:${clientAddress}`));
  const clientHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const row = await database.prepare(`
    INSERT INTO rag_daily_usage (usage_date, client_hash, request_count, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (usage_date, client_hash) DO UPDATE SET
      request_count = request_count + 1,
      updated_at = CURRENT_TIMESTAMP
    RETURNING request_count AS requestCount
  `).bind(date, clientHash).first<{ requestCount: number }>();
  const used = row?.requestCount ?? DAILY_ASK_LIMIT + 1;
  if (used > DAILY_ASK_LIMIT) throw new RagRateLimitError();
  return DAILY_ASK_LIMIT - used;
}

async function currentDatasetRow(database: D1Database) {
  const row = await database.prepare(`
    SELECT id, record_count AS recordCount
    FROM canonical_dataset_versions
    WHERE publication_status = 'published'
    ORDER BY published_at DESC, created_at DESC
    LIMIT 1
  `).first<{ id: string; recordCount: number }>();
  if (!row) throw new Error('No canonical dataset is published.');
  return row;
}

async function updateIndexState(
  database: D1Database,
  datasetId: string,
  expected: number,
  indexed: number,
  status: 'indexing' | 'ready' | 'failed',
  error: string | null,
) {
  await database.prepare(`
    INSERT INTO rag_index_state (
      dataset_version_id, expected_count, indexed_count, status, last_error, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CASE WHEN ? = 'ready' THEN CURRENT_TIMESTAMP ELSE NULL END)
    ON CONFLICT (dataset_version_id) DO UPDATE SET
      expected_count = excluded.expected_count,
      indexed_count = excluded.indexed_count,
      status = excluded.status,
      last_error = excluded.last_error,
      updated_at = CURRENT_TIMESTAMP,
      completed_at = CASE WHEN excluded.status = 'ready' THEN CURRENT_TIMESTAMP ELSE rag_index_state.completed_at END
  `).bind(datasetId, expected, indexed, status, error, status).run();
}

function indexText(row: IndexRow) {
  return [row.title, row.collectionSlug, row.narrator, row.translation, row.arabic]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4_000);
}

function contextBlock(record: Dua | Hadith, contentType: 'dua' | 'hadith', index: number) {
  const segments = contentType === 'dua'
    ? (record as Dua).parts.flat()
    : (record as Hadith).segments;
  const text = segments.map((segment) => `${segment.kind}: ${normalizeLegacyTypography(segment.text)}`).join('\n').slice(0, 8_000);
  const summary = contentType === 'hadith' ? hadithReference(record as Hadith) : record.title;
  return `[${index}] ${record.title}\nReference: ${summary}\nVerification: ${record.verificationStatus}\n${text}`;
}

function sourceFrom(record: Dua | Hadith, contentType: 'dua' | 'hadith', score: number, index: number): RagSource {
  const collection = contentType === 'hadith' ? (record as Hadith).collection.title : 'Hisn al-Muslim';
  return {
    index,
    id: record.id,
    contentType,
    title: record.title,
    collection,
    reference: contentType === 'hadith' ? hadithReference(record as Hadith) : record.title,
    canonicalUrl: record.canonicalUrl,
    verificationStatus: record.verificationStatus,
    score: Number(score.toFixed(4)),
  };
}

function hasValidCitations(answer: string, sourceCount: number) {
  if (!answer) return false;
  const citations = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  return citations.length > 0 && citations.every((citation) => citation >= 1 && citation <= sourceCount);
}

function groundedFallback(sources: RagSource[]) {
  const references = sources.slice(0, 3).map((source) => `${source.title} [${source.index}]`).join('; ');
  return `I found relevant published Fortress sources, but could not generate a fully cited answer. Review: ${references}.`;
}

function hadithReference(record: Hadith) {
  return `${record.collection.title} ${record.displayNumber}`;
}

function normalizeLegacyTypography(value: string) {
  return value
    .replaceAll('Ë¹', "'")
    .replaceAll('Ëº', "'")
    .replaceAll('â€™', "'")
    .replaceAll('â€œ', '"')
    .replaceAll('â€', '"')
    .replaceAll('â€“', '-')
    .replaceAll('Â', '');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class RagRateLimitError extends Error {
  constructor() { super('Daily assistant limit reached.'); }
}
