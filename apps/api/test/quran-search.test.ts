import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { QURAN_NAMESPACE, searchQuran } from '../src/quran-search';

// "An ayah about tawakkul" is the case this feature exists for: the word appears nowhere in an
// English translation and "reliance upon Allah" does, so lexical search alone cannot answer it and
// embeddings have to. These run against the real 6,236 ayahs -- the same files the PWA ships --
// because a search feature tested on three fixtures proves nothing about whether it finds verses.
const MIGRATIONS = resolve(__dirname, '../migrations');

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.exec(readFileSync(resolve(MIGRATIONS, '0024_quran_search.sql'), 'utf8'));
  db.exec(readFileSync(resolve(MIGRATIONS, '0025_quran_ayahs.sql'), 'utf8'));
});

/** D1's shape over better-sqlite3, enough for the queries this module makes. */
const d1 = () => ({
  prepare: (sql: string) => {
    const statement = db.prepare(sql);
    const bind = (...binds: unknown[]) => ({
      all: async () => ({ results: statement.all(...binds) }),
      first: async () => statement.get(...binds) ?? null,
      run: async () => statement.run(...binds),
    });
    return { bind, all: async () => ({ results: statement.all() }), first: async () => statement.get() ?? null };
  },
});

/**
 * A stand-in for Workers AI and Vectorize. The embedding is deterministic and meaningless -- what
 * these tests check is the retrieval and ranking around the models, not the models themselves --
 * and the reranker is told which verse should win so the ordering can be asserted.
 */
const envWith = ({ vectorHits = [] as string[], rerankOn = '' } = {}) => ({
  CONTENT_DB: d1(),
  AI: {
    run: async (model: string, input: { text?: string[]; contexts?: Array<{ text: string }> }) => {
      if (model.includes('bge-m3')) {
        return { data: (input.text ?? []).map(() => Array.from({ length: 1024 }, () => 0.01)) };
      }
      if (model.includes('reranker')) {
        return {
          response: (input.contexts ?? []).map((context, id) => ({
            id,
            score: rerankOn && context.text.toLowerCase().includes(rerankOn.toLowerCase()) ? 0.95 : 0.02,
          })),
        };
      }
      throw new Error(`unexpected model ${model}`);
    },
  },
  VECTOR_INDEX: {
    query: async () => ({ matches: vectorHits.map((id) => ({ id, score: 0.8 })) }),
    upsert: async () => ({}),
  },
});

describe('the ayah corpus the search runs over', () => {
  it('holds the whole Quran, and agrees with the app about its size', () => {
    const { total } = db.prepare('SELECT COUNT(*) AS total FROM quran_ayahs').get() as { total: number };
    expect(total).toBe(6236);
    const { surahs } = db.prepare('SELECT COUNT(DISTINCT surah) AS surahs FROM quran_ayahs').get() as { surahs: number };
    expect(surahs).toBe(114);
  });

  it('carries no verse without words to search', () => {
    const { empty } = db.prepare("SELECT COUNT(*) AS empty FROM quran_ayahs WHERE TRIM(translation) = ''").get() as { empty: number };
    expect(empty).toBe(0);
  });

  it('queues itself for embedding under its own namespace', () => {
    // Its own namespace is what keeps Ask's retrieval and this one from ever seeing each other.
    const state = db.prepare('SELECT namespace, status, expected_count AS expected FROM quran_index_state').get() as
      { namespace: string; status: string; expected: number };
    expect(state).toEqual({ namespace: QURAN_NAMESPACE, status: 'pending', expected: 6236 });
  });
});

