import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../edge/worker.js';

// What a crawler receives for a content URL, before any JavaScript runs -- served by the real Worker
// from the real index.html and data files. Before this, every one of these was the home page's HTML
// with a canonical pointing at the home page, and Search Console listed 246 of them as "Discovered -
// currently not indexed".

const ROOT = process.cwd();
const ORIGIN = 'https://fortressofmuslim.org';
const SITEMAP = readFileSync(resolve(ROOT, 'sitemap-pages.xml'), 'utf8');

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

describe('the sitemap index', () => {
  const index = readFileSync(resolve(ROOT, 'sitemap.xml'), 'utf8');
  const files = [...index.matchAll(/<loc>https:\/\/fortressofmuslim\.org\/([^<]*)<\/loc>/g)].map((match) => match[1]);

  it('names the pages and every hadith collection, each a file that is published', () => {
    expect(index).toContain('<sitemapindex');
    expect(files).toContain('sitemap-pages.xml');
    expect(files.filter((file) => file.startsWith('sitemap-hadith-')).length).toBeGreaterThanOrEqual(3);
    for (const file of files) expect(existsSync(resolve(ROOT, file)), file).toBe(true);
  });

  it('lists hadith at the URL shape the Worker renders, each with the date it was published', () => {
    for (const file of files.filter((name) => name.startsWith('sitemap-hadith-'))) {
      const xml = readFileSync(resolve(ROOT, file), 'utf8');
      const urls = [...xml.matchAll(/<url><loc>https:\/\/fortressofmuslim\.org(\/[^<]*)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)];
      expect(urls.length, file).toBe((xml.match(/<url>/g) || []).length);
      for (const [, path] of urls) expect(path, file).toMatch(/^\/[a-z0-9-]+\/book[^/]+\/[^/]+$/);
    }
  });

  it('dates the pages by when their content changed, not by when it was built', () => {
    const dates = new Set([...SITEMAP.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((match) => match[1]));
    expect(dates.size).toBeGreaterThan(1);
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

  it('leaves the home page as the plain shell', async () => {
    const home = await get('/');
    expect(home.html).not.toContain('id="prerender"');
    expect(tag(home.html, /<link rel="canonical" href="([^"]*)">/)).toBe(`${ORIGIN}/`);
  });
});

describe('a hadith page', () => {
  // The API, stubbed: Bukhari 1 exists, Bukhari 99999 does not, and "outage" stands for an API that
  // cannot be reached at all.
  const HADITH = {
    title: 'Sahih al-Bukhari 1', canonicalUrl: 'https://fortressofmuslim.org/bukhari/book1/1',
    collection: { slug: 'bukhari', title: 'Sahih al-Bukhari' }, book: { number: '1', title: 'Revelation' },
    chapter: { number: '1', title: 'How the Divine Revelation started' }, narrator: "Narrated 'Umar bin Al-Khattab:",
    grade: null, segments: [{ kind: 'arabic', text: 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ' }, { kind: 'translation', text: 'The reward of deeds depends upon the intentions.' }],
  };
  const api = vi.fn(async (url) => {
    const query = new URL(url).searchParams;
    if (query.get('collection') === 'outage') throw new Error('unreachable');
    if (query.get('collection') === 'bukhari' && query.get('number') === '1') return Response.json({ data: HADITH });
    return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  });
  beforeEach(() => vi.stubGlobal('fetch', api));
  afterEach(() => vi.unstubAllGlobals());

  it('has its own title, canonical, description and text', async () => {
    const { status, html } = await get('/bukhari/book1/1');
    expect(status).toBe(200);
    expect(tag(html, /<title>([^<]*)<\/title>/)).toBe('Sahih al-Bukhari 1 - Revelation - Fortress of Muslim');
    expect(tag(html, /<link rel="canonical" href="([^"]*)">/)).toBe(`${ORIGIN}/bukhari/book1/1`);
    expect(tag(html, /<meta name="description" content="([^"]*)">/)).toContain('The reward of deeds depends upon the intentions.');
    const article = tag(html, /<article id="prerender" class="prerender">([\s\S]*?)<\/article>/);
    expect(article).toContain('Book 1: Revelation');
    expect(article).toContain('lang="ar" dir="rtl"');
  });

  it('asks the production API for the production site', async () => {
    await get('/bukhari/book1/1');
    expect(String(api.mock.calls.at(-1)[0])).toMatch(/^https:\/\/api\.fortressofmuslim\.org\/v1\/hadith\/resolve\?collection=bukhari&book=1&number=1$/);
  });

  it('is a 404 when the API says there is no such hadith', async () => {
    expect((await get('/bukhari/book1/99999')).status).toBe(404);
  });

  it('falls back to the plain app, not a 404, when the API cannot be reached', async () => {
    const { status, html } = await get('/outage/book1/1');
    expect(status).toBe(200);
    expect(html).not.toContain('id="prerender"');
  });
});
