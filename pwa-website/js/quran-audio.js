import { els } from './dom.js';
import { escapeHtml, toast } from './utils.js';

// Recitation is streamed one ayah at a time from everyayah.com, which serves CORS-open, byte-range
// capable MP3s named SSSAAA.mp3. Streaming per ayah rather than per surah is what makes the player
// usable on a phone connection: Al-Baqarah as a single file is tens of megabytes before the first
// word sounds, where its first ayah alone is ~150KB.
const AYAH_AUDIO_BASE = 'https://everyayah.com/data';
// Word audio is numbered by the word's position within its ayah. Those positions come from the
// stored word data, never from splitting the text -- see tools/build-quran-words.mjs for why.
const WORD_AUDIO_BASE = 'https://audio.qurancdn.com/wbw';
const wordsUrl = (number) => `./data/quran/words-${number}.json`;
const STORAGE_KEY = 'fortress_quran_audio';
const AUDIO_CACHE = 'fortress-quran-audio-v1';

export const RECITERS = [
  { id: 'Alafasy_128kbps', name: 'Mishary Rashid Alafasy' },
  { id: 'Husary_128kbps', name: 'Mahmoud Khalil Al-Husary' },
  { id: 'Abdul_Basit_Murattal_192kbps', name: 'Abdul Basit (Murattal)' },
  { id: 'Minshawy_Murattal_128kbps', name: 'Mohamed Siddiq El-Minshawi' },
  { id: 'Abdurrahmaan_As-Sudais_192kbps', name: 'Abdul Rahman Al-Sudais' },
  { id: 'Saood_ash-Shuraym_128kbps', name: 'Saud Al-Shuraim' },
];
// Every reciter here is verified present for the whole mushaf at 128kbps or better. Saad Al-Ghamdi
// was offered as a 40kbps "low data" option and has been removed: that bitrate is the only one this
// CDN carries for him, and a recitation nobody wants to listen to is not worth a slot in the list.
export const DEFAULT_RECITER = 'Alafasy_128kbps';
export const REPEAT_MODES = ['off', 'ayah', 'surah'];
const REPEAT_LABELS = { off: 'Repeat off', ayah: 'Repeating this ayah', surah: 'Repeating this surah' };

const pad = (value, length) => String(value).padStart(length, '0');
const ayahAudioUrl = (reciter, surah, ayah) => `${AYAH_AUDIO_BASE}/${reciter}/${pad(surah, 3)}${pad(ayah, 3)}.mp3`;
const wordAudioUrl = (surah, ayah, position) => `${WORD_AUDIO_BASE}/${pad(surah, 3)}_${pad(ayah, 3)}_${pad(position, 3)}.mp3`;

const wordCache = new Map();
let audio = null;
let wordAudio = null;
let context = null;
let downloadAbort = null;
// Names for the lock screen: set when a surah opens, so the OS can say "Al-Kahf · Ayah 10" rather
// than a bare number.
let surahMeta = null;
// Fetches the next ayah while this one plays, so the gap between files is a cache hit rather than a
// network round trip -- see preloadNextAyah.
let preloader = null;
let wakeLock = null;
let wakeLockPending = false;

// Which ayah is sounding right now is deliberately not a stored preference: persisting it would
// mean a cold start resumes audio nobody asked to hear.
let playing = null;

let prefs = loadPrefs();

function loadPrefs() {
  const fallback = { reciter: DEFAULT_RECITER, repeat: 'off', wordMode: false, autoScroll: true };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      reciter: RECITERS.some((r) => r.id === raw.reciter) ? raw.reciter : fallback.reciter,
      repeat: REPEAT_MODES.includes(raw.repeat) ? raw.repeat : fallback.repeat,
      wordMode: Boolean(raw.wordMode),
      autoScroll: raw.autoScroll !== false,
    };
  } catch {
    return fallback;
  }
}

function savePrefs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

