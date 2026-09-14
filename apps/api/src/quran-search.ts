import { EMBEDDING_MODEL, embeddingCalls, errorMessage, rerankByRelevance } from './rag';
import type { Bindings } from './types';

// Its own namespace in the shared Vectorize index. Ask queries a dataset namespace and so can never
// retrieve an ayah, and this can never retrieve a dua -- which is the point. Ask answers questions
// from cited sources; this finds verses and lets the reader read them.
export const QURAN_NAMESPACE = 'quran.saheeh.v1';
const QURAN_CANDIDATES = 24;
const QURAN_RESULTS = 10;

type EmbeddingResponse = { data: number[][] };
type AyahRow = {
  surah: number;
  ayah: number;
  surahNameSimple: string;
  surahNameEnglish: string;
  revelationPlace: string;
  translation: string;
};

/**
 * What a search returns. No verse text: the Saheeh International translation is not
 * redistributable, so the API answers with references and the client renders the words from the
 * copy it already ships offline. See migration 0024.
 */
export type QuranMatch = {
  surah: number;
  ayah: number;
  reference: string;
  surahName: string;
  surahNameEnglish: string;
  revelationPlace: string;
  score: number;
  retrieval: 'vector' | 'lexical';
};

const referenceOf = (row: { surah: number; ayah: number }) => `${row.surah}:${row.ayah}`;
const keyOf = referenceOf;

/** FTS5 tolerates very little punctuation, and a question is mostly punctuation and stop words. */
function toFtsQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 12);
  if (terms.length === 0) return '';
  return terms.map((term) => `"${term}"*`).join(' OR ');
}

async function lexicalAyahs(database: D1Database, query: string, limit: number): Promise<AyahRow[]> {
  const match = toFtsQuery(query);
  if (!match) return [];
  const result = await database.prepare(`
    SELECT ayahs.surah, ayahs.ayah,
           ayahs.surah_name_simple AS surahNameSimple,
           ayahs.surah_name_english AS surahNameEnglish,
           ayahs.revelation_place AS revelationPlace,
           ayahs.translation
    FROM quran_search_fts search
    JOIN quran_ayahs ayahs ON ayahs.surah = search.surah AND ayahs.ayah = search.ayah
    WHERE quran_search_fts MATCH ?
    ORDER BY bm25(quran_search_fts), ayahs.surah, ayahs.ayah
    LIMIT ?
  `).bind(match, limit).all<AyahRow>();
  return result.results ?? [];
}

async function vectorAyahs(env: Bindings, query: string, limit: number): Promise<AyahRow[]> {
  const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [query] }) as EmbeddingResponse;
  if (!embedding.data[0]) throw new Error('Query embedding was not returned.');
  const matches = await env.VECTOR_INDEX.query(embedding.data[0], {
    namespace: QURAN_NAMESPACE,
    topK: limit,
    returnMetadata: 'none',
  });
  const keys = matches.matches.map((match) => match.id);
  if (keys.length === 0) return [];
  // Vector ids are "surah:ayah", and the rows come back in one query rather than one per hit.
  // Matched on a single integer (no surah has 1,000 ayahs, so surah*1000+ayah is unique) rather
  // than a row-value IN (VALUES ...), which is exotic SQL and compares as text -- where an integer
  // bound as a float quietly becomes "65.0:3.0" and matches nothing.
  const numericKeys = keys.map((key) => {
    const [surah, ayah] = key.split(':');
    return Number(surah) * 1000 + Number(ayah);
  });
  const result = await env.CONTENT_DB.prepare(`
    SELECT surah, ayah, surah_name_simple AS surahNameSimple, surah_name_english AS surahNameEnglish,
           revelation_place AS revelationPlace, translation
    FROM quran_ayahs
    WHERE surah * 1000 + ayah IN (${numericKeys.map(() => '?').join(', ')})
  `).bind(...numericKeys).all<AyahRow>();
  const byKey = new Map((result.results ?? []).map((row) => [keyOf(row), row]));
  // Keep the vector order: it is a ranking, and the map lookup would otherwise discard it.
  return keys.map((key) => byKey.get(key)).filter((row): row is AyahRow => Boolean(row));
}

/**
 * Finds the verses a theme asks for. "An ayah about tawakkul" is the case this exists for: the word
 * appears nowhere in an English translation, "reliance upon Allah" does, and only an embedding
 * bridges that. Lexical search runs alongside it for the opposite case -- someone half-remembering
 * a phrase and wanting the exact verse.
 *
 * There is no generation step. Nothing here explains what a verse means: it returns which verses
 * relate to the theme and lets the reader read them. That keeps it honest about interpretation and
 * makes it several seconds faster than Ask, which is what a person quoting a verse actually wants.
 */
