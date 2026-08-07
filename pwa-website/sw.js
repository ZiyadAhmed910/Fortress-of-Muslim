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
  `./css/online.css?v=${APP_VERSION}`,
  `./css/responsive.css?v=${APP_VERSION}`,
  `./js/app.js?v=${APP_VERSION}`,
  './js/assistant.js',
  './js/categories.js',
  './js/constants.js',
  './js/data.js',
  './js/dom.js',
  './js/filters.js',
  './js/home.js',
  './js/hadith.js',
  './js/layout.js',
  './js/layout-settings.js',
  './js/modes.js',
  './js/online.js',
  './js/prayer.js',
  './js/prayer-times.js',
  './js/pwa.js',
  './js/reminders.js',
  './js/reader.js',
  './js/routes.js',
  './js/settings.js',
  './js/state.js',
  './js/tasbih.js',
  './js/userData.js',
  './js/utils.js',
  './manifest.json',
  './data/duas.json',
  './data/duas.json?v=2026-07-23-hisn-v4',
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
  if (new URL(event.request.url).origin !== self.location.origin) return;
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
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
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
