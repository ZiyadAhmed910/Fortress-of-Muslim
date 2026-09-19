import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContentRepository } from '../src/repositories/content-repository';
import { answerQuestion } from '../src/rag';

// The source dropdown is a filter: choosing "Quran verses" means an answer written from verses and
// from nothing else. It leaked three separate times, always the same way and always only for the
// Quran scope, which is the tell. recordScope() turns a Quran scope into `undefined`, every
// repository call reads `undefined` as "no filter", and so each retrieval path that forgot to check
// first quietly searched the whole editorial corpus the scope existed to exclude. Scoping to duas or
// to hadith never leaked, because those translate into filters the repository actually applies.
//
// From the live log on the test environment, which is what these fixtures are shaped after:
//
//   id 38  scope=quran  "Give me a quran verse for reliance on allah"  -> quran, hadith, dua
//   id 50  scope=quran  "what is tawakkul?"                            -> quran, hadith
//   id 53  scope=quran  "Helping others"                               -> quran, hadith
//
// So the repository below is the opposite of a helpful one: every record search it offers returns
// hadith and duas, eagerly, whatever it is asked. If any path still fails to respect the scope, it
// has something wrong to hand back and these fail.
const MIGRATIONS = resolve(__dirname, '../migrations');

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((name) => /^002[456]_/.test(name)).sort()) {
    db.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'));
  }
});

const segment = (text: string) => [{ kind: 'translation' as const, text }];

const hadith = (id: string) => ({
  id,
  title: `Hadith ${id}`,
  contentType: 'hadith' as const,
  canonicalUrl: `https://fortressofmuslim.org/hadith/${id}`,
  verificationStatus: 'verified',
  collection: { slug: 'bukhari', name: 'Sahih al-Bukhari' },
  reference: id,
  segments: segment('Whoever relies upon Allah, He is sufficient for him.'),
  references: [{ type: 'bukhari', locator: '2822' }],
});

const dua = (id: string) => ({
  id,
  title: `Dua ${id}`,
  contentType: 'dua' as const,
  canonicalUrl: `https://fortressofmuslim.org/dua/${id}`,
  verificationStatus: 'verified',
  collection: { slug: 'hisn', name: 'Fortress of the Muslim' },
  reference: id,
  parts: [segment('I place my trust in Allah, reliance upon Him alone.')],
});

const RECORDS = [
  { id: 'hadith.bukhari.2822', contentType: 'hadith' as const, score: 0.9 },
  { id: 'hadith.muslim.1343b', contentType: 'hadith' as const, score: 0.8 },
  { id: 'dua.hisn.097', contentType: 'dua' as const, score: 0.7 },
];

/**
 * Answers every record search with hadith and duas, and ignores the filter it is given -- which is
 * exactly what the real repository does when handed `undefined`. A scope that holds against this
 * holds because the caller respected it, not because the store happened to have nothing to offer.
 */
const generousRepository = {
  getCurrentDataset: async () => ({
    id: 'canonical.ask-scope.test',
    sourceName: 'Ask scope test',
    sourceVersion: '1',
    publicationStatus: 'active',
    verificationStatus: 'verified',
    recordCount: 3,
    contentHash: 'ask-scope',
    importedAt: '2026-07-23T00:00:00.000Z',
  }),
  searchForRag: async () => RECORDS,
  searchCurrentForRag: async () => RECORDS,
  getAskDua: async (id: string) => dua(id),
  getAskHadith: async (id: string) => hadith(id),
  getDua: async (id: string) => dua(id),
  getHadith: async (id: string) => hadith(id),
  findHadithByReference: async () => hadith('hadith.bukhari.2822'),
} as unknown as ContentRepository;

