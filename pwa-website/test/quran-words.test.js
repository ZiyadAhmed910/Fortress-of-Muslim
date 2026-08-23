import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Word audio is addressed as wbw/SSS_AAA_WWW.mp3, where WWW is a word's position in its ayah. If
// that numbering ever drifts from the stored words, the player does not fail -- it plays the wrong
// word, silently, and only in the ayahs nobody happened to check. These tests exist to make that
// drift loud.
const DATA = resolve(process.cwd(), 'data/quran');
const readJson = (name) => JSON.parse(readFileSync(resolve(DATA, name), 'utf8'));

// Strips vowel marks, tatweel and alef-form differences, leaving the consonantal skeleton the two
// orthographies agree on.
const bare = (text) => text
  .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
  .replace(/[آأإٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/\s+/g, '');

const index = readJson('index.json');
const surahs = index.surahs;
const words = new Map(surahs.map((s) => [s.number, readJson(`words-${s.number}.json`)]));
const bodies = new Map(surahs.map((s) => [s.number, readJson(`surah-${s.number}.json`)]));

describe('word-by-word data', () => {
  it('covers all 114 surahs', () => {
    expect(words.size).toBe(114);
    for (const surah of surahs) {
      expect(words.get(surah.number).number, `surah ${surah.number}`).toBe(surah.number);
    }
  });

  it('has one word list per ayah, matching the surah body', () => {
    for (const surah of surahs) {
      const wordAyahs = words.get(surah.number).ayahs;
      expect(wordAyahs.length, `surah ${surah.number} ayah count`).toBe(surah.ayahCount);
      expect(wordAyahs.length).toBe(bodies.get(surah.number).ayahs.length);
    }
  });

  it('totals 6236 ayahs and 77429 words', () => {
    let ayahs = 0;
    let total = 0;
    for (const payload of words.values()) {
      ayahs += payload.ayahs.length;
      for (const ayah of payload.ayahs) total += ayah.length;
    }
    expect(ayahs).toBe(6236);
    // The count quran.com's segmentation produces, and therefore the count its audio files are
    // numbered against.
    expect(total).toBe(77429);
  });

  it('never has an empty ayah, and every word carries Arabic', () => {
    for (const [number, payload] of words) {
      payload.ayahs.forEach((ayah, i) => {
        expect(ayah.length, `${number}:${i + 1} has no words`).toBeGreaterThan(0);
        for (const [arabic] of ayah) {
          expect(typeof arabic, `${number}:${i + 1}`).toBe('string');
          expect(arabic.trim().length, `${number}:${i + 1} has a blank word`).toBeGreaterThan(0);
        }
      });
    }
  });

  it('glosses almost every word, so word mode is not a wall of blanks', () => {
    let glossed = 0;
    let total = 0;
    for (const payload of words.values()) {
      for (const ayah of payload.ayahs) {
        for (const [, gloss] of ayah) {
          total += 1;
          if (gloss && gloss.trim()) glossed += 1;
        }
      }
    }
    expect(glossed / total).toBeGreaterThan(0.99);
  });

  // This is the whole reason the data is stored rather than derived. Splitting the Arabic on
  // whitespace looks equivalent and is right for 6232 of 6236 ayahs -- the four below are where
  // Tanzil writes as two tokens what the Uthmani script counts as one word. Deriving positions at
  // runtime would play every word after those points one place off.
  it('disagrees with whitespace splitting in exactly the four known places', () => {
    const divergent = [];
    for (const surah of surahs) {
      const body = bodies.get(surah.number).ayahs;
      const wordAyahs = words.get(surah.number).ayahs;
      body.forEach((ayah, i) => {
        const split = ayah.ar.trim().split(/\s+/).filter(Boolean).length;
        if (split !== wordAyahs[i].length) divergent.push(`${surah.number}:${ayah.n}`);
      });
    }
    expect(divergent).toEqual(['2:181', '8:6', '13:37', '37:130']);
  });

  it('keeps Al-Fatihah word for word', () => {
    const fatihah = words.get(1).ayahs;
    expect(fatihah[0].map(([ar]) => bare(ar))).toEqual(['بسم', 'الله', 'الرحمن', 'الرحيم']);
    expect(fatihah[0][1][1]).toBe('(of) Allah');
    expect(fatihah.reduce((n, ayah) => n + ayah.length, 0)).toBe(29);
  });

  // The strongest check available offline: the stored words really are the words of the ayah, in
  // order. Comparison is on the consonantal skeleton because the two files come from different
  // orthographies -- the bodies are Tanzil, the words are Uthmani from quran.com -- and they write
  // the same word with different vowel marks and alef forms. Those differences are why the earlier
  // literal-string version of the test above failed against text that was in fact correct.
  it('reproduces each ayah when its words are joined', () => {
    // Three ayahs write a hamza the two orthographies place differently (Tanzil's fa-iddaara'tum
    // against the Uthmani spelling, and the same pattern twice more). They are listed rather than
    // normalised away: widening the stripping until they pass would blunt the check everywhere
    // else, and the point of this test is to catch a word list that has genuinely drifted.
    const ORTHOGRAPHY = new Set(['2:72', '11:13', '27:26']);
    const mismatched = [];
    for (const surah of surahs) {
      const body = bodies.get(surah.number).ayahs;
      const wordAyahs = words.get(surah.number).ayahs;
      body.forEach((ayah, i) => {
        const ref = `${surah.number}:${ayah.n}`;
        if (ORTHOGRAPHY.has(ref)) return;
        if (wordAyahs[i].map(([ar]) => bare(ar)).join('') !== bare(ayah.ar)) mismatched.push(ref);
      });
    }
    expect(mismatched).toEqual([]);
  });
});
