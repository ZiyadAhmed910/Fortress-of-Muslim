import { state } from './state.js';
import { openEntry } from './reader.js';
import { activateHadith, openCanonicalHadith } from './hadith.js';
import { setContentMode } from './modes.js';
import { openSurah } from './quran.js';
import { setCanonical } from './seo.js';

/**
 * Opens a canonical Fortress path in the app. Called on load for the current URL, and by a citation
 * that wants to open the record it points at -- the paths are identical, so a source is navigable
 * without a second implementation of what /bukhari/book1/1 means.
 */
/**
 * The screens an install shortcut may open, keyed by the value manifest.json puts in `?screen=`.
 *
 * Separate from openCanonicalRoute on purpose. That function resolves content URLs -- a verse, a
 * dua, a hadith -- which are real pages with canonical addresses a search engine indexes. A shortcut
 * is not a page; it is a way of arriving at a tool. Folding the two together would give Qibla and
 * Tasbih canonical URLs that mean nothing to anyone but the launcher that asked for them.
 *
 * An allow-list rather than passing the value straight to setContentMode: a shortcut URL is
 * something an OS hands the app, and the app should only act on the ones it declared.
 */
export const SHORTCUT_SCREENS = ['prayerTimes', 'qibla', 'tasbih', 'quran'];

export function shortcutScreen(search = location.search) {
  const screen = new URLSearchParams(search).get('screen');
  return SHORTCUT_SCREENS.includes(screen) ? screen : null;
}

export async function openCanonicalRoute(pathname = location.pathname) {
  const path = decodeURI(pathname).replace(/\/+$/, '') || '/';
  // Every route is served the same HTML by a catch-all rewrite, so without this each one claims to
  // be the homepage and a crawler is told they are all the same page.
  setCanonical(path);
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
