// Builds the offline Quran snapshot the PWA reads from data/quran/.
//
// Sources, and why each was chosen:
//   Arabic     Tanzil Project, uthmani-min. Distributed under CC BY 3.0: verbatim copying and
//              redistribution are permitted provided the source is credited with a link back, and
//              the text must not be altered. That makes it clean for any downstream use, including
//              serving through the platform API.
//   Translation Saheeh International, via Tanzil. Copyrighted; permitted here for free,
//              non-commercial religious use with attribution. It is deliberately NOT cleared for
//              redistribution to third-party developers through the platform API -- see
//              data/quran/index.json's `attribution` block, which travels with the data.
//
// Both files are plain text, one ayah per line, in the same canonical Hafs order (6236 ayahs), so
// they can be zipped together by line index. The script asserts that alignment rather than trusting
// it, because a silent off-by-one would attach the wrong translation to a verse.
//
// Output is one file per surah so the app can fetch only what is opened, plus a small index the
// shell precaches. Run with: npm run pwa:quran:build

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const OUT_DIR = new URL('../data/quran/', import.meta.url);
const CACHE_DIR = new URL('../../.quran-cache/', import.meta.url);
const TOTAL_AYAHS = 6236;
const TOTAL_SURAHS = 114;

const SOURCES = {
  arabic: 'https://tanzil.net/pub/download/index.php?quranType=uthmani-min&outType=txt&agree=true',
  english: 'https://tanzil.net/trans/?transID=en.sahih&type=txt&agree=true',
  chapters: 'https://api.quran.com/api/v4/chapters?language=en',
};

// Downloads are cached on disk so re-running the build does not re-hit the upstream sites, and so a
// build stays reproducible if one of them is briefly unreachable.
async function fetchCached(name, url) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cached = new URL(name, CACHE_DIR);
  if (existsSync(cached)) return readFile(cached, 'utf8');
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} from ${url}`);
  const text = await response.text();
  await writeFile(cached, text, 'utf8');
  return text;
}

// Tanzil appends a licence/credits block of #-prefixed lines; keep only real ayah lines.
function ayahLines(raw, label) {
  const lines = raw.split(/\r?\n/).filter((line) => !line.startsWith('#') && line.trim().length > 0);
  if (lines.length !== TOTAL_AYAHS) {
    throw new Error(`${label}: expected ${TOTAL_AYAHS} ayahs, parsed ${lines.length}`);
  }
  return lines;
}

const [arabicRaw, englishRaw, chaptersRaw] = await Promise.all([
  fetchCached('arabic.txt', SOURCES.arabic),
  fetchCached('english-sahih.txt', SOURCES.english),
  fetchCached('chapters.json', SOURCES.chapters),
]);

const arabic = ayahLines(arabicRaw, 'Arabic (Tanzil uthmani-min)');
const english = ayahLines(englishRaw, 'English (Saheeh International)');
const chapters = JSON.parse(chaptersRaw).chapters;

if (chapters.length !== TOTAL_SURAHS) throw new Error(`Expected ${TOTAL_SURAHS} surahs, got ${chapters.length}`);
const declared = chapters.reduce((sum, chapter) => sum + chapter.verses_count, 0);
if (declared !== TOTAL_AYAHS) throw new Error(`Surah verse counts sum to ${declared}, expected ${TOTAL_AYAHS}`);

await mkdir(OUT_DIR, { recursive: true });

// Tanzil prefixes ayah 1 of every surah except At-Tawbah with the Bismillah. For Al-Fatihah that
// prefix IS ayah 1 and must stay; everywhere else it is an opening line that is not part of the
// verse -- the Saheeh International translation omits it there, so leaving it in would show the
// Bismillah twice in Arabic (once as the surah heading, once inside ayah 1) against an English
// line that does not contain it. Taken from the data rather than typed, so diacritics match.
const BISMILLAH = arabic[0].trim();
let strippedCount = 0;

function openingText(surahNumber, bismillahPre, text) {
  if (!bismillahPre) return text;
  const trimmed = text.trim();
  if (!trimmed.startsWith(BISMILLAH)) {
    throw new Error(`Surah ${surahNumber}: expected a Bismillah prefix on ayah 1, found "${trimmed.slice(0, 40)}"`);
  }
  const remainder = trimmed.slice(BISMILLAH.length).trim();
  if (!remainder) throw new Error(`Surah ${surahNumber}: stripping the Bismillah left ayah 1 empty`);
  strippedCount += 1;
  return remainder;
}

let cursor = 0;
const index = [];
for (const chapter of chapters) {
  const count = chapter.verses_count;
  const bismillahPre = Boolean(chapter.bismillah_pre);
  const ayahs = [];
  for (let i = 0; i < count; i += 1) {
    const ar = i === 0 ? openingText(chapter.id, bismillahPre, arabic[cursor]) : arabic[cursor];
    ayahs.push({ n: i + 1, ar, en: english[cursor] });
    cursor += 1;
  }
  const surah = {
    number: chapter.id,
    nameArabic: chapter.name_arabic,
    nameSimple: chapter.name_simple,
    nameEnglish: chapter.translated_name.name,
    revelationPlace: chapter.revelation_place,
    ayahCount: count,
    // Every surah opens with the Bismillah except At-Tawbah (9). In Al-Fatihah it is ayah 1 of the
    // text itself, so it must not also be rendered as a heading -- hence a flag rather than the app
    // guessing from the surah number.
    bismillahPre,
    ayahs,
  };
  await writeFile(new URL(`surah-${chapter.id}.json`, OUT_DIR), JSON.stringify(surah), 'utf8');
  index.push({
    number: surah.number,
    nameArabic: surah.nameArabic,
    nameSimple: surah.nameSimple,
    nameEnglish: surah.nameEnglish,
    revelationPlace: surah.revelationPlace,
    ayahCount: surah.ayahCount,
  });
}

if (cursor !== TOTAL_AYAHS) throw new Error(`Consumed ${cursor} ayahs, expected ${TOTAL_AYAHS}`);

await writeFile(new URL('index.json', OUT_DIR), JSON.stringify({
  totalSurahs: TOTAL_SURAHS,
  totalAyahs: TOTAL_AYAHS,
  attribution: {
    arabic: {
      source: 'Tanzil Project',
      url: 'https://tanzil.net',
      text: 'Quran text copied from the Tanzil Project (tanzil.net), used verbatim under CC BY 3.0.',
      licence: 'CC BY 3.0',
      redistributable: true,
    },
    translation: {
      source: 'Saheeh International',
      url: 'https://tanzil.net/trans/',
      text: 'English translation: Saheeh International, obtained via the Tanzil Project.',
      licence: 'Copyright retained by the publisher; free non-commercial religious use with attribution.',
      redistributable: false,
    },
  },
  surahs: index,
}), 'utf8');

// 114 surahs, minus Al-Fatihah (Bismillah is its ayah 1) and At-Tawbah (no Bismillah at all).
if (strippedCount !== 112) throw new Error(`Stripped a Bismillah prefix from ${strippedCount} surahs, expected 112`);

console.log(`Built ${TOTAL_SURAHS} surahs / ${TOTAL_AYAHS} ayahs into data/quran/ (Bismillah prefix separated on ${strippedCount}).`);
