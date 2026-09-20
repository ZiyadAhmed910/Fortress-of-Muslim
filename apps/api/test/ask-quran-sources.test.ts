import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
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
  // Every quran migration in order: 0026 adds the Arabic, and a fixture missing it tests a
  // schema no environment has.
  for (const file of readdirSync(MIGRATIONS).filter((name) => /^002[456]_/.test(name)).sort()) {
    db.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'));
  }
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
const envWith = ({ vectorHits = [] as string[], rerankOn = '', capture, scoreBy }: {
  vectorHits?: string[];
  rerankOn?: string;
  capture?: { generationPrompt?: string; rerankQuery?: string };
  scoreBy?: (text: string) => number;
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
            score: scoreBy ? scoreBy(context.text)
              : rerankOn && context.text.toLowerCase().includes(rerankOn.toLowerCase()) ? 0.95 : 0.02,
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

  it('shows verses even when hadith outrank them', async () => {
    // Live failure: "what does the Quran say about patience?" came back citing four hadith and not
    // one verse. The Quran is one book against 14,625 records, so on a common theme the hadith
    // simply outnumber the verses through the cut. Reranking still orders them; a floor of two slots
    // means the Quran is represented when it was found and judged relevant.
    const withHadith = {
      ...emptyRepository,
      searchForRag: async () => Array.from({ length: 10 }, (_unused, index) => ({
        id: `hadith.bukhari.${index + 1}`,
        contentType: 'hadith' as const,
        score: 0.9,
      })),
      getAskHadith: async (id: string) => ({
        id,
        sequence: 1,
        displayNumber: id.split('.').pop(),
        title: `Sahih al-Bukhari ${id.split('.').pop()}`,
        collection: { slug: 'bukhari', title: 'Sahih al-Bukhari' },
        book: null,
        chapter: null,
        narrator: 'Narrated someone:',
        grade: null,
        verificationStatus: 'unverified',
        workflowState: 'pending_review',
        verifiedBy: null,
        verifiedAt: null,
        revisionNumber: 1,
        publishedAt: '2026-09-13T00:00:00.000Z',
        canonicalUrl: `https://fortressofmuslim.org/bukhari/${id}`,
        segments: [{ kind: 'translation', text: 'A hadith about patience and steadfastness.' }],
        references: [],
      }),
    } as unknown as ContentRepository;
    // Hadith score 0.9 and the verse 0.2, so a cut taken across both kinds (0.9 x 0.35 = 0.315)
    // removes every verse before anything can reserve a slot for one. That is the live failure.
    const result = await answerQuestion(
      envWith({ vectorHits: ['2:153'], scoreBy: (text) => (/Bukhari/.test(text) ? 0.9 : 0.2) }),
      withHadith,
      'what does the quran say about patience?',
      'quran-ask-test',
    );
    expect(result.sources.some((source) => source.contentType === 'quran')).toBe(true);
    // And the hadith are still there: the quota is a floor, not a takeover.
    expect(result.sources.some((source) => source.contentType === 'hadith')).toBe(true);
  });


  it('lets no record reach an answer scoped to the Quran', async () => {
    // Live: scope=quran returned quran,quran,quran,hadith. The base retrieval was gated on the
    // scope and the expansion variants were not, and a Quran scope resolves to "no record filter"
    // -- which the repository reads as every record.
    const withHadith = {
      ...emptyRepository,
      searchForRag: async () => [{ id: 'hadith.bukhari.1', contentType: 'hadith' as const, score: 0.95 }],
      getAskHadith: async (id: string) => ({
        id, sequence: 1, displayNumber: '1', title: 'Sahih al-Bukhari 1',
        collection: { slug: 'bukhari', title: 'Sahih al-Bukhari' }, book: null, chapter: null,
        narrator: 'Narrated someone:', grade: null, verificationStatus: 'unverified',
        workflowState: 'pending_review', verifiedBy: null, verifiedAt: null, revisionNumber: 1,
        publishedAt: '2026-09-13T00:00:00.000Z',
        canonicalUrl: 'https://fortressofmuslim.org/bukhari/book1/1',
        segments: [{ kind: 'translation', text: 'A hadith about reliance upon Allah.' }], references: [],
      }),
    } as unknown as ContentRepository;
    const result = await answerQuestion(
      envWith({ vectorHits: ['65:3'], rerankOn: 'relies upon Allah' }),
      withHadith,
      'what is tawakkul?',
      'quran-ask-test',
      { contentType: 'quran' },
    );
    expect(result.sources.every((source) => source.contentType === 'quran')).toBe(true);
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
