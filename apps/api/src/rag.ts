import type { Dua, Hadith } from '@fortress/contracts';
import type { ContentRepository, RagFilters } from './repositories/content-repository';
import { parseExactHadithReference } from './rag-reference';
import { expandRetrievalQuery } from './rag-synonyms';
import type { Bindings } from './types';

// bge-m3 (1024-dim, multilingual, 8192-token context) replaces bge-base-en-v1.5 (768-dim,
// English-only, ~512-token context) -- this platform's content and questions mix Arabic, English
// translation, and inconsistent transliteration (siwak/miswak, wudu/wudhu) in ways an English-only
// embedding model can't represent well. Vectorize indexes are dimension-locked at creation, so this
// requires a new index (fortress-rag-test-m3), not an in-place resize -- see wrangler.jsonc.
const EMBEDDING_MODEL = '@cf/baai/bge-m3';
// Reads the question and each candidate together rather than comparing two embeddings made in
// isolation, which is what a bi-encoder does. That difference is the whole point here: embeddings
// happily place "before entering the toilet" near half a dozen bathroom-adjacent readings, and
// nothing downstream could tell which of them actually answered the question. A cross-encoder can.
// It costs 283 Neurons per million tokens -- about half a Neuron per question -- so this is the
// cheapest part of the pipeline by two orders of magnitude.
const RERANK_MODEL = '@cf/baai/bge-reranker-base';
// Query rewriting only needs to produce a couple of alternate phrasings, so it stays on the small
// model no matter which model is answering.
const QUERY_EXPANSION_MODEL = '@cf/meta/llama-3.2-3b-instruct';
// Used when the configured models are unavailable, and for the deterministic answer path.
const FALLBACK_GENERATION_MODEL = '@cf/meta/llama-3.2-3b-instruct';
const DEFAULT_ASK_SETTINGS = {
  perIpDailyLimit: 20,
  primaryModel: '@cf/openai/gpt-oss-120b',
  primaryDailyLimit: 80,
  primarySwitchPercent: 75,
  secondaryModel: '@cf/openai/gpt-oss-20b',
  secondaryDailyLimit: 600,
};
const MAX_CONTEXTS = 6;
// Retrieve wide, then let the reranker decide. Recall is cheap (a vector query and an FTS query);
// being wrong about which six to show is not.
const RERANK_CANDIDATES = 16;
// Two cuts, because one flat threshold gets both cases wrong. The absolute floor throws out
// nonsense. The relative cut keeps only what is in the same league as the best match, which is what
// removes the tail of near-misses that made "toilet" cite five unrelated readings.
//
// The floor is deliberately low. A cross-encoder's scores are not comparable across questions: a
// plainly-worded one scores 0.98 where an indirect one ("I cannot sleep at night, what should I
// read?") scores a fraction of that against the very reading that answers it. Set high enough to
// look tidy, the floor returns "nothing found" for questions the corpus does answer -- a worse
// failure than passing a weak source to a model that must cite it and can say so when the evidence
// is thin.
const RERANK_FLOOR = 0.05;
const RERANK_RELATIVE_CUT = 0.35;
// Below this many verified/published sources, also try the unverified-content fallback --
// verified is still the primary path, this only fills gaps when it's thin.
const MIN_VERIFIED_SOURCES = 2;
const GENERATION_SYSTEM_PROMPT = 'You are the Fortress of Muslim canonical source assistant. '
  + 'Answer only from the numbered source contexts. Every non-empty paragraph must include a '
  + 'citation such as [1]. Never invent a ruling, grading, source type, attribution, or quotation. '
  + 'Do not identify text as Quran or Hadith unless the context explicitly does so. Each context '
  + 'states its own Verification status; if a context you cite is not "verified", you must say so '
  + 'explicitly in the sentence that cites it (for example, "this is not yet independently '
  + 'verified") -- never present unverified material with the same confidence as verified material. '
  + 'If the contexts are insufficient, say so. Keep the answer concise and do not provide medical, '
  + 'legal, or religious verdicts. '
  + 'Formatting, which is enforced: write ONE short paragraph, with no headings, no bullet points '
  + 'and no blank lines. Every paragraph you write must contain a bracketed citation such as [1], '
  + 'including any paragraph that only quotes the words of a supplication. An answer whose '
  + 'paragraphs are not all cited is discarded and never reaches the reader.';
