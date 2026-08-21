import { els } from './dom.js';
import { state } from './state.js';
import { escapeHtml, toast } from './utils.js';

// Surah bodies live in their own files and are fetched the first time one is opened, rather than
// bundled into the install. The full text plus translation is ~2.4MB, which would dominate a first
// load on a slow connection for content most people read a surah at a time. sw.js keeps whatever
// has been opened in a build-independent cache, so a surah read once stays readable offline across
// deploys, and Settings offers a one-tap download of everything.
const INDEX_URL = './data/quran/index.json';
const surahUrl = (number) => `./data/quran/surah-${number}.json`;

let index = null;
const loaded = new Map();

export function initQuran() {
  els.quranSearch.addEventListener('input', renderSurahList);
  els.quranList.addEventListener('click', (event) => {
    const row = event.target.closest('[data-surah]');
    if (row) openSurah(Number(row.dataset.surah));
  });
  els.quranReader.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-surah]')) showSurahList();
  });
}

export async function activateQuran() {
  if (!index) {
    els.quranList.innerHTML = '<div class="empty-state">Loading surahs...</div>';
    try {
      index = await fetchJson(INDEX_URL);
    } catch {
      els.quranList.innerHTML = '<div class="empty-state">The Quran index could not be loaded. Check your connection and try again.</div>';
      return;
    }
    renderAttribution();
  }
  if (state.quranSurah) openSurah(state.quranSurah);
  else showSurahList();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function showSurahList() {
  state.quranSurah = null;
  els.quranReader.hidden = true;
  els.quranBrowse.hidden = false;
  renderSurahList();
}

function renderSurahList() {
  if (!index) return;
  const query = els.quranSearch.value.trim().toLocaleLowerCase();
  const matches = index.surahs.filter((surah) => !query
    || String(surah.number) === query
    || surah.nameSimple.toLocaleLowerCase().includes(query)
    || surah.nameEnglish.toLocaleLowerCase().includes(query)
    || surah.nameArabic.includes(query));
  els.quranCount.textContent = `${matches.length} surah${matches.length === 1 ? '' : 's'}`;
  els.quranList.innerHTML = matches.length
    ? matches.map((surah) => `
      <button class="surah-row" type="button" data-surah="${surah.number}">
        <span class="surah-number">${surah.number}</span>
        <span class="surah-names">
          <strong>${escapeHtml(surah.nameSimple)}</strong>
          <small>${escapeHtml(surah.nameEnglish)} &middot; ${surah.ayahCount} ayahs &middot; ${surah.revelationPlace === 'makkah' ? 'Meccan' : 'Medinan'}</small>
        </span>
        <span class="surah-arabic">${escapeHtml(surah.nameArabic)}</span>
      </button>
    `).join('')
    : '<div class="empty-state">No surah matched that search.</div>';
}

export async function openSurah(number) {
  const meta = index?.surahs.find((surah) => surah.number === number);
  if (!meta) return;
  state.quranSurah = number;
  els.quranBrowse.hidden = true;
  els.quranReader.hidden = false;
  els.quranReader.innerHTML = `${backButton()}<div class="empty-state">Loading ${escapeHtml(meta.nameSimple)}...</div>`;
  window.scrollTo({ top: 0, behavior: 'instant' });

  let surah = loaded.get(number);
  if (!surah) {
    try {
      surah = await fetchJson(surahUrl(number));
      loaded.set(number, surah);
    } catch {
      els.quranReader.innerHTML = `${backButton()}<div class="empty-state">This surah is not downloaded and could not be fetched. Connect to the internet, or download the full Quran from Settings.</div>`;
      return;
    }
  }
  if (state.quranSurah !== number) return; // user navigated away while it loaded
  renderSurah(surah);
}

function renderSurah(surah) {
  const bismillah = surah.bismillahPre
    ? '<p class="surah-bismillah" dir="rtl" lang="ar">بِسمِ اللَّهِ الرَّحمٰنِ الرَّحيمِ</p>'
    : '';
  els.quranReader.innerHTML = `
    ${backButton()}
    <header class="surah-header">
      <h2>${escapeHtml(surah.nameSimple)} <span dir="rtl" lang="ar">${escapeHtml(surah.nameArabic)}</span></h2>
      <p>${escapeHtml(surah.nameEnglish)} &middot; ${surah.ayahCount} ayahs &middot; ${surah.revelationPlace === 'makkah' ? 'Meccan' : 'Medinan'}</p>
    </header>
    ${bismillah}
    <ol class="ayah-list">
      ${surah.ayahs.map((ayah) => `
        <li class="ayah" id="ayah-${surah.number}-${ayah.n}">
          <span class="ayah-number">${surah.number}:${ayah.n}</span>
          <p class="ayah-arabic" dir="rtl" lang="ar">${escapeHtml(ayah.ar)}</p>
          <p class="ayah-english" lang="en">${escapeHtml(ayah.en)}</p>
        </li>
      `).join('')}
    </ol>
    ${attributionMarkup()}
  `;
}

function backButton() {
  return '<button class="inline-back" data-close-surah type="button">All surahs</button>';
}

// The translation is used here under a non-commercial permission rather than an open licence, so
// the credit travels with the text itself instead of living only in a settings screen.
function attributionMarkup() {
  if (!index?.attribution) return '';
  const { arabic, translation } = index.attribution;
  return `<p class="quran-attribution">${escapeHtml(arabic.text)}<br>${escapeHtml(translation.text)}</p>`;
}

function renderAttribution() {
  els.quranAttribution.innerHTML = attributionMarkup();
}

/** Fetches every surah so the whole Quran is readable offline. Reports progress as it goes. */
export async function downloadFullQuran(onProgress) {
  if (!index) index = await fetchJson(INDEX_URL);
  const total = index.surahs.length;
  let done = 0;
  let failed = 0;
  // Sequential on purpose: 114 parallel requests would stall a phone on a weak connection and make
  // the progress readout meaningless.
  for (const surah of index.surahs) {
    try {
      loaded.set(surah.number, await fetchJson(surahUrl(surah.number)));
    } catch {
      failed += 1;
    }
    done += 1;
    onProgress?.(done, total, failed);
  }
  return { total, failed };
}

export function initQuranDownload() {
  els.quranDownloadButton.addEventListener('click', async () => {
    const button = els.quranDownloadButton;
    button.disabled = true;
    const original = button.textContent;
    try {
      const { total, failed } = await downloadFullQuran((done, count) => {
        button.textContent = `Downloading ${done}/${count}`;
      });
      button.textContent = failed ? `${total - failed}/${total} saved` : 'Saved for offline';
      toast(failed ? `${failed} surah${failed === 1 ? '' : 's'} could not be downloaded.` : 'Full Quran saved for offline reading.');
    } catch {
      button.textContent = original;
      toast('The Quran could not be downloaded.');
    } finally {
      button.disabled = false;
    }
  });
}