// Same object-in/object-out contract as the other backup-aware stores, so userData.js can treat
// every one of them the same way.
export function readQuranAudioStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeQuranAudioStorage(raw) {
  if (!raw || typeof raw !== 'object') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  prefs = loadPrefs();
  syncQuranAudioControls();
}

export function isWordMode() {
  return prefs.wordMode;
}

export function currentReciter() {
  return RECITERS.find((r) => r.id === prefs.reciter) || RECITERS[0];
}

/**
 * quran.js owns rendering and pagination; this module owns sound. Rather than importing each other
 * (which would be circular), the reader registers what the player needs from it: a way to make an
 * ayah visible, which in paginated mode means turning the page first.
 */
export function initQuranAudio({ ensureAyahVisible, onAyahChange }) {
  context = { ensureAyahVisible, onAyahChange };

  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('ended', onAyahEnded);
  audio.addEventListener('error', onAudioError);
  audio.addEventListener('play', renderPlayerBar);
  audio.addEventListener('pause', renderPlayerBar);
  audio.addEventListener('playing', preloadNextAyah);
  bindMediaSession();
  // Visual sync is skipped while the screen is off (see step), so catch the page up to wherever the
  // recitation has got to the moment it is looked at again, and put the wake lock back -- the
  // browser releases it automatically whenever the page is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !playing) return;
    Promise.resolve(context?.ensureAyahVisible?.(playing.surah, playing.ayah)).then(() => highlightPlaying());
    syncWakeLock();
  });

  els.quranPlayerReciter.innerHTML = RECITERS
    .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
    .join('');
  els.quranPlayer.addEventListener('click', onPlayerClick);
  els.quranPlayerReciter.addEventListener('change', () => {
    prefs.reciter = els.quranPlayerReciter.value;
    savePrefs();
    syncQuranAudioControls();
    // Switching voice mid-ayah restarts the ayah rather than keeping the playhead: the same ayah
    // is a different length in every recitation, so the old position means nothing in the new one.
    if (playing) playAyah(playing.surah, playing.ayah, { autoplay: !audio.paused });
  });

  syncQuranAudioControls();
}

export function initQuranAudioSettings({ onWordModeChange } = {}) {
  els.quranReciterSelect.innerHTML = RECITERS
    .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
    .join('');
  els.quranWordModeToggle.addEventListener('change', () => {
    prefs.wordMode = els.quranWordModeToggle.checked;
    savePrefs();
    onWordModeChange?.();
  });
  els.quranAutoScrollToggle.addEventListener('change', () => {
    prefs.autoScroll = els.quranAutoScrollToggle.checked;
    savePrefs();
    syncWakeLock();
  });
  els.quranReciterSelect.addEventListener('change', () => {
    prefs.reciter = els.quranReciterSelect.value;
    savePrefs();
    syncQuranAudioControls();
  });
  syncQuranAudioControls();
}

export function syncQuranAudioControls() {
  if (els.quranWordModeToggle) els.quranWordModeToggle.checked = prefs.wordMode;
  if (els.quranAutoScrollToggle) els.quranAutoScrollToggle.checked = prefs.autoScroll;
  if (els.quranReciterSelect) els.quranReciterSelect.value = prefs.reciter;
  if (els.quranPlayerReciter) els.quranPlayerReciter.value = prefs.reciter;
}

// ---------------------------------------------------------------------------
// Word data
// ---------------------------------------------------------------------------

export async function loadWords(surahNumber) {
  if (wordCache.has(surahNumber)) return wordCache.get(surahNumber);
  const response = await fetch(wordsUrl(surahNumber));
  if (!response.ok) throw new Error(`words ${surahNumber}: HTTP ${response.status}`);
  const payload = await response.json();
  wordCache.set(surahNumber, payload);
  return payload;
}

