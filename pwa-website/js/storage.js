// What this app keeps on the device, and a way to give some of it back.
//
// The service worker fills three caches and nothing ever showed what was in them. Someone who
// downloaded a few reciters' full mushaf for offline listening could be holding hundreds of
// megabytes with no way to see it, and the only way to free it was to clear all site data from the
// browser -- which also wipes favourites, settings and reading position, none of which had anything
// to do with the audio. So each cache is listed on its own, measured on its own, and cleared on its
// own. There is deliberately no "clear everything" button: the same philosophy as the per-surah
// download, specific actions that say what they will do.
//
// The names here must match sw.js exactly. The worker is a classic script and cannot import this
// module, so the names are written twice; test/storage.test.js reads sw.js and fails if they drift.
// A name that drifts is not a cosmetic bug -- sw.js deletes every cache it does not recognise on
// activate, so a mismatch would mean downloads silently vanish on the next deploy.

export const CACHES = [
  {
    key: 'duaAudio',
    name: 'fortress-dua-audio-v1',
    label: 'Dua recitation',
    detail: 'Recordings saved for offline listening. Clearing it only removes downloads; recitation still plays when you are online.',
    clearable: true,
  },
  {
    key: 'quranAudio',
    name: 'fortress-quran-audio-v1',
    label: 'Quran recitation',
    detail: 'Audio saved for offline listening. Clearing it only removes downloads; recitation still streams when you are online.',
    clearable: true,
  },
  {
    key: 'quranText',
    name: 'fortress-quran-v1',
    label: 'Quran text',
    detail: 'Surahs saved as you read them. Clearing it means a surah needs a connection the next time you open it.',
    clearable: true,
  },
];

// The per-build app shell. Listed so the numbers add up, but not clearable: without it the app does
// not start offline at all, which is a far bigger loss than any download, and it is replaced on the
// next update anyway.
export const SHELL_CACHE_PREFIX = 'fortress-of-muslim-';

const clearableNames = new Set(CACHES.filter((cache) => cache.clearable).map((cache) => cache.name));

export const storageSupported = () => typeof caches !== 'undefined';

/**
 * The browser's own figure for everything this site holds, and how much it may hold.
 *
 * An estimate by definition, and not available everywhere -- older Safari has no
 * navigator.storage.estimate(). Where it is missing this returns null and the caller hides the
 * figure rather than showing a number it cannot back up. The per-cache sizes below do not depend
 * on it, so the rest of the section still works.
 */
export async function estimateTotal() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (!Number.isFinite(usage)) return null;
    return { usage, quota: Number.isFinite(quota) ? quota : null };
  } catch {
    return null;
  }
}

/**
 * The size of one response. The Content-Length header when there is one, which is every audio file
 * and costs nothing; otherwise the body itself, which means reading it. A cache holding thousands of
 * ayahs is the reason for preferring the header -- reading every body to add up a total would pull
 * the whole cache through memory just to print one number.
 */
async function responseBytes(response) {
  const header = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(header) && header > 0) return header;
  try {
    return (await response.clone().blob()).size;
  } catch {
    // Opaque cross-origin responses cannot be read. They still take space; not being able to say how
    // much is better than inventing a figure.
    return 0;
  }
}

/** How many entries a cache holds and roughly how many bytes. Does not create a cache that is absent. */
export async function measureCache(name) {
  if (!storageSupported()) return { entries: 0, bytes: 0 };
  // caches.open() would create an empty cache as a side effect of looking at it. has() does not.
  if (!(await caches.has(name))) return { entries: 0, bytes: 0 };
  const cache = await caches.open(name);
  const requests = await cache.keys();
  let bytes = 0;
  for (const request of requests) {
    const response = await cache.match(request);
    if (response) bytes += await responseBytes(response);
  }
  return { entries: requests.length, bytes };
}

/** The current build's app shell, found by prefix because its name changes on every deploy. */
export async function shellCacheName() {
  if (!storageSupported()) return null;
  const names = await caches.keys();
  return names.find((name) => name.startsWith(SHELL_CACHE_PREFIX)) ?? null;
}

/**
 * Deletes exactly one cache, and only one that is listed as clearable.
 *
 * Refuses anything else rather than trusting the caller, because the failure it guards against is
 * severe and silent: deleting the app shell by passing the wrong name takes the whole app offline,
 * and nothing about the button that did it would say so.
 */
export async function clearCache(name) {
  if (!clearableNames.has(name)) throw new Error(`Not a clearable cache: ${name}`);
  if (!storageSupported()) return false;
  return caches.delete(name);
}

/** "48.2 MB", "312 KB", "0 bytes". Decimal units, the way devices report free space. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 bytes';
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${value} bytes` : `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