const QUERY_EXPANSION_SYSTEM_PROMPT = 'Rewrite the user question into exactly 2 short alternate '
  + 'search phrasings using different but related wording -- synonyms, alternate transliterations '
  + 'of Islamic terms, or closely related concepts. Reply with exactly 2 lines, one phrasing per '
  + 'line, nothing else. Do not answer the question. Do not add numbering or punctuation beyond the '
  + 'phrasing itself.';

type EmbeddingResponse = { data: number[][] };
type GenerationResponse = { response?: string };
type IndexRow = {
  recordId: string;
  contentType: 'dua' | 'hadith';
  collectionSlug: string;
  title: string;
  narrator: string | null;
  aliases: string | null;
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

/**
 * Workers AI does not answer in one shape. Llama models return { response }, while the gpt-oss
 * models accept chat messages and reply in OpenAI's chat-completions shape -- choices[0].message
 * .content -- and can also be driven through the Responses API, which returns an output[] array of
 * reasoning and message items. Reading only { response } is why every gpt-oss answer came back
 * empty and silently became the deterministic fallback: the call succeeded, so nothing logged.
 */
export function extractAnswerText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const payload = response as Record<string, unknown>;
  if (typeof payload.response === 'string') return payload.response.trim();

  const choice = Array.isArray(payload.choices) ? payload.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === 'string') return message.content.trim();

  // Responses API: take the message items, never the reasoning ones -- a private chain of thought
  // is not an answer and must not be shown to anyone.
  if (Array.isArray(payload.output)) {
    const text = payload.output
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .filter((item) => item.type === 'message')
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object')
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  if (typeof payload.output_text === 'string') return payload.output_text.trim();
  return '';
}

export type AskSettings = typeof DEFAULT_ASK_SETTINGS;

/** Admin-controlled Ask policy. Falls back to the defaults if the row is missing or unreadable. */
export async function loadAskSettings(database: D1Database): Promise<AskSettings> {
  try {
    const row = await database.prepare(`
      SELECT per_ip_daily_limit AS perIpDailyLimit, primary_model AS primaryModel,
             primary_daily_limit AS primaryDailyLimit, primary_switch_percent AS primarySwitchPercent,
             secondary_model AS secondaryModel, secondary_daily_limit AS secondaryDailyLimit
      FROM ask_settings WHERE id = 1
    `).first<AskSettings>();
    return row ? { ...DEFAULT_ASK_SETTINGS, ...row } : DEFAULT_ASK_SETTINGS;
  } catch {
    // Ask answering questions matters more than reading its own configuration, so a missing table
    // (an environment that has not run the migration yet) falls back rather than failing the request.
    return DEFAULT_ASK_SETTINGS;
  }
}

/**
 * Which model answers this question. The better model is used until the configured share of its
 * daily allowance is spent, then the cheaper one takes over for the rest of the day: everyone still
 * gets an answer, and the day's Neurons stretch further. A limit of 0 means unlimited.
 */
export function chooseAskModel(settings: AskSettings, usage: Record<string, number>) {
  const used = (model: string) => usage[model] ?? 0;
  const primaryAllowance = settings.primaryDailyLimit === 0
    ? Number.POSITIVE_INFINITY
    : Math.floor((settings.primaryDailyLimit * settings.primarySwitchPercent) / 100);
  if (used(settings.primaryModel) < primaryAllowance) {
    return { model: settings.primaryModel, tier: 'primary' as const };
  }
  const secondaryAllowance = settings.secondaryDailyLimit === 0
    ? Number.POSITIVE_INFINITY
    : settings.secondaryDailyLimit;
  if (used(settings.secondaryModel) < secondaryAllowance) {
    return { model: settings.secondaryModel, tier: 'secondary' as const };
  }
  // Both allowances are spent. The question still gets an answer, from the cheapest model there is.
  return { model: FALLBACK_GENERATION_MODEL, tier: 'fallback' as const };
}