export function renderAyahWords(surahNumber, ayahNumber) {
  const words = wordCache.get(surahNumber)?.ayahs?.[ayahNumber - 1];
  if (!words) return '';
  return `
    <div class="ayah-words" dir="rtl" lang="ar">
      ${words.map(([arabic, gloss], i) => `
        <button class="qword" type="button" data-word="${surahNumber}:${ayahNumber}:${i + 1}">
          <span class="qword-ar" lang="ar">${escapeHtml(arabic)}</span>
          <span class="qword-en" dir="ltr" lang="en">${escapeHtml(gloss)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export function setPlaybackSurah(surah) {
  surahMeta = surah;
  // Opening a different surah ends playback rather than carrying it: hearing Al-Baqarah while
  // looking at Yasin is never what was meant.
  if (playing && playing.surah !== surah.number) stopPlayback();
  if (playing) playing.total = surah.ayahCount;
}

export async function playAyah(surahNumber, ayahNumber, { autoplay = true, total } = {}) {
  if (!audio) return;
  playing = { surah: surahNumber, ayah: ayahNumber, total: total ?? playing?.total ?? null };
  // Listening is reading. Someone who plays a surah and comes back tomorrow should resume where the
  // recitation reached, not where they last happened to scroll.
  context?.onAyahChange?.(surahNumber, ayahNumber);
  audio.src = ayahAudioUrl(prefs.reciter, surahNumber, ayahNumber);
  if (!document.hidden) highlightPlaying();
  renderPlayerBar();
  if (!autoplay) return;
  try {
    await audio.play();
  } catch (error) {
    // A rejected play() is nearly always the browser's autoplay policy, which only a user gesture
    // clears. Saying so beats failing silently. An AbortError just means a newer src superseded
    // this one, which is normal when stepping quickly.
    if (error.name !== 'AbortError') toast('Tap play to start the recitation.');
  }
  renderPlayerBar();
}

export function togglePlayback() {
  if (!audio || !playing) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  renderPlayerBar();
}

export function stopPlayback() {
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  playing = null;
  if (preloader) preloader.removeAttribute('src');
  clearHighlight();
  renderPlayerBar();
}

export function isPlaying() {
  return Boolean(playing);
}

function onAyahEnded() {
  if (!playing) return;
  if (prefs.repeat === 'ayah') {
    playAyah(playing.surah, playing.ayah);
    return;
  }
  const next = playing.ayah + 1;
  if (playing.total && next > playing.total) {
    if (prefs.repeat === 'surah') {
      step(1 - playing.ayah);
      return;
    }
    stopPlayback();
    return;
  }
  step(1);
}

function onAudioError() {
  if (!playing || !audio.getAttribute('src')) return;
  const failed = playing;
  stopPlayback();
  toast(navigator.onLine
    ? `Could not load ayah ${failed.surah}:${failed.ayah} in this recitation.`
    : 'Recitation needs a connection unless this surah has been downloaded.');
}

async function step(delta) {
  if (!playing) return;
  const next = playing.ayah + delta;
  if (next < 1) return;
  if (playing.total && next > playing.total) return;
  // In paginated mode the next ayah may sit on a page that is not rendered. Turning the page is the
  // reader's job, so ask it first -- otherwise the highlight would target an element that does not
  // exist and the reader would silently stop following the recitation.
  //
  // Not while the screen is off, though. Waiting on a page render between ayahs left a gap with
  // nothing playing, and that gap is exactly when a locked phone decides the page is idle and
  // freezes it -- which stopped the recitation at the next ayah boundary. With the page hidden,
  // the next file starts immediately and the reader catches up on visibilitychange.
  if (!document.hidden) await context?.ensureAyahVisible?.(playing.surah, next);
  playAyah(playing.surah, next);
}

export function playPrevious() {
  step(-1);
}

export function playNext() {
  step(1);
}

export async function playWord(surahNumber, ayahNumber, position) {
  if (!wordAudio) {
    wordAudio = new Audio();
    wordAudio.preload = 'none';
  }
  // A word lasts a fraction of a second, so queueing taps would run behind the finger. A new tap
  // replaces whatever is sounding.
  wordAudio.pause();
  wordAudio.src = wordAudioUrl(surahNumber, ayahNumber, position);
  try {
    await wordAudio.play();
  } catch (error) {
    if (error.name !== 'AbortError') toast('Word audio needs a connection.');
  }
}

function highlightPlaying() {
  clearHighlight();
  if (!playing) return;
  const el = document.getElementById(`ayah-${playing.surah}-${playing.ayah}`);
  if (!el) return;
  el.classList.add('is-playing');
  if (prefs.autoScroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function clearHighlight() {
  document.querySelectorAll('.ayah.is-playing').forEach((el) => el.classList.remove('is-playing'));
}

/** Called by the reader after it re-renders, so the highlight survives a page turn. */
export function restoreHighlight() {
  if (playing) highlightPlaying();
}

// ---------------------------------------------------------------------------
// Player bar
// ---------------------------------------------------------------------------

function renderPlayerBar() {
  updateMediaSession();
  syncWakeLock();
  const bar = els.quranPlayer;
  if (!bar) return;
  if (!playing) {
    bar.hidden = true;
    document.body.classList.remove('has-player');
    return;
  }
  bar.hidden = false;
  document.body.classList.add('has-player');
  measureReaderControls();
  const paused = !audio || audio.paused;
  els.quranPlayerLabel.textContent = `Ayah ${playing.surah}:${playing.ayah}`
    + (playing.total ? ` of ${playing.total}` : '');
  els.quranPlayerToggle.textContent = paused ? '▶' : '❚❚';
  els.quranPlayerToggle.setAttribute('aria-label', paused ? 'Play recitation' : 'Pause recitation');
  els.quranPlayerRepeat.classList.toggle('active', prefs.repeat !== 'off');
  els.quranPlayerRepeat.setAttribute('aria-label', REPEAT_LABELS[prefs.repeat]);
  els.quranPlayerRepeat.textContent = prefs.repeat === 'ayah' ? '↻1' : '↻';
  els.quranPlayerReciter.value = prefs.reciter;
}

// The utility strip is fixed and its height varies with viewport width and text size, so the
// player's offset is derived from a measurement rather than a constant.
function measureReaderControls() {
  const strip = document.querySelector('.reader-controls');
  if (!strip) return;
  const { height } = strip.getBoundingClientRect();
  if (height > 0) document.body.style.setProperty('--reader-controls-height', `${Math.round(height)}px`);
}

// ---------------------------------------------------------------------------
// Background playback
// ---------------------------------------------------------------------------

/**
 * Registers the recitation with the operating system as media.
 *
 * Without this, a locked Android phone had no reason to keep a web page running: to the OS it was
 * an idle tab, free to freeze between one ayah's file and the next. A media session is what tells
 * it otherwise, and it is also what puts play, pause and skip on the lock screen and in the
 * notification shade -- so someone listening with the screen off can still move between ayahs.
 */
function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const handlers = {
    play: () => audio?.play().catch(() => {}),
    pause: () => audio?.pause(),
    previoustrack: () => playPrevious(),
    nexttrack: () => playNext(),
    stop: () => stopPlayback(),
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Not every browser supports every action; the ones it does support still register.
    }
  }
}

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  if (!playing) {
    session.metadata = null;
    session.playbackState = 'none';
    return;
  }
  const name = surahMeta?.number === playing.surah ? surahMeta.nameSimple : `Surah ${playing.surah}`;
  if (typeof MediaMetadata === 'function') {
    session.metadata = new MediaMetadata({
      title: `${name} · Ayah ${playing.ayah}`,
      artist: currentReciter().name,
      album: 'The Quran',
      artwork: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  }
  session.playbackState = audio && !audio.paused ? 'playing' : 'paused';
}

/**
 * Starts fetching the next ayah while this one plays. The recitation host sends
 * cache-control: max-age of roughly ten months, so when the player switches to that file it comes
 * straight from the HTTP cache: no stutter between ayahs in the foreground, and in the background a
 * shorter window in which nothing is sounding.
 */
function preloadNextAyah() {
  if (!playing || prefs.repeat === 'ayah') return;
  const next = playing.ayah + 1;
  if (playing.total && next > playing.total) return;
  if (!preloader) {
    preloader = new Audio();
    preloader.preload = 'auto';
    preloader.muted = true;
  }
  const url = ayahAudioUrl(prefs.reciter, playing.surah, next);
  if (preloader.getAttribute('src') !== url) preloader.src = url;
}

/**
 * Keeps the screen awake while a recitation plays -- but only when "Follow the recitation" is on.
 *
 * Someone following along needs the page on screen, and a phone that dims mid-surah loses their
 * place. Someone listening with the screen off wants exactly that, and should not pay for a lit
 * screen in their pocket. The setting that already means "I am reading along" decides between
 * them. Pressing the power button still turns the screen off either way; this only suppresses the
 * automatic timeout.
 */
async function syncWakeLock() {
  const wanted = Boolean(playing && audio && !audio.paused && prefs.autoScroll && !document.hidden);
  // renderPlayerBar fires on every play, pause and ayah change, so two calls can arrive before the
  // first request resolves; without the pending flag both would take a lock and one would leak.
  if (wanted && !wakeLock && !wakeLockPending && 'wakeLock' in navigator) {
    wakeLockPending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      // The wait above is a window in which playback can stop; do not keep a lock nobody wants.
      if (!playing || audio.paused) {
        lock.release().catch(() => {});
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } catch {
      // Refused when the page is not visible or battery saver is on; the screen simply sleeps.
    } finally {
      wakeLockPending = false;
    }
  } else if (!wanted && wakeLock) {
    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }
}

function onPlayerClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.playerAction;
  if (action === 'toggle') togglePlayback();
  if (action === 'previous') playPrevious();
  if (action === 'next') playNext();
  if (action === 'close') stopPlayback();
  if (action === 'repeat') {
    prefs.repeat = REPEAT_MODES[(REPEAT_MODES.indexOf(prefs.repeat) + 1) % REPEAT_MODES.length];
    savePrefs();
    renderPlayerBar();
    toast(REPEAT_LABELS[prefs.repeat]);
  }
}

// ---------------------------------------------------------------------------
// Offline audio
// ---------------------------------------------------------------------------

export function isDownloadingAudio() {
  return Boolean(downloadAbort);
}

export function cancelAudioDownload() {
  downloadAbort?.abort();
  downloadAbort = null;
}

/**
 * Recitation files vary enormously by surah -- Al-Baqarah runs to tens of megabytes where An-Nas is
 * a few hundred kilobytes -- and by reciter bitrate on top of that. Rather than quote an estimate
 * that would be wrong for every surah but the one it was measured on, this reports actual bytes as
 * they arrive and stays cancellable throughout.
 */
export async function downloadSurahAudio(surahNumber, ayahCount, onProgress) {
  if (!('caches' in window)) throw new Error('This browser cannot store audio offline.');
  cancelAudioDownload();
  downloadAbort = new AbortController();
  const { signal } = downloadAbort;
  const cache = await caches.open(AUDIO_CACHE);
  let bytes = 0;
  try {
    for (let ayah = 1; ayah <= ayahCount; ayah += 1) {
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      const url = ayahAudioUrl(prefs.reciter, surahNumber, ayah);
      const existing = await cache.match(url);
      if (existing) {
        bytes += Number(existing.headers.get('content-length') || 0);
      } else {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`ayah ${ayah}: HTTP ${response.status}`);
        const body = await response.clone().arrayBuffer();
        bytes += body.byteLength;
        await cache.put(url, response);
      }
      onProgress?.({ done: ayah, total: ayahCount, bytes });
    }
  } finally {
    downloadAbort = null;
  }
  return bytes;
}

export async function surahAudioDownloaded(surahNumber, ayahCount) {
  if (!('caches' in window)) return false;
  const cache = await caches.open(AUDIO_CACHE);
  // Checking the last ayah is enough: the download runs in order, so the final file only exists
  // once every earlier one does.
  return Boolean(await cache.match(ayahAudioUrl(prefs.reciter, surahNumber, ayahCount)));
}

