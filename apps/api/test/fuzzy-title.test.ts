import { describe, expect, it } from 'vitest';
import { rankDuaTitles } from '../src/lib/fuzzy-title';

const titles = [
  { id: 'dua.hisn.001', sequence: 1, title: 'When waking up' },
  { id: 'dua.hisn.012', sequence: 12, title: 'Supplication when going to the mosque' },
  { id: 'dua.hisn.013', sequence: 13, title: 'Upon entering the mosque' },
  { id: 'dua.hisn.099', sequence: 99, title: 'For travel' },
  { id: 'dua.hisn.108', sequence: 108, title: 'While returning from travel' },
];

describe('rankDuaTitles', () => {
  it('finds a title from natural wording without requiring the full list', () => {
    expect(rankDuaTitles(titles, 'dua for waking up', 1)[0]?.id).toBe('dua.hisn.001');
    expect(rankDuaTitles(titles, 'entering mosque', 1)[0]?.id).toBe('dua.hisn.013');
  });

  it('tolerates common misspellings and ranks the closest title first', () => {
    expect(rankDuaTitles(titles, 'wakeing up', 1)[0]?.id).toBe('dua.hisn.001');
    expect(rankDuaTitles(titles, 'entering mosqe', 1)[0]?.id).toBe('dua.hisn.013');
  });

  it('returns useful alternatives for an ambiguous situation', () => {
    expect(rankDuaTitles(titles, 'travel', 2).map((match) => match.id)).toEqual([
      'dua.hisn.099',
      'dua.hisn.108',
    ]);
  });
});
