import { els } from './dom.js';
import { state } from './state.js';
import { escapeHtml, toast } from './utils.js';

// Surah bodies live in their own files and are fetched the first time one is opened, rather than
// bundled into the install. With tajweed markup the full text is ~6MB, which would dominate a first
// load for content read a surah at a time. sw.js keeps whatever has been opened in a
// build-independent cache, so a surah read once stays readable offline across deploys.
const INDEX_URL = './data/quran/index.json';
const surahUrl = (number) => `./data/quran/surah-${number}.json`;
const STORAGE_KEY = 'fortress_quran';
const PAGE_SIZE = 20;

let index = null;
const loaded = new Map();
let prefs = loadPrefs();
let page = 0;

function loadPrefs() {
  const fallback = { favouriteSurahs: [], favouriteAyahs: [], lastRead: null, tajweed: true, paginated: false };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      favouriteSurahs: Array.isArray(parsed.favouriteSurahs) ? parsed.favouriteSurahs.filter(Number.isInteger) : [],
      favouriteAyahs: Array.isArray(parsed.favouriteAyahs) ? parsed.favouriteAyahs.filter((k) => typeof k === 'string') : [],
      lastRead: parsed.lastRead && Number.isInteger(parsed.lastRead.surah) ? parsed.lastRead : null,
      tajweed: parsed.tajweed !== false,
      paginated: parsed.paginated === true,
    };
  } catch {
    return fallback;
  }
}

function savePrefs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function readQuranStorage() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

export function writeQuranStorage(raw) {
  if (!raw || typeof raw !== 'object') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  prefs = loadPrefs();
}

