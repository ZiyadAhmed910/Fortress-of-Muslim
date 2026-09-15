import { describe, expect, it } from 'vitest';
import type { ContentRepository } from '../src/repositories/content-repository';
import { answerQuestion } from '../src/rag';

// Ask discards any answer that asserts something without a citation, and replaces it with a
// deterministic list of source titles. That rule protects the one thing Ask promises. It was also
// throwing away correct answers: asked for the travel supplication, the model writes a cited
// sentence and puts the dua itself on the next line -- exactly the shape a person wants -- and the
// whole thing was replaced by "could not generate a fully cited answer" because that line carried
// no [1]. Quoted scripture is the cited source speaking, not a new claim.
const FALLBACK = 'could not generate a fully cited answer';

const dua = {
  id: 'dua.hisn.207',
  legacyId: 'dua.hisn.207',
  sequence: 1,
  title: 'For travel',
  readingRole: 'supplication' as const,
  partCount: 1,
  verificationStatus: 'verified' as const,
  workflowState: 'verified' as const,
  verifiedBy: 'reviewer',
  verifiedAt: '2026-07-23T00:00:00.000Z',
  revisionNumber: 1,
  publishedAt: '2026-07-23T00:00:00.000Z',
  canonicalUrl: 'https://fortressofmuslim.org/hisn/chapter208',
  parts: [[{ kind: 'translation' as const, text: 'Glory to Him who has subjected this to us.' }]],
};

const repository = {
  getCurrentDataset: async () => ({
    id: 'canonical.citations.test',
    sourceName: 'Citations test',
    sourceVersion: '1',
    publicationStatus: 'active',
    verificationStatus: 'verified',
    recordCount: 1,
    contentHash: 'citations',
    importedAt: '2026-07-23T00:00:00.000Z',
  }),
  searchForRag: async () => [{ id: dua.id, contentType: 'dua' as const, score: 0.9 }],
  searchCurrentForRag: async () => [],
  getAskDua: async (id: string) => (id === dua.id ? dua : undefined),
  getAskHadith: async () => undefined,
} as unknown as ContentRepository;

const envAnswering = (answer: string) => ({
  CONTENT_DB: { prepare: () => ({ bind: () => ({ first: async () => ({ requestCount: 1 }), run: async () => ({}) }) }) },
  AI: {
    run: async (model: string, input: { contexts?: Array<{ text: string }>; messages?: Array<{ content: string }> }) => {
      if (model.includes('bge-m3')) throw new Error('no vectors in this test');
      if (model.includes('reranker')) return { response: (input.contexts ?? []).map((_c, id) => ({ id, score: 0.9 })) };
      if (model.includes('llama')) return { response: '' };
      return { response: answer };
    },
  },
  VECTOR_INDEX: { query: async () => { throw new Error('no vectors in this test'); } },
} as never);

const ask = (answer: string) =>
  answerQuestion(envAnswering(answer), repository, 'what do I say when travelling?', 'citations-test');

describe('which answers survive the citation rule', () => {
  it('keeps an answer whose quoted Arabic sits on its own line', async () => {
    // The reported failure, exactly.
    const result = await ask('The travel supplication is [1]:\n\nسُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا');
    expect(result.answer).not.toContain(FALLBACK);
    expect(result.meta.generated).toBe(true);
  });

  it('keeps an answer that ends on an uncited line of pure Arabic', async () => {
    const result = await ask('Say the following when setting out [1].\nاللَّهُ أَكْبَرُ، اللَّهُ أَكْبَرُ');
    expect(result.meta.generated).toBe(true);
  });

  it('keeps an answer that opens with a lead-in to the quotation below it', async () => {
    // The most natural shape for a supplication -- a lead-in, the Arabic, then the cited
    // translation -- was being thrown away because the first line ended in a colon instead of a
    // citation. It asserts nothing the citation beneath it does not already carry.
    const result = await ask('Before entering the toilet one says:\n\nبِسْمِ اللَّهِ\n\n"In the Name of Allah" [1].');
    expect(result.answer).not.toContain(FALLBACK);
    expect(result.meta.generated).toBe(true);
  });

  it('does not let a lead-in launder a claim that never gets cited', async () => {
    // A colon is not a licence: if nothing below it carries a citation, the answer still goes.
    const result = await ask('The ruling on this is as follows:\n\nIt must be recited seven times.');
    expect(result.answer).toContain(FALLBACK);
  });

  it('does not treat a long paragraph as a lead-in because it ends in a colon', async () => {
    const essay = `${'This is a long assertion about what should be done and why it matters. '.repeat(3)}:`;
    const result = await ask(`${essay}\n\nSomething cited [1].`);
    expect(result.answer).toContain(FALLBACK);
  });

  it('still discards an answer that asserts something with no citation at all', async () => {
    const result = await ask('You should recite this three times before leaving home.');
    expect(result.answer).toContain(FALLBACK);
    expect(result.meta.generated).toBe(false);
  });

  it('still discards a second English paragraph that cites nothing', async () => {
    // The case the rule exists for: a cited claim followed by an uncited one reads as though both
    // were sourced.
    const result = await ask('The travel supplication is recorded [1].\n\nIt must be said seven times facing the qibla.');
    expect(result.answer).toContain(FALLBACK);
    expect(result.meta.generated).toBe(false);
  });

  it('still discards a citation pointing at a source that does not exist', async () => {
    const result = await ask('The travel supplication is recorded [4].');
    expect(result.answer).toContain(FALLBACK);
    expect(result.meta.generated).toBe(false);
  });

  it('does not treat a transliteration as quoted scripture', async () => {
    // Latin letters are the model writing, not the source speaking, so this still needs a citation.
    const result = await ask('Subhana alladhi sakhkhara lana hadha wa ma kunna lahu muqrinin.');
    expect(result.answer).toContain(FALLBACK);
  });
});