async function todayModelUsage(database: D1Database): Promise<Record<string, number>> {
  try {
    const rows = await database.prepare(`
      SELECT model, request_count AS requestCount FROM ask_model_usage WHERE usage_date = ?
    `).bind(utcDate()).all<{ model: string; requestCount: number }>();
    return Object.fromEntries(rows.results.map((row) => [row.model, Number(row.requestCount)]));
  } catch {
    return {};
  }
}

async function recordModelUse(database: D1Database, model: string) {
  try {
    await database.prepare(`
      INSERT INTO ask_model_usage (usage_date, model, request_count, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT (usage_date, model) DO UPDATE SET
        request_count = request_count + 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(utcDate(), model).run();
  } catch (error) {
    // Losing a counter is not worth failing an answered question over.
    console.error(JSON.stringify({ event: 'ask_usage_record_failed', model, message: errorMessage(error) }));
  }
}

const utcDate = () => new Date().toISOString().slice(0, 10);

/**
 * Scores every candidate against the question with a cross-encoder and keeps the ones that actually
 * answer it. This is what separates "before entering the bathroom" from "before undressing" when
 * someone asks about a toilet: both sit near the question in embedding space, only one answers it.
 * If the reranker is unavailable the retrieval order is kept, so Ask degrades rather than breaks.
 */
export async function rankByRelevance(env: Bindings, question: string, candidates: GroundedRecord[]) {
  if (candidates.length === 0) return { records: [] as GroundedRecord[], reranked: false };
  try {
    const contexts = candidates.map((candidate) => ({ text: rerankText(candidate) }));
    // @cloudflare/workers-types describes this model without its `query` field -- the doc comment
    // for it survives in the interface but the property does not -- so the input is cast. The field
    // is required by the model itself; without it the call returns nothing useful.
    const response = await env.AI.run(RERANK_MODEL, {
      query: question,
      contexts,
      top_k: candidates.length,
    } as unknown as Ai_Cf_Baai_Bge_Reranker_Base_Input) as Ai_Cf_Baai_Bge_Reranker_Base_Output;
    const scored = response.response;
    if (!Array.isArray(scored) || scored.length === 0) throw new Error('Reranker returned no scores.');
    const ranked = scored
      .filter((entry) => typeof entry.id === 'number' && typeof entry.score === 'number' && candidates[entry.id])
      .map((entry) => ({ ...candidates[entry.id!]!, score: entry.score! }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0]?.score ?? 0;
    const kept = ranked
      .filter((entry) => entry.score >= RERANK_FLOOR && entry.score >= best * RERANK_RELATIVE_CUT)
      .slice(0, MAX_CONTEXTS);
    if (kept.length === 0 && ranked.length > 0) {
      // Worth seeing: everything judged unrelated is either a question the corpus does not answer,
      // or a floor set too high for how this one is worded.
      console.error(JSON.stringify({
        event: 'rag_rerank_dropped_all',
        candidates: ranked.length,
        bestScore: Number(best.toFixed(4)),
      }));
    }
    return { records: kept, reranked: true };
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_rerank_failed', message: errorMessage(error) }));
    return { records: candidates.slice(0, MAX_CONTEXTS), reranked: false };
  }
}

// Title plus the reading's own words, which is what the question is really being matched against.
function rerankText(candidate: GroundedRecord) {
  const segments = candidate.contentType === 'dua'
    ? (candidate.record as Dua).parts.flat()
    : (candidate.record as Hadith).segments;
  const body = segments
    .filter((segment) => segment.kind === 'translation' || segment.kind === 'comment')
    .map((segment) => segment.text)
    .join(' ');
  return `${candidate.record.title}. ${body}`.slice(0, 1_200);
}

export async function indexRecordBatch(env: Bindings, cursor: number, limit: number) {
  const dataset = await currentDatasetRow(env.CONTENT_DB);
  const rows = await env.CONTENT_DB.prepare(`
    SELECT publication.canonical_id AS recordId,
           canonical.content_type AS contentType,
           COALESCE(collection.slug, CASE WHEN canonical.content_type = 'dua' THEN 'hisn' ELSE 'unknown' END) AS collectionSlug,
           revision.title,
           metadata.narrator,
           alias.aliases,
           publication.dataset_version_id AS datasetId,
           GROUP_CONCAT(CASE WHEN segment.kind = 'translation' THEN segment.text END, '\n') AS translation,
           GROUP_CONCAT(CASE WHEN segment.kind = 'arabic' THEN segment.text END, '\n') AS arabic
    FROM canonical_publications publication
    JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
    JOIN content_revisions revision ON revision.id = publication.revision_id
    LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
    LEFT JOIN canonical_search_aliases alias ON alias.chapter_id = metadata.chapter_id
    LEFT JOIN collections collection ON collection.id = metadata.collection_id
    LEFT JOIN revision_parts part ON part.revision_id = revision.id
    LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
    WHERE publication.publication_status = 'published'
      AND publication.dataset_version_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM canonical_withdrawals withdrawal
        WHERE withdrawal.canonical_id = publication.canonical_id
      )
    GROUP BY publication.canonical_id, publication.revision_id
    ORDER BY canonical.content_type, revision.sequence, publication.canonical_id
    LIMIT ? OFFSET ?
  `).bind(dataset.id, limit, cursor).all<IndexRow>();

  if (rows.results.length > 0) {
    try {
      const vectors: number[][] = [];
      for (const texts of embeddingCalls(rows.results.map(indexText))) {
        const embeddings = await env.AI.run(EMBEDDING_MODEL, { text: texts }) as EmbeddingResponse;
        if (embeddings.data.length !== texts.length) {
          throw new Error('Embedding response count did not match the indexing batch.');
        }
        vectors.push(...embeddings.data);
      }
      await env.VECTOR_INDEX.upsert(rows.results.map((row, index) => ({
        id: row.recordId,
        namespace: dataset.id,
        values: vectors[index]!,
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

export async function answerQuestion(
  env: Bindings,
  repository: ContentRepository,
  question: string,
  clientAddress: string,
  filters?: RagFilters,
) {
  // Settings are read after this check, not alongside it: with no published dataset there is
  // nothing to answer from, and the empty-dataset path is required to touch no storage at all.
  const dataset = await repository.getCurrentDataset();
  if (dataset.recordCount === 0) {
    return {
      answer: 'The current Fortress dataset has no published records yet. Ask will become available after an editorial batch is approved, published, and indexed.',
      sources: [],
      meta: {
        datasetId: dataset.id,
        model: null,
        remainingToday: null,
        retrievalMode: 'empty_dataset',
        vectorAvailable: false,
      },
    };
  }

  const settings = await loadAskSettings(env.CONTENT_DB);
  const remaining = await consumeDailyAllowance(env.CONTENT_DB, clientAddress, settings.perIpDailyLimit);
  const chosen = chooseAskModel(settings, await todayModelUsage(env.CONTENT_DB));

  // Some users already know exactly what they want ("Bukhari 52") rather than asking a natural
  // question -- for those, skip the multi-query embedding/lexical pipeline below and resolve the
  // reference directly. Falls through to normal retrieval if the hint doesn't match a real record
  // (it may just be an ordinary question that happens to end in a number).
  const exactReference = filters?.contentType !== 'dua' ? parseExactHadithReference(question) : null;
  if (exactReference) {
    const record = await repository.findHadithByReference(exactReference.collectionHint, exactReference.number);
    if (record && (!filters?.collection || record.collection.slug === filters.collection)) {
      const grounded: GroundedRecord[] = [{ record, contentType: 'hadith', score: 0.99, retrieval: 'lexical' }];
      const { answer, sources, model, generated } = await generateGroundedAnswer(env, dataset, question, grounded, chosen.model);
      return {
        answer,
        sources,
        meta: {
          datasetId: dataset.id,
          model,
          generated,
          remainingToday: remaining,
          retrievalMode: 'exact_reference' as const,
          vectorAvailable: false,
          includesUnverifiedSource: record.verificationStatus !== 'verified',
        },
      };
    }
  }

  // Synonym expansion (deterministic, curated) always runs; LLM query expansion adds up to 2 more
  // phrasings on top. Every variant is retrieved in parallel and merged -- this is deliberately the
  // expensive option (extra Workers AI calls on every request) over a cheaper dictionary-only or
  // embedding-only approach, so an unfamiliar transliteration or phrasing has more chances to match.
  const expandedVariants = await expandQueryVariants(env, question);
  const retrievalQueries = [question, ...expandedVariants].map(expandRetrievalQuery);
  const retrievals = await Promise.all(retrievalQueries.map((retrievalQuery) => Promise.all([
    retrieveVectorRecords(env, repository, dataset.id, retrievalQuery, filters),
    retrieveLexicalRecords(repository, retrievalQuery, filters),
  ])));
  const vectorAvailable = retrievals.some(([vectorResult]) => vectorResult.available);
  const vectorRecords = retrievals.flatMap(([vectorResult]) => vectorResult.records);
  const lexicalRecords = retrievals.flatMap(([, lexical]) => lexical);
  const candidates = mergeCandidates(vectorRecords, lexicalRecords);
  const { records: ranked, reranked } = await rankByRelevance(env, question, candidates);
  const grounded = ranked;

  let includesUnverifiedSource = false;
  if (grounded.length < MIN_VERIFIED_SOURCES) {
    const fallback = await retrieveUnverifiedFallback(repository, retrievalQueries[0]!, grounded, MAX_CONTEXTS - grounded.length, filters);
    if (fallback.length) {
      includesUnverifiedSource = true;
      grounded.push(...fallback);
    }
  }

  if (grounded.length === 0) {
    return {
      answer: 'I could not find a sufficiently grounded answer in the published Fortress sources.',
      sources: [],
      meta: {
        datasetId: dataset.id,
        model: null,
        remainingToday: remaining,
        retrievalMode: vectorAvailable ? 'hybrid' : 'lexical',
        vectorAvailable,
      },
    };
  }

  const { answer, sources, model, generated } = await generateGroundedAnswer(env, dataset, question, grounded, chosen.model);
  if (generated) await recordModelUse(env.CONTENT_DB, chosen.model);

  return {
    answer,
    sources,
    meta: {
      datasetId: dataset.id,
      model,
      modelTier: chosen.tier,
      generated,
      remainingToday: remaining,
      retrievalMode: vectorAvailable && lexicalRecords.length > 0 ? 'hybrid' : vectorAvailable ? 'vector' : 'lexical',
      reranked,
      vectorAvailable,
      includesUnverifiedSource,
    },
  };
}

async function generateGroundedAnswer(
  env: Bindings,
  dataset: { id: string },
  question: string,
  grounded: GroundedRecord[],
  chosenModel: string,
) {
  const contexts = grounded.map((item, index) => contextBlock(item.record, item.contentType, index + 1)).join('\n\n');
  const sources = grounded.map((item, index) => sourceFrom(item.record, item.contentType, item.score, index + 1));
  let answer: string;
  let model: string | null = chosenModel;
  let generated = true;
  try {
    // The model is chosen per request from admin-set daily allowances, so it cannot be a literal
    // here the way a fixed model would be.
    const response = await env.AI.run(chosenModel as Parameters<Ai['run']>[0], {
      messages: [
        { role: 'system', content: GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: `Question: ${question}\n\nSource contexts:\n${contexts}` },
      ],
      max_tokens: 650,
      temperature: 0.1,
    });
    answer = extractAnswerText(response);
    if (!answer) {
      console.error(JSON.stringify({
        event: 'rag_generation_empty',
        model: chosenModel,
        shape: Object.keys((response ?? {}) as Record<string, unknown>).join(','),
      }));
    }
    if (!hasValidCitations(answer, sources.length)) {
      // Answers are discarded unless every paragraph carries a citation. That rule protects the
      // one commitment that matters most here -- nothing is asserted about religious content
      // without a source -- but discarding silently made a well-behaved model look broken, so the
      // rejected text is logged. It is generated prose about published records, not user data.
      console.error(JSON.stringify({
        event: 'rag_generation_uncited',
        model: chosenModel,
        sourceCount: sources.length,
        answer: answer.slice(0, 300),
      }));
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
  return { answer, sources, model, generated };
}

async function expandQueryVariants(env: Bindings, question: string): Promise<string[]> {
  try {
    const response = await env.AI.run(QUERY_EXPANSION_MODEL, {
      messages: [
        { role: 'system', content: QUERY_EXPANSION_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
      max_tokens: 80,
      temperature: 0.4,
    });
    return extractAnswerText(response)
      .split('\n')
      .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
      .filter((line) => line.length >= 5 && line.length <= 200)
      .slice(0, 2);
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_query_expansion_failed', message: errorMessage(error) }));
    return [];
  }
}

// The primary retrieval above (retrieveVectorRecords/retrieveLexicalRecords via searchForRag) only
// ever considers published/verified content by design. When that comes up thin, this supplements
// it with unverified current content instead of returning nothing -- but only ever adds records
// that are NOT already verified (a verified match should already have surfaced via the primary
// path; duplicating it in here with a fabricated score would be wrong) and every one it returns
// still carries its real verificationStatus through to the generation context and the sources list,
// so the generation prompt and the frontend can both show it isn't verified.
async function retrieveUnverifiedFallback(
  repository: ContentRepository,
  question: string,
  existing: GroundedRecord[],
  limit: number,
  filters?: RagFilters,
): Promise<GroundedRecord[]> {
  if (limit <= 0) return [];
  try {
    const existingIds = new Set(existing.map((item) => item.record.id));
    const candidates = await repository.searchCurrentForRag(question, limit + existingIds.size, filters);
    const records = await Promise.all(candidates.map(async (candidate) => {
      if (existingIds.has(candidate.id)) return null;
      const record = candidate.contentType === 'dua'
        ? await repository.getDua(candidate.id)
        : await repository.getHadith(candidate.id);
      if (!record || record.verificationStatus === 'verified') return null;
      return { record, contentType: candidate.contentType, score: candidate.score, retrieval: 'lexical' as const };
    }));
    return records.filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, limit);
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_unverified_fallback_failed', message: errorMessage(error) }));
    return [];
  }
}

async function retrieveVectorRecords(
  env: Bindings,
  repository: ContentRepository,
  datasetId: string,
  question: string,
  filters?: RagFilters,
) {
  try {
    const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [question] }) as EmbeddingResponse;
    if (!embedding.data[0]) throw new Error('Question embedding was not returned.');
    const vectorFilter: Record<string, string> = {};
    if (filters?.contentType) vectorFilter.contentType = filters.contentType;
    if (filters?.collection) vectorFilter.collection = filters.collection;
    const matches = await env.VECTOR_INDEX.query(embedding.data[0], {
      namespace: datasetId,
      topK: RERANK_CANDIDATES,
      returnMetadata: 'all',
      ...(Object.keys(vectorFilter).length > 0 ? { filter: vectorFilter } : {}),
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

async function retrieveLexicalRecords(
  repository: ContentRepository,
  question: string,
  filters?: RagFilters,
): Promise<GroundedRecord[]> {
  let candidates: Awaited<ReturnType<ContentRepository['searchForRag']>>;
  try {
    candidates = await repository.searchForRag(question, RERANK_CANDIDATES, filters);
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

// Candidates for the reranker to judge, deduplicated across both retrieval paths. There is
// deliberately no score cut here any more: vector and lexical scores are not comparable to each
// other, and the floor that used to live here is why an unfamiliar wording surfaced six loosely
// related readings. The reranker decides what survives.
export function mergeCandidates(vector: GroundedRecord[], lexical: GroundedRecord[]) {
  const merged = new Map<string, GroundedRecord>();
  for (const item of [...vector, ...lexical]) {
    const current = merged.get(item.record.id);
    if (!current || item.score > current.score) merged.set(item.record.id, item);
  }
  return [...merged.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, RERANK_CANDIDATES);
}

// The count is kept even when the limit is off, so turning the limit back on has real numbers
// behind it and the Admin Console can show what a day actually looks like.
async function consumeDailyAllowance(database: D1Database, clientAddress: string, limit: number) {
  const date = utcDate();
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
  if (limit === 0) return null;
  const used = row?.requestCount ?? limit + 1;
  if (used > limit) throw new RagRateLimitError();
  return limit - used;
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

// Workers AI pads every input in an embedding call to the longest one, and rejects a call whose
// padded total exceeds the model's context -- 60,000 tokens for bge-m3. Fifty Hisn readings in one
// call failed as "Max context reached 81200 tokens": 50 inputs x the 1,624 tokens of the longest.
// So a batch is split into calls sized by that padded cost. Tokens are estimated at one per
// character, which overstates the ~0.6 measured on this corpus and leaves room for denser text.
export const EMBEDDING_CALL_TOKEN_BUDGET = 40_000;

export function embeddingCalls(texts: string[]): string[][] {
  const calls: string[][] = [];
  let call: string[] = [];
  let longest = 0;
  for (const text of texts) {
    const widened = Math.max(longest, text.length);
    if (call.length > 0 && (call.length + 1) * widened > EMBEDDING_CALL_TOKEN_BUDGET) {
      calls.push(call);
      call = [];
      longest = 0;
    }
    call.push(text);
    longest = Math.max(longest, text.length);
  }
  if (call.length > 0) calls.push(call);
  return calls;
}

function indexText(row: IndexRow) {
  // Aliases ride along in the embedded text for the same reason they are in the lexical index: the
  // words a reader uses are often not the words the book uses.
  return [row.title, row.collectionSlug, row.narrator, row.aliases, row.translation, row.arabic]
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
  const paragraphs = answer.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return citations.length > 0
    && citations.every((citation) => citation >= 1 && citation <= sourceCount)
    && paragraphs.every((paragraph) => /\[\d+\]/.test(paragraph));
}

function groundedFallback(sources: RagSource[]) {
  const references = sources.slice(0, 3).map((source) => `${source.title} [${source.index}]`).join('; ');
  return `I found relevant published Fortress sources, but could not generate a fully cited answer. Review: ${references}.`;
}

function hadithReference(record: Hadith) {
  return `${record.collection.title} ${record.displayNumber}`;
}

function normalizeLegacyTypography(value: string) {
  let repaired = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const decoded = decodeLegacyUtf8(repaired);
    if (decoded === repaired) break;
    repaired = decoded;
  }
  return repaired
    .replaceAll('\u00cb\u00b9', "'")
    .replaceAll('\u00cb\u00ba', "'")
    .replaceAll('\u02f9', "'")
    .replaceAll('\u02fa', "'")
    .replaceAll('\u2019', "'")
    .replaceAll('\u201c', '"')
    .replaceAll('\u201d', '"')
    .replaceAll('\u2013', '-')
    .replaceAll('\u00c2', '');
}

function decodeLegacyUtf8(value: string) {
  if (!/[\u00c2-\u00c5\u00cb\u00e1\u00e2]/u.test(value)) return value;
  const windows1252 = new Map<number, number>([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
    [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
    [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
    [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  ]);
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const byte = codePoint <= 0xff ? codePoint : windows1252.get(codePoint);
    if (byte === undefined) return value;
    bytes.push(byte);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return value;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class RagRateLimitError extends Error {
  constructor() { super('Daily assistant limit reached.'); }
}
