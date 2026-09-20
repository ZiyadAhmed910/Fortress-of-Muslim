import { describe, expect, it } from 'vitest';
import type { ContentRepository } from '../src/repositories/content-repository';
import { answerQuestion } from '../src/rag';

// "What about returning?" is clear to a person who just read an answer about travelling, and
// meaningless to a retrieval pipeline -- there is no reading about "returning" in the abstract.
// Rewriting the follow-up against the conversation is what makes a second turn work.
//
// The boundary these mostly exist to hold: the conversation is used to rewrite the query and for
// nothing else. It never reaches the generation prompt, so an answer can only ever come from
// retrieved records. An assistant allowed to quote its own earlier answers can launder an
// ungrounded claim into a later turn as though it had a source.

const dua = (id: string, title: string, translation: string) => ({
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
});

const returning = dua('dua.hisn.200', 'Supplication when returning from travel', 'We return, repentant.');

const repository = {
  getCurrentDataset: async () => ({
    id: 'canonical.follow-up.test',
    sourceName: 'Follow-up test',
    sourceVersion: '1',
    publicationStatus: 'active',
    verificationStatus: 'verified',
    recordCount: 1,
    contentHash: 'followup',
    importedAt: '2026-07-23T00:00:00.000Z',
  }),
  searchForRag: async () => [{ id: returning.id, contentType: 'dua' as const, score: 0.9 }],
  searchCurrentForRag: async () => [],
  getAskDua: async (id: string) => (id === returning.id ? returning : undefined),
  getAskHadith: async () => undefined,
} as unknown as ContentRepository;

/** Records what each model was asked, so the query rewrite and the answer prompt can be inspected. */
const envWith = (rewrite: string) => {
  const seen = { rewritePrompt: '', retrievalQueries: [] as string[], generationPrompt: '' };
  const env = {
    CONTENT_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }), run: async () => ({}) }) }) },
    AI: {
      run: async (model: string, input: {
        messages?: Array<{ role: string; content: string }>;
        contexts?: Array<{ text: string }>;
        text?: string[];
      }) => {
        if (model.includes('bge-m3')) {
          seen.retrievalQueries.push(...(input.text ?? []));
          throw new Error('no vectors in this test');
        }
        if (model.includes('reranker')) {
          return { response: (input.contexts ?? []).map((_context, id) => ({ id, score: 0.9 })) };
        }
        const system = input.messages?.[0]?.content ?? '';
        const user = input.messages?.[1]?.content ?? '';
        if (system.startsWith('Rewrite the final user question')) {
          seen.rewritePrompt = user;
          return { response: rewrite };
        }
        if (system.startsWith('Rewrite the user question')) return { response: '' };   // expansion
        seen.generationPrompt = user;
        return { response: 'Say the returning supplication [1].' };
      },
    },
    VECTOR_INDEX: { query: async () => { throw new Error('no vectors in this test'); } },
  } as never;
  return { env, seen };
};

const history = [{ question: 'dua for travelling', answer: 'The travel supplication is Allahu akbar... [1]' }];

describe('following up on an earlier answer', () => {
  it('rewrites a follow-up into something that can actually be retrieved', async () => {
    const { env, seen } = envWith('What is the supplication when returning from travel?');
    await answerQuestion(env, repository, 'what about returning?', 'follow-up-test', undefined, history);
    // The rewrite, not the two words the user typed, is what retrieval ran on.
    expect(seen.retrievalQueries.join(' ')).toContain('returning from travel');
  });

  it('tells the caller the question was rewritten', async () => {
    const { env } = envWith('What is the supplication when returning from travel?');
    const result = await answerQuestion(env, repository, 'what about returning?', 'follow-up-test', undefined, history);
    expect(result.meta.rewritten).toBe(true);
  });

  it('never puts the conversation in front of the model that writes the answer', async () => {
    // The boundary. History shapes which records are found; it is not material to answer from.
    const { env, seen } = envWith('What is the supplication when returning from travel?');
    await answerQuestion(env, repository, 'what about returning?', 'follow-up-test', undefined, [
      { question: 'dua for travelling', answer: 'A previous answer that must not be quotable.' },
    ]);
    expect(seen.generationPrompt).not.toContain('must not be quotable');
    expect(seen.generationPrompt).toContain('Supplication when returning from travel');
  });

  it('gives the rewriter the conversation, which is the one place it belongs', async () => {
    const { env, seen } = envWith('What is the supplication when returning from travel?');
    await answerQuestion(env, repository, 'what about returning?', 'follow-up-test', undefined, history);
    expect(seen.rewritePrompt).toContain('dua for travelling');
    expect(seen.rewritePrompt).toContain('what about returning?');
  });

  it('leaves a first question exactly as it was asked', async () => {
    const { env, seen } = envWith('should not be used');
    await answerQuestion(env, repository, 'what do I say when travelling?', 'follow-up-test');
    expect(seen.rewritePrompt).toBe('');
    expect(seen.retrievalQueries.join(' ')).toContain('travelling');
  });

  it('falls back to the previous question rather than retrieving on two dangling words', async () => {
    // An unusable rewrite -- empty, enormous, or a refusal -- must not become the query.
    const { env, seen } = envWith('no');
    const result = await answerQuestion(env, repository, 'what about returning?', 'follow-up-test', undefined, history);
    expect(result.meta.rewritten).toBe(false);
    const queries = seen.retrievalQueries.join(' ');
    expect(queries).toContain('dua for travelling');
    expect(queries).toContain('what about returning?');
  });

  it('still answers from sources when there is no conversation at all', async () => {
    const { env } = envWith('unused');
    const result = await answerQuestion(env, repository, 'what do I say when travelling?', 'follow-up-test', undefined, []);
    expect(result.meta.rewritten).toBe(false);
    expect(result.sources).toHaveLength(1);
    expect(result.answer).toContain('[1]');
  });
});
