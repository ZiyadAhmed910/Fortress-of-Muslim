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
  it('drops weak matches and repairs legacy typography before generation', async () => {
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
        run: async (model: string, input: { messages?: Array<{ content: string }> }) => {
          if (model.includes('bge-base')) throw new Error('Vector unavailable in quality test.');
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
});

function dua(id: string, title: string, translation: string) {
  return {
    id,
    legacyId: id,
    sequence: 1,
    title,
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
