import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CACHES,
  SHELL_CACHE_PREFIX,
  clearCache,
  estimateTotal,
  formatBytes,
  measureCache,
  shellCacheName,
} from '../js/storage.js';

// The storage manager lets someone free what the app has saved without wiping everything else the
// browser holds for the site. Its one real hazard is deleting the wrong thing, so most of what is
// here is about that: a clear touches one cache and only one, never the app shell, and the names
// it knows are the same names the service worker keeps.

const SW = readFileSync(resolve(process.cwd(), 'sw.js'), 'utf8');
const SHELL = `${SHELL_CACHE_PREFIX}build-test`;

let store;

const response = ({ length, body = 'x' } = {}) => ({
  headers: { get: (name) => (name === 'content-length' && length !== undefined ? String(length) : null) },
  clone: () => ({ blob: async () => ({ size: body.length }) }),
});

beforeEach(() => {
  // name -> Map(url -> response). Mirrors the Cache API closely enough to catch a clear that reaches
  // further than it should.
  store = new Map([
    [SHELL, new Map([['/index.html', response({ length: 5000 })]])],
    ['fortress-quran-v1', new Map([['/data/quran/surah-1.json', response({ length: 4000 })]])],
    ['fortress-quran-audio-v1', new Map([
      ['https://audio/001001.mp3', response({ length: 120_000 })],
      ['https://audio/001002.mp3', response({ length: 80_000 })],
    ])],
  ]);
  globalThis.caches = {
    has: async (name) => store.has(name),
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name);
      return {
        keys: async () => [...entries.keys()],
        match: async (url) => entries.get(url),
      };
    },
  };
});

afterEach(() => {
  delete globalThis.caches;
  delete globalThis.navigator.storage;
});

describe('the caches this knows about', () => {
  it('are the caches the service worker keeps', () => {
    // sw.js deletes every cache it does not recognise on activate. A name that drifts between the
    // two would mean downloads silently disappearing on the next deploy.
    for (const cache of CACHES) {
      expect(SW, `${cache.name} is not declared in sw.js`).toContain(`'${cache.name}'`);
    }
  });

  it('are ones the service worker preserves across deploys', () => {
    // Which, in sw.js, is a named constant each: the activate filter keeps those and nothing else.
    const activate = SW.slice(SW.indexOf("addEventListener('activate'"));
    const keptConstants = [...activate.slice(0, activate.indexOf('});')).matchAll(/key !== ([A-Z_]+)/g)]
      .map((match) => match[1]);
    const kept = keptConstants.map((constant) => SW.match(new RegExp(`const ${constant} = '([^']+)'`))?.[1]);
    for (const cache of CACHES) expect(kept).toContain(cache.name);
  });

  it('never offer the app shell for clearing', () => {
    expect(CACHES.some((cache) => cache.name.startsWith(SHELL_CACHE_PREFIX))).toBe(false);
  });
});

describe('clearing one cache', () => {
  it.each(CACHES.map((cache) => [cache.name]))('clears %s and leaves every other cache alone', async (name) => {
    const before = new Map([...store].map(([key, entries]) => [key, entries.size]));
    await clearCache(name);
    expect(store.has(name)).toBe(false);
    for (const [key, size] of before) {
      if (key === name) continue;
      expect(store.has(key), `${key} was deleted too`).toBe(true);
      expect(store.get(key).size, `${key} lost entries`).toBe(size);
    }
  });

  it('refuses the app shell, whatever it is called this build', async () => {
    await expect(clearCache(SHELL)).rejects.toThrow(/Not a clearable cache/);
    expect(store.has(SHELL)).toBe(true);
  });

  it('refuses a name it does not know', async () => {
    await expect(clearCache('something-else')).rejects.toThrow(/Not a clearable cache/);
  });
});

describe('measuring', () => {
  it('adds up the entries in a cache', async () => {
    expect(await measureCache('fortress-quran-audio-v1')).toEqual({ entries: 2, bytes: 200_000 });
  });

  it('reads the size from the header rather than reading every body', async () => {
    let bodiesRead = 0;
    store.set('fortress-quran-audio-v1', new Map([['a', {
      headers: { get: () => '1000' },
      clone: () => ({ blob: async () => { bodiesRead += 1; return { size: 1000 }; } }),
    }]]));
    await measureCache('fortress-quran-audio-v1');
    expect(bodiesRead).toBe(0);
  });

  it('falls back to the body when there is no length header', async () => {
    store.set('fortress-quran-v1', new Map([['a', response({ body: 'twelve bytes' })]]));
    expect(await measureCache('fortress-quran-v1')).toEqual({ entries: 1, bytes: 12 });
  });

  it('does not create a cache just by looking at it', async () => {
    store.delete('fortress-quran-audio-v1');
    expect(await measureCache('fortress-quran-audio-v1')).toEqual({ entries: 0, bytes: 0 });
    expect(store.has('fortress-quran-audio-v1')).toBe(false);
  });

  it('finds the app shell by prefix, since its name changes every build', async () => {
    expect(await shellCacheName()).toBe(SHELL);
  });
});

describe('the total', () => {
  it('reports what the browser estimates', async () => {
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ usage: 1234, quota: 99999 }) },
    });
    expect(await estimateTotal()).toEqual({ usage: 1234, quota: 99999 });
  });

  it('is absent rather than invented where the browser cannot estimate', async () => {
    Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: undefined });
    expect(await estimateTotal()).toBeNull();
  });
});

describe('formatting a size', () => {
  it.each([
    [0, '0 bytes'],
    [512, '512 bytes'],
    [1500, '1.5 KB'],
    [48_200_000, '48 MB'],
    [2_400_000, '2.4 MB'],
    [2_100_000_000, '2.1 GB'],
  ])('%d reads as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
