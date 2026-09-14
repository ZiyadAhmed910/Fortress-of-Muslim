import { apiBaseUrl } from './online.js';
import { escapeHtml } from './utils.js';

// Thematic verse search: "an ayah about tawakkul", "verses on patience". The API decides which
// verses match and returns only their numbers -- the Saheeh International translation it searches
// over is not ours to redistribute, so it never leaves the server. The words come from the copy
// this app already ships, which also means a result renders instantly and works offline once the
// search itself has come back.
const MIN_QUERY = 3;

let lastQuery = '';
let controller = null;

export function versePrompt(query) {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY) return '';
  return `
    <button class="verse-search-prompt" type="button" data-verse-search="${escapeHtml(trimmed)}">
      <span aria-hidden="true">&#9906;</span>
      <span>Search all verses for <strong>${escapeHtml(trimmed)}</strong></span>
    </button>
  `;
}

/**
 * Runs the search and renders into `target`. Returns the matches so the caller can decide what to
 * do with an empty result, rather than having that decision buried in here.
 */
export async function searchVerses(query, target, loadSurah) {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY) return [];
  // A previous search still in flight would otherwise resolve after this one and overwrite it.
  controller?.abort();
  controller = new AbortController();
  lastQuery = trimmed;

  target.innerHTML = `
    <div class="verse-search-state" role="status">
      <div class="assistant-thinking"><span></span><span></span><span></span></div>
      <span>Searching all 6,236 verses</span>
    </div>
  `;

  let matches;
  try {
    const url = `${apiBaseUrl()}/v1/quran/search?q=${encodeURIComponent(trimmed)}&limit=12`;
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Verse search returned ${response.status}.`);
    const body = await response.json();
    matches = body.data || [];
  } catch (error) {
    if (error.name === 'AbortError') return [];
    target.innerHTML = `<div class="empty-state">Verse search needs a connection. Surah browsing works offline.</div>`;
    return [];
  }
  if (lastQuery !== trimmed) return [];

  if (matches.length === 0) {
    target.innerHTML = `<div class="empty-state">No verses matched &ldquo;${escapeHtml(trimmed)}&rdquo;.</div>`;
    return [];
  }

  // The API gave references; the text comes from this device.
  const surahs = new Map();
  for (const match of matches) {
    if (surahs.has(match.surah)) continue;
    surahs.set(match.surah, await loadSurah(match.surah));
  }

  target.innerHTML = `
    <p class="verse-search-count">${matches.length} verse${matches.length === 1 ? '' : 's'} for &ldquo;${escapeHtml(trimmed)}&rdquo;</p>
    ${matches.map((match) => {
      const surah = surahs.get(match.surah);
      const ayah = surah?.ayahs?.find((item) => item.n === match.ayah);
      return `
        <article class="verse-result" data-surah="${match.surah}" data-ayah="${match.ayah}" role="button" tabindex="0">
          <header>
            <strong>${escapeHtml(match.surahName)} ${match.surah}:${match.ayah}</strong>
            <small>${escapeHtml(match.surahNameEnglish)}</small>
          </header>
          ${ayah ? `<p class="verse-arabic" dir="rtl" lang="ar">${escapeHtml(ayah.ar)}</p>` : ''}
          ${ayah ? `<p class="verse-translation">${escapeHtml(ayah.en)}</p>` : '<p class="verse-translation">Open the surah to read this verse.</p>'}
        </article>
      `;
    }).join('')}
    <p class="verse-search-note">Translation: Saheeh International. Arabic: Tanzil Project (CC BY 3.0).
    Search finds verses; it does not interpret them.</p>
  `;
  return matches;
}
