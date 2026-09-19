import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { opensWithBismillah } from '../js/quran-audio.js';

// Every surah is recited from its Bismillah except At-Tawbah, which has none, and Al-Fatihah, where
// it is the first ayah rather than an opening to one -- so in neither case is there a separate line
// to play. The surah data already records this per surah, and the player reads it from there rather
// than carrying its own copy of the rule, so the recitation and the page cannot disagree.
const DATA = resolve(process.cwd(), 'data/quran');
const surah = (number) => JSON.parse(readFileSync(resolve(DATA, `surah-${number}.json`), 'utf8'));

describe('when a recitation opens with the Bismillah', () => {
  it('does for an ordinary surah', () => {
    expect(opensWithBismillah(surah(2))).toBe(true);
    expect(opensWithBismillah(surah(114))).toBe(true);
  });

  it('does not for At-Tawbah, which has no Bismillah', () => {
    expect(opensWithBismillah(surah(9))).toBe(false);
  });

  it('does not for Al-Fatihah, where the Bismillah is the first ayah', () => {
    // Playing it separately would recite it twice.
    expect(opensWithBismillah(surah(1))).toBe(false);
  });

  it('holds across the whole mushaf: 112 of 114', () => {
    const opening = Array.from({ length: 114 }, (_unused, index) => index + 1)
      .filter((number) => opensWithBismillah(surah(number)));
    expect(opening).toHaveLength(112);
    expect(opening).not.toContain(1);
    expect(opening).not.toContain(9);
  }, 20_000);

  it('treats a surah it was never given as not opening with one', () => {
    expect(opensWithBismillah(null)).toBe(false);
    expect(opensWithBismillah(undefined)).toBe(false);
  });
});
