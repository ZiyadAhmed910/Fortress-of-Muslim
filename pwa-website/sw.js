const APP_VERSION = 'build-dev';
const CACHE_NAME = `fortress-of-muslim-${APP_VERSION}`;
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
  `./css/responsive.css?v=${APP_VERSION}`,
  `./js/app.js?v=${APP_VERSION}`,
  './js/categories.js',
  './js/constants.js',
  './js/data.js',
  './js/dom.js',
  './js/filters.js',
  './js/home.js',
  './js/pwa.js',
  './js/reader.js',
  './js/settings.js',
  './js/state.js',
  './js/userData.js',
  './js/utils.js',
  './manifest.json',
  './data/duas.json',
  './data/duas.json?v=2026-07-11-v2',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
