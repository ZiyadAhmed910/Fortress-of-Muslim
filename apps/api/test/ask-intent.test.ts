import { describe, expect, it } from 'vitest';
import { detectAskIntent } from '../src/rag-intent';
import { composeContexts } from '../src/rag';

// Retrieval scores see topical similarity and nothing else, so on a common theme the 14,357 hadith
// outnumber everything regardless of what was asked for. "Find tawakkul in the Quran" and "what did
// the Prophet say about intentions" are different requests, and the words say which.
//
// A preference, never a filter. The dropdown filters; wording only reorders, because a wrong guess
// about intent must not be able to hide the answer.

describe('reading what kind of source a question asks for', () => {
  it('hears a request for the Quran', () => {
    for (const question of [
      'find tawakkul in the quran',
      'which ayah talks about patience',
      'is there a verse about forgiveness',
      'what does surah al-kahf say about wealth',
    ]) {
      expect(detectAskIntent(question), question).toBe('quran');
    }
  });

  it('hears a request for hadith', () => {
    for (const question of [
      'give me a hadith about kindness',
      'what did the prophet say about intentions',
      'is this narrated in bukhari',
      'what does the sunnah say about fasting',
    ]) {
      expect(detectAskIntent(question), question).toBe('hadith');
    }
  });

  it('hears a request for a dua', () => {
    for (const question of [
      'dua for entering the toilet',
      'what should i recite before sleeping',
      'supplication for travel',
      'adhkar after prayer',
    ]) {
      expect(detectAskIntent(question), question).toBe('dua');
    }
  });

  it('stays out of the way when the question names no kind', () => {
    for (const question of ['what is tawakkul', 'how do I deal with anger', 'tell me about patience']) {
      expect(detectAskIntent(question), question).toBeNull();
    }
  });

  it('stays out of the way when a question asks for more than one kind', () => {
    // Picking one of them would answer worse than picking neither.
    expect(detectAskIntent('what do the quran and the sunnah say about charity')).toBeNull();
  });

  it('does not fire on a word that merely contains one', () => {
    expect(detectAskIntent('what happens at graduation')).toBeNull();
    expect(detectAskIntent('tell me about a versatile approach')).toBeNull();
  });
});

describe('what the preference does to the chosen contexts', () => {
  const item = (id: string, contentType: 'dua' | 'hadith' | 'quran', score: number) => ({
    record: {
      id,
      title: id,
      canonicalUrl: `https://fortressofmuslim.org/${id}`,
      verificationStatus: 'verified' as const,
      surah: 1,
      ayah: 1,
      surahName: 'Al-Fatihah',
      arabic: 'نص',
      translation: 'text',
    },
    contentType,
    score,
    retrieval: 'vector' as const,
  });
  // Hadith score highest, as they do on a common theme.
  const ranked = [
    item('hadith.1', 'hadith', 0.90),
    item('hadith.2', 'hadith', 0.88),
    item('hadith.3', 'hadith', 0.86),
    item('hadith.4', 'hadith', 0.84),
    item('dua.1', 'dua', 0.80),
    item('dua.2', 'dua', 0.78),
    item('quran.1', 'quran', 0.60),
    item('quran.2', 'quran', 0.58),
  ];

  it('leads with verses when the question asked about the Quran', () => {
    const chosen = composeContexts(ranked, 'quran');
    // First, not merely present. The citation numbers follow this order and the model leads with [1];
    // sorting the finished set by score put the verse fourth behind the hadith it was preferred over.
    expect(chosen[0]!.contentType).toBe('quran');
    expect(chosen.filter((entry) => entry.contentType === 'quran').length).toBeGreaterThanOrEqual(2);
    // And the hadith are still there: a preference, not a takeover.
    expect(chosen.some((entry) => entry.contentType === 'hadith')).toBe(true);
  });

  it('leads with duas when the question asked for a supplication', () => {
    const chosen = composeContexts(ranked, 'dua');
    expect(chosen[0]!.contentType).toBe('dua');
    expect(chosen.filter((entry) => entry.contentType === 'dua').length).toBeGreaterThanOrEqual(2);
    expect(chosen.some((entry) => entry.contentType !== 'dua')).toBe(true);
  });

  it('keeps the Quran represented even with no stated preference', () => {
    const chosen = composeContexts(ranked, null);
    expect(chosen.some((entry) => entry.contentType === 'quran')).toBe(true);
  });

  it('never returns more contexts than the answer is built from', () => {
    for (const intent of ['quran', 'hadith', 'dua', null] as const) {
      expect(composeContexts(ranked, intent).length).toBeLessThanOrEqual(6);
    }
  });

  it('does not invent contexts when only one kind was retrieved', () => {
    const versesOnly = [item('quran.1', 'quran', 0.6), item('quran.2', 'quran', 0.58)];
    expect(composeContexts(versesOnly, 'hadith').map((entry) => entry.record.id)).toEqual(['quran.1', 'quran.2']);
  });
});
