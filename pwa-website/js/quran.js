import { els } from './dom.js';
import { state } from './state.js';
import { escapeHtml, toast } from './utils.js';
import { setFontScale } from './settings.js';
import {
  initQuranAudio,
  isWordMode,
  loadWords,
  playAyah,
  playWord,
  renderAyahWords,
  restoreHighlight,
  setPlaybackSurah,
  stopPlayback,
  isPlaying,
  downloadSurahAudio,
  cancelAudioDownload,
  isDownloadingAudio,
  surahAudioDownloaded,
  currentReciter,
} from './quran-audio.js';

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
  const fallback = { favouriteSurahs: [], favouriteAyahs: [], lastRead: null, tajweed: true, paginated: true };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      favouriteSurahs: Array.isArray(parsed.favouriteSurahs) ? parsed.favouriteSurahs.filter(Number.isInteger) : [],
      favouriteAyahs: normaliseFavouriteAyahs(parsed.favouriteAyahs),
      lastRead: parsed.lastRead && Number.isInteger(parsed.lastRead.surah) ? parsed.lastRead : null,
      tajweed: parsed.tajweed !== false,
      paginated: parsed.paginated !== false,
    };
  } catch {
    return fallback;
  }
}

// Saved ayahs were originally plain "surah:ayah" strings, which meant the saved list had no text to
// show without fetching every surah they came from. They now carry a short preview; older entries
// (and older backups) are upgraded in place and simply render without one until re-saved.
function normaliseFavouriteAyahs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return { k: entry, p: '' };
      if (entry && typeof entry.k === 'string') return { k: entry.k, p: typeof entry.p === 'string' ? entry.p : '' };
      return null;
    })
    .filter(Boolean);
}

function isAyahFavourite(key) {
  return prefs.favouriteAyahs.some((entry) => entry.k === key);
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
  els.quranClearSearch.addEventListener('click', () => {
    els.quranSearch.value = '';
    renderSurahList();
    els.quranSearch.focus();
  });
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
    if (resume) return openSurah(prefs.lastRead.surah, prefs.lastRead.ayah);
    const savedAyah = event.target.closest('[data-open-ayah]');
    if (savedAyah) {
      const [surahNumber, ayahNumber] = savedAyah.dataset.openAyah.split(':').map(Number);
      openSurah(surahNumber, ayahNumber);
    }
  });
  els.quranReader.addEventListener('click', onReaderClick);
  bindSurahSwipe();
  // The player advances ayah by ayah; in paginated mode the next ayah may be on a page that is not
  // rendered, and only the reader knows how to turn one.
  initQuranAudio({ ensureAyahVisible, onAyahChange: markRead });
}

// Matches the dua reader's swipe. Horizontal-only and threshold-gated so it cannot fire while
// someone is scrolling a long surah vertically, and RTL-aware in intent: swiping left moves forward
// through the mushaf, the same direction the Next button goes.
function bindSurahSwipe() {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  els.quranReader.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) { tracking = false; return; }
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  els.quranReader.addEventListener('touchend', (event) => {
    if (!tracking || !state.quranSurah) return;
    tracking = false;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
    const target = state.quranSurah + (dx < 0 ? 1 : -1);
    if (target >= 1 && target <= 114) openSurah(target);
  }, { passive: true });
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
    const { ayah } = findAyah(favAyah.dataset.favAyah);
    toggleAyahFavourite(favAyah.dataset.favAyah, ayah?.en || '');
    renderSurah(loaded.get(state.quranSurah));
    return;
  }
  const goto = event.target.closest('[data-goto-surah]');
  if (goto) return openSurah(Number(goto.dataset.gotoSurah));
  const zoom = event.target.closest('[data-zoom]');
  if (zoom) {
    setFontScale(state.fontScale + Number(zoom.dataset.zoom));
    return;
  }
  const copy = event.target.closest('[data-copy-ayah]');
  if (copy) return copyAyah(copy.dataset.copyAyah);
  const share = event.target.closest('[data-share-ayah]');
  if (share) return shareAyah(share.dataset.shareAyah);
  const shareSurah = event.target.closest('[data-share-surah]');
  if (shareSurah) return shareWholeSurah(Number(shareSurah.dataset.shareSurah));
  const playButton = event.target.closest('[data-play-ayah]');
  if (playButton) {
    const [surahNumber, ayahNumber] = playButton.dataset.playAyah.split(':').map(Number);
    const surah = loaded.get(surahNumber);
    return playAyah(surahNumber, ayahNumber, { total: surah?.ayahCount });
  }
  const word = event.target.closest('[data-word]');
  if (word) {
    const [surahNumber, ayahNumber, position] = word.dataset.word.split(':').map(Number);
    document.querySelectorAll('.qword.is-active').forEach((el) => el.classList.remove('is-active'));
    word.classList.add('is-active');
    return playWord(surahNumber, ayahNumber, position);
  }
  if (event.target.closest('[data-play-surah]')) {
    const surah = loaded.get(state.quranSurah);
    if (surah) return playAyah(surah.number, 1, { total: surah.ayahCount });
  }
  if (event.target.closest('[data-download-audio]')) return downloadAudioForOpenSurah();

}

