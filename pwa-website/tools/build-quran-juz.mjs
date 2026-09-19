// Builds data/quran/juz.json: where each of the thirty ajza begins and ends.
//
// Run from the repository root:
//   node pwa-website/tools/build-quran-juz.mjs
//
// The boundaries are not typed in from memory. They are fetched from quran.com, cross-checked
// ayah-for-ayah against alquran.cloud -- two independent projects -- and then validated against the
// mushaf this app already ships: the thirty ajza must tile all 6,236 ayahs exactly, in order, with
// no gap and no overlap, starting at 1:1 and ending at 114:6. Any disagreement anywhere aborts
// without writing, because a juz boundary that is quietly wrong is worse than a feature that is
// missing.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = new URL('../../', import.meta.url);
const quranData = new URL('pwa-website/data/quran/', repositoryRoot);
const output = new URL('juz.json', quranData);

const readJson = (name) => JSON.parse(readFileSync(new URL(name, quranData), 'utf8'));
const index = readJson('index.json');
const ayahCount = new Map(index.surahs.map((surah) => [surah.number, surah.ayahCount]));

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** Every ayah of the mushaf in order, so a boundary can be turned into a position and back. */
const sequence = [];
for (const surah of index.surahs) {
  for (let ayah = 1; ayah <= surah.ayahCount; ayah += 1) sequence.push({ surah: surah.number, ayah });
}
if (sequence.length !== index.totalAyahs) {
  throw new Error(`The shipped index does not agree with itself: ${sequence.length} ayahs, ${index.totalAyahs} claimed.`);
}
const positionOf = new Map(sequence.map((entry, position) => [`${entry.surah}:${entry.ayah}`, position]));

console.log('Fetching juz boundaries from quran.com...');
const { juzs } = await getJson('https://api.quran.com/api/v4/juzs');
// The endpoint returns each juz twice under different ids; the boundaries are identical.
const byNumber = new Map();
for (const juz of juzs) {
  const existing = byNumber.get(juz.juz_number);
  const mapping = JSON.stringify(juz.verse_mapping);
  if (existing && JSON.stringify(existing.verse_mapping) !== mapping) {
    throw new Error(`quran.com disagrees with itself about juz ${juz.juz_number}.`);
  }
  byNumber.set(juz.juz_number, juz);
}
if (byNumber.size !== 30) throw new Error(`Expected 30 ajza, got ${byNumber.size}.`);

const built = [];
for (let number = 1; number <= 30; number += 1) {
  const juz = byNumber.get(number);
  const surahs = Object.entries(juz.verse_mapping).map(([surah, range]) => {
    const [from, to] = String(range).split('-').map(Number);
    const count = ayahCount.get(Number(surah));
    if (!count) throw new Error(`Juz ${number} names surah ${surah}, which this mushaf does not have.`);
    if (!(from >= 1 && to >= from && to <= count)) {
      throw new Error(`Juz ${number}: ${surah}:${range} is not a range inside a surah of ${count} ayahs.`);
    }
    return { surah: Number(surah), from, to };
  }).sort((left, right) => left.surah - right.surah);

  const first = surahs[0];
  const last = surahs[surahs.length - 1];
  const start = { surah: first.surah, ayah: first.from };
  const end = { surah: last.surah, ayah: last.to };
  const ayahs = surahs.reduce((total, part) => total + (part.to - part.from + 1), 0);
  if (ayahs !== juz.verses_count) {
    throw new Error(`Juz ${number}: mapping covers ${ayahs} ayahs, quran.com says ${juz.verses_count}.`);
  }
  built.push({ number, start, end, ayahCount: ayahs, surahs });
}

console.log('Cross-checking every juz against alquran.cloud...');
for (const juz of built) {
  const { data } = await getJson(`https://api.alquran.cloud/v1/juz/${juz.number}/quran-uthmani`);
  const verses = data.ayahs;
  const otherStart = { surah: verses[0].surah.number, ayah: verses[0].numberInSurah };
  const otherEnd = {
    surah: verses[verses.length - 1].surah.number,
    ayah: verses[verses.length - 1].numberInSurah,
  };
  const same = (left, right) => left.surah === right.surah && left.ayah === right.ayah;
  if (!same(juz.start, otherStart) || !same(juz.end, otherEnd) || verses.length !== juz.ayahCount) {
    throw new Error([
      `Juz ${juz.number} does not reconcile between sources.`,
      `  quran.com     : ${juz.start.surah}:${juz.start.ayah} to ${juz.end.surah}:${juz.end.ayah} (${juz.ayahCount})`,
      `  alquran.cloud : ${otherStart.surah}:${otherStart.ayah} to ${otherEnd.surah}:${otherEnd.ayah} (${verses.length})`,
    ].join('\n'));
  }
  process.stdout.write(`  juz ${String(juz.number).padStart(2)} ✓\r`);
}
console.log('\nBoth sources agree on all thirty.');

// The check that matters most: the ajza are a partition of the mushaf, not thirty ranges that
// merely look plausible one at a time.
let expected = 0;
for (const juz of built) {
  const startAt = positionOf.get(`${juz.start.surah}:${juz.start.ayah}`);
  const endAt = positionOf.get(`${juz.end.surah}:${juz.end.ayah}`);
  if (startAt === undefined || endAt === undefined) throw new Error(`Juz ${juz.number} names an ayah this mushaf does not have.`);
  if (startAt !== expected) {
    const at = sequence[expected];
    throw new Error(`Juz ${juz.number} starts at ${juz.start.surah}:${juz.start.ayah}, leaving a gap or overlap at ${at.surah}:${at.ayah}.`);
  }
  if (endAt - startAt + 1 !== juz.ayahCount) throw new Error(`Juz ${juz.number} spans ${endAt - startAt + 1} ayahs but claims ${juz.ayahCount}.`);
  expected = endAt + 1;
}
if (expected !== sequence.length) throw new Error(`The ajza cover ${expected} ayahs, not ${sequence.length}.`);

writeFileSync(output, `${JSON.stringify({
  totalJuz: built.length,
  totalAyahs: sequence.length,
  attribution: {
    source: 'quran.com API, cross-checked against alquran.cloud',
    text: 'Juz boundaries fetched from api.quran.com and verified ayah-for-ayah against api.alquran.cloud.',
  },
  juz: built,
}, null, 1)}\n`);
console.log(`Wrote ${fileURLToPath(output)} -- 30 ajza tiling ${sequence.length} ayahs exactly.`);
