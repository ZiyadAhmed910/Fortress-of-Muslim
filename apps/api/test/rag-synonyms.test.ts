import { describe, expect, it } from 'vitest';
import { expandRetrievalQuery } from '../src/rag-synonyms';

// Expansion is what lets a question reach content that never uses its words. It only fires when a
// group member appears in the question, so a group whose every member is a multi-word phrase is a
// group that mostly never fires -- which is exactly what happened to tawakkul: the translation says
// "reliance upon Allah", a person types "reliance on Allah", nothing matched, and the question that
// motivated the group returned five verses of Surah Ash-Shu'ara at 0.02.

describe('reaching a concept by the words people type', () => {
  it('expands reliance, however the preposition falls', () => {
    for (const question of [
      'Give me a Quran verse for reliance on Allah',
      'reliance upon Allah',
      'verses about relying on Allah',
      'what is tawakkul',
    ]) {
      expect(expandRetrievalQuery(question).toLowerCase(), question).toContain('tawakkul');
    }
  });

  it('carries the other Arabic concepts to their English wording', () => {
    expect(expandRetrievalQuery('verses about sabr').toLowerCase()).toContain('patience');
    expect(expandRetrievalQuery('what does the Quran say about rizq').toLowerCase()).toContain('provision');
    expect(expandRetrievalQuery('hadith about shukr').toLowerCase()).toContain('gratitude');
  });

  it('carries English wording back to the Arabic term', () => {
    expect(expandRetrievalQuery('verses about patience').toLowerCase()).toContain('sabr');
    expect(expandRetrievalQuery('dua for ablution').toLowerCase()).toContain('wudu');
  });

  it('leaves a question naming no known concept exactly as it was', () => {
    const question = 'what time does the sun set in December';
    expect(expandRetrievalQuery(question)).toBe(question);
  });

  it('every concept can be reached by a single word', () => {
    // The structural guard. A group reachable only by a full phrase is one that will quietly fail
    // for the phrasing a person actually uses, and nothing about the failure looks like a failure:
    // retrieval simply returns something worse.
    const probes = [
      'siwak', 'dua', 'ruqyah', 'adhan', 'iqamah', 'wudu', 'ghusl', 'tayammum', 'witr', 'zakat',
      'sunnah', 'istighfar', 'talbiyah', 'tashahhud', 'istikharah', 'taraweeh', 'iftar', 'suhoor',
      'tawakkul', 'sabr', 'taqwa', 'shukr', 'rizq', 'tawbah', 'dhikr', 'sadaqah', 'jannah',
      'jahannam', 'qadar', 'ilm', 'rahmah',
    ];
    for (const probe of probes) {
      expect(expandRetrievalQuery(probe), probe).not.toBe(probe);
    }
  });
});
