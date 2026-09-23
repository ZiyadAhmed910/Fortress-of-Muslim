import { describe, expect, it } from 'vitest';
import worker, { cacheControlFor, isAppRoute } from '../edge/worker.js';
import { isPublished } from '../tools/build-dist.mjs';
import { isTestHost } from '../js/utils.js';

// The PWA on Cloudflare replaces Bluehost's .htaccess with edge/worker.js. These pin that it does
// the same jobs: the three app URL shapes open the app, everything else unknown is a real 404, the
// cache headers the update model depends on, and nothing from development gets published.

const ORIGIN = 'https://test.fortressofmuslim.org';

// A static-assets binding holding index.html, sw.js, one module and reset.html.
function assets() {
  const files = {
    '/index.html': '<!doctype html>app shell',
    '/sw.js': 'service worker',
    '/js/app.js': 'module',
    '/reset.html': 'reset page',
    // Just enough data for the deep links below to name a dua and verses that exist (edge/pages.js
    // answers one that does not with a 404). edge-pages.test.js runs against the real files.
    '/data/duas.json': JSON.stringify({ entries: [{ sequence: 27, id: 27, title: 'Morning', parts: [[{ kind: 'translation', text: 'Praise' }]] }] }),
    '/data/quran/surah-2.json': JSON.stringify({ number: 2, nameSimple: 'Al-Baqarah', nameEnglish: 'The Cow', nameArabic: 'البقرة', ayahCount: 286,
      ayahs: Array.from({ length: 286 }, (_, index) => ({ n: index + 1, ar: 'آية', en: 'ayah' })) }),
    '/data/quran/surah-114.json': JSON.stringify({ number: 114, nameSimple: 'An-Nas', nameEnglish: 'Mankind', nameArabic: 'الناس', ayahCount: 6,
      ayahs: Array.from({ length: 6 }, (_, index) => ({ n: index + 1, ar: 'آية', en: 'ayah' })) }),
  };
  return {
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      return pathname in files
        ? new Response(files[pathname], { headers: { etag: '"x"' } })
        : new Response('Not found', { status: 404 });
    },
  };
}

const get = async (path, method = 'GET') => {
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method }), { ASSETS: assets() });
  return { status: response.status, body: await response.text(), cache: response.headers.get('cache-control') };
};

describe('app routes', () => {
  it('open the app at the root and at every deep-link shape', async () => {
    for (const path of ['/', '/quran/2/255', '/quran/114/6/', '/hisn/chapter27', '/bukhari/book1/1']) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.body, path).toContain('app shell');
    }
  });

  it('are the same three shapes .htaccess recognised, and nothing broader', () => {
    expect(isAppRoute('/quran/2/255')).toBe(true);
    expect(isAppRoute('/quran/2')).toBe(false);
    expect(isAppRoute('/hisn/chapter27')).toBe(true);
    expect(isAppRoute('/hisn/27')).toBe(false);
    expect(isAppRoute('/wp-admin/')).toBe(false);
  });

  it('answer an unknown URL with a real 404, not the app shell', async () => {
    // A soft 404 -- 200 and a page for every guessed URL -- gets indexed as empty copies of the site.
    expect((await get('/wp-login.php')).status).toBe(404);
    expect((await get('/some/random/page/here')).status).toBe(404);
  });

  it('serve real pages as themselves, reset.html above all', async () => {
    expect((await get('/reset.html')).body).toBe('reset page');
  });

  it('send www to the one real address, keeping the path', async () => {
    const response = await worker.fetch(new Request('https://www.fortressofmuslim.org/hisn/chapter27?x=1'), { ASSETS: assets() });
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://fortressofmuslim.org/hisn/chapter27?x=1');
  });

  it('refuse anything but reads', async () => {
    expect((await get('/', 'POST')).status).toBe(405);
  });
});

describe('cache headers', () => {
  const header = (path) => cacheControlFor(new URL(`${ORIGIN}${path}`));

  it('never cache the service worker, or a new build is not seen on the next launch', async () => {
    expect(header('/sw.js')).toMatch(/no-store/);
    expect((await get('/sw.js')).cache).toMatch(/no-store/);
  });

  it('keep build-stamped files for a year', () => {
    expect(header('/js/app.js?v=build-1a2b3c4d5e')).toBe('public, max-age=31536000, immutable');
    expect(header('/css/base.css?v=build-1a2b3c4d5e')).toBe('public, max-age=31536000, immutable');
    expect(header('/icons/logo.svg?v=build-1a2b3c4d5e')).toBe('public, max-age=31536000, immutable');
  });

  it('revalidate anything unstamped, including the app shell and the data', () => {
    expect(header('/js/app.js')).toBe('no-cache');
    expect(header('/')).toBe('no-cache');
    expect(header('/data/duas.json')).toBe('no-cache');
    expect(header('/js/app.js?v=anything-else')).toBe('no-cache');
  });

  it('keep unstamped images for a day', () => {
    expect(header('/assets/cards/living/morning.svg')).toBe('public, max-age=86400');
  });
});

describe('what is published', () => {
  it('leaves out development files, tests, tooling and the hosting config', () => {
    for (const path of ['test/storage.test.js', 'tools/stamp_version.py', 'node_modules/x/index.js', 'package.json',
      'vitest.config.js', 'serve.py', 'README.md', 'edge/worker.js', 'wrangler.jsonc', '.htaccess', 'dist/index.html',
      'visualize.html', 'js/something.test.js']) {
      expect(isPublished(path), path).toBe(false);
    }
  });

  it('keeps everything the site serves', () => {
    for (const path of ['index.html', 'sw.js', 'manifest.json', 'reset.html', 'robots.txt', 'sitemap.xml',
      'js/app.js', 'css/base.css', 'data/duas.json', 'data/quran/surah-2.json', 'icons/icon-192.png',
      'assets/cards/living/morning.svg']) {
      expect(isPublished(path), path).toBe(true);
    }
  });
});

describe('which environment a copy of the app belongs to', () => {
  it('treats the test site, local previews and the Cloudflare test preview as test', () => {
    for (const host of ['test.fortressofmuslim.org', 'localhost', '127.0.0.1', 'fortress-pwa-test.example.workers.dev']) {
      expect(isTestHost(host), host).toBe(true);
    }
  });

  it('treats everything else as production', () => {
    for (const host of ['fortressofmuslim.org', 'fortress-pwa-production.example.workers.dev']) {
      expect(isTestHost(host), host).toBe(false);
    }
  });
});