/**
 * Re-renders whatever surah is open. Turning word mode on needs the words file for that surah, so
 * this fetches it first -- otherwise the toggle would appear to do nothing until the next surah.
 */
export async function rerenderOpenSurah() {
  const surah = loaded.get(state.quranSurah);
  if (!surah) return;
  if (isWordMode()) {
    try {
      await loadWords(surah.number);
    } catch {
      toast('Word-by-word data could not be loaded for this surah.');
      return;
    }
  }
  renderSurah(surah);
}

// Tajweed and reading mode are Settings, not per-surah controls, so the reader is not cluttered with
// preferences that are set once. Both re-render whatever surah is open so the change is immediate.
export function initQuranSettings() {
  els.quranTajweedToggle.addEventListener('change', () => {
    prefs.tajweed = els.quranTajweedToggle.checked;
    savePrefs();
    if (state.quranSurah) renderSurah(loaded.get(state.quranSurah));
  });
  els.quranReadingModeSelect.addEventListener('change', () => {
    prefs.paginated = els.quranReadingModeSelect.value === 'pages';
    page = 0;
    savePrefs();
    if (state.quranSurah) renderSurah(loaded.get(state.quranSurah));
  });
  syncQuranSettingsControls();
}

export function syncQuranSettingsControls() {
  els.quranTajweedToggle.checked = prefs.tajweed;
  els.quranReadingModeSelect.value = prefs.paginated ? 'pages' : 'scroll';
}

function toggleSurahFavourite(number) {
  const at = prefs.favouriteSurahs.indexOf(number);
  if (at === -1) prefs.favouriteSurahs.push(number); else prefs.favouriteSurahs.splice(at, 1);
  savePrefs();
}

