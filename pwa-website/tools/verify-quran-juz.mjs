// Verifies data/quran/juz.json: where each of the thirty ajza begins and ends.
//
//   node pwa-website/tools/verify-quran-juz.mjs            offline, checked against our own mushaf
//   node pwa-website/tools/verify-quran-juz.mjs --online   also cross-checked against outside sources
//
// Read the direction of this carefully, because an earlier version of this tool had it backwards.
// data/quran/juz.json is OUR canonical data. It is committed, reviewable and diffable like any
// other file in this repo, and it is what the app ships and reads. This tool NEVER writes it. It
// only ever checks it, and the outside sources can only ever disagree -- they cannot supply.
//
// That distinction is the whole point. A generator that re-fetches its data on every run makes a
// third party the authority over what our app says the Quran is divided into: the file would change
// underneath us whenever theirs did, and a review would show a diff nobody chose. The boundaries are
// a fixed division of the mushaf, not a moving figure. They belong in the repo.
//
// What is checked, in order of how much it is worth:
//
//   1. The tiling, offline, always. The thirty ajza must cover every one of the 6,236 ayahs of the
//      mushaf THIS app ships, in order, each ayah in exactly one juz, from 1:1 to 114:6. This is the
//      strongest check available and it needs no network: a boundary that is off by a single ayah
//      cannot survive it, because the gap it leaves has to show up somewhere.
//   2. Internal agreement. Each juz's start, end and ayah count must match its own per-surah ranges,
//      and every range must lie inside a surah that exists and is at least that long.
//   3. With --online, agreement with quran.com and alquran.cloud -- two independent projects. This
//      is corroboration, not authority, and it is deliberately not part of `npm run check`: a green
//      build must not depend on someone else's uptime.
import { readFileSync } from 'node:fs';

const online = process.argv.includes('--online');
const quranData = new URL('../data/quran/', import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, quranData), 'utf8'));

const index = readJson('index.json');
const ours = readJson('juz.json');

const failures = [];
const fail = (message) => failures.push(message);

/** Every ayah of our mushaf in order, so a boundary can be turned into a position and back. */
const sequence = [];
for (const surah of index.surahs) {
  for (let ayah = 1; ayah <= surah.ayahCount; ayah += 1) sequence.push({ surah: surah.number, ayah });
}
if (sequence.length !== index.totalAyahs) {
  fail(`index.json does not agree with itself: ${sequence.length} ayahs listed, ${index.totalAyahs} claimed.`);
}
const positionOf = new Map(sequence.map((entry, position) => [`${entry.surah}:${entry.ayah}`, position]));
const ayahCount = new Map(index.surahs.map((surah) => [surah.number, surah.ayahCount]));

// --- 2. Each juz agrees with itself, and names ayahs this mushaf actually has -------------------
if (ours.juz.length !== 30) fail(`Expected 30 ajza, found ${ours.juz.length}.`);
if (ours.totalAyahs !== index.totalAyahs) {
  fail(`juz.json claims ${ours.totalAyahs} ayahs; index.json has ${index.totalAyahs}.`);
}

for (const [at, juz] of ours.juz.entries()) {
  if (juz.number !== at + 1) fail(`The juz at position ${at + 1} is numbered ${juz.number}.`);
  let covered = 0;
  for (const part of juz.surahs) {
    const length = ayahCount.get(part.surah);
    if (!length) {
      fail(`Juz ${juz.number} names surah ${part.surah}, which this mushaf does not have.`);
      continue;
    }
    if (!(part.from >= 1 && part.to >= part.from && part.to <= length)) {
      fail(`Juz ${juz.number}: ${part.surah}:${part.from}-${part.to} is not a range inside a surah of ${length} ayahs.`);
      continue;
    }
    covered += part.to - part.from + 1;
  }
  if (covered !== juz.ayahCount) {
    fail(`Juz ${juz.number}: its ranges cover ${covered} ayahs but ayahCount says ${juz.ayahCount}.`);
  }

  const first = juz.surahs[0];
  const last = juz.surahs[juz.surahs.length - 1];
  if (first && (juz.start.surah !== first.surah || juz.start.ayah !== first.from)) {
    fail(`Juz ${juz.number}: start ${juz.start.surah}:${juz.start.ayah} is not where its ranges begin.`);
  }
  if (last && (juz.end.surah !== last.surah || juz.end.ayah !== last.to)) {
    fail(`Juz ${juz.number}: end ${juz.end.surah}:${juz.end.ayah} is not where its ranges end.`);
  }
}

