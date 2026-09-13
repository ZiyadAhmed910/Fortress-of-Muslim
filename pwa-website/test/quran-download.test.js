import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelAudioDownload, downloadSurahAudio, surahAudioDownloaded } from '../js/quran-audio.js';

// A surah download is one request per ayah -- everyayah's per-surah zips are served without a CORS
// header, so a browser cannot read one -- and Al-Baqarah is 286 of them. Running them one at a time
// spent 286 round trips of latency in a row. These cover what the window is allowed to change and,
// more importantly, what it is not: surahAudioDownloaded() reads the last ayah's presence as proof
// that the whole surah is stored.
const AYAH_BYTES = 120_000;

let inFlight = 0;
let peakInFlight = 0;
let requested = [];
let stored = [];
let cacheStore = new Map();
let failAt = null;

const response = () => ({
  ok: true,
  headers: { get: () => String(AYAH_BYTES) },
  clone: () => ({ arrayBuffer: async () => new ArrayBuffer(AYAH_BYTES) }),
});

beforeEach(() => {
  inFlight = 0;
  peakInFlight = 0;
  requested = [];
  stored = [];
  cacheStore = new Map();
  failAt = null;
  globalThis.caches = {
    open: async () => ({
      match: async (url) => cacheStore.get(url),
      put: async (url, value) => { cacheStore.set(url, value); stored.push(url); },
    }),
  };
  globalThis.fetch = async (url, { signal } = {}) => {
    requested.push(url);
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    if (failAt && url.includes(failAt)) return { ok: false, status: 404 };
    return response();
  };
});

afterEach(() => {
  cancelAudioDownload();
  delete globalThis.caches;
  delete globalThis.fetch;
});

const ayahOf = (url) => Number(url.slice(-7, -4));

describe('downloading a surah for offline listening', () => {
  it('asks for several ayahs at once instead of one round trip at a time', async () => {
    await downloadSurahAudio(2, 40, () => {});
    expect(peakInFlight).toBeGreaterThan(1);
  });

  it('keeps the window small enough not to behave like a download manager', async () => {
    await downloadSurahAudio(2, 40, () => {});
    expect(peakInFlight).toBeLessThanOrEqual(5);
  });

  it('stores the last ayah only once every earlier one is stored', async () => {
    // surahAudioDownloaded() checks the last ayah alone, so this ordering is the whole basis of
    // "this surah is downloaded". In flight together, ayah 40 would often land before ayah 3.
    await downloadSurahAudio(2, 40, () => {});
    expect(stored).toHaveLength(40);
    expect(ayahOf(stored[stored.length - 1])).toBe(40);
    expect(new Set(stored.slice(0, -1).map(ayahOf))).toEqual(new Set(Array.from({ length: 39 }, (_, i) => i + 1)));
  });

  it('leaves a cancelled download looking incomplete rather than finished', async () => {
    const running = downloadSurahAudio(2, 40, ({ done }) => {
      if (done === 4) cancelAudioDownload();
    });
    await expect(running).rejects.toThrow();
    expect(await surahAudioDownloaded(2, 40)).toBe(false);
  });

  it('reports every ayah exactly once, and counts up', async () => {
    const progress = [];
    await downloadSurahAudio(112, 4, (update) => progress.push(update.done));
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  it('counts bytes for what it fetched', async () => {
    const bytes = await downloadSurahAudio(112, 4, () => {});
    expect(bytes).toBe(4 * AYAH_BYTES);
  });

  it('does not fetch again what the cache already holds', async () => {
    await downloadSurahAudio(112, 4, () => {});
    requested = [];
    const bytes = await downloadSurahAudio(112, 4, () => {});
    expect(requested).toEqual([]);
    expect(bytes).toBe(4 * AYAH_BYTES);
  });

  it('stops the requests still in flight when one ayah fails', async () => {
    failAt = '002003.mp3';
    await expect(downloadSurahAudio(2, 40, () => {})).rejects.toThrow(/HTTP 404/);
    const afterFailure = requested.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requested.length).toBe(afterFailure);
    expect(await surahAudioDownloaded(2, 40)).toBe(false);
  });

  it('handles a surah short enough to have nothing to parallelise', async () => {
    await downloadSurahAudio(108, 3, () => {});
    expect(stored).toHaveLength(3);
    expect(await surahAudioDownloaded(108, 3)).toBe(true);
  });
});
