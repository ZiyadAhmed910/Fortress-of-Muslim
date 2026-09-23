// Serves the PWA from Cloudflare (Workers static assets), in place of Bluehost + .htaccess.
//
// The files themselves are plain static assets (see tools/build-dist.mjs for what is published).
// This script runs in front of them for two things .htaccess used to do:
//
// 1. App routes. Only these URL shapes are the app, and each is answered with index.html:
//      /                          the home screen
//      /quran/<surah>/<ayah>      a verse
//      /hisn/chapter<n>           a dua
//      /<collection>/book<b>/<n>  a hadith
//    Anything else that is not a real file is a 404, not the app shell. A catch-all would answer
//    every URL ever guessed at with 200 and a page -- a soft 404 that search engines index as
//    empty duplicates of the site.
//
//    A dua or verse URL also gets its own title, description, canonical and text in the HTML
//    itself (edge/pages.js), and is a 404 when it names one that does not exist.
//
// 2. Cache headers, which the app's update model depends on:
//      sw.js                      never cached, so a new build is seen on the next launch
//      ?v=build-<sha> files       kept for a year: a new build is a new URL (tools/stamp_version.py)
//      other html/js/css/json     revalidated every time (answered 304 when unchanged)
//      other images               a day
//
// html_handling is "none" in wrangler.jsonc so paths are served exactly as asked: the default
// would redirect /reset.html to /reset, and the service worker recognises the reset page -- the
// escape hatch for a broken install -- by its .html name.

import { applyPage, pageFor } from './pages.js';

// Parsed data files, kept for the life of the isolate: duas.json is read on every dua page, and
// these files only change with a deploy, which starts new isolates.
const jsonCache = new Map();
function loadJson(env, url, path) {
  if (!jsonCache.has(path)) {
    jsonCache.set(path, env.ASSETS.fetch(new Request(new URL(path, url)))
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      // A failed read is not remembered: the next request tries again.
      .then((data) => {
        if (!data) jsonCache.delete(path);
        return data;
      }));
  }
  return jsonCache.get(path);
}

// A page whose tags cannot be filled in is still served -- as the plain shell, which is what every
// route was before -- rather than failing the request. edge-pages.test.js holds index.html to having
// every tag, so this is for the day someone edits one without running the tests.
function withPage(html, page, url) {
  try {
    return applyPage(html, page);
  } catch (error) {
    console.error(JSON.stringify({ event: 'page_render_failed', path: url.pathname, message: String(error) }));
    return html;
  }
}

const notFound = () => new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' },
});

const APP_ROUTES = [
  /^\/quran\/[0-9]{1,3}\/[0-9]{1,3}\/?$/,
  /^\/hisn\/chapter[0-9]{1,4}\/?$/,
  /^\/[a-z0-9-]+\/book[^/]+\/[^/]+\/?$/,
];

const STAMPED = /(?:^|&)v=build-[0-9a-f]+(?:&|$)/;

export function isAppRoute(pathname) {
  return pathname === '/' || APP_ROUTES.some((route) => route.test(pathname));
}

/**
 * Where a request should be sent instead, so each page exists at exactly one address -- or null.
 * Every one of these was a second copy of a page to a search engine:
 *   http://...                       -> https://
 *   www.fortressofmuslim.org         -> fortressofmuslim.org (attached to the production Worker for this)
 *   /hisn/chapter27/ (an app route)  -> /hisn/chapter27
 *
 * /index.html is deliberately NOT redirected, though it is the home page under a second name: the
 * service worker precaches it as the offline shell (sw.js), and a redirected response stored there
 * is one Chrome refuses to serve for a navigation -- the installed app would fail to open. Its
 * canonical link already names /, and nothing links to it.
 */
export function canonicalRedirect(url) {
  const target = new URL(url);
  if (target.protocol === 'http:') target.protocol = 'https:';
  if (target.hostname.startsWith('www.')) target.hostname = target.hostname.slice(4);
  if (target.pathname.length > 1 && target.pathname.endsWith('/') && isAppRoute(target.pathname)) {
    target.pathname = target.pathname.replace(/\/+$/, '');
  }
  return target.href === url.href ? null : target.href;
}

// Only the production site belongs in search results. The test site and the workers.dev preview
// addresses serve the same pages; js/seo.js marked them noindex, but only once the app had run, so
// the HTML a crawler first read said "index". A header is read before anything else.
export const INDEXED_HOST = 'fortressofmuslim.org';

export function cacheControlFor(url) {
  const { pathname } = url;
  if (pathname === '/sw.js') return 'no-store, no-cache, must-revalidate';
  if (STAMPED.test(url.search.slice(1)) && /\.(?:js|css|svg|png|ico)$/.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  if (/\.(?:png|webp|svg|ico)$/.test(pathname)) return 'public, max-age=86400';
  return 'no-cache';
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    const canonical = canonicalRedirect(url);
    if (canonical) return Response.redirect(canonical, 301);
    let response = await env.ASSETS.fetch(request);
    let body = response.body;
    if (response.status === 404 && isAppRoute(url.pathname)) {
      const shell = await env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: 'GET' }));
      const page = await pageFor(url.pathname, (path) => loadJson(env, url, path));
      if (page === null) return notFound();
      response = shell;
      body = page ? withPage(await shell.text(), page, url) : shell.body;
    }
    const headers = new Headers(response.headers);
    headers.set('cache-control', cacheControlFor(url));
    headers.set('x-content-type-options', 'nosniff');
    if (url.hostname !== INDEXED_HOST) headers.set('x-robots-tag', 'noindex, nofollow');
    // The rewritten page is a different length from the file it came from.
    if (typeof body === 'string') {
      headers.delete('content-length');
      headers.delete('etag');
    }
    if (request.method === 'HEAD') body = null;
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  },
};
