import type { Dua, Hadith } from '@fortress/contracts';
import type { ContentRepository, RagFilters } from './repositories/content-repository';
import { parseExactHadithReference } from './rag-reference';
import { detectAskIntent, type AskIntent } from './rag-intent';
import { expandRetrievalQuery } from './rag-synonyms';
import { ayahRerankText, quranCandidates } from './quran-search';
import type { Bindings } from './types';

// bge-m3 (1024-dim, multilingual, 8192-token context) replaces bge-base-en-v1.5 (768-dim,
// English-only, ~512-token context) -- this platform's content and questions mix Arabic, English
// translation, and inconsistent transliteration (siwak/miswak, wudu/wudhu) in ways an English-only
// embedding model can't represent well. Vectorize indexes are dimension-locked at creation, so this
// requires a new index (fortress-rag-test-m3), not an in-place resize -- see wrangler.jsonc.
export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
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
  // Off: the query behind it has no index, and one question can read ~200,000 rows. See 0021.
  unverifiedFallback: 0,
};
const MAX_CONTEXTS = 6;
// gpt-oss is a reasoning model: it writes a private chain of thought before the answer, and those
// tokens come out of the same budget. At 650 the reasoning could consume all of it and the model
// returned an empty string -- which became the deterministic fallback, so most questions showed
// "could not generate a fully cited answer" while displaying the right sources. It got worse the
// moment verse contexts gained their Arabic, because a longer context means longer reasoning.
// The answer itself is a short paragraph; nearly all of this is headroom for thinking.
const GENERATION_MAX_TOKENS = 2_000;
// How much of one record reaches the prompt. 8,000 characters each, six at a time, was ~16,000
// tokens of input per question -- paid for on every question, and more to reason through. A
// reading or a hadith says what it says well inside this.
const CONTEXT_TEXT_LIMIT = 1_500;
// Retrieve wide, then let the reranker decide. Recall is cheap (a vector query and an FTS query);
// being wrong about which six to show is not.
const RERANK_CANDIDATES = 16;
// How many verses join the pool Ask reranks. Smaller than the record side because the Quran is one
// book against 14,625 records, and a question about a dua should not drown in ayahs.
const QURAN_ASK_CANDIDATES = 8;
// Context slots held for the Quran when verses were retrieved and cleared the relevance floor. A
// floor rather than a cap -- see composeContexts().
const VERSE_SLOTS = 2;
// The reranker is used to order candidates, not to judge whether an answer exists. bge-reranker-base
// is the only reranker Workers AI offers, and its absolute scores are not comparable across
// questions: the same reading scores 0.81 for "When angry" and under 0.05 for "what should I recite
// when I am angry?". Every threshold high enough to look tidy therefore answered "nothing found" to
// ordinary questions the book plainly answers.
//
// So: a floor low enough to catch only nonsense, and a relative cut that keeps what is in the same
// league as the best match -- which is what actually removes the tail of near-misses that had
// "toilet" citing five unrelated readings. Sufficiency is judged where it can be judged properly,
// by a model that must cite every paragraph and is told to say when the sources do not answer.
const RERANK_FLOOR = 0.01;
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
  + 'Formatting, which is enforced: keep it short, with no headings and no bullet points. Every '
  + 'sentence that states something must carry a bracketed citation such as [1]. Arabic you are '
  + 'quoting from a source may stand on its own line without one -- it is that source speaking. An '
  + 'answer that asserts anything uncited is discarded and never reaches the reader.';
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
/**
 * A Quran verse, shaped to travel through the same pipeline as a dua or a hadith. It is not an
 * editorial record -- no revision, no reviewer, no workflow -- so it carries only what retrieval,
 * ranking and citation need, and reports itself as verified because the mushaf is not something a
 * reviewer stamps.
 */
export type AyahRecord = {
  id: string;
  title: string;
  canonicalUrl: string;
  verificationStatus: 'verified';
  surah: number;
  ayah: number;
  surahName: string;
  arabic: string;
  translation: string;
};

export type AskRecord = Dua | Hadith | AyahRecord;

/**
 * What Ask can be scoped to. Wider than the repository's RagFilters because "quran" is not a kind
 * of record it stores -- it means "answer from verses instead", so it is resolved before any
 * repository call rather than passed down into one.
 */
export type AskScope = { contentType?: 'dua' | 'hadith' | 'quran'; collection?: string };

/** Narrows an Ask scope to what the repository understands; a Quran scope means no records. */
const recordScope = (scope?: AskScope): RagFilters | undefined =>
  (!scope || scope.contentType === 'quran' ? undefined : scope as RagFilters);

type GroundedRecord = {
  record: AskRecord;
  contentType: 'dua' | 'hadith' | 'quran';
  score: number;
  metadata?: Record<string, string>;
  retrieval: 'vector' | 'lexical';
};

