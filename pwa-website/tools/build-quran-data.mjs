// Builds the offline Quran snapshot the PWA reads from data/quran/.
//
// Sources, and why each was chosen:
//   Arabic     Tanzil Project, uthmani-min. Distributed under CC BY 3.0: verbatim copying and
//              redistribution are permitted provided the source is credited with a link back, and
//              the text must not be altered. That makes it clean for any downstream use, including
//              serving through the platform API.
//   Tajweed    Quran.com / Quran Foundation (text_uthmani_tajweed), which returns the Uthmani text
//              with recitation rules already marked up inline as <tajweed class=...> spans, plus the
//              ornate end-of-ayah numeral. The obvious alternative, cpfair/quran-tajweed, annotates
//              by codepoint offset into a 2017 snapshot of the Tanzil text; measured against current
//              Tanzil that lands only 97-99% of rules on the right letter, because Tanzil's encoding
//              has shifted since. Mis-coloured tajweed teaches recitation wrongly, so the pre-marked
//              text was chosen -- there is no offset arithmetic to drift.
//   Sajdah     Quran.com verse metadata (sajdah_number), so prostration verses are marked as in a
//              printed mushaf rather than hard-coded from memory.
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
  tajweed: (surah) => `https://api.quran.com/api/v4/quran/verses/uthmani_tajweed?chapter_number=${surah}`,
  sajdah: (surah) => `https://api.quran.com/api/v4/verses/by_chapter/${surah}?fields=sajdah_number&per_page=300`,
};

// <tajweed class=x>..</tajweed> and the <span class=end>N</span> ayah numeral are stripped to
// recover plain text for copying, sharing and search. Kept as one helper so the app and the build
// agree on what "plain" means.
export function stripTajweed(markup) {
  return markup
    .replace(/<span class=end>.*?<\/span>/g, '')
    .replace(/<\/?tajweed[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

// Tanzil prefixes ayah 1 with the Bismillah; Quran.com's tajweed text does not (2:1 is just
// "الٓمٓ"). So only the plain text is stripped -- but that difference is asserted per surah rather
// than assumed, because silently stripping a real opening word would corrupt the verse.
const BISMILLAH_TAJWEED_PLAIN = stripTajweed(
  JSON.parse(await fetchCached('tajweed-1.json', SOURCES.tajweed(1))).verses[0].text_uthmani_tajweed,
);

function assertTajweedHasNoBismillah(surahNumber, markup) {
  if (stripTajweed(markup).startsWith(BISMILLAH_TAJWEED_PLAIN)) {
    throw new Error(`Surah ${surahNumber}: tajweed ayah 1 unexpectedly opens with the Bismillah; it would render twice`);
  }
}

let cursor = 0;
const index = [];
let sajdahTotal = 0;
const sajdahKeys = [];
for (const chapter of chapters) {
  const count = chapter.verses_count;
  const bismillahPre = Boolean(chapter.bismillah_pre);

  const [tajweedRaw, sajdahRaw] = await Promise.all([
    fetchCached(`tajweed-${chapter.id}.json`, SOURCES.tajweed(chapter.id)),
    fetchCached(`sajdah-${chapter.id}.json`, SOURCES.sajdah(chapter.id)),
  ]);
  const tajweedVerses = JSON.parse(tajweedRaw).verses;
  const sajdahVerses = JSON.parse(sajdahRaw).verses;
  if (tajweedVerses.length !== count) {
    throw new Error(`Surah ${chapter.id}: tajweed returned ${tajweedVerses.length} verses, expected ${count}`);
  }
  const sajdahByAyah = new Map(sajdahVerses
    .filter((verse) => verse.sajdah_number)
    .map((verse) => [verse.verse_number, verse.sajdah_number]));

  const ayahs = [];
  for (let i = 0; i < count; i += 1) {
    const ar = i === 0 ? openingText(chapter.id, bismillahPre, arabic[cursor]) : arabic[cursor];
    const tj = tajweedVerses[i].text_uthmani_tajweed;
    if (i === 0 && bismillahPre) assertTajweedHasNoBismillah(chapter.id, tj);
    const ayah = { n: i + 1, ar, tj, en: english[cursor] };
    const sajdah = sajdahByAyah.get(i + 1);
    if (sajdah) { ayah.sajdah = sajdah; sajdahTotal += 1; sajdahKeys.push(`${chapter.id}:${i + 1}`); }
    ayahs.push(ayah);
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
    sajdah: {
      convention: '14 verses (Hanafi, Maliki, Hanbali): includes Sad 38:24, excludes the second Hajj sajdah 22:77.',
    },
    tajweed: {
      source: 'Quran.com (Quran Foundation)',
      url: 'https://quran.com',
      text: 'Tajweed markup and sajdah marks from Quran.com (Quran Foundation).',
      licence: 'Free use with attribution.',
      redistributable: false,
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
// The number of recitation sajdahs is a point of fiqh difference, so the exact set is pinned rather
// than counted: this is the 14-sajdah convention (Hanafi/Maliki/Hanbali) that the upstream metadata
// follows -- it includes Sad 38:24 and excludes the second Hajj sajdah 22:77. The Shafi'i position
// is the reverse on both. Pinning the keys means an upstream change to the convention fails the
// build loudly instead of silently altering which verses the app tells people to prostrate at.
const EXPECTED_SAJDAH = ['7:206', '13:15', '16:50', '17:109', '19:58', '22:18', '25:60',
  '27:26', '32:15', '38:24', '41:38', '53:62', '84:21', '96:19'];
const foundSajdah = sajdahKeys.slice().sort();
if (foundSajdah.join(',') !== EXPECTED_SAJDAH.slice().sort().join(',')) {
  throw new Error(`Sajdah verses changed upstream.
  expected: ${EXPECTED_SAJDAH.join(', ')}
  found:    ${sajdahKeys.join(', ')}`);
}

console.log(`Built ${TOTAL_SURAHS} surahs / ${TOTAL_AYAHS} ayahs into data/quran/ (Bismillah separated on ${strippedCount}, ${sajdahTotal} sajdah verses, tajweed inline).`);