function toggleAyahFavourite(key, preview = '') {
  const at = prefs.favouriteAyahs.findIndex((entry) => entry.k === key);
  if (at === -1) prefs.favouriteAyahs.push({ k: key, p: preview.slice(0, 120) });
  else prefs.favouriteAyahs.splice(at, 1);
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

async function shareWholeSurah(number) {
  const surah = loaded.get(number);
  if (!surah) return;
  const text = `${surah.nameSimple} (${surah.nameEnglish}) — ${surah.ayahCount} ayahs
${location.origin}${location.pathname}`;
  if (navigator.share) {
    try { await navigator.share({ title: surah.nameSimple, text }); } catch { /* user dismissed */ }
    return;
  }
  try { await navigator.clipboard.writeText(text); toast('Surah link copied.'); } catch { toast('Could not share this surah.'); }
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
  }
  if (state.quranSurah) openSurah(state.quranSurah);
  else showSurahList();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function showSurahList() {
  stopObservingReadingPosition();
  if (isPlaying()) stopPlayback();
  state.quranSurah = null;
  els.app.classList.remove('is-surah');
  els.quranReader.hidden = true;
  els.quranBrowse.hidden = false;
  els.screenTitle.textContent = 'Quran';
  els.screenSubtitle.textContent = 'Arabic with English translation - works offline';
  renderSurahList();
}

/** True when a surah is open, so the shared topbar back button knows what to close. */
export function isSurahOpen() {
  return Boolean(state.quranSurah);
}

// Mirrors the dua list's highlightMatch so a search reads the same in both places.
function highlightMatch(value, query) {
  const raw = String(value);
  if (!query) return escapeHtml(raw);
  const index = raw.toLocaleLowerCase().indexOf(query);
  if (index < 0) return escapeHtml(raw);
  return [
    escapeHtml(raw.slice(0, index)),
    `<mark>${escapeHtml(raw.slice(index, index + query.length))}</mark>`,
    escapeHtml(raw.slice(index + query.length)),
  ].join('');
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

  els.quranResume.innerHTML = favouritesOnly ? renderSavedAyahs() : renderResumeCard();
  els.quranCount.textContent = `${matches.length} surah${matches.length === 1 ? '' : 's'}`;
  els.quranClearSearch.hidden = !query;
  els.quranList.innerHTML = matches.length
    ? matches.map((surah) => {
      const faved = prefs.favouriteSurahs.includes(surah.number);
      return `
        <div class="surah-row" data-surah="${surah.number}" role="button" tabindex="0">
          <span class="surah-number">${surah.number}</span>
          <span class="surah-names">
            <strong>${highlightMatch(surah.nameSimple, query)}</strong>
            <small>${highlightMatch(surah.nameEnglish, query)} &middot; ${surah.ayahCount} ayahs &middot; ${surah.revelationPlace === 'makkah' ? 'Meccan' : 'Medinan'}</small>
          </span>
          <span class="surah-arabic">${escapeHtml(surah.nameArabic)}</span>
          <button class="star-toggle${faved ? ' active' : ''}" type="button" data-fav-surah="${surah.number}"
            aria-label="${faved ? 'Remove' : 'Add'} ${escapeHtml(surah.nameSimple)} ${faved ? 'from' : 'to'} favourites">${faved ? '★' : '☆'}</button>
        </div>
      `;
    }).join('')
    : `<div class="empty-state">${favouritesOnly ? 'No favourite surahs yet. Tap a star to save one.' : 'No surah matched that search.'}</div>`;
}

// Saving an ayah is pointless if it cannot be found again, so the Saved chip lists saved ayahs as
// well as saved surahs, each jumping straight back to the verse.
function renderSavedAyahs() {
  if (!prefs.favouriteAyahs.length) return '';
  const rows = prefs.favouriteAyahs.map((entry) => {
    const meta = index?.surahs.find((surah) => surah.number === Number(entry.k.split(':')[0]));
    return `
      <button class="saved-ayah" type="button" data-open-ayah="${entry.k}">
        <span class="saved-ayah-ref">${escapeHtml(meta ? meta.nameSimple : '')} ${escapeHtml(entry.k)}</span>
        ${entry.p ? `<span class="saved-ayah-text">${escapeHtml(entry.p)}</span>` : ''}
      </button>
    `;
  }).join('');
  return `<div class="saved-block"><h3>Saved ayahs (${prefs.favouriteAyahs.length})</h3><div class="saved-ayah-list">${rows}</div></div>`;
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
  els.app.classList.add('is-surah');
  els.quranBrowse.hidden = true;
  els.quranReader.hidden = false;
  els.screenTitle.textContent = meta.nameSimple;
  els.screenSubtitle.textContent = `${meta.nameEnglish} · ${meta.ayahCount} ayahs`;
  els.quranReader.innerHTML = `<div class="empty-state">Loading ${escapeHtml(meta.nameSimple)}...</div>`;
  window.scrollTo({ top: 0, behavior: 'instant' });

  let surah = loaded.get(number);
  if (!surah) {
    try {
      surah = await fetchJson(surahUrl(number));
      loaded.set(number, surah);
    } catch {
      els.quranReader.innerHTML = `<div class="empty-state">This surah is not downloaded and could not be fetched. Connect to the internet, or download the full Quran from Settings.</div>`;
      return;
    }
  }
  if (state.quranSurah !== number) return; // user navigated away while it loaded

  // Word data is a separate ~25KB-to-200KB file per surah, fetched only when word mode is on. A
  // failure here degrades to the ordinary flowing text rather than blocking the surah from opening:
  // being unable to show glosses is not a reason to be unable to read.
  if (isWordMode()) {
    try {
      await loadWords(number);
    } catch {
      toast('Word-by-word data could not be loaded for this surah.');
    }
    if (state.quranSurah !== number) return;
  }
  setPlaybackSurah(meta);

  if (scrollToAyah && prefs.paginated) page = Math.floor((scrollToAyah - 1) / PAGE_SIZE);
  // Seeds the position on open. It used to be the ONLY place lastRead was ever written, which is
  // why "Continue reading" was stuck at ayah 1 no matter how far anyone actually read -- reading is
  // scrolling, and nothing was watching that. markRead below now keeps it honest.
  markRead(number, scrollToAyah || 1, { immediate: true });
  renderSurah(surah);
  if (scrollToAyah) {
    // Instant, not smooth: resuming at ayah 200 should put you there, not animate the whole way down
    // past everything you already read. Following a recitation is the case where smooth is right,
    // and that one still is.
    document.getElementById(`ayah-${number}-${scrollToAyah}`)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

let readMarkTimer = null;

/**
 * Records how far the reader has actually got. Two things move the position, because there are two
 * ways to move through a surah: scrolling it, and listening to it.
 *
 * Writes are debounced -- scrolling past forty ayahs should not be forty localStorage writes -- but
 * an explicit call (opening a surah, closing the reader) commits straight away so nothing is lost if
 * the tab goes away before the timer fires.
 */
function markRead(surahNumber, ayahNumber, { immediate = false } = {}) {
  if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahNumber)) return;
  const last = prefs.lastRead;
  if (last && last.surah === surahNumber && last.ayah === ayahNumber) return;
  prefs.lastRead = { surah: surahNumber, ayah: ayahNumber };
  clearTimeout(readMarkTimer);
  if (immediate) savePrefs();
  else readMarkTimer = setTimeout(savePrefs, 500);
}

/** Commits any pending position write immediately. */
function flushReadMark() {
  if (!readMarkTimer) return;
  clearTimeout(readMarkTimer);
  readMarkTimer = null;
  savePrefs();
}

/**
 * Tracks which ayah is nearest the middle of the screen, so the reading position follows scrolling.
 *
 * Deliberately a scroll listener rather than an IntersectionObserver: IO callbacks are delivered as
 * part of the rendering steps, so they never arrive in a tab that is not producing frames -- which
 * is also what made the observer version impossible to verify here. Measuring once the scrolling
 * stops is cheap enough (one pass over the rendered ayahs) and behaves the same whether or not
 * anything is being painted.
 */
let scrollTracker = null;

function observeReadingPosition(surahNumber) {
  stopScrollTracking();
  let idle = null;
  const onScroll = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      const ayah = nearestAyahToCentre();
      if (ayah) markRead(surahNumber, ayah);
    }, 150);
  };
  scrollTracker = () => {
    clearTimeout(idle);
    window.removeEventListener('scroll', onScroll);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}

