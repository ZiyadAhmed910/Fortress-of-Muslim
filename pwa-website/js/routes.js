import { state } from './state.js';
import { openEntry } from './reader.js';
import { activateHadith, openCanonicalHadith } from './hadith.js';
import { setContentMode } from './modes.js';

export async function openCanonicalRoute() {
  const path = decodeURI(location.pathname).replace(/\/+$/, '') || '/';
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
  return false;
}
