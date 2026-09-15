import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContentRepository } from '../src/repositories/content-repository';
import { answerQuestion } from '../src/rag';

// "What is tawakkul" used to be answered from whatever dua sat nearest it in embedding space,
// because the concept lives in the Quran and Ask could not see the Quran. Verses are retrieved and
// reranked alongside duas and hadith now, and cited the same way. They are sources, not commentary:
// the model may quote and attribute a verse, and the citation rule that governs every other answer
// governs this one too.
const MIGRATIONS = resolve(__dirname, '../migrations');

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.exec(readFileSync(resolve(MIGRATIONS, '0024_quran_search.sql'), 'utf8'));
  db.exec(readFileSync(resolve(MIGRATIONS, '0025_quran_ayahs.sql'), 'utf8'));
});

const emptyRepository = {
  getCurrentDataset: async () => ({
    id: 'canonical.quran-ask.test',
    sourceName: 'Quran-in-Ask test',
    sourceVersion: '1',
    publicationStatus: 'active',
    verificationStatus: 'verified',
    recordCount: 1,
    contentHash: 'quran-ask',
    importedAt: '2026-07-23T00:00:00.000Z',
  }),
  // No duas or hadith match, so anything cited had to come from the Quran.
  searchForRag: async () => [],
  searchCurrentForRag: async () => [],
  getAskDua: async () => undefined,
  getAskHadith: async () => undefined,
} as unknown as ContentRepository;

/** D1 over better-sqlite3, plus a Vectorize stub that returns the verses it is told to. */
const envWith = ({ vectorHits = [] as string[], rerankOn = '', capture }: {
  vectorHits?: string[];
  rerankOn?: string;
  capture?: { generationPrompt?: string; rerankQuery?: string };
} = {}) => ({
  CONTENT_DB: {
    prepare: (sql: string) => {
      if (!/quran_/.test(sql)) {
        return { bind: () => ({ first: async () => ({ requestCount: 1 }), run: async () => ({}), all: async () => ({ results: [] }) }) };
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
    run: async (model: string, input: {
      text?: string[];
      query?: string;
      contexts?: Array<{ text: string }>;
      messages?: Array<{ content: string }>;
    }) => {
      if (model.includes('bge-m3')) return { data: (input.text ?? []).map(() => Array.from({ length: 1024 }, () => 0.01)) };
      if (model.includes('reranker')) {
        if (capture) capture.rerankQuery = input.query ?? '';
        return {
          response: (input.contexts ?? []).map((context, id) => ({
            id,
            score: rerankOn && context.text.toLowerCase().includes(rerankOn.toLowerCase()) ? 0.95 : 0.02,
          })),
        };
      }
      if (model.includes('llama')) return { response: '' };
      if (capture) capture.generationPrompt = input.messages?.[1]?.content ?? '';
      return { response: 'Reliance upon Allah is described in the verse cited [1].' };
    },
  },
  VECTOR_INDEX: { query: async () => ({ matches: vectorHits.map((id) => ({ id, score: 0.8 })) }) },
} as never);

describe('answering from the Quran', () => {
  it('cites a verse when the answer comes from one', async () => {
    const result = await answerQuestion(
      envWith({ vectorHits: ['65:3'], rerankOn: 'relies upon Allah' }),
      emptyRepository,
      'what is tawakkul?',
      'quran-ask-test',
    );
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      contentType: 'quran',
      collection: 'The Quran',
      reference: 'At-Talaq 65:3',
      verificationStatus: 'verified',
    });
  });

  it('gives the model the verse text, labelled as Quran', async () => {
    // The prompt forbids calling anything Quran unless the context says so. For a verse it does.
    const capture = { generationPrompt: '' };
    await answerQuestion(
      envWith({ vectorHits: ['65:3'], rerankOn: 'relies upon Allah', capture }),
      emptyRepository,
      'what is tawakkul?',
      'quran-ask-test',
    );
    expect(capture.generationPrompt).toContain('Reference: Quran 65:3');
    expect(capture.generationPrompt).toContain('relies upon Allah');
  });

  it('links a cited verse to where it can be read', async () => {
    const result = await answerQuestion(
      envWith({ vectorHits: ['2:255'], rerankOn: 'Ayat al-Kursi' }),
      emptyRepository,
      'tell me about the verse of the throne',
      'quran-ask-test',
    );
    const verse = result.sources.find((source) => source.contentType === 'quran');
    expect(verse?.canonicalUrl).toMatch(/\/quran\/\d+\/\d+$/);
  });

  it('reranks on the expanded query, so a term the sources never use still scores', async () => {
    // Live failure: retrieval ran on the expanded query and found the tawakkul verses, then the
    // reranker was handed the raw "what is tawakkul?" -- a word in no English translation -- scored
    // everything under the floor, and Ask answered "nothing found" while plain verse search, which
    // reranks on the expanded text, returned the right verses. The reranker has the same vocabulary
    // problem retrieval does, so it gets the same help.
    //
    // Asserted on the query the reranker was handed, because that is the change. Scoring the
    // candidates instead proves nothing: with a uniform score they all clear the floor either way.
    const capture = { rerankQuery: '' };
    await answerQuestion(
      envWith({ vectorHits: ['65:3'], rerankOn: 'relies upon Allah', capture }),
      emptyRepository,
      'what is tawakkul?',
      'quran-ask-test',
    );
    expect(capture.rerankQuery).toContain('tawakkul');
    expect(capture.rerankQuery).toContain('reliance upon Allah');
  });

  it('leaves verses out when the question is scoped to duas', async () => {
    const result = await answerQuestion(
      envWith({ vectorHits: ['65:3'], rerankOn: 'relies upon Allah' }),
      emptyRepository,
      'what is tawakkul?',
      'quran-ask-test',
      { contentType: 'dua' },
    );
    expect(result.sources.every((source) => source.contentType !== 'quran')).toBe(true);
  });

  it('answers from verses alone when the question is scoped to the Quran', async () => {
    const result = await answerQuestion(
      envWith({ vectorHits: ['65:3'], rerankOn: 'relies upon Allah' }),
      emptyRepository,
      'what is tawakkul?',
      'quran-ask-test',
      { contentType: 'quran' },
    );
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.contentType).toBe('quran');
  });
});
