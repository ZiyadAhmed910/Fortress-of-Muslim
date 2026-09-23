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
// 2. Cache headers, which the app's update model depends on:
//      sw.js                      never cached, so a new build is seen on the next launch
//      ?v=build-<sha> files       kept for a year: a new build is a new URL (tools/stamp_version.py)
//      other html/js/css/json     revalidated every time (answered 304 when unchanged)
//      other images               a day
//
// html_handling is "none" in wrangler.jsonc so paths are served exactly as asked: the default
// would redirect /reset.html to /reset, and the service worker recognises the reset page -- the
// escape hatch for a broken install -- by its .html name.

const APP_ROUTES = [
  /^\/quran\/[0-9]{1,3}\/[0-9]{1,3}\/?$/,
  /^\/hisn\/chapter[0-9]{1,4}\/?$/,
  /^\/[a-z0-9-]+\/book[^/]+\/[^/]+\/?$/,
];

const STAMPED = /(?:^|&)v=build-[0-9a-f]+(?:&|$)/;

export function isAppRoute(pathname) {
  return pathname === '/' || APP_ROUTES.some((route) => route.test(pathname));
}

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
    // www.fortressofmuslim.org is attached to the production Worker only so it can send people to
    // the one real address. Serving the site under both would be a duplicate copy of it.
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.href, 301);
    }
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && isAppRoute(url.pathname)) {
      response = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }
    const headers = new Headers(response.headers);
    headers.set('cache-control', cacheControlFor(url));
    headers.set('x-content-type-options', 'nosniff');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
