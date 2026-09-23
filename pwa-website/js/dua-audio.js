import { els } from './dom.js';
import { escapeHtml, toast } from './utils.js';

// Recorded recitation for the duas, served from our own media host (apps/media) out of R2.
//
// data/dua-audio.json maps a reading to its recordings: readings[uid][partNumber] is a list of
// tracks, usually one, two where the book gives a Morning and an Evening wording. A part with no
// entry simply has no play button -- most instruction and virtue readings have no words to recite,
// and a few recordings are still being checked against the text, so absence is normal, not an error.
//
// The media host counts plays and downloads for the audio's provider. It only sees what reaches it:
// a play is counted when a file is fetched from the start, an offline download once when it is
// saved, and a play from a downloaded copy is not counted at all, because it never leaves the phone.

const MAP_URL = './data/dua-audio.json';
export const DUA_AUDIO_CACHE = 'fortress-dua-audio-v1';
// The test site plays from the test media host, so its listens land in the test database and never
// in a report built from production.
const TEST_MEDIA_BASE = 'https://media-test.fortressofmuslim.org';
const DOWNLOAD_CONCURRENCY = 4;

let map = null;
let mapPromise = null;
let audio = null;
let playing = null; // { uid, part, index, title }
let downloadAbort = null;
// The part the reader is showing, so a map that loads after the first render can still fill it in.
let current = null;

export function mediaBase(hostname = location.hostname, fallback = map?.base) {
  if (hostname === 'test.fortressofmuslim.org' || hostname === 'localhost' || hostname === '127.0.0.1') {
    return TEST_MEDIA_BASE;
  }
  return fallback;
}

export function trackUrl(track, base = mediaBase()) {
  return `${base}/${track.path}`;
}

export function loadDuaAudio() {
  if (map) return Promise.resolve(map);
  mapPromise ||= fetch(MAP_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      map = payload?.version === 1 ? payload : { version: 1, readings: {} };
      return map;
    })
    .catch(() => {
      mapPromise = null;
      return { version: 1, readings: {} };
    });
  return mapPromise;
}

/** The recordings for one part (0-based index, as the reader counts), or an empty list. */
export function tracksFor(uid, partIndex, source = map) {
  return source?.readings?.[uid]?.[String(partIndex + 1)] || [];
}

/** Every track in the map, once each -- what "download all" saves. */
export function allTracks(source = map) {
  return Object.values(source?.readings || {}).flatMap((parts) => Object.values(parts).flat());
}

const formatSeconds = (seconds) => {
  const whole = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export function initDuaAudio() {
  audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('play', () => {
    // See the matching listener in quran-audio.js: one player at a time, and the lock screen's
    // controls go to whichever started last.
    document.dispatchEvent(new CustomEvent('fortress:audio-start', { detail: 'dua' }));
    bindMediaSession();
    updateMediaSession();
    renderButtons();
  });
  document.addEventListener('fortress:audio-start', (event) => {
    if (event.detail !== 'dua' && !audio.paused) audio.pause();
  });
  audio.addEventListener('pause', renderButtons);
  audio.addEventListener('ended', () => {
    playing = null;
    renderButtons();
    updateMediaSession();
  });
  audio.addEventListener('error', () => {
    if (!playing) return;
    playing = null;
    renderButtons();
    toast(navigator.onLine ? 'This recitation could not be played.' : 'Recitation needs a connection unless it has been downloaded.');
  });
  els.duaAudio?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dua-track]');
    if (button) toggleTrack(Number(button.dataset.duaTrack));
  });
  loadDuaAudio().then(() => {
    if (current) renderDuaAudio(current.entry, current.partIndex);
    syncDownloadRow();
  });
}

/** Called by the reader on every render. Shows the part's play buttons, or nothing. */
export function renderDuaAudio(entry, partIndex) {
  if (!els.duaAudio) return;
  // Moving to another part stops what was playing: the button that would pause it is gone.
  if (playing && (playing.uid !== entry.uid || playing.part !== partIndex)) stopDuaAudio();
  current = { entry, partIndex };
  const tracks = tracksFor(entry.uid, partIndex);
  els.duaAudio.hidden = tracks.length === 0;
  els.duaAudio.innerHTML = reciterLine() + tracks.map((track, index) => `
    <button class="dua-audio-button" type="button" data-dua-track="${index}" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path class="icon-play" d="M8 5.5v13l10.5-6.5z"/><path class="icon-pause" d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z"/></svg>
      <span>${escapeHtml(track.label || 'Listen')}</span>
      <small>${formatSeconds(track.seconds)}</small>
    </button>
  `).join('');
  renderButtons();
}

// Named once, above the buttons, rather than on each: the same voice reads every dua.
function reciterLine() {
  return map?.reciter ? `<p class="dua-audio-reciter">Recited by ${escapeHtml(map.reciter)}</p>` : '';
}

