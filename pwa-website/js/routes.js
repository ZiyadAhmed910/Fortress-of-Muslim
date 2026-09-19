import { state } from './state.js';
import { openEntry } from './reader.js';
import { activateHadith, openCanonicalHadith } from './hadith.js';
import { setContentMode } from './modes.js';
import { openSurah } from './quran.js';

/**
 * Opens a canonical Fortress path in the app. Called on load for the current URL, and by a citation
 * that wants to open the record it points at -- the paths are identical, so a source is navigable
 * without a second implementation of what /bukhari/book1/1 means.
 */
export async function openCanonicalRoute(pathname = location.pathname) {
  const path = decodeURI(pathname).replace(/\/+$/, '') || '/';
  const hadith = path.match(/^\/([a-z0-9-]+)\/book([^/]+)\/([^/]+)$/i);
  if (hadith) {
    setContentMode('hadith');
    await activateHadith();
    await openCanonicalHadith(hadith[1].toLowerCase(), hadith[2], hadith[3]);
    return true;
  }

  const dua = path.match(/^\/hisn\/chapter(\d+)$/i);
  if (dua) {
    const sequence = Number(dua[1]);
    state.filtered = state.entries;
    const index = state.filtered.findIndex((entry) => Number(entry.sequence ?? entry.number) === sequence);
    if (index >= 0) {
      setContentMode('duas');
      openEntry(index);
      return true;
    }
  }
  const verse = path.match(/^\/quran\/(\d+)\/(\d+)$/i);
  if (verse) {
    setContentMode('quran');
    await openSurah(Number(verse[1]), Number(verse[2]));
    return true;
  }
  return false;
}