function nearestAyahToCentre() {
  const centre = window.innerHeight / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const el of els.quranReader.querySelectorAll('.ayah[id]')) {
    const rect = el.getBoundingClientRect();
    // Anything spanning the centre line wins outright; otherwise the nearest edge decides, which is
    // what settles the top and bottom of a surah where no ayah crosses the middle at all.
    const distance = rect.top <= centre && rect.bottom >= centre
      ? 0
      : Math.min(Math.abs(rect.top - centre), Math.abs(rect.bottom - centre));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = Number(el.id.split('-')[2]);
      if (distance === 0) break;
    }
  }
  return Number.isInteger(best) ? best : null;
}

function stopScrollTracking() {
  scrollTracker?.();
  scrollTracker = null;
}

function stopObservingReadingPosition() {
  stopScrollTracking();
  flushReadMark();
}

function renderSurah(surah) {
  if (!surah) return;
  const faved = prefs.favouriteSurahs.includes(surah.number);
  const totalPages = Math.ceil(surah.ayahs.length / PAGE_SIZE);
  const visible = prefs.paginated
    ? surah.ayahs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    : surah.ayahs;

  els.quranReader.innerHTML = `
    <header class="surah-header">
      <h2>${escapeHtml(surah.nameSimple)} <span dir="rtl" lang="ar">${escapeHtml(surah.nameArabic)}</span></h2>
      <p>${escapeHtml(surah.nameEnglish)} &middot; ${surah.ayahCount} ayahs &middot; ${surah.revelationPlace === 'makkah' ? 'Meccan' : 'Medinan'}</p>

    </header>
    ${surah.bismillahPre ? '<p class="surah-bismillah" dir="rtl" lang="ar">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</p>' : ''}
    <ol class="ayah-list">
      ${visible.map((ayah) => renderAyah(surah, ayah)).join('')}
    </ol>
    ${prefs.paginated ? renderPager(page, totalPages) : ''}
    ${renderSurahNav(surah.number)}
    ${renderUtilityBar(surah, faved)}
  `;
  restoreHighlight();
  observeReadingPosition(surah.number);
  refreshAudioDownloadState(surah);
}

