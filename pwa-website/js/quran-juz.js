// The thirty ajza (parahs): where each one begins and ends, and how to say so in a list.
//
// The boundaries themselves are not written here. They live in data/quran/juz.json, built and
// verified by tools/build-quran-juz.mjs -- fetched from quran.com, reconciled ayah-for-ayah against
// alquran.cloud, and checked to tile all 6,236 ayahs with no gap and no overlap. Nothing in this
// file second-guesses them; it only reads them.
const JUZ_URL = './data/quran/juz.json';

let index = null;
let pending = null;

/**
 * The juz index, fetched once. Concurrent callers share the one request rather than each starting
 * their own -- opening the Juz tab while a citation is already loading it is an ordinary race.
 */
export async function loadJuzIndex() {
  if (index) return index;
  if (!pending) {
    pending = fetch(JUZ_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => { index = data; return data; })
      .finally(() => { pending = null; });
  }
  return pending;
}

/** The loaded index, or null if it has not been fetched yet. For callers that must not await. */
export function juzIndex() {
  return index;
}

/** Used by tests to supply an index without a network. */
export function setJuzIndex(data) {
  index = data;
}

/**
 * Which juz an ayah falls in, or null if it falls outside every one of them. Reads the per-surah
 * ranges rather than comparing against start/end, because a juz boundary can sit mid-surah and a
 * naive "after the start and before the end" test gets the surah either side of it wrong.
 */
export function juzContaining(list, surah, ayah) {
  for (const juz of list ?? []) {
    for (const part of juz.surahs) {
      if (part.surah === surah && ayah >= part.from && ayah <= part.to) return juz.number;
    }
  }
  return null;
}

/** "Al-Fatihah 1 — Al-Baqarah 141", shortened to "Al-Baqarah 142 — 252" inside a single surah. */
export function juzRangeLabel(juz, nameOf) {
  const from = `${nameOf(juz.start.surah)} ${juz.start.ayah}`;
  const to = juz.start.surah === juz.end.surah
    ? String(juz.end.ayah)
    : `${nameOf(juz.end.surah)} ${juz.end.ayah}`;
  return `${from} \u2013 ${to}`;
}

/** Matches a juz against a search box: by its number, or by any surah name inside its range. */
export function juzMatches(juz, query, nameOf) {
  if (!query) return true;
  if (String(juz.number) === query) return true;
  if (`juz ${juz.number}`.startsWith(query) || `para ${juz.number}`.startsWith(query)) return true;
  return juz.surahs.some((part) => nameOf(part.surah).toLocaleLowerCase().includes(query));
}