// Strips tajweed spans and the ornate ayah-end numeral so copy/share yields clean Arabic. Mirrors
// stripTajweed() in tools/build-quran-data.mjs -- both must agree on what "plain" means.
function stripTajweed(markup) {
  return markup
    .replace(/<span class=end>.*?<\/span>/g, '')
    .replace(/<\/?tajweed[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The tajweed text is upstream markup, not user input, but it still goes through innerHTML -- so
// only the exact tag shapes we expect are allowed through and everything else is escaped.
function tajweedHtml(markup) {
  return escapeHtml(markup)
    .replace(/&lt;tajweed class=([a-z_]+)&gt;/g, '<span class="tj tj-$1">')
    .replace(/&lt;\/tajweed&gt;/g, '</span>')
    .replace(/&lt;span class=end&gt;(.*?)&lt;\/span&gt;/g, '<span class="ayah-end">$1</span>');
}

export function initQuran() {
  els.quranSearch.addEventListener('input', renderSurahList);
  els.quranFavFilter.addEventListener('click', () => {
    els.quranFavFilter.classList.toggle('active');
    renderSurahList();
  });
  els.quranList.addEventListener('click', (event) => {
    const star = event.target.closest('[data-fav-surah]');
    if (star) {
      event.stopPropagation();
      toggleSurahFavourite(Number(star.dataset.favSurah));
      renderSurahList();
      return;
    }
    const row = event.target.closest('[data-surah]');
    if (row) openSurah(Number(row.dataset.surah));
  });
  els.quranBrowse.addEventListener('click', (event) => {
    const resume = event.target.closest('[data-resume]');
    if (resume) openSurah(prefs.lastRead.surah, prefs.lastRead.ayah);
  });
  els.quranReader.addEventListener('click', onReaderClick);
}

function onReaderClick(event) {
  if (event.target.closest('[data-close-surah]')) return showSurahList();

  const pageBtn = event.target.closest('[data-page]');
  if (pageBtn) {
    page = Number(pageBtn.dataset.page);
    renderSurah(loaded.get(state.quranSurah));
    els.quranReader.scrollIntoView({ block: 'start', behavior: 'instant' });
    return;
  }
  const favSurah = event.target.closest('[data-fav-surah]');
  if (favSurah) {
    toggleSurahFavourite(Number(favSurah.dataset.favSurah));
    renderSurah(loaded.get(state.quranSurah));
    return;
  }
  const favAyah = event.target.closest('[data-fav-ayah]');
  if (favAyah) {
    toggleAyahFavourite(favAyah.dataset.favAyah);
    renderSurah(loaded.get(state.quranSurah));
    return;
  }
  const copy = event.target.closest('[data-copy-ayah]');
  if (copy) return copyAyah(copy.dataset.copyAyah);
  const share = event.target.closest('[data-share-ayah]');
  if (share) return shareAyah(share.dataset.shareAyah);

  const tajweedToggle = event.target.closest('[data-toggle-tajweed]');
  if (tajweedToggle) {
    prefs.tajweed = !prefs.tajweed;
    savePrefs();
    renderSurah(loaded.get(state.quranSurah));
    return;
  }
  const viewToggle = event.target.closest('[data-toggle-view]');
  if (viewToggle) {
    prefs.paginated = !prefs.paginated;
    page = 0;
    savePrefs();
    renderSurah(loaded.get(state.quranSurah));
  }
}

function toggleSurahFavourite(number) {
  const at = prefs.favouriteSurahs.indexOf(number);
  if (at === -1) prefs.favouriteSurahs.push(number); else prefs.favouriteSurahs.splice(at, 1);
  savePrefs();
}

function toggleAyahFavourite(key) {
  const at = prefs.favouriteAyahs.indexOf(key);
  if (at === -1) prefs.favouriteAyahs.push(key); else prefs.favouriteAyahs.splice(at, 1);
  savePrefs();
}

function findAyah(key) {
  const [surahNumber, ayahNumber] = key.split(':').map(Number);
  const surah = loaded.get(surahNumber);
  const ayah = surah?.ayahs.find((item) => item.n === ayahNumber);
  return { surah, ayah };
}

function ayahPlainText(key) {
  const { surah, ayah } = findAyah(key);
  if (!ayah) return '';
  return `${stripTajweed(ayah.tj)}\n\n${ayah.en}\n\n— ${surah.nameSimple} ${key}`;
}

async function copyAyah(key) {
  try {
    await navigator.clipboard.writeText(ayahPlainText(key));
    toast('Ayah copied.');
  } catch {
    toast('Could not copy this ayah.');
  }
}

async function shareAyah(key) {
  const text = ayahPlainText(key);
  if (navigator.share) {
    try { await navigator.share({ text }); } catch { /* user dismissed the sheet */ }
    return;
  }
  copyAyah(key);
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
  const favouritesOnly = els.quranFavFilter.classList.contains('active');
  const matches = index.surahs.filter((surah) => {
    if (favouritesOnly && !prefs.favouriteSurahs.includes(surah.number)) return false;
    if (!query) return true;
    return String(surah.number) === query
      || surah.nameSimple.toLocaleLowerCase().includes(query)
      || surah.nameEnglish.toLocaleLowerCase().includes(query)
      || surah.nameArabic.includes(query);
  });

  els.quranResume.innerHTML = renderResumeCard();
  els.quranCount.textContent = `${matches.length} surah${matches.length === 1 ? '' : 's'}`;
  els.quranList.innerHTML = matches.length
    ? matches.map((surah) => {
      const faved = prefs.favouriteSurahs.includes(surah.number);
      return `
        <div class="surah-row" data-surah="${surah.number}" role="button" tabindex="0">
          <span class="surah-number">${surah.number}</span>
          <span class="surah-names">
            <strong>${escapeHtml(surah.nameSimple)}</strong>
            <small>${escapeHtml(surah.nameEnglish)} &middot; ${surah.ayahCount} ayahs &middot; ${surah.revelationPlace === 'makkah' ? 'Meccan' : 'Medinan'}</small>
          </span>
          <span class="surah-arabic">${escapeHtml(surah.nameArabic)}</span>
          <button class="star-toggle${faved ? ' active' : ''}" type="button" data-fav-surah="${surah.number}"
            aria-label="${faved ? 'Remove' : 'Add'} ${escapeHtml(surah.nameSimple)} ${faved ? 'from' : 'to'} favourites">${faved ? '★' : '☆'}</button>
        </div>
      `;
    }).join('')
    : `<div class="empty-state">${favouritesOnly ? 'No favourite surahs yet. Tap a star to save one.' : 'No surah matched that search.'}</div>`;
}

function renderResumeCard() {
  const last = prefs.lastRead;
  if (!last || !index) return '';
  const surah = index.surahs.find((item) => item.number === last.surah);
  if (!surah) return '';
  return `
    <button class="resume-card" type="button" data-resume>
      <span><small>Continue reading</small><strong>${escapeHtml(surah.nameSimple)} ${last.surah}:${last.ayah || 1}</strong></span>
      <span aria-hidden="true">›</span>
    </button>
  `;
}

export async function openSurah(number, scrollToAyah = null) {
  const meta = index?.surahs.find((surah) => surah.number === number);
  if (!meta) return;
  state.quranSurah = number;
  page = 0;
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

  if (scrollToAyah && prefs.paginated) page = Math.floor((scrollToAyah - 1) / PAGE_SIZE);
  prefs.lastRead = { surah: number, ayah: scrollToAyah || 1 };
  savePrefs();
  renderSurah(surah);
  if (scrollToAyah) {
    document.getElementById(`ayah-${number}-${scrollToAyah}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function renderSurah(surah) {
  if (!surah) return;
  const faved = prefs.favouriteSurahs.includes(surah.number);
  const totalPages = Math.ceil(surah.ayahs.length / PAGE_SIZE);
  const visible = prefs.paginated
    ? surah.ayahs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    : surah.ayahs;

  els.quranReader.innerHTML = `
    ${backButton()}
    <header class="surah-header">
      <h2>${escapeHtml(surah.nameSimple)} <span dir="rtl" lang="ar">${escapeHtml(surah.nameArabic)}</span></h2>
      <p>${escapeHtml(surah.nameEnglish)} &middot; ${surah.ayahCount} ayahs &middot; ${surah.revelationPlace === 'makkah' ? 'Meccan' : 'Medinan'}</p>
      <div class="surah-tools">
        <button class="chip-toggle${faved ? ' active' : ''}" type="button" data-fav-surah="${surah.number}">${faved ? '★ Saved' : '☆ Save surah'}</button>
        <button class="chip-toggle${prefs.tajweed ? ' active' : ''}" type="button" data-toggle-tajweed>Tajweed</button>
        <button class="chip-toggle${prefs.paginated ? ' active' : ''}" type="button" data-toggle-view>${prefs.paginated ? 'Pages' : 'Scroll'}</button>
      </div>
    </header>
    ${surah.bismillahPre ? '<p class="surah-bismillah" dir="rtl" lang="ar">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</p>' : ''}
    <ol class="ayah-list">
      ${visible.map((ayah) => renderAyah(surah, ayah)).join('')}
    </ol>
    ${prefs.paginated ? renderPager(page, totalPages) : ''}
    ${attributionMarkup()}
  `;
}

function renderAyah(surah, ayah) {
  const key = `${surah.number}:${ayah.n}`;
  const faved = prefs.favouriteAyahs.includes(key);
  const arabic = prefs.tajweed ? tajweedHtml(ayah.tj) : escapeHtml(stripTajweed(ayah.tj));
  return `
    <li class="ayah${ayah.sajdah ? ' has-sajdah' : ''}${faved ? ' is-favourite' : ''}" id="ayah-${surah.number}-${ayah.n}">
      <div class="ayah-head">
        <span class="ayah-number">${key}</span>
        ${ayah.sajdah ? '<span class="sajdah-mark" title="Verse of prostration (sajdah)">۩ Sajdah</span>' : ''}
      </div>
      <p class="ayah-arabic" dir="rtl" lang="ar">${arabic}</p>
      <p class="ayah-english" lang="en">${escapeHtml(ayah.en)}</p>
      <div class="ayah-actions">
        <button class="ayah-action${faved ? ' active' : ''}" type="button" data-fav-ayah="${key}" aria-label="${faved ? 'Remove' : 'Save'} ayah ${key}">${faved ? '★' : '☆'}</button>
        <button class="ayah-action" type="button" data-copy-ayah="${key}" aria-label="Copy ayah ${key}">Copy</button>
        <button class="ayah-action" type="button" data-share-ayah="${key}" aria-label="Share ayah ${key}">Share</button>
      </div>
    </li>
  `;
}

function renderPager(current, total) {
  return `
    <nav class="ayah-pager" aria-label="Surah pages">
      <button type="button" data-page="${current - 1}" ${current === 0 ? 'disabled' : ''}>Previous</button>
      <span>Page ${current + 1} of ${total}</span>
      <button type="button" data-page="${current + 1}" ${current >= total - 1 ? 'disabled' : ''}>Next</button>
    </nav>
  `;
}

function backButton() {
  return '<button class="inline-back" data-close-surah type="button">All surahs</button>';
}

// The translation is used under a non-commercial permission rather than an open licence, so the
// credit travels with the text itself instead of living only in a settings screen.
function attributionMarkup() {
  if (!index?.attribution) return '';
  const { arabic, translation, tajweed, sajdah } = index.attribution;
  return `<p class="quran-attribution">${escapeHtml(arabic.text)}<br>${escapeHtml(translation.text)}<br>${escapeHtml(tajweed?.text || '')}<br><span class="sajdah-note">Sajdah marks: ${escapeHtml(sajdah?.convention || '')}</span></p>`;
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
        button.textContent = `${done}/${count}`;
      });
      button.textContent = failed ? `${total - failed}/${total} saved` : 'Saved';
      toast(failed ? `${failed} surah${failed === 1 ? '' : 's'} could not be downloaded.` : 'Full Quran saved for offline reading.');
    } catch {
      button.textContent = original;
      toast('The Quran could not be downloaded.');
    } finally {
      button.disabled = false;
    }
  });
}