/**
 * Makes an ayah renderable and returns once it is in the DOM. In continuous mode every ayah is
 * already rendered; in paginated mode this turns to the page holding it. The player awaits this
 * before starting the next ayah, so the highlight always has an element to land on.
 */
async function ensureAyahVisible(surahNumber, ayahNumber) {
  if (surahNumber !== state.quranSurah) return;
  const surah = loaded.get(surahNumber);
  if (!surah) return;
  if (!prefs.paginated) return;
  const target = Math.floor((ayahNumber - 1) / PAGE_SIZE);
  if (target === page) return;
  page = target;
  renderSurah(surah);
}

// The download button reports state rather than firing and forgetting: a surah of recitation can be
// tens of megabytes, so "already have it", "downloading", and "how far along" all need to be visible.
async function refreshAudioDownloadState(surah) {
  const button = els.quranReader.querySelector('[data-download-audio]');
  if (!button) return;
  if (isDownloadingAudio()) return;
  try {
    if (await surahAudioDownloaded(surah.number, surah.ayahCount)) {
      button.classList.add('active');
      button.setAttribute('aria-label', `Recitation of ${surah.nameSimple} is saved offline`);
      button.title = `Saved offline in ${currentReciter().name}`;
    }
  } catch {
    // Cache inspection is best-effort; the button still works without it.
  }
}

