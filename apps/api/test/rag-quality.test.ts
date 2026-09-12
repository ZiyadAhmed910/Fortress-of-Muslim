import { describe, expect, it } from 'vitest';
import type { ContentRepository } from '../src/repositories/content-repository';
import { answerQuestion } from '../src/rag';

const exact = dua(
  'dua.exact',
  'Before entering the bathroom',
  '\u00c3\u008b\u00c2\u00b9O Allah, I seek refuge in You.\u00c3\u008b\u00c2\u00ba Al-\u00e1\u00b8\u00a5amdu lill\u00c4\u0081hi.',
);
const weak = dua('dua.weak', 'After leaving the bathroom', 'All praise is for Allah.');

describe('Ask evidence quality', () => {
  it('drops sources that do not answer the question, and repairs legacy typography before generation', async () => {
    let generationContext = '';
    const repository = {
      getCurrentDataset: async () => ({
        id: 'canonical.quality.test',
        sourceName: 'Quality test',
        sourceVersion: '1',
        publicationStatus: 'active',
        verificationStatus: 'verified',
        recordCount: 2,
        contentHash: 'quality',
        importedAt: '2026-07-23T00:00:00.000Z',
      }),
      searchForRag: async () => [
        { id: exact.id, contentType: 'dua' as const, score: 0.96 },
        { id: weak.id, contentType: 'dua' as const, score: 0.7 },
      ],
      searchCurrentForRag: async () => [],
      getPublishedDua: async (id: string) => id === exact.id ? exact : id === weak.id ? weak : undefined,
      getPublishedHadith: async () => undefined,
    } as unknown as ContentRepository;
    const env = {
      CONTENT_DB: {
        prepare: () => ({
          bind: () => ({ first: async () => ({ requestCount: 1 }) }),
        }),
      },
      AI: {
        run: async (model: string, input: { messages?: Array<{ content: string }>; contexts?: Array<{ text: string }> }) => {
          if (model.includes('bge-m3')) throw new Error('Vector unavailable in quality test.');
          // The reranker is what decides relevance now, so the quality bar this test describes is
          // its judgement rather than a gap between two retrieval scores.
          if (model.includes('reranker')) {
            return {
              response: (input.contexts ?? []).map((context, id) => ({
                id,
                score: context.text.includes(weak.title) ? 0.03 : 0.95,
              })),
            };
          }
          generationContext = input.messages?.[1]?.content ?? '';
          return { response: 'Use the cited supplication [1].' };
        },
      },
      VECTOR_INDEX: { query: async () => { throw new Error('Vector unavailable in quality test.'); } },
    } as never;

    const result = await answerQuestion(env, repository, 'What should I say when entering the bathroom?', 'quality-test');

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.id).toBe(exact.id);
    expect(generationContext).toContain("'O Allah, I seek refuge in You.'");
    expect(generationContext).toContain('Al-\u1e25amdu lill\u0101hi.');
    expect(generationContext).not.toContain('\u00e1\u00b8\u00a5');
    expect(generationContext).not.toContain(weak.title);
  });

  it('merges retrieval across LLM-suggested query expansion variants', async () => {
    const original = dua('dua.original', 'Ruling on X', 'Original record text.');
    const variantA = dua('dua.variant-a', 'Related ruling A', 'Variant A record text.');
    const variantB = dua('dua.variant-b', 'Related ruling B', 'Variant B record text.');
    const seenQueries: string[] = [];
    const repository = {
      getCurrentDataset: async () => ({
        id: 'canonical.quality.test',
        sourceName: 'Quality test',
        sourceVersion: '1',
        publicationStatus: 'active',
        verificationStatus: 'verified',
        recordCount: 3,
        contentHash: 'quality',
        importedAt: '2026-07-23T00:00:00.000Z',
      }),
      searchForRag: async (query: string) => {
        seenQueries.push(query);
        if (query.includes('original question')) return [{ id: original.id, contentType: 'dua' as const, score: 0.9 }];
        if (query.includes('alternate phrasing one')) return [{ id: variantA.id, contentType: 'dua' as const, score: 0.9 }];
        if (query.includes('alternate phrasing two')) return [{ id: variantB.id, contentType: 'dua' as const, score: 0.9 }];
        return [];
      },
      searchCurrentForRag: async () => [],
      getPublishedDua: async (id: string) => [original, variantA, variantB].find((item) => item.id === id),
      getPublishedHadith: async () => undefined,
    } as unknown as ContentRepository;
    const env = {
      CONTENT_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }) }) }) },
      AI: {
        run: async (model: string, input: { messages?: Array<{ content: string }> }) => {
          if (model.includes('bge')) throw new Error('Vector unavailable in quality test.');
          const systemPrompt = input.messages?.[0]?.content ?? '';
          if (systemPrompt.startsWith('Rewrite the user question')) {
            return { response: 'alternate phrasing one\nalternate phrasing two' };
          }
          return { response: 'Combined answer [1] [2] [3].' };
        },
      },
      VECTOR_INDEX: { query: async () => { throw new Error('Vector unavailable in quality test.'); } },
    } as never;

    const result = await answerQuestion(env, repository, 'original question text', 'quality-test-expansion');

    expect(seenQueries.some((query) => query.includes('original question'))).toBe(true);
    expect(seenQueries.some((query) => query.includes('alternate phrasing one'))).toBe(true);
    expect(seenQueries.some((query) => query.includes('alternate phrasing two'))).toBe(true);
    expect(result.sources.map((source) => source.id).sort()).toEqual([original.id, variantA.id, variantB.id].sort());
    expect(result.meta.generated).toBe(true);
  });

  it('supplements thin verified results with unverified current content, clearly labeled', async () => {
    const pendingRecord = { ...dua('dua.pending', 'Related but unverified topic', 'Pending record text.'), verificationStatus: 'unverified' as const };
    let generationContext = '';
    const repository = {
      getCurrentDataset: async () => ({
        id: 'canonical.quality.test',
        sourceName: 'Quality test',
        sourceVersion: '1',
        publicationStatus: 'active',
        verificationStatus: 'verified',
        recordCount: 1,
        contentHash: 'quality',
        importedAt: '2026-07-23T00:00:00.000Z',
      }),
      searchForRag: async () => [],
      searchCurrentForRag: async () => [{ id: pendingRecord.id, contentType: 'dua' as const, score: 0.6 }],
      getPublishedDua: async () => undefined,
      getPublishedHadith: async () => undefined,
      getDua: async (id: string) => (id === pendingRecord.id ? pendingRecord : undefined),
      getHadith: async () => undefined,
    } as unknown as ContentRepository;
    const env = {
      CONTENT_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }) }) }) },
      AI: {
        run: async (model: string, input: { messages?: Array<{ content: string }> }) => {
          if (model.includes('bge')) throw new Error('Vector unavailable in quality test.');
          const systemPrompt = input.messages?.[0]?.content ?? '';
          if (systemPrompt.startsWith('Rewrite the user question')) return { response: '' };
          generationContext = input.messages?.[1]?.content ?? '';
          return { response: 'This is not yet independently verified [1].' };
        },
      },
      VECTOR_INDEX: { query: async () => { throw new Error('Vector unavailable in quality test.'); } },
    } as never;

    const result = await answerQuestion(env, repository, 'Related but unverified topic question', 'quality-test-fallback');

    expect(result.meta.includesUnverifiedSource).toBe(true);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.verificationStatus).toBe('unverified');
    expect(generationContext).toContain('Verification: unverified');
    expect(result.answer).toContain('not yet independently verified');
  });
});

function dua(id: string, title: string, translation: string) {
  return {
    id,
    legacyId: id,
    sequence: 1,
    title,
    readingRole: 'supplication' as const,
    partCount: 1,
    verificationStatus: 'verified' as const,
    workflowState: 'verified' as const,
    verifiedBy: 'reviewer',
    verifiedAt: '2026-07-23T00:00:00.000Z',
    revisionNumber: 1,
    publishedAt: '2026-07-23T00:00:00.000Z',
    canonicalUrl: `https://fortressofmuslim.org/${id}`,
    parts: [[{ kind: 'translation' as const, text: translation }]],
  };
}
