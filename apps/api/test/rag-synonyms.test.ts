import { describe, expect, it } from 'vitest';
import { expandRetrievalQuery } from '../src/rag-synonyms';

describe('Ask retrieval synonym expansion', () => {
  it('expands a known alternate transliteration to the other spellings in its group', () => {
    const expanded = expandRetrievalQuery('What are the benefits of using a miswak?');
    expect(expanded).toContain('siwak');
    expect(expanded).toContain('tooth stick');
  });

  it('matches case-insensitively and matches from either direction within a group', () => {
    expect(expandRetrievalQuery('Tell me about SIWAK')).toContain('miswak');
    expect(expandRetrievalQuery('what is wudhu')).toContain('wudu');
  });

  it('leaves a question with no known alias untouched', () => {
    const question = 'What is the etiquette of visiting the sick?';
    expect(expandRetrievalQuery(question)).toBe(question);
  });

  it('does not duplicate the same term twice when it already appears in the question', () => {
    const expanded = expandRetrievalQuery('miswak siwak benefits');
    const occurrences = expanded.split(/\s+/).filter((word) => word === 'siwak').length;
    expect(occurrences).toBe(1);
  });
});