async function downloadAudioForOpenSurah() {
  const surah = loaded.get(state.quranSurah);
  if (!surah) return;
  const button = els.quranReader.querySelector('[data-download-audio]');
  if (isDownloadingAudio()) {
    cancelAudioDownload();
    toast('Download cancelled.');
    if (button) button.textContent = '⬇';
    return;
  }
  const original = button ? button.textContent : '';
  try {
    const bytes = await downloadSurahAudio(surah.number, surah.ayahCount, ({ done, total }) => {
      if (button) button.textContent = `${Math.round((done / total) * 100)}%`;
    });
    if (button) {
      button.textContent = original;
      button.classList.add('active');
    }
    toast(`${surah.nameSimple} saved for offline listening (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
  } catch (error) {
    if (button) button.textContent = original;
    if (error.name === 'AbortError') return;
    toast('Could not download this recitation. Check your connection and try again.');
  }
}

function renderAyah(surah, ayah) {
  const key = `${surah.number}:${ayah.n}`;
  const faved = isAyahFavourite(key);
  // Word mode replaces the flowing line with per-word chips, so tajweed colouring cannot come along:
  // its markup spans word boundaries and would have to be cut mid-rule. Settings says so plainly
  // rather than letting the colouring vanish unexplained.
  const words = isWordMode() ? renderAyahWords(surah.number, ayah.n) : '';
  const arabic = prefs.tajweed ? tajweedHtml(ayah.tj) : escapeHtml(stripTajweed(ayah.tj));
  return `
    <li class="ayah${ayah.sajdah ? ' has-sajdah' : ''}${faved ? ' is-favourite' : ''}" id="ayah-${surah.number}-${ayah.n}">
      <div class="ayah-head">
        <span class="ayah-number">${key}</span>
        ${ayah.sajdah ? '<span class="sajdah-mark" title="Verse of prostration (sajdah)">۩ Sajdah</span>' : ''}
      </div>
      ${words || `<p class="ayah-arabic" dir="rtl" lang="ar">${arabic}</p>`}
      <p class="ayah-english" lang="en">${escapeHtml(ayah.en)}</p>
      <div class="ayah-actions">
        <button class="ayah-action" type="button" data-play-ayah="${key}" aria-label="Play ayah ${key}">▶ Play</button>
        <button class="ayah-action${faved ? ' active' : ''}" type="button" data-fav-ayah="${key}" aria-label="${faved ? 'Remove' : 'Save'} ayah ${key}">${faved ? '★' : '☆'}</button>
        <button class="ayah-action" type="button" data-copy-ayah="${key}" aria-label="Copy ayah ${key}">Copy</button>
        <button class="ayah-action" type="button" data-share-ayah="${key}" aria-label="Share ayah ${key}">Share</button>
      </div>
    </li>
  `;
}

// Mirrors the dua reader's fixed control strip so the two readers are operated the same way, and so
// preferences and actions are not competing for space at the top of the text.
function renderUtilityBar(surah, faved) {
  const previous = surah.number > 1 ? surah.number - 1 : null;
  const next = surah.number < 114 ? surah.number + 1 : null;
  return `
    <nav class="reader-controls quran-controls" aria-label="Surah controls">
      <button class="tool-button" type="button" data-goto-surah="${previous ?? ''}" ${previous ? '' : 'disabled'} aria-label="Previous surah">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button class="tool-button" type="button" data-goto-surah="${next ?? ''}" ${next ? '' : 'disabled'} aria-label="Next surah">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
      <button class="tool-button" type="button" data-play-surah aria-label="Play this surah from the beginning">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <button class="tool-button" type="button" data-download-audio aria-label="Download this recitation for offline listening">⬇</button>
      <button class="tool-button${faved ? ' active' : ''}" type="button" data-fav-surah="${surah.number}" aria-label="${faved ? 'Remove surah from favourites' : 'Save surah to favourites'}">${faved ? '★' : '☆'}</button>
      <button class="tool-button" type="button" data-share-surah="${surah.number}" aria-label="Share surah">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
      </button>
      <button class="tool-button" type="button" data-zoom="-0.12" aria-label="Decrease text size">A-</button>
      <button class="tool-button" type="button" data-zoom="0.12" aria-label="Increase text size">A+</button>
    </nav>
  `;
}

// Reaching the end of a surah and having to go back to the list to continue is the main friction in
// reading straight through, so the reader carries its own previous/next surah step.
function renderSurahNav(number) {
  const previous = index?.surahs.find((surah) => surah.number === number - 1);
  const next = index?.surahs.find((surah) => surah.number === number + 1);
  if (!previous && !next) return '';
  return `
    <nav class="surah-nav" aria-label="Surah navigation">
      ${previous ? `<button type="button" data-goto-surah="${previous.number}"><small>Previous</small><strong>${escapeHtml(previous.nameSimple)}</strong><span class="surah-nav-arabic" dir="rtl" lang="ar">${escapeHtml(previous.nameArabic)}</span></button>` : '<span></span>'}
      ${next ? `<button type="button" data-goto-surah="${next.number}"><small>Next</small><strong>${escapeHtml(next.nameSimple)}</strong><span class="surah-nav-arabic" dir="rtl" lang="ar">${escapeHtml(next.nameArabic)}</span></button>` : '<span></span>'}
    </nav>
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

// Rendered once into Settings > About rather than under every surah: CC BY still requires the
// credit, but repeating four lines of licensing under each reading session was visual noise.
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
