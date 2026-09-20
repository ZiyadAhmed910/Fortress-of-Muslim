// Builds per-surah word-by-word data: the Arabic of each word and its English gloss.
//
// Word audio on the CDN is addressed as wbw/SSS_AAA_WWW.mp3, where WWW is the word's position
// within its ayah. Splitting our Arabic text on whitespace *looks* like it would reproduce those
// positions, and on a 15-ayah sample it did -- but the whole-Quran word total came out 4 words
// away from quran.com's segmentation, which means a handful of ayahs disagree. A wrong position
// plays the wrong word, silently, and only for the ayahs nobody sampled. So the segmentation is
// taken from the same source that numbers the audio files, and stored, rather than re-derived at
// runtime from text that was never guaranteed to segment identically.
//
// These files are fetched only when a reader turns word mode on, like surah bodies already are --
// bundling 2.6MB into an app whose point is being light would be the wrong trade.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'data/quran');
const API = 'https://api.quran.com/api/v4/verses/by_chapter';
const TOTAL_AYAHS = 6236;

async function fetchChapter(number, attempt = 1) {
  const url = `${API}/${number}?words=true&word_fields=text_uthmani,char_type_name,position`
    + '&word_translation_language=en&per_page=300';
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 4) throw new Error(`surah ${number} failed after ${attempt} attempts: ${error.message}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return fetchChapter(number, attempt + 1);
  }
}

const index = JSON.parse(readFileSync(resolve(OUT_DIR, 'index.json'), 'utf8'));
mkdirSync(OUT_DIR, { recursive: true });

let totalWords = 0;
let totalAyahs = 0;

for (const meta of index.surahs) {
  const payload = await fetchChapter(meta.number);
  const verses = payload.verses || [];
  if (verses.length !== meta.ayahCount) {
    throw new Error(`surah ${meta.number}: got ${verses.length} ayahs, expected ${meta.ayahCount}`);
  }

  const ayahs = verses.map((verse) => {
    const words = (verse.words || []).filter((w) => w.char_type_name === 'word');
    // Positions must run 1..n with no gaps: the audio filename is built from this number, so a gap
    // would mean every later word in the ayah plays one word off.
    words.forEach((word, i) => {
      if (word.position !== i + 1) {
        throw new Error(`${verse.verse_key}: word ${i + 1} reports position ${word.position}`);
      }
    });
    if (!words.length) throw new Error(`${verse.verse_key}: no words`);
    totalWords += words.length;
    return words.map((w) => [w.text_uthmani, (w.translation && w.translation.text) || '']);
  });

  totalAyahs += ayahs.length;
  writeFileSync(resolve(OUT_DIR, `words-${meta.number}.json`), JSON.stringify({ number: meta.number, ayahs }));
  process.stdout.write(`\rsurah ${meta.number}/114  words ${totalWords}   `);
  await new Promise((r) => setTimeout(r, 120));
}

if (totalAyahs !== TOTAL_AYAHS) throw new Error(`wrote ${totalAyahs} ayahs, expected ${TOTAL_AYAHS}`);
console.log(`\ndone: ${totalAyahs} ayahs, ${totalWords} words across 114 files`);
