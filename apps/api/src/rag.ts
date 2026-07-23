import type { Dua, Hadith } from '@fortress/contracts';
import type { ContentRepository } from './repositories/content-repository';
import type { Bindings } from './types';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const GENERATION_MODEL = '@cf/meta/llama-3.2-3b-instruct';
const DAILY_ASK_LIMIT = 20;

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
  const rows = await env.CONTENT_DB.prepare(`
    SELECT COALESCE(record.logical_id, record.id) AS recordId,
           record.content_type AS contentType, collection.slug AS collectionSlug,
           record.title, metadata.narrator, publication.dataset_version_id AS datasetId,
           GROUP_CONCAT(CASE WHEN segment.kind = 'translation' THEN segment.text END, '\n') AS translation,
           GROUP_CONCAT(CASE WHEN segment.kind = 'arabic' THEN segment.text END, '\n') AS arabic
    FROM content_records record
    JOIN canonical_publications publication ON publication.record_id = record.id
    JOIN record_placements placement ON placement.record_id = record.id
    JOIN collections collection ON collection.id = placement.collection_id
    JOIN content_parts part ON part.record_id = record.id
    JOIN content_segments segment ON segment.part_id = part.id
    LEFT JOIN hadith_metadata metadata ON metadata.record_id = record.id
    WHERE publication.publication_status = 'published'
    GROUP BY record.id
    ORDER BY record.content_type, record.sequence
    LIMIT ? OFFSET ?
  `).bind(limit, cursor).all<IndexRow>();
  if (rows.results.length === 0) return { indexed: 0, nextCursor: null, complete: true };

  const texts = rows.results.map(indexText);
  const embeddings = await env.AI.run(EMBEDDING_MODEL, { text: texts }) as EmbeddingResponse;
  if (embeddings.data.length !== rows.results.length) throw new Error('Embedding response count did not match the indexing batch.');
  await env.VECTOR_INDEX.upsert(rows.results.map((row, index) => ({
    id: row.recordId,
    namespace: row.datasetId,
    values: embeddings.data[index]!,
    metadata: {
      recordId: row.recordId,
      contentType: row.contentType,
      collection: row.collectionSlug,
      title: row.title.slice(0, 300),
    },
  })));
  return { indexed: rows.results.length, nextCursor: cursor + rows.results.length, complete: rows.results.length < limit };
}

export async function answerQuestion(env: Bindings, repository: ContentRepository, question: string, clientAddress: string) {
  const remaining = await consumeDailyAllowance(env.CONTENT_DB, clientAddress);
  const dataset = await repository.getCurrentDataset();
  const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [question] }) as EmbeddingResponse;
  if (!embedding.data[0]) throw new Error('Question embedding was not returned.');
  const matches = await env.VECTOR_INDEX.query(embedding.data[0], {
    namespace: dataset.id,
    topK: 6,
    returnMetadata: 'all',
  });
  const records = await Promise.all(matches.matches.map(async (match) => {
    const metadata = match.metadata as Record<string, string> | undefined;
    const id = metadata?.recordId ?? match.id;
    const contentType: 'dua' | 'hadith' = metadata?.contentType === 'dua' ? 'dua' : 'hadith';
    const record = contentType === 'dua' ? await repository.getDua(id) : await repository.getHadith(id);
    return record ? { record, contentType, score: match.score, metadata } : null;
  }));
  const grounded = records.filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (grounded.length === 0) {
    return {
      answer: 'I could not find a sufficiently grounded answer in the indexed Fortress sources.',
      sources: [],
      meta: { datasetId: dataset.id, model: GENERATION_MODEL, remainingToday: remaining },
    };
  }
  const contexts = grounded.map((item, index) => contextBlock(item.record, item.contentType, index + 1)).join('\n\n');
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
  const sources = grounded.map((item, index) => sourceFrom(item.record, item.contentType, item.score, item.metadata, index + 1));
  return {
    answer: response.response?.trim() || 'The assistant did not return an answer.',
    sources,
    meta: { datasetId: dataset.id, model: GENERATION_MODEL, remainingToday: remaining },
  };
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
  const text = segments.map((segment) => `${segment.kind}: ${segment.text}`).join('\n').slice(0, 8_000);
  const summary = contentType === 'hadith' ? hadithReference(record as Hadith) : record.title;
  return `[${index}] ${record.title}\nReference: ${summary}\nVerification: ${record.verificationStatus}\n${text}`;
}

function sourceFrom(record: Dua | Hadith, contentType: 'dua' | 'hadith', score: number, metadata: Record<string, string> | undefined, index: number): RagSource {
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

function hadithReference(record: Hadith) {
  return `${record.collection.title} ${record.displayNumber}`;
}

export class RagRateLimitError extends Error {
  constructor() { super('Daily assistant limit reached.'); }
}