export async function searchQuran(env: Bindings, query: string, limit = QURAN_RESULTS) {
  const [vector, lexical] = await Promise.all([
    vectorAyahs(env, query, QURAN_CANDIDATES).catch((error) => {
      console.error(JSON.stringify({ event: 'quran_vector_search_failed', message: errorMessage(error) }));
      return [] as AyahRow[];
    }),
    lexicalAyahs(env.CONTENT_DB, query, QURAN_CANDIDATES).catch((error) => {
      console.error(JSON.stringify({ event: 'quran_lexical_search_failed', message: errorMessage(error) }));
      return [] as AyahRow[];
    }),
  ]);

  // Interleave rather than pool: a cosine distance and a bm25 rank are not comparable numbers, and
  // sorting them against each other is what used to drop the obviously-right lexical hit.
  const seen = new Set<string>();
  const source = new Map<string, 'vector' | 'lexical'>();
  const candidates: AyahRow[] = [];
  for (let index = 0; index < Math.max(vector.length, lexical.length); index += 1) {
    for (const [row, path] of [[vector[index], 'vector'], [lexical[index], 'lexical']] as const) {
      if (!row || seen.has(keyOf(row))) continue;
      seen.add(keyOf(row));
      source.set(keyOf(row), path);
      candidates.push(row);
    }
  }
  if (candidates.length === 0) return { matches: [] as QuranMatch[], reranked: false, vectorAvailable: vector.length > 0 };

  const ranked = await rerankByRelevance(
    env,
    query,
    candidates.slice(0, QURAN_CANDIDATES),
    (row) => `${row.surahNameSimple} ${row.surah}:${row.ayah} -- ${row.translation}`,
    limit,
  );
  const ordered = ranked ?? candidates.slice(0, limit).map((row) => ({ item: row, score: 0 }));
  return {
    matches: ordered.map(({ item, score }) => ({
      surah: item.surah,
      ayah: item.ayah,
      reference: referenceOf(item),
      surahName: item.surahNameSimple,
      surahNameEnglish: item.surahNameEnglish,
      revelationPlace: item.revelationPlace,
      score: Number(score.toFixed(4)),
      retrieval: source.get(keyOf(item)) ?? 'lexical',
    })),
    reranked: ranked !== null,
    vectorAvailable: vector.length > 0,
  };
}

/** Progress of the embedding pass, so a half-built index is visible rather than silently thin. */
export async function getQuranIndexStatus(env: Bindings) {
  const state = await env.CONTENT_DB.prepare(`
    SELECT expected_count AS expectedCount, indexed_count AS indexedCount, status,
           last_error AS lastError, updated_at AS updatedAt, completed_at AS completedAt
    FROM quran_index_state WHERE namespace = ?
  `).bind(QURAN_NAMESPACE).first<{
    expectedCount: number;
    indexedCount: number;
    status: string;
    lastError: string | null;
    updatedAt: string;
    completedAt: string | null;
  }>();
  return {
    namespace: QURAN_NAMESPACE,
    status: state?.status ?? 'pending',
    indexedCount: state?.indexedCount ?? 0,
    expectedCount: state?.expectedCount ?? 0,
    lastError: state?.lastError ?? null,
    updatedAt: state?.updatedAt ?? null,
    completedAt: state?.completedAt ?? null,
  };
}

/**
 * One cron tick of Quran embedding. Walks the ayahs in order, so the cursor is just how many are
 * done -- the same shape as the record indexer, and restartable for the same reason.
 */
export async function indexQuranBatch(env: Bindings, limit = 200) {
  const state = await env.CONTENT_DB.prepare(
    'SELECT indexed_count AS indexedCount, status FROM quran_index_state WHERE namespace = ?',
  ).bind(QURAN_NAMESPACE).first<{ indexedCount: number; status: string }>();
  if (!state || state.status === 'ready') return { skipped: true, reason: 'already_ready' as const };

  const rows = await env.CONTENT_DB.prepare(`
    SELECT surah, ayah, surah_name_simple AS surahNameSimple, translation
    FROM quran_ayahs ORDER BY surah, ayah LIMIT ? OFFSET ?
  `).bind(limit, state.indexedCount).all<{ surah: number; ayah: number; surahNameSimple: string; translation: string }>();
  const batch = rows.results ?? [];
  if (batch.length === 0) {
    await env.CONTENT_DB.prepare(`
      UPDATE quran_index_state SET status = 'ready', completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE namespace = ?
    `).bind(QURAN_NAMESPACE).run();
    return { complete: true, indexedTotal: state.indexedCount };
  }

  try {
    // The surah name rides along in the embedded text so "verses in Al-Kahf about patience" has
    // something to match on beyond the translation itself.
    const texts = batch.map((row) => `${row.surahNameSimple} ${row.surah}:${row.ayah}. ${row.translation}`);
    const vectors: number[][] = [];
    for (const call of embeddingCalls(texts)) {
      const embeddings = await env.AI.run(EMBEDDING_MODEL, { text: call }) as EmbeddingResponse;
      if (embeddings.data.length !== call.length) throw new Error('Embedding response count did not match the batch.');
      vectors.push(...embeddings.data);
    }
    await env.VECTOR_INDEX.upsert(batch.map((row, index) => ({
      id: `${row.surah}:${row.ayah}`,
      namespace: QURAN_NAMESPACE,
      values: vectors[index]!,
    })));
    const indexedTotal = state.indexedCount + batch.length;
    await env.CONTENT_DB.prepare(`
      UPDATE quran_index_state
      SET indexed_count = ?, status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP,
          completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE namespace = ?
    `).bind(
      indexedTotal,
      indexedTotal >= (await quranAyahCount(env)) ? 'ready' : 'indexing',
      indexedTotal >= (await quranAyahCount(env)) ? 1 : 0,
      QURAN_NAMESPACE,
    ).run();
    return { indexed: batch.length, indexedTotal };
  } catch (error) {
    await env.CONTENT_DB.prepare(`
      UPDATE quran_index_state SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE namespace = ?
    `).bind(errorMessage(error), QURAN_NAMESPACE).run();
    throw error;
  }
}

async function quranAyahCount(env: Bindings) {
  const row = await env.CONTENT_DB.prepare('SELECT COUNT(*) AS total FROM quran_ayahs').first<{ total: number }>();
  return row?.total ?? 0;
}
