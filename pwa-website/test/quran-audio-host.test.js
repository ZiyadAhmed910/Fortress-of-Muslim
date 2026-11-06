import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ayahAudioUrl, legacyAyahAudioUrl, wordAudioUrl } from '../js/quran-audio.js';

// Quran recitation moved from everyayah.com and audio.qurancdn.com to our own media host in 0.50.3.
// The one thing that must not break in the move is a surah someone already downloaded: those copies
// are cached under the old addresses. These run the real sw.js fetch handler to check that a request
// for the new address is answered from an old copy, offline, with the byte range the player asks for.

const SOURCE = readFileSync(resolve(process.cwd(), 'sw.js'), 'utf8');
const MEDIA = 'https://media-test.fortressofmuslim.org';

describe('where recitation comes from', () => {
  it('plays ayahs and words from our own media host -- the test one, on a test or local copy', () => {
    // vitest runs on localhost, which the app treats as test (isTestHost).
    expect(ayahAudioUrl('Alafasy_128kbps', 2, 255)).toBe(`${MEDIA}/quran/Alafasy_128kbps/002255.mp3`);
    expect(wordAudioUrl(1, 1, 3)).toBe(`${MEDIA}/quran/wbw/001_001_003.mp3`);
  });

  it('still knows where an earlier download was stored', () => {
    expect(legacyAyahAudioUrl('Alafasy_128kbps', 2, 255)).toBe('https://everyayah.com/data/Alafasy_128kbps/002255.mp3');
  });

  it('no longer streams from the old hosts', () => {
    const player = readFileSync(resolve(process.cwd(), 'js/quran-audio.js'), 'utf8');
    // `const ` in front: LEGACY_AYAH_AUDIO_BASE keeps the old address on purpose, to find old downloads.
    expect(player).not.toMatch(/const WORD_AUDIO_BASE = 'https:\/\/audio\.qurancdn\.com/);
    expect(player).not.toMatch(/const AYAH_AUDIO_BASE = 'https:\/\/everyayah\.com/);
  });
});

// The service worker, run with a fake cache holding whatever `cached` lists (url -> 1000 bytes).
function serviceWorker(cached = []) {
  const listeners = {};
  const body = () => new Uint8Array(1000).map((_, index) => index % 256);
  const store = new Set(cached);
  const cache = {
    match: async (request) => {
      const key = typeof request === 'string' ? request : request.url;
      return store.has(key) ? new Response(body(), { headers: { 'content-type': 'audio/mpeg' } }) : undefined;
    },
    put: async () => {},
  };
  const network = vi.fn(async () => new Response('from network'));
  const self = { location: { href: 'https://fortressofmuslim.org/sw.js', origin: 'https://fortressofmuslim.org' }, addEventListener: (type, handler) => { listeners[type] = handler; }, clients: { claim: () => {} } };
  new Function('self', 'caches', 'fetch', SOURCE)(self, { open: async () => cache, match: cache.match, keys: async () => [] }, network);
  const request = async (url, headers = {}) => {
    let responded;
    listeners.fetch({
      request: new Request(url, { headers }),
      respondWith: (promise) => { responded = promise; },
    });
    return responded ? responded : null;
  };
  return { request, network };
}

describe('a surah downloaded before the move', () => {
  const NEW = `${MEDIA}/quran/Alafasy_128kbps/002255.mp3`;
  const OLD = 'https://everyayah.com/data/Alafasy_128kbps/002255.mp3';

  it('plays from its old copy when the new address is asked for', async () => {
    const worker = serviceWorker([OLD]);
    const response = await worker.request(NEW);
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
    expect(worker.network).not.toHaveBeenCalled();
  });

  it('answers a range from it with 206, as Safari needs', async () => {
    const worker = serviceWorker([OLD]);
    const response = await worker.request(NEW, { range: 'bytes=0-99' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-99/1000');
  });

  it('finds old word audio too', async () => {
    const worker = serviceWorker(['https://audio.qurancdn.com/wbw/001_001_003.mp3']);
    const response = await worker.request(`${MEDIA}/quran/wbw/001_001_003.mp3`);
    expect(response.status).toBe(200);
    expect(worker.network).not.toHaveBeenCalled();
  });

  it('prefers a copy stored under the new address, and goes to the network when there is none', async () => {
    expect((await serviceWorker([NEW]).request(NEW)).status).toBe(200);
    const worker = serviceWorker([]);
    expect(await (await worker.request(NEW)).text()).toBe('from network');
  });
});

describe('dua recitation on the same host', () => {
  it('is still handled as dua audio, not Quran', async () => {
    // Its own cache, and a play that is not downloaded still reaches the network to be counted.
    const worker = serviceWorker([]);
    const response = await worker.request(`${MEDIA}/duas/v1/dua-001/1.mp3`);
    expect(await response.text()).toBe('from network');
    expect(SOURCE).toMatch(/isDuaRecitation = \(url\) => DUA_AUDIO_HOSTS\.includes\(url\.hostname\) && url\.pathname\.startsWith\('\/duas\/'\)/);
  });
});

// ---------------------------------------------------------------------------------------------------
// The audio-source switch: the Admin Console chooses, the app reads it once per launch (app-config.js).

import { appConfig, refreshAppConfig, resetAppConfigFetch, sanitizeConfig } from '../js/app-config.js';
import { otherSourceUrl } from '../js/quran-audio.js';

const memoryStorage = () => {
  const store = new Map();
  return { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
};
const reply = (body, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

describe('the app\'s settings from the Admin Console', () => {
  it('defaults to our own server, and keeps to the two known sources', () => {
    expect(appConfig(memoryStorage())).toEqual({ audioSource: 'own' });
    expect(sanitizeConfig({ audioSource: 'external' })).toEqual({ audioSource: 'external' });
    expect(sanitizeConfig({ audioSource: 'ftp' })).toEqual({ audioSource: 'own' });
    expect(sanitizeConfig(null)).toEqual({ audioSource: 'own' });
  });

  it('asks once per launch, and remembers the answer for the next, offline included', async () => {
    resetAppConfigFetch();
    const storage = memoryStorage();
    const fetcher = reply({ data: { audioSource: 'external' } });
    expect(await refreshAppConfig({ storage, fetcher })).toEqual({ audioSource: 'external' });
    await refreshAppConfig({ storage, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(appConfig(storage)).toEqual({ audioSource: 'external' });
  });

  it('keeps the last value when the request fails, rather than falling back to the default', async () => {
    resetAppConfigFetch();
    const storage = memoryStorage();
    storage.setItem('fortress_app_config', JSON.stringify({ audioSource: 'external' }));
    expect(await refreshAppConfig({ storage, fetcher: reply({}, false) })).toEqual({ audioSource: 'external' });
    resetAppConfigFetch();
    expect(await refreshAppConfig({ storage, fetcher: vi.fn(async () => { throw new Error('offline'); }) })).toEqual({ audioSource: 'external' });
  });
});

describe('switching the source', () => {
  it('plays from the external hosts when the switch says so', () => {
    expect(ayahAudioUrl('Husary_128kbps', 1, 1, 'external')).toBe('https://everyayah.com/data/Husary_128kbps/001001.mp3');
    expect(wordAudioUrl(1, 1, 3, 'external')).toBe('https://audio.qurancdn.com/wbw/001_001_003.mp3');
    expect(ayahAudioUrl('Husary_128kbps', 1, 1, 'own')).toBe(`${MEDIA}/quran/Husary_128kbps/001001.mp3`);
  });

  it('follows the stored setting by default', () => {
    localStorage.setItem('fortress_app_config', JSON.stringify({ audioSource: 'external' }));
    expect(ayahAudioUrl('Husary_128kbps', 1, 1)).toMatch(/^https:\/\/everyayah\.com\//);
    localStorage.removeItem('fortress_app_config');
    expect(ayahAudioUrl('Husary_128kbps', 1, 1)).toMatch(/^https:\/\/media-test\./);
  });

  it('knows the same file at the other source, for a retry when one fails', () => {
    expect(otherSourceUrl(`${MEDIA}/quran/Alafasy_128kbps/002255.mp3`)).toBe('https://everyayah.com/data/Alafasy_128kbps/002255.mp3');
    expect(otherSourceUrl('https://everyayah.com/data/Alafasy_128kbps/002255.mp3')).toBe(`${MEDIA}/quran/Alafasy_128kbps/002255.mp3`);
    expect(otherSourceUrl(`${MEDIA}/quran/wbw/001_001_003.mp3`)).toBe('https://audio.qurancdn.com/wbw/001_001_003.mp3');
    expect(otherSourceUrl('https://audio.qurancdn.com/wbw/001_001_003.mp3')).toBe(`${MEDIA}/quran/wbw/001_001_003.mp3`);
    // A dua, or anything else, has no other source.
    expect(otherSourceUrl(`${MEDIA}/duas/v1/dua-001/1.mp3`)).toBeNull();
  });

  it('retries once and then gives up, rather than bouncing between sources', () => {
    const player = readFileSync(resolve(process.cwd(), 'js/quran-audio.js'), 'utf8');
    const handler = player.slice(player.indexOf('function onAudioError'), player.indexOf('async function step'));
    expect(handler).toMatch(/if \(!playing\.retried\)/);
    expect(handler).toMatch(/playing\.retried = true/);
  });
});

describe('a surah downloaded from our own server, with the switch on external', () => {
  it('still plays offline: the external address is answered from our copy', async () => {
    for (const host of ['media.fortressofmuslim.org', 'media-test.fortressofmuslim.org']) {
      const worker = serviceWorker([`https://${host}/quran/Alafasy_128kbps/002255.mp3`]);
      const response = await worker.request('https://everyayah.com/data/Alafasy_128kbps/002255.mp3', { range: 'bytes=0-99' });
      expect(response.status, host).toBe(206);
      expect(worker.network).not.toHaveBeenCalled();
    }
    const words = serviceWorker(['https://media.fortressofmuslim.org/quran/wbw/001_001_003.mp3']);
    expect((await words.request('https://audio.qurancdn.com/wbw/001_001_003.mp3')).status).toBe(200);
    expect(words.network).not.toHaveBeenCalled();
  });
});
