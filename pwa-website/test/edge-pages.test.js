import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../edge/worker.js';

// What a crawler receives for a content URL, before any JavaScript runs -- served by the real Worker
// from the real index.html and data files. Before this, every one of these was the home page's HTML
// with a canonical pointing at the home page, and Search Console listed 246 of them as "Discovered -
// currently not indexed".

const ROOT = process.cwd();
const ORIGIN = 'https://fortressofmuslim.org';
const SITEMAP = readFileSync(resolve(ROOT, 'sitemap.xml'), 'utf8');

// A static-assets binding over the pwa-website directory itself.
const assets = {
  fetch: async (request) => {
    const { pathname } = new URL(request.url);
    const file = resolve(ROOT, `.${pathname}`);
    if (!file.startsWith(ROOT) || pathname === '/' || !existsSync(file)) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(file), { headers: { 'content-type': pathname.endsWith('.json') ? 'application/json' : 'text/html' } });
  },
};

const get = async (path) => {
  const response = await worker.fetch(new Request(`${ORIGIN}${path}`), { ASSETS: assets });
  return { status: response.status, html: await response.text() };
};
const tag = (html, pattern) => html.match(pattern)?.[1];

describe('a dua page', () => {
  it('has its own title, description, canonical and text', async () => {
    const { status, html } = await get('/hisn/chapter27');
    expect(status).toBe(200);
    expect(tag(html, /<title>([^<]*)<\/title>/)).toBe('27. In the morning and evening - Fortress of Muslim');
    expect(tag(html, /<link rel="canonical" href="([^"]*)">/)).toBe(`${ORIGIN}/hisn/chapter27`);
    expect(tag(html, /<meta property="og:url" content="([^"]*)">/)).toBe(`${ORIGIN}/hisn/chapter27`);
    const description = tag(html, /<meta name="description" content="([^"]*)">/);
    expect(description).toMatch(/^In the morning and evening: /);
    expect(description.length).toBeLessThanOrEqual(160);
    const article = tag(html, /<article id="prerender" class="prerender">([\s\S]*?)<\/article>/);
    expect(article).toContain('<h2>27. In the morning and evening</h2>');
    // One main heading, and it names the page -- not "Fortress of Muslim" as on every URL before.
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(tag(html, /<h1 id="screenTitle">([^<]*)<\/h1>/)).toBe('27. In the morning and evening');
    expect(article).toContain('lang="ar" dir="rtl"');
  });

  it('is still the app, which removes the server copy as it starts', async () => {
    const { html } = await get('/hisn/chapter27');
    expect(html).toMatch(/<script type="module" src="js\/app\.js\?v=[^"]+"><\/script>/);
    expect(readFileSync(resolve(ROOT, 'js/app.js'), 'utf8')).toContain("document.getElementById('prerender')?.remove()");
  });

  it('is a 404 when the dua does not exist, not an empty shell', async () => {
    expect((await get('/hisn/chapter999')).status).toBe(404);
    expect((await get('/hisn/chapter0')).status).toBe(404);
  });
});

describe('a surah page', () => {
  it('carries the whole surah at its first ayah, the URL the sitemap lists', async () => {
    const { status, html } = await get('/quran/1/1');
    expect(status).toBe(200);
    expect(tag(html, /<title>([^<]*)<\/title>/)).toBe('Surah Al-Fatihah (The Opener) - Fortress of Muslim');
    expect(tag(html, /<link rel="canonical" href="([^"]*)">/)).toBe(`${ORIGIN}/quran/1/1`);
    const article = tag(html, /<article id="prerender" class="prerender">([\s\S]*?)<\/article>/);
    expect((article.match(/lang="ar"/g) || []).length).toBe(8); // the name, and seven ayahs
  });

  it('gives a single ayah its own page', async () => {
    const { html } = await get('/quran/2/255');
    expect(tag(html, /<title>([^<]*)<\/title>/)).toBe('Surah Al-Baqarah, Ayah 255 - Fortress of Muslim');
    expect(tag(html, /<link rel="canonical" href="([^"]*)">/)).toBe(`${ORIGIN}/quran/2/255`);
  });

  it('is a 404 past the end of a surah, or for a surah that does not exist', async () => {
    expect((await get('/quran/1/8')).status).toBe(404);
    expect((await get('/quran/115/1')).status).toBe(404);
  });
});

describe('every page in the sitemap', () => {
  it('is served with its own canonical, never the home page', async () => {
    const paths = [...SITEMAP.matchAll(/<loc>https:\/\/fortressofmuslim\.org([^<]*)<\/loc>/g)].map((match) => match[1]);
    expect(paths.length).toBe(247);
    const titles = new Set();
    for (const path of paths.filter((candidate) => candidate !== '/')) {
      const { status, html } = await get(path);
      expect(status, path).toBe(200);
      expect(tag(html, /<link rel="canonical" href="([^"]*)">/), path).toBe(`${ORIGIN}${path}`);
      titles.add(tag(html, /<title>([^<]*)<\/title>/));
    }
    expect(titles.size).toBe(paths.length - 1);
  });

  it('leaves the home page and the hadith routes as the plain shell', async () => {
    const home = await get('/');
    expect(home.html).not.toContain('id="prerender"');
    expect(tag(home.html, /<link rel="canonical" href="([^"]*)">/)).toBe(`${ORIGIN}/`);
    const hadith = await get('/bukhari/book1/1');
    expect(hadith.status).toBe(200);
    expect(hadith.html).not.toContain('id="prerender"');
  });
});