/** Everything scores well, so nothing is dropped for irrelevance and only the scope can exclude. */
const env = ({ verses = true } = {}) => ({
  CONTENT_DB: {
    prepare: (sql: string) => {
      if (/ask_settings/.test(sql)) {
        return {
          // The unverified fallback ON is the state that leaked in production: it tops the answer up
          // from the editorial corpus whenever fewer than two sources survived.
          first: async () => ({ perIpDailyLimit: 0, unverifiedFallback: 1 }),
          bind: () => ({ first: async () => ({ perIpDailyLimit: 0, unverifiedFallback: 1 }) }),
        };
      }
      if (!/quran_/.test(sql)) {
        return {
          first: async () => ({ requestCount: 1 }),
          bind: () => ({ first: async () => ({ requestCount: 1 }), run: async () => ({}), all: async () => ({ results: [] }) }),
        };
      }
      if (!verses) {
        return { bind: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) }) };
      }
      const statement = db.prepare(sql);
      return {
        bind: (...binds: unknown[]) => ({
          all: async () => ({ results: statement.all(...binds) }),
          first: async () => statement.get(...binds) ?? null,
          run: async () => statement.run(...binds),
        }),
      };
    },
  },
  AI: {
    run: async (model: string, input: { text?: string[]; contexts?: Array<{ text: string }>; }) => {
      if (model.includes('bge-m3')) return { data: (input.text ?? []).map(() => Array.from({ length: 1024 }, () => 0.01)) };
      if (model.includes('reranker')) {
        return { response: (input.contexts ?? []).map((_context, id) => ({ id, score: 0.9 })) };
      }
      if (model.includes('llama')) return { response: '' };
      return { response: 'Reliance upon Allah is described in the source cited [1].' };
    },
  },
  // One index, two namespaces: the editorial records live under the dataset id and the verses under
  // their own. Answering both from the same list would put verse ids through the record path, which
  // classifies everything it is given as a dua or a hadith -- and the test would then be reading its
  // own fixture's confusion rather than the scope.
  VECTOR_INDEX: {
    query: async (_embedding: unknown, options?: { namespace?: string }) => ({
      matches: options?.namespace?.startsWith('quran.')
        ? (verses ? ['64:13', '9:51', '27:26'].map((id) => ({ id, score: 0.9 })) : [])
        : RECORDS.map((record) => ({
          id: record.id,
          score: record.score,
          metadata: { recordId: record.id, contentType: record.contentType },
        })),
    }),
  },
} as never);

const ask = (scope?: 'dua' | 'hadith' | 'quran', question = 'Give me a quran verse for reliance on allah') =>
  answerQuestion(env(), generousRepository, question, 'ask-scope-test', scope ? { contentType: scope } : undefined);

describe('the source scope the user chose', () => {
  it('returns only verses when scoped to the Quran', async () => {
    const result = await ask('quran');
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources.map((source) => source.contentType)).toEqual(
      result.sources.map(() => 'quran'),
    );
  });

  it('returns only hadith when scoped to hadith', async () => {
    const result = await ask('hadith');
    expect(result.sources.length).toBeGreaterThan(0);
    expect([...new Set(result.sources.map((source) => source.contentType))]).toEqual(['hadith']);
  });

  it('returns only duas when scoped to duas', async () => {
    const result = await ask('dua');
    expect(result.sources.length).toBeGreaterThan(0);
    expect([...new Set(result.sources.map((source) => source.contentType))]).toEqual(['dua']);
  });

  it('may return every kind when nothing is scoped', async () => {
    const result = await ask(undefined);
    const kinds = new Set(result.sources.map((source) => source.contentType));
    // The point of the unscoped case is that the filter is not silently always on.
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('does not resolve an exact hadith reference under a Quran scope', async () => {
    // parseExactHadithReference() fires on a question ending in a number and returns that hadith as
    // the whole answer, bypassing ranking entirely. It used to run for anything not scoped to duas.
    const result = await ask('quran', 'reliance upon Allah Bukhari 2822');
    expect(result.sources.every((source) => source.contentType === 'quran')).toBe(true);
  });

  it('would rather find nothing than answer from the wrong kind of source', async () => {
    // No verse matches, the fallback has hadith and duas ready, and the scope still holds: the
    // honest answer to "nothing of the kind you asked for" is nothing, not something else.
    const result = await answerQuestion(
      env({ verses: false }),
      generousRepository,
      'a question no verse answers',
      'ask-scope-test',
      { contentType: 'quran' },
    );
    expect(result.sources).toHaveLength(0);
  });
});