// --- 1. The check that matters most: a partition of the mushaf, not thirty plausible ranges -----
let expected = 0;
for (const juz of ours.juz) {
  const startAt = positionOf.get(`${juz.start.surah}:${juz.start.ayah}`);
  const endAt = positionOf.get(`${juz.end.surah}:${juz.end.ayah}`);
  if (startAt === undefined || endAt === undefined) {
    fail(`Juz ${juz.number} names an ayah this mushaf does not have.`);
    break;
  }
  if (startAt !== expected) {
    const at = sequence[expected];
    fail(`Juz ${juz.number} starts at ${juz.start.surah}:${juz.start.ayah}, leaving a gap or overlap at ${at.surah}:${at.ayah}.`);
    break;
  }
  if (endAt - startAt + 1 !== juz.ayahCount) {
    fail(`Juz ${juz.number} spans ${endAt - startAt + 1} ayahs but claims ${juz.ayahCount}.`);
    break;
  }
  expected = endAt + 1;
}
if (!failures.length && expected !== sequence.length) {
  fail(`The ajza cover ${expected} ayahs, not ${sequence.length}.`);
}

if (failures.length) {
  console.error('data/quran/juz.json does not check out:\n');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`data/quran/juz.json checks out: 30 ajza tiling ${sequence.length} ayahs exactly, no gap, no overlap.`);

// --- 3. Corroboration, only when asked ----------------------------------------------------------
if (!online) {
  console.log('Run with --online to also cross-check against quran.com and alquran.cloud.');
  process.exit(0);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thirty requests in a row is enough to get rate-limited, and being told 429 is not a disagreement
 * about the Quran -- treating it as one would report a boundary as wrong because someone else's
 * server was busy. Backs off and tries again; only a real answer counts either way.
 */
async function getJson(url, attempt = 1) {
  const response = await fetch(url);
  if (response.ok) return response.json();
  const retryable = response.status === 429 || response.status >= 500;
  if (retryable && attempt <= 4) {
    const backoff = 2 ** attempt * 1_000;
    console.log(`  ${response.status} from ${new URL(url).host}; waiting ${backoff / 1000}s and retrying.`);
    await wait(backoff);
    return getJson(url, attempt + 1);
  }
  throw new Error(`${url}: HTTP ${response.status}`);
}

const disagreements = [];
const same = (left, right) => left.surah === right.surah && left.ayah === right.ayah;
const show = (juz) => `${juz.start.surah}:${juz.start.ayah} to ${juz.end.surah}:${juz.end.ayah} (${juz.ayahCount})`;

console.log('\nCross-checking against quran.com...');
const { juzs } = await getJson('https://api.quran.com/api/v4/juzs');
// The endpoint returns each juz twice under different ids; the boundaries are identical.
const theirs = new Map();
for (const juz of juzs) {
  if (!theirs.has(juz.juz_number)) theirs.set(juz.juz_number, juz);
}
for (const juz of ours.juz) {
  const other = theirs.get(juz.number);
  if (!other) {
    disagreements.push(`quran.com has no juz ${juz.number}.`);
    continue;
  }
  const parts = Object.entries(other.verse_mapping)
    .map(([surah, range]) => {
      const [from, to] = String(range).split('-').map(Number);
      return { surah: Number(surah), from, to };
    })
    .sort((left, right) => left.surah - right.surah);
  const start = { surah: parts[0].surah, ayah: parts[0].from };
  const end = { surah: parts[parts.length - 1].surah, ayah: parts[parts.length - 1].to };
  if (!same(juz.start, start) || !same(juz.end, end) || juz.ayahCount !== other.verses_count) {
    disagreements.push([
      `Juz ${juz.number} differs from quran.com.`,
      `    ours      : ${show(juz)}`,
      `    quran.com : ${start.surah}:${start.ayah} to ${end.surah}:${end.ayah} (${other.verses_count})`,
    ].join('\n'));
  }
}

console.log('Cross-checking against alquran.cloud...');
for (const juz of ours.juz) {
  if (juz.number > 1) await wait(400); // thirty back-to-back requests is what trips their limiter
  const { data } = await getJson(`https://api.alquran.cloud/v1/juz/${juz.number}/quran-uthmani`);
  const verses = data.ayahs;
  const start = { surah: verses[0].surah.number, ayah: verses[0].numberInSurah };
  const end = {
    surah: verses[verses.length - 1].surah.number,
    ayah: verses[verses.length - 1].numberInSurah,
  };
  if (!same(juz.start, start) || !same(juz.end, end) || verses.length !== juz.ayahCount) {
    disagreements.push([
      `Juz ${juz.number} differs from alquran.cloud.`,
      `    ours          : ${show(juz)}`,
      `    alquran.cloud : ${start.surah}:${start.ayah} to ${end.surah}:${end.ayah} (${verses.length})`,
    ].join('\n'));
  }
}

if (disagreements.length) {
  // Deliberately not an instruction to change our file. A disagreement is a question for a person:
  // it may be their bug, a different numbering convention, or ours. Nothing is rewritten here.
  console.error('\nOur boundaries disagree with an outside source. Investigate before changing anything:\n');
  for (const message of disagreements) console.error(`  - ${message}`);
  process.exit(1);
}
console.log('\nBoth outside sources agree with ours on all thirty.');
