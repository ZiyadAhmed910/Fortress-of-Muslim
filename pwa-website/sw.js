const APP_VERSION = 'build-dev';
const CACHE_NAME = `fortress-of-muslim-${APP_VERSION}`;
// Quran text is immutable scripture, so it is keyed by content version rather than by build and is
// deliberately NOT cleared on activate. Surah bodies are fetched on demand and can add up to ~2.4MB
// once someone downloads the lot; putting them in the per-build cache would throw that away on the
// next deploy and silently take the Quran offline for anyone who had saved it.
const QURAN_CACHE = 'fortress-quran-v1';
// Recitation audio is cross-origin and far larger again -- a single surah can run to tens of
// megabytes -- so it gets its own cache that survives deploys for exactly the same reason.
const AUDIO_CACHE = 'fortress-quran-audio-v1';
const AUDIO_HOSTS = ['everyayah.com', 'audio.qurancdn.com', 'verses.quran.com'];
const isQuranBody = (url) => url.pathname.includes('/data/quran/surah-')
  || url.pathname.includes('/data/quran/words-');
const isRecitation = (url) => AUDIO_HOSTS.includes(url.hostname);
const ASSETS = [
  './',
  './index.html',
  `./styles.css?v=${APP_VERSION}`,
  `./css/base.css?v=${APP_VERSION}`,
  `./css/layout.css?v=${APP_VERSION}`,
  `./css/home.css?v=${APP_VERSION}`,
  `./css/reader.css?v=${APP_VERSION}`,
  `./css/settings.css?v=${APP_VERSION}`,
  `./css/feedback.css?v=${APP_VERSION}`,
  `./css/online.css?v=${APP_VERSION}`,
  `./css/responsive.css?v=${APP_VERSION}`,
  `./js/app.js?v=${APP_VERSION}`,
  `./js/assistant.js?v=${APP_VERSION}`,
  `./js/categories.js?v=${APP_VERSION}`,
  `./js/constants.js?v=${APP_VERSION}`,
  `./js/data.js?v=${APP_VERSION}`,
  `./js/dom.js?v=${APP_VERSION}`,
  `./js/filters.js?v=${APP_VERSION}`,
  `./js/home.js?v=${APP_VERSION}`,
  `./js/hadith.js?v=${APP_VERSION}`,
  `./js/layout.js?v=${APP_VERSION}`,
  `./js/layout-settings.js?v=${APP_VERSION}`,
  `./js/modes.js?v=${APP_VERSION}`,
  `./js/online.js?v=${APP_VERSION}`,
  `./js/prayer.js?v=${APP_VERSION}`,
  `./js/quran.js?v=${APP_VERSION}`,
  `./js/quran-audio.js?v=${APP_VERSION}`,
  `./js/prayer-times.js?v=${APP_VERSION}`,
  `./js/pwa.js?v=${APP_VERSION}`,
  `./js/reminders.js?v=${APP_VERSION}`,
  `./js/reader.js?v=${APP_VERSION}`,
  `./js/routes.js?v=${APP_VERSION}`,
  `./js/settings.js?v=${APP_VERSION}`,
  `./js/state.js?v=${APP_VERSION}`,
  `./js/tasbih.js?v=${APP_VERSION}`,
  `./js/userData.js?v=${APP_VERSION}`,
  `./js/utils.js?v=${APP_VERSION}`,
  './manifest.json',
  './data/duas.json',
  './data/duas.json?v=2026-07-23-hisn-v4',
  './data/quran/index.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Decorative card art. Kept out of ASSETS deliberately: a single failed image must not fail the
// whole install and strand everyone on the previous worker, which is one way the app got stuck on
// an old version. These are cached opportunistically and fall through to network if missing.
const OPTIONAL_ASSETS = [
  './assets/cards/all-duas.webp',
  './assets/cards/morning.webp',
  './assets/cards/evening.webp',
  './assets/cards/before-sleep.webp',
  './assets/cards/salah.webp',
  './assets/cards/travel.webp',
  './assets/cards/favourites.webp',
  './assets/cards/moods.webp',
  './assets/cards/ruqyah.webp',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' forces every install fetch past the browser HTTP cache. cache.addAll() goes
  // through it by default, so a stale HTTP-cached module could otherwise be baked into a brand new
  // service worker cache and outlive the HTTP entry that produced it.
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Core assets stay all-or-nothing: a half-cached shell must never activate.
      await Promise.all(ASSETS.map(async (asset) => {
        const response = await fetch(new Request(asset, { cache: 'reload' }));
        if (!response.ok) throw new Error(`Could not cache ${asset}: ${response.status}`);
        await cache.put(asset, response);
      }));
      await Promise.all(OPTIONAL_ASSETS.map((asset) => fetch(new Request(asset, { cache: 'reload' }))
        .then((response) => (response.ok ? cache.put(asset, response) : null))
        .catch(() => null)));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME && key !== QURAN_CACHE && key !== AUDIO_CACHE)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Recitation is the one cross-origin request worth intercepting: a surah downloaded for offline
  // listening is useless if playback still goes straight to the network. Everything else
  // cross-origin is left alone.
  if (isRecitation(url)) {
    event.respondWith(
      caches.open(AUDIO_CACHE)
        .then((cache) => cache.match(url.href))
        .then((cached) => cached || fetch(event.request))
        .catch(() => fetch(event.request))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
        }
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  const target = isQuranBody(url) ? QURAN_CACHE : CACHE_NAME;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(target).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

// Reminder notifications (registration.showNotification, used whenever this service worker
// controls the page) carry {category: 'morning'|'evening'} in event.notification.data. Clicking
// one should open the matching adhkar category directly rather than just opening the app.
self.addEventListener('notificationclick', (event) => {
  const category = event.notification.data?.category;
  event.notification.close();
  if (!category) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((client) => 'focus' in client);
      if (existing) {
        existing.postMessage({ type: 'OPEN_ADHKAR', category });
        return existing.focus();
      }
      return self.clients.openWindow(`./?adhkar=${category}`);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