export type RagSource = {
  index: number;
  id: string;
  contentType: 'dua' | 'hadith' | 'quran';
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
             secondary_model AS secondaryModel, secondary_daily_limit AS secondaryDailyLimit,
             unverified_fallback AS unverifiedFallback
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
/**
 * Orders anything by how well it answers a query, and cuts what is nowhere near the best match.
 * Returns null when the reranker is unavailable, so the caller decides what to do without a
 * ranking rather than being handed a silently unranked list.
 *
 * Generic because Quran search reranks ayahs with the same model, the same floor and the same
 * relative cut, and duplicating that meant duplicating the cast below and the reasoning above the
 * two constants.
 */
export async function rerankByRelevance<T>(
  env: Bindings,
  query: string,
  items: T[],
  toText: (item: T) => string,
  keep: number,
  { relativeCut = true } = {},
): Promise<Array<{ item: T; score: number }> | null> {
  try {
    // @cloudflare/workers-types describes this model without its `query` field -- the doc comment
    // for it survives in the interface but the property does not -- so the input is cast. The field
    // is required by the model itself; without it the call returns nothing useful.
    const response = await env.AI.run(RERANK_MODEL, {
      query,
      contexts: items.map((item) => ({ text: toText(item) })),
      top_k: items.length,
    } as unknown as Ai_Cf_Baai_Bge_Reranker_Base_Input) as Ai_Cf_Baai_Bge_Reranker_Base_Output;
    const scored = response.response;
    if (!Array.isArray(scored) || scored.length === 0) throw new Error('Reranker returned no scores.');
    const ranked = scored
      .filter((entry) => typeof entry.id === 'number' && typeof entry.score === 'number' && items[entry.id])
      .map((entry) => ({ item: items[entry.id!]!, score: entry.score! }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0]?.score ?? 0;
    const kept = ranked
      .filter((entry) => entry.score >= RERANK_FLOOR && (!relativeCut || entry.score >= best * RERANK_RELATIVE_CUT))
      .slice(0, keep);
    if (kept.length === 0 && ranked.length > 0) {
      // Worth seeing: everything judged unrelated is either a question the corpus does not answer,
      // or a floor set too high for how this one is worded.
      console.error(JSON.stringify({
        event: 'rag_rerank_dropped_all',
        candidates: ranked.length,
        bestScore: Number(best.toFixed(4)),
      }));
    }
    return kept;
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_rerank_failed', message: errorMessage(error) }));
    return null;
  }
}

export async function rankByRelevance(env: Bindings, question: string, candidates: GroundedRecord[], keep = MAX_CONTEXTS) {
  if (candidates.length === 0) return { records: [] as GroundedRecord[], reranked: false };
  // The relative cut is left to composeContexts(), which applies it within each kind.
  const kept = await rerankByRelevance(env, question, candidates, rerankText, keep, { relativeCut: false });
  if (!kept) return { records: candidates.slice(0, keep), reranked: false };
  return { records: kept.map((entry) => ({ ...entry.item, score: entry.score })), reranked: true };
}

const isVerse = (item: GroundedRecord) => item.contentType === 'quran';

/**
 * Chooses the six contexts an answer is written from.
 *
 * Two things happen here that reranking alone got wrong once the Quran joined the corpus.
 *
 * The relevance cut is applied within each kind rather than across both. It exists to drop a tail of
 * near-misses, and it does that by comparing against the best candidate -- which is sound among
 * things of one kind and wrong across two. The Quran is one book against 14,625 records, so on a
 * common theme the best hadith scores far above the best verse, and every verse fell under a cut
 * calculated from a hadith: "what does the Quran say about patience?" came back citing four hadith
 * and not one verse. Whether a verse answers the question is judged against the other verses.
 *
 * Then the Quran is guaranteed a couple of slots when verses survived that cut. It is a floor, never
 * a cap -- when verses rank highly they take as many slots as they earn.
 */
export function composeContexts(ranked: GroundedRecord[], intent: AskIntent = null) {
  const withinKind = (items: GroundedRecord[]) => {
    const best = items[0]?.score ?? 0;
    return items.filter((item) => item.score >= best * RERANK_RELATIVE_CUT);
  };
  const verses = withinKind(ranked.filter(isVerse));
  const records = withinKind(ranked.filter((item) => !isVerse(item)));

  // A question that names a kind of source gets more of it. "Find tawakkul in the Quran" and "what
  // did the Prophet say about intentions" are asking for different things, and retrieval scores
  // cannot tell -- they see topical similarity, on which the 14,357 hadith outnumber everything.
  // A preference, not a filter: the wanted kind leads, the others still appear, because the wording
  // is a hint and a wrong guess must not be able to hide the answer.
  const wantsVerses = intent === 'quran';
  const preferred = intent && intent !== 'quran'
    ? records.filter((item) => item.contentType === intent)
    : [];
  const quota = wantsVerses
    ? Math.min(verses.length, MAX_CONTEXTS - 1)
    : Math.min(VERSE_SLOTS, verses.length);
  const chosen = [
    ...verses.slice(0, quota),
    ...preferred.slice(0, Math.max(MAX_CONTEXTS - quota - 1, 0)),
    ...records.filter((item) => !preferred.includes(item)).slice(0, MAX_CONTEXTS - quota - preferred.length),
  ].filter((item, index, all) => all.indexOf(item) === index).slice(0, MAX_CONTEXTS);
  // Anything still unfilled goes to whichever kind has more left, so a Quran-only or record-only
  // question still gets six contexts rather than two.
  if (chosen.length < MAX_CONTEXTS) {
    const rest = [...verses.slice(quota), ...records.slice(MAX_CONTEXTS - quota)]
      .sort((left, right) => right.score - left.score);
    chosen.push(...rest.slice(0, MAX_CONTEXTS - chosen.length));
  }
  return chosen.sort((left, right) => right.score - left.score);
}

// Title plus the reading's own words, which is what the question is really being matched against.
function rerankText(candidate: GroundedRecord) {
  if (candidate.contentType === 'quran') {
    const verse = asAyah(candidate.record);
    return ayahRerankText(verse.surahName, verse.surah, verse.ayah, verse.translation).slice(0, 1_200);
  }
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

/**
 * One cron tick of indexing. The batch was 50 while the corpus was 268 duas, where it finished in
 * six minutes; at 14,625 records that same batch is a five-hour backfill. The cost of a bigger
 * batch is subrequests, not CPU -- embedding calls are already split to fit the model's context by
 * embeddingCalls(), and awaiting them burns no CPU time -- and 200 records is a handful of AI calls
 * and one vector upsert against a paid limit of 1,000 subrequests per invocation.
 */
export async function indexNextPendingBatch(env: Bindings, limit = 200) {
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

/**
 * What an Ask request answers with. Written out rather than inferred because the pipeline returns
 * from several places -- no dataset, nothing grounded, or a real generated answer -- and the fields
 * that only a generated answer carries have to be optional for all of them to be one type.
 */
export type AskAnswer = {
  answer: string;
  sources: RagSource[];
  meta: {
    datasetId: string;
    model: string | null;
    modelTier?: 'primary' | 'secondary' | 'fallback';
    generated?: boolean;
    remainingToday: number | null;
    retrievalMode: string;
    reranked?: boolean;
    vectorAvailable: boolean;
    includesUnverifiedSource?: boolean;
    /** The question was a follow-up and was rewritten to stand alone before retrieval. */
    rewritten?: boolean;
  };
};

/**
 * Everything up to generation: the policy reads, retrieval, reranking and the grounded records.
 * The streaming and non-streaming endpoints share it so they cannot drift into making different
 * decisions -- the only difference between them is how the finished answer is delivered.
 */
async function prepareGrounding(
  env: Bindings,
  repository: ContentRepository,
  question: string,
  clientAddress: string,
  filters?: AskScope,
  history?: AskTurn[],
) {
  // Settings are read after this check, not alongside it: with no published dataset there is
  // nothing to answer from, and the empty-dataset path is required to touch no storage at all.
  const dataset = await repository.getCurrentDataset();
  if (dataset.recordCount === 0) {
    return {
      ready: false as const,
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

  // The query-expansion model is asked first and awaited last. It is a whole round trip to a
  // language model that the base question's own retrieval does not depend on, so it now runs while
  // the policy rows are read and while the question itself is already being retrieved. It used to
  // sit in front of all of that, adding its latency to every question asked.
  // A follow-up has to be made standalone before anything can be retrieved on it, so unlike the
  // expansion below this cannot be overlapped -- it decides what the query even is. It only runs
  // when there is a conversation behind the question.
  const { query: retrievalQuestion, rewritten } = await contextualiseQuestion(env, question, history);
  const expansion = expandQueryVariants(env, retrievalQuestion);
  const baseQuery = expandRetrievalQuery(retrievalQuestion);
  // "Quran" is a scope rather than a record filter: the ayahs live outside the editorial corpus, so
  // asking for them means asking for no records at all, and the repository only understands duas
  // and hadith.
  const wantsRecords = filters?.contentType !== 'quran';
  const wantsVerses = !filters?.contentType || filters.contentType === 'quran';
  const recordFilters: RagFilters | undefined = wantsRecords
    ? (filters as RagFilters | undefined)
    : undefined;
  const baseRetrieval = wantsRecords
    ? Promise.all([
      retrieveVectorRecords(env, repository, dataset.id, baseQuery, recordFilters),
      retrieveLexicalRecords(repository, baseQuery, recordFilters),
    ])
    : Promise.resolve([{ available: false, records: [] }, []] as const);
  // Verses are retrieved alongside the records and reranked with them, so "what is tawakkul" is
  // answered from the Quran -- which is where that concept mostly lives -- rather than from whatever
  // dua happened to sit nearest it in embedding space. They are sources like any other: cited,
  // never interpreted, and held to the same rule that every claim names where it came from.
  const verses = wantsVerses
    ? quranCandidates(env, baseQuery, QURAN_ASK_CANDIDATES).catch(() => ({ rows: [], vectorAvailable: false }))
    : Promise.resolve({ rows: [], vectorAvailable: false });

  const [settings, usage] = await Promise.all([
    loadAskSettings(env.CONTENT_DB),
    todayModelUsage(env.CONTENT_DB),
  ]);
  const remaining = await consumeDailyAllowance(env.CONTENT_DB, clientAddress, settings.perIpDailyLimit);
  const chosen = chooseAskModel(settings, usage);

  // Some users already know exactly what they want ("Bukhari 52") rather than asking a natural
  // question -- for those, skip the multi-query embedding/lexical pipeline below and resolve the
  // reference directly. Falls through to normal retrieval if the hint doesn't match a real record
  // (it may just be an ordinary question that happens to end in a number).
  const exactReference = filters?.contentType !== 'dua' ? parseExactHadithReference(question) : null;
  if (exactReference) {
    const record = await repository.findHadithByReference(exactReference.collectionHint, exactReference.number);
    if (record && (!filters?.collection || record.collection.slug === filters.collection)) {
      return {
        ready: true as const,
        dataset,
        chosen,
        remaining,
        grounded: [{ record, contentType: 'hadith' as const, score: 0.99, retrieval: 'lexical' as const }],
        // Logged like any other question. Nothing was ranked -- a reference was resolved directly --
        // and the counts say so rather than being left out.
        telemetry: {
          retrievalQuery: baseQuery,
          scope: filters?.contentType,
          rewritten,
          vectorCandidates: 0,
          lexicalCandidates: 1,
          verseCandidates: 0,
          reranked: false,
        },
        retrievalMode: 'exact_reference' as const,
        reranked: false,
        vectorAvailable: false,
        includesUnverifiedSource: record.verificationStatus !== 'verified',
      };
    }
  }

  // Synonym expansion (deterministic, curated) always runs; LLM query expansion adds up to 2 more
  // phrasings on top. Every variant is retrieved and merged -- this is deliberately the expensive
  // option (extra Workers AI calls on every request) over a cheaper dictionary-only or
  // embedding-only approach, so an unfamiliar transliteration or phrasing has more chances to match.
  const variantRetrievals = await Promise.all((await expansion).map((variant) => {
    const retrievalQuery = expandRetrievalQuery(variant);
    return Promise.all([
      retrieveVectorRecords(env, repository, dataset.id, retrievalQuery, filters),
      retrieveLexicalRecords(repository, retrievalQuery, filters),
    ]);
  }));
  const retrievals = [await baseRetrieval, ...variantRetrievals];
  const vectorAvailable = retrievals.some(([vectorResult]) => vectorResult.available);
  const vectorRecords = retrievals.flatMap(([vectorResult]) => vectorResult.records);
  const lexicalRecords = retrievals.flatMap(([, lexical]) => lexical);
  const { rows: ayahs } = await verses;
  const candidates = [
    ...mergeCandidates(vectorRecords, lexicalRecords),
    ...ayahs.map((row): GroundedRecord => ({
      record: {
        id: `quran.${row.surah}.${row.ayah}`,
        title: `Quran ${row.surah}:${row.ayah}`,
        canonicalUrl: `https://fortressofmuslim.org/quran/${row.surah}/${row.ayah}`,
        verificationStatus: 'verified',
        surah: row.surah,
        ayah: row.ayah,
        surahName: row.surahNameSimple,
        arabic: row.arabic,
        translation: row.translation,
      },
      contentType: 'quran',
      score: 0,
      retrieval: 'vector',
    })),
  ];
  // Reranked on the expanded query, not the raw question. The expansion exists because a word can
  // name a concept that the sources only ever render in other words, and the reranker has the same
  // vocabulary problem retrieval does: asked to score verses against "what is tawakkul?" -- a term
  // in no English translation -- it put everything under the floor and Ask answered "nothing found"
  // while plain verse search, which reranks on the expanded text, returned the right verses.
  const { records: ranked, reranked } = await rankByRelevance(env, baseQuery, candidates, RERANK_CANDIDATES);
  // Read from the question as typed -- the rewritten follow-up is for retrieval, and the words a
  // person chose are what say which kind of source they want.
  const intent = filters?.contentType ? null : detectAskIntent(question);
  const grounded = composeContexts(ranked, intent);
  const telemetry = {
    retrievalQuery: baseQuery,
    scope: filters?.contentType,
    rewritten,
    vectorCandidates: vectorRecords.length,
    lexicalCandidates: lexicalRecords.length,
    verseCandidates: ayahs.length,
    reranked,
  };

  if (settings.unverifiedFallback === 1 && grounded.length < MIN_VERIFIED_SOURCES) {
    const fallback = await retrieveUnverifiedFallback(repository, baseQuery, grounded, MAX_CONTEXTS - grounded.length, filters);
    if (fallback.length) grounded.push(...fallback);
  }

  // Read off the records themselves rather than set by whichever code path added them. This flag
  // used to mean "the unverified-content fallback contributed something", which was the only way
  // an unverified record could appear -- until 0022 published 14,357 unverified hadith through the
  // ordinary path. Every source was then marked unverified individually while the answer as a whole
  // reported none, so the PWA's banner above the answer stayed hidden on exactly the answers it
  // exists for.
  const includesUnverifiedSource = grounded.some((item) => item.record.verificationStatus !== 'verified');

  if (grounded.length === 0) {
    return {
      ready: false as const,
      telemetry,
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

  return {
    ready: true as const,
    dataset,
    chosen,
    remaining,
    grounded,
    retrievalMode: vectorAvailable && lexicalRecords.length > 0 ? 'hybrid' as const
      : vectorAvailable ? 'vector' as const : 'lexical' as const,
    reranked,
    vectorAvailable,
    includesUnverifiedSource,
    rewritten,
    telemetry,
  };
}

export async function answerQuestion(
  env: Bindings,
  repository: ContentRepository,
  question: string,
  clientAddress: string,
  filters?: AskScope,
  history?: AskTurn[],
): Promise<AskAnswer> {
  const prepared = await prepareGrounding(env, repository, question, clientAddress, filters, history);
  if (!prepared.ready) {
    if (prepared.telemetry) {
      await logAskQuery(env, { question, ...prepared.telemetry, sources: [], model: null, generated: false });
    }
    return { answer: prepared.answer, sources: prepared.sources, meta: prepared.meta };
  }

  const { answer, sources, model, generated, rejected } = await generateGroundedAnswer(
    env, prepared.dataset, question, prepared.grounded, prepared.chosen.model,
  );
  if (generated) await recordModelUse(env.CONTENT_DB, prepared.chosen.model);
  await logAskQuery(env, { question, ...prepared.telemetry, sources, model, generated, rejected });

  return {
    answer,
    sources,
    meta: {
      datasetId: prepared.dataset.id,
      model,
      modelTier: prepared.chosen.tier,
      generated,
      remainingToday: prepared.remaining,
      retrievalMode: prepared.retrievalMode,
      reranked: prepared.reranked,
      vectorAvailable: prepared.vectorAvailable,
      includesUnverifiedSource: prepared.includesUnverifiedSource,
      rewritten: prepared.rewritten,
    },
  };
}

const encoder = new TextEncoder();
const sseEvent = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * One chunk of a streamed reply, in whichever shape the model streams in -- the same problem
 * extractAnswerText() solves for whole responses, and with the same rule: never return reasoning.
 * A reasoning model streams its thinking too, and that must not reach a reader.
 */
export function extractDeltaText(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') return '';
  const record = chunk as Record<string, unknown>;
  if (typeof record.response === 'string') return record.response;
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const delta = (choices[0] as Record<string, unknown> | undefined)?.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === 'string') return delta.content;
  }
  if (record.type === 'response.output_text.delta' && typeof record.delta === 'string') return record.delta;
  return '';
}

/** Reads Workers AI's server-sent stream and yields each parsed data payload. */
async function* readModelStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            yield JSON.parse(payload) as unknown;
          } catch {
            // A frame split across reads is normal; a malformed one is not worth failing over.
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * The same answer as answerQuestion, delivered as it is written instead of all at once.
 *
 * Retrieval, reranking and generation take seconds that no amount of tuning removes -- a question
 * costs an embedding call, a vector query, a lexical query, a reranker call and then a language
 * model writing an answer. What a reader actually experienced, though, was a blank panel for all
 * of it. This opens the connection immediately, names the stage it is on, shows the sources as
 * soon as retrieval has them, and then writes the answer word by word.
 *
 * The citation rule is unchanged and still absolute: every paragraph must cite a source. It can
 * only be checked once the text is complete, so an answer that fails it is replaced -- the client
 * is told to discard what it has shown and render the deterministic source list instead. That is
 * rare enough to log and too important to relax.
 */
export function streamAnswer(
  env: Bindings,
  repository: ContentRepository,
  question: string,
  clientAddress: string,
  filters?: AskScope,
  history?: AskTurn[],
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(sseEvent(event, data));
      try {
        send('status', { stage: 'retrieving' });
        const prepared = await prepareGrounding(env, repository, question, clientAddress, filters, history);
        if (!prepared.ready) {
          send('sources', { sources: prepared.sources, meta: prepared.meta });
          send('done', { answer: prepared.answer, meta: prepared.meta });
          return;
        }

        const sources = prepared.grounded.map((item, index) => sourceFrom(item.record, item.contentType, item.score, index + 1));
        const baseMeta = {
          datasetId: prepared.dataset.id,
          modelTier: prepared.chosen.tier,
          remainingToday: prepared.remaining,
          retrievalMode: prepared.retrievalMode,
          reranked: prepared.reranked,
          vectorAvailable: prepared.vectorAvailable,
          includesUnverifiedSource: prepared.includesUnverifiedSource,
          rewritten: prepared.rewritten,
        };
        send('sources', { sources, meta: { ...baseMeta, model: prepared.chosen.model, generated: true } });
        send('status', { stage: 'writing' });

        const contexts = prepared.grounded
          .map((item, index) => contextBlock(item.record, item.contentType, index + 1))
          .join('\n\n');
        let answer = '';
        let generated = true;
        let rejectedText: string | null = null;
        try {
          const stream = await env.AI.run(prepared.chosen.model as Parameters<Ai['run']>[0], {
            messages: [
              { role: 'system', content: GENERATION_SYSTEM_PROMPT },
              { role: 'user', content: `Question: ${question}\n\nSource contexts:\n${contexts}` },
            ],
            max_tokens: GENERATION_MAX_TOKENS,
            temperature: 0.1,
            stream: true,
          }) as unknown as ReadableStream<Uint8Array>;
          for await (const chunk of readModelStream(stream)) {
            const text = extractDeltaText(chunk);
            if (!text) continue;
            answer += text;
            send('delta', { text });
          }
        } catch (error) {
          console.error(JSON.stringify({ event: 'rag_stream_failed', datasetId: prepared.dataset.id, message: errorMessage(error) }));
          answer = '';
        }

        answer = answer.trim();
        if (!answer || !hasValidCitations(answer, sources.length)) {
          if (answer) {
            console.error(JSON.stringify({
              event: 'rag_generation_uncited',
              model: prepared.chosen.model,
              sourceCount: sources.length,
              answer: answer.slice(0, 300),
            }));
          }
          rejectedText = answer;
          answer = groundedFallback(sources);
          generated = false;
          send('replace', { answer });
        }
        if (generated) await recordModelUse(env.CONTENT_DB, prepared.chosen.model);
        await logAskQuery(env, {
          question,
          ...prepared.telemetry,
          sources,
          model: generated ? prepared.chosen.model : null,
          generated,
          rejected: rejectedText,
        });
        send('done', {
          answer,
          meta: { ...baseMeta, model: generated ? prepared.chosen.model : null, generated },
        });
      } catch (error) {
        const rateLimited = error instanceof RagRateLimitError;
        if (!rateLimited) {
          console.error(JSON.stringify({ event: 'rag_stream_aborted', message: errorMessage(error) }));
        }
        // Headers went out with the first byte, so a failure cannot become a status code any more.
        // It is reported in the stream instead, with the code the non-streaming endpoint would use.
        send('error', {
          code: rateLimited ? 'rate_limited' : 'ask_failed',
          message: rateLimited ? errorMessage(error) : 'Ask could not complete this answer. Please try again.',
        });
      } finally {
        controller.close();
      }
    },
  });
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
  // Kept for the log: what the citation rule threw away is the only evidence for whether it is set
  // right, and it used to exist nowhere but a Worker log.
  let rejected: string | null = null;
  try {
    // The model is chosen per request from admin-set daily allowances, so it cannot be a literal
    // here the way a fixed model would be.
    const response = await env.AI.run(chosenModel as Parameters<Ai['run']>[0], {
      messages: [
        { role: 'system', content: GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: `Question: ${question}\n\nSource contexts:\n${contexts}` },
      ],
      max_tokens: GENERATION_MAX_TOKENS,
      temperature: 0.1,
    });
    answer = extractAnswerText(response);
    if (!answer) {
      // Distinguished in the log from an answer rejected for citations: the causes and the fixes are
      // nothing alike, and both previously arrived as the same fallback text.
      rejected = '(model returned no text)';
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
      rejected = answer;
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
  return { answer, sources, model, generated, rejected };
}

const FOLLOW_UP_SYSTEM_PROMPT = 'Rewrite the final user question into one standalone question that '
  + 'can be understood without the conversation before it. Resolve pronouns and references ("it", '
  + '"that one", "what about after?") using the earlier turns. Keep it short and keep the user\'s '
  + 'own words wherever they already stand alone. Reply with the rewritten question only -- no '
  + 'preamble, no answer, no explanation.';

export type AskTurn = { question: string; answer: string };

/**
 * Turns a follow-up into something retrievable.
 *
 * "What about returning?" is a perfectly clear question to a person who just read an answer about
 * travelling, and meaningless to a retrieval pipeline: there is no verse, reading or hadith about
 * "returning" in the abstract. Rewriting it against the conversation is what makes a second turn
 * work at all.
 *
 * The rewrite is the only thing history is used for. It never becomes a source, never reaches the
 * generation prompt, and cannot be cited -- an answer still comes from retrieved records only. That
 * boundary is the whole reason this is a query rewrite and not a chat transcript passed through to
 * the model: an assistant that can quote its own previous answers can launder an ungrounded claim
 * into a later turn as though it were sourced.
 *
 * Falls back to joining the previous question with this one, which is worse than a real rewrite and
 * much better than retrieving on "what about returning?" alone.
 */
export async function contextualiseQuestion(
  env: Bindings,
  question: string,
  history: AskTurn[] | undefined,
): Promise<{ query: string; rewritten: boolean }> {
  if (!history?.length) return { query: question, rewritten: false };
  const recent = history.slice(-3);
  try {
    const transcript = recent
      .map((turn) => `Q: ${turn.question}\nA: ${turn.answer.slice(0, 400)}`)
      .join('\n\n');
    const response = await env.AI.run(QUERY_EXPANSION_MODEL, {
      messages: [
        { role: 'system', content: FOLLOW_UP_SYSTEM_PROMPT },
        { role: 'user', content: `${transcript}\n\nFinal question: ${question}` },
      ],
      max_tokens: 80,
      temperature: 0.2,
    });
    const rewritten = extractAnswerText(response).split('\n')[0]?.trim() ?? '';
    // A rewrite that came back empty, enormous, or shorter than the question it replaced is a
    // failed rewrite, not a better question.
    if (rewritten.length < 5 || rewritten.length > 300) throw new Error('Unusable rewrite.');
    return { query: rewritten, rewritten: true };
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_follow_up_rewrite_failed', message: errorMessage(error) }));
    const previous = recent.at(-1)?.question ?? '';
    return { query: `${previous} ${question}`.trim().slice(0, 500), rewritten: false };
  }
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
  filters?: AskScope,
): Promise<GroundedRecord[]> {
  if (limit <= 0) return [];
  try {
    const existingIds = new Set(existing.map((item) => item.record.id));
    const candidates = await repository.searchCurrentForRag(question, limit + existingIds.size, recordScope(filters));
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
  filters?: AskScope,
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
        ? await repository.getAskDua(id)
        : await repository.getAskHadith(id);
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
  filters?: AskScope,
): Promise<GroundedRecord[]> {
  let candidates: Awaited<ReturnType<ContentRepository['searchForRag']>>;
  try {
    candidates = await repository.searchForRag(question, RERANK_CANDIDATES, recordScope(filters));
  } catch (error) {
    console.error(JSON.stringify({ event: 'rag_lexical_retrieval_failed', message: errorMessage(error) }));
    return [];
  }
  const records = await Promise.all(candidates.map(async (candidate) => {
    const record = candidate.contentType === 'dua'
      ? await repository.getAskDua(candidate.id)
      : await repository.getAskHadith(candidate.id);
    return record ? {
      record,
      contentType: candidate.contentType,
      score: candidate.score,
      retrieval: 'lexical' as const,
    } : null;
  }));
  return records.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

// Candidates for the reranker to judge, taken from both retrieval paths in turn rather than
// pooled and sorted together. Their scores are not comparable -- a vector cosine and a bm25-derived
// lexical score mean different things -- so ranking them against each other and keeping the top 16
// silently starved the reranker of the very record it needed: "what should I recite when I am
// angry?" retrieved the chapter literally titled "When angry" lexically, lost it in that sort, and
// answered that nothing was found. Interleaving guarantees each path gets its best candidates in
// front of the judge; the judge then decides on merit.
export function mergeCandidates(vector: GroundedRecord[], lexical: GroundedRecord[]) {
  const byPath = [
    [...vector].sort((left, right) => right.score - left.score),
    [...lexical].sort((left, right) => right.score - left.score),
  ];
  const merged = new Map<string, GroundedRecord>();
  for (let rank = 0; merged.size < RERANK_CANDIDATES; rank += 1) {
    const exhausted = byPath.every((path) => rank >= path.length);
    if (exhausted) break;
    for (const path of byPath) {
      const candidate = path[rank];
      if (!candidate || merged.size >= RERANK_CANDIDATES) continue;
      const current = merged.get(candidate.record.id);
      if (!current || candidate.score > current.score) merged.set(candidate.record.id, candidate);
    }
  }
  return [...merged.values()];
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

/** Narrows a record the pipeline has already tagged as a verse. */
const asAyah = (record: AskRecord) => record as AyahRecord;

/**
 * Records what a question retrieved, so retrieval can be improved from evidence.
 *
 * Every gap found so far was found by hand -- "toilet" citing bathroom-adjacent readings, "when
 * angry" returning nothing, "tawakkul" returning nothing, a Quran question citing only hadith. Each
 * cost a person noticing and a session of digging. This writes the same information down as it
 * happens.
 *
 * Never allowed to affect the answer: a logging failure is swallowed, because a question that was
 * answered correctly must not fail on the way out because a write did. Carries no IP and no
 * identifier -- see migration 0027.
 */
async function logAskQuery(env: Bindings, entry: {
  question: string;
  retrievalQuery: string;
  scope?: string;
  rewritten: boolean;
  vectorCandidates: number;
  lexicalCandidates: number;
  verseCandidates: number;
  reranked: boolean;
  sources: RagSource[];
  model: string | null;
  generated: boolean;
  rejected?: string | null;
}) {
  try {
    await env.CONTENT_DB.prepare(`
      INSERT INTO ask_query_log (
        question, retrieval_query, scope, rewritten,
        vector_candidates, lexical_candidates, verse_candidates,
        reranked, sources, model, generated, rejected_answer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entry.question.slice(0, 500),
      entry.retrievalQuery.slice(0, 1_000),
      entry.scope ?? null,
      entry.rewritten ? 1 : 0,
      entry.vectorCandidates,
      entry.lexicalCandidates,
      entry.verseCandidates,
      entry.reranked ? 1 : 0,
      JSON.stringify(entry.sources.map((source) => ({
        id: source.id,
        contentType: source.contentType,
        score: source.score,
      }))),
      entry.model,
      entry.generated ? 1 : 0,
      entry.rejected ? entry.rejected.slice(0, 2_000) : null,
    ).run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'ask_query_log_failed', message: errorMessage(error) }));
  }
}

function contextBlock(record: AskRecord, contentType: 'dua' | 'hadith' | 'quran', index: number) {
  if (contentType === 'quran') {
    const verse = asAyah(record);
    // Labelled as Quran explicitly: the prompt forbids the model calling anything Quran unless its
    // context says so, and here the context truthfully does.
    // The Arabic is given, in full, because otherwise the model writes it from memory. It did
    // exactly that when the context carried the translation alone -- producing Quranic text that
    // trailed off in an ellipsis, recalled rather than quoted. There is nothing this platform should
    // be more careful about, so the words come from the source or they do not appear.
    return [
      `[${index}] ${verse.title}`,
      `Reference: Quran ${verse.surah}:${verse.ayah} (Surah ${verse.surahName})`,
      'Verification: verified',
      `arabic: ${verse.arabic}`,
      `translation: ${normalizeLegacyTypography(verse.translation)}`,
    ].join('\n');
  }
  const segments = contentType === 'dua'
    ? (record as Dua).parts.flat()
    : (record as Hadith).segments;
  const text = segments.map((segment) => `${segment.kind}: ${normalizeLegacyTypography(segment.text)}`).join('\n').slice(0, 8_000);
  const summary = contentType === 'hadith' ? hadithReference(record as Hadith) : record.title;
  return `[${index}] ${record.title}\nReference: ${summary}\nVerification: ${record.verificationStatus}\n${text}`;
}

function sourceFrom(record: AskRecord, contentType: 'dua' | 'hadith' | 'quran', score: number, index: number): RagSource {
  if (contentType === 'quran') {
    const verse = asAyah(record);
    return {
      index,
      id: verse.id,
      contentType,
      title: verse.title,
      collection: 'The Quran',
      reference: `${verse.surahName} ${verse.surah}:${verse.ayah}`,
      canonicalUrl: verse.canonicalUrl,
      verificationStatus: verse.verificationStatus,
      score: Number(score.toFixed(4)),
    };
  }
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

/**
 * A line that is mostly Arabic is the source's own words being quoted, not a claim being made about
 * them, so it does not need a citation of its own.
 *
 * This distinction is why good answers were being thrown away. Asked for the travel supplication,
 * the model would write a cited sentence and put the dua itself on the following line -- exactly the
 * shape a person wants -- and the whole answer was replaced by "could not generate a fully cited
 * answer" because that line had no [1] on it. The reader saw a non-answer listing source titles.
 */
function isQuotedText(paragraph: string) {
  const letters = paragraph.replace(/[^\p{L}]/gu, '');
  if (!letters) return true;                                    // digits or punctuation alone
  const arabic = (letters.match(/\p{Script=Arabic}/gu) ?? []).length;
  return arabic / letters.length >= 0.5;
}

/**
 * The rule that protects the one thing Ask promises: nothing is asserted about religious content
 * without a source. Every paragraph that makes a claim must cite one, and every citation must point
 * at a source that exists. Quoted scripture is exempt -- it is the cited source speaking.
 */
function hasValidCitations(answer: string, sourceCount: number) {
  if (!answer) return false;
  const citations = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  if (citations.length === 0) return false;
  if (!citations.every((citation) => citation >= 1 && citation <= sourceCount)) return false;

  const paragraphs = answer.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const cited = (paragraph?: string) => Boolean(paragraph && /\[\d+\]/.test(paragraph));
  return paragraphs.every((paragraph, index) => {
    if (isQuotedText(paragraph) || cited(paragraph)) return true;
    // A line that introduces the quotation beneath it ("Before entering the toilet one says:")
    // asserts nothing the citation below does not already carry. Requiring its own [1] rejected
    // whole correct answers for punctuation, which is how the most natural shape for a supplication
    // -- a lead-in, the Arabic, then the cited translation -- kept being thrown away.
    const leadIn = paragraph.endsWith(':') && paragraph.length <= 160;
    return leadIn && paragraphs.slice(index + 1).some(cited);
  });
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

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class RagRateLimitError extends Error {
  constructor() { super('Daily assistant limit reached.'); }
}