function toggleTrack(index) {
  if (!current) return;
  const { entry, partIndex } = current;
  if (playing && playing.uid === entry.uid && playing.part === partIndex && playing.index === index) {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    return;
  }
  const track = tracksFor(entry.uid, partIndex)[index];
  if (!track) return;
  playing = { uid: entry.uid, part: partIndex, index, title: entry.title, label: track.label };
  audio.src = trackUrl(track);
  audio.play().catch(() => {});
  updateMediaSession();
  renderButtons();
}

export function stopDuaAudio() {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  playing = null;
  renderButtons();
  updateMediaSession();
}

function renderButtons() {
  if (!els.duaAudio) return;
  for (const button of els.duaAudio.querySelectorAll('[data-dua-track]')) {
    const active = Boolean(playing && current && playing.uid === current.entry.uid
      && playing.part === current.partIndex && playing.index === Number(button.dataset.duaTrack) && !audio.paused);
    button.classList.toggle('is-playing', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if ('mediaSession' in navigator && playing) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
}

function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const handlers = {
    play: () => (playing ? audio.play().catch(() => {}) : undefined),
    pause: () => (playing ? audio.pause() : undefined),
    stop: () => (playing ? stopDuaAudio() : undefined),
    // A dua is a single recording: clear the Quran player's skip buttons rather than leave them
    // pointing at a recitation that is no longer playing.
    previoustrack: null,
    nexttrack: null,
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Not every browser supports every action.
    }
  }
}

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  if (!playing) return;
  if (typeof MediaMetadata === 'function') {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: playing.label ? `${playing.title} · ${playing.label}` : playing.title,
      artist: map?.reciter || 'Fortress of Muslim',
      album: 'Supplications',
      artwork: [
        { src: 'icons/icon-192.png?v=build-dev', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png?v=build-dev', sizes: '512x512', type: 'image/png' },
      ],
    });
  }
}

// ---------------------------------------------------------------------------
// Offline download (Settings -> Data)
// ---------------------------------------------------------------------------

export function totalBytes(source = map) {
  return allTracks(source).reduce((sum, track) => sum + (track.bytes || 0), 0);
}

export function initDuaAudioDownload({ onChange } = {}) {
  els.duaAudioDownloadButton?.addEventListener('click', async () => {
    if (downloadAbort) {
      downloadAbort.abort();
      return;
    }
    await downloadAll();
    onChange?.();
  });
  syncDownloadRow();
}

async function savedCount(cache, tracks) {
  const base = mediaBase();
  const hits = await Promise.all(tracks.map((track) => cache.match(trackUrl(track, base)).then(Boolean)));
  return hits.filter(Boolean).length;
}

export async function syncDownloadRow() {
  if (!els.duaAudioDownloadRow) return;
  const tracks = allTracks();
  els.duaAudioDownloadRow.hidden = tracks.length === 0 || typeof caches === 'undefined';
  if (els.duaAudioDownloadRow.hidden || downloadAbort) return;
  const saved = await savedCount(await caches.open(DUA_AUDIO_CACHE), tracks);
  const megabytes = (totalBytes() / 1048576).toFixed(0);
  els.duaAudioDownloadStatus.textContent = saved === tracks.length
    ? `All ${tracks.length} recordings saved for offline listening.`
    : `${saved} of ${tracks.length} recordings saved. About ${megabytes} MB for all of them.`;
  els.duaAudioDownloadButton.textContent = saved === tracks.length ? 'Saved' : 'Download';
  els.duaAudioDownloadButton.disabled = saved === tracks.length;
}

async function downloadAll() {
  const tracks = allTracks();
  const cache = await caches.open(DUA_AUDIO_CACHE);
  const base = mediaBase();
  const pending = [];
  for (const track of tracks) {
    if (!(await cache.match(trackUrl(track, base)))) pending.push(track);
  }
  downloadAbort = new AbortController();
  const { signal } = downloadAbort;
  els.duaAudioDownloadButton.textContent = 'Cancel';
  let done = tracks.length - pending.length;
  let failed = 0;
  const report = () => {
    els.duaAudioDownloadStatus.textContent = `Saving ${done} of ${tracks.length}…`;
  };
  report();
  const queue = [...pending];
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const track = queue.shift();
      try {
        // ?intent=download tells the media host to count this as a download rather than a play. The
        // copy is stored under the plain URL, which is the one the player asks for.
        const response = await fetch(`${trackUrl(track, base)}?intent=download`, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await cache.put(trackUrl(track, base), response);
        done += 1;
      } catch {
        if (signal.aborted) return;
        failed += 1;
      }
      report();
    }
  };
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
  const cancelled = signal.aborted;
  downloadAbort = null;
  els.duaAudioDownloadButton.disabled = false;
  await syncDownloadRow();
  if (cancelled) toast('Download stopped. What was saved stays saved.');
  else if (failed) toast(`${failed} recordings could not be saved. Try again when the connection is steadier.`);
  else toast('Dua recitation saved for offline listening.');
}