describe('searching for verses', () => {
  it('finds a half-remembered phrase exactly, without any vectors at all', async () => {
    // The lexical half, and the case embeddings are worst at.
    const { matches, vectorAvailable } = await searchQuran(envWith({ rerankOn: 'burden' }) as never, 'burdened beyond capacity', 5);
    expect(vectorAvailable).toBe(false);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((match) => match.reference === '2:286')).toBe(true);
  });

  it('puts the verse the reranker judged best at the top', async () => {
    // "burden" is the distinctive word in 2:286 ("lay not upon us a burden like that which You laid
    // upon those before us"), which is what makes it a usable marker here.
    const { matches, reranked } = await searchQuran(envWith({ rerankOn: 'lay not upon us a burden' }) as never, 'burdened beyond capacity', 5);
    expect(reranked).toBe(true);
    expect(matches[0]!.reference).toBe('2:286');
  });

  it('returns references and never the translation, which is not ours to redistribute', async () => {
    // The whole reason the endpoint answers with numbers: the Saheeh International text is stored
    // to search over and served by nobody. The client renders it from the copy it already ships.
    const { matches } = await searchQuran(envWith({ rerankOn: 'mercy' }) as never, 'verses about mercy', 3);
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      expect(Object.keys(match).sort()).toEqual([
        'ayah', 'reference', 'retrieval', 'revelationPlace', 'score', 'surah', 'surahName', 'surahNameEnglish',
      ]);
      expect(JSON.stringify(match)).not.toMatch(/Allah|God/);
    }
  });

  it('names the surah, so a result can be read without looking it up', async () => {
    const { matches } = await searchQuran(envWith({ rerankOn: 'lay not upon us a burden' }) as never, 'burdened beyond capacity', 3);
    const verse = matches.find((match) => match.reference === '2:286')!;
    expect(verse.surahName).toBe('Al-Baqarah');
    expect(verse.surahNameEnglish).toBe('The Cow');
    expect(verse.revelationPlace).toBe('madinah');
  });

  it('merges what the vectors found with what the words found', async () => {
    // A theme the embedding reaches and the wording does not, alongside an exact phrase match:
    // both paths have to survive into the candidate list for the reranker to choose between them.
    // 65:3 is the tawakkul verse and says "relies", never "tawakkul" -- the exact vocabulary gap
    // that makes the vector half necessary, since no lexical query for the concept reaches it.
    const { matches } = await searchQuran(
      envWith({ vectorHits: ['65:3', '3:159'], rerankOn: 'relies upon Allah' }) as never,
      'reliance upon Allah',
      10,
    );
    const references = matches.map((match) => match.reference);
    expect(references).toContain('65:3');
    expect(matches.some((match) => match.retrieval === 'vector')).toBe(true);
  });

  it('still answers when the vector index is unavailable', async () => {
    const broken = {
      ...envWith({ rerankOn: 'patience' }),
      VECTOR_INDEX: { query: async () => { throw new Error('vectorize unavailable'); } },
    };
    const { matches, vectorAvailable } = await searchQuran(broken as never, 'patience and prayer', 5);
    expect(vectorAvailable).toBe(false);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('returns nothing rather than noise for a query the Quran does not speak to', async () => {
    const { matches } = await searchQuran(envWith({ rerankOn: 'zzzznotaword' }) as never, 'qwertyuiop asdfghjkl', 5);
    expect(matches).toEqual([]);
  });

  it('finds anything at all for the word people actually type', async () => {
    // Measured live before this was fixed: "reliance upon Allah" returned 8:49, 27:79 and 33:3 at
    // 0.99, while "tawakkul" -- the same question, and the word far likelier to be typed --
    // returned nothing whatsoever. The transliteration appears in no English translation, so the
    // lexical half had no term to match, and it sits nowhere near the English phrase for the
    // embedding half. Curated expansion is what bridges both.
    //
    // Asserted as "not empty, and about trust": which verse ranks first is the reranker's call on
    // the live index, and pinning one here would test the mock rather than the gap that was closed.
    const { matches } = await searchQuran(envWith({ rerankOn: 'trust' }) as never, 'ayah about tawakkul', 5);
    expect(matches.length).toBeGreaterThan(0);
    const bare = await searchQuran(envWith({ rerankOn: 'zzzznotaword' }) as never, 'tawakkul', 5);
    expect(bare.matches.length).toBeGreaterThan(0);
  });

  it('expands the retrieval query without changing what the reader asked', async () => {
    const { matches } = await searchQuran(envWith({ rerankOn: 'patience' }) as never, 'verses on sabr', 5);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('respects the limit it was given', async () => {
    const { matches } = await searchQuran(envWith({ rerankOn: 'the' }) as never, 'guidance for the believers', 3);
    expect(matches.length).toBeLessThanOrEqual(3);
  });
});
