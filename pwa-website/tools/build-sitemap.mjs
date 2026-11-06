// Builds the sitemaps from the app's own data and the production API, so the lists cannot drift
// from what the site serves.
//
//   node pwa-website/tools/build-sitemap.mjs
//
// sitemap.xml is an index (robots.txt names it) of:
//   sitemap-pages.xml               the home page, the 114 surahs and the 132 duas
//   sitemap-hadith-<collection>.xml every hadith in that collection, read from the production API
//
// Every one of these URLs is served with its own title, canonical and text before any JavaScript
// runs (edge/pages.js); until that existed each was the same app shell, which is why this file once
// listed surahs and duas only and left hadith out. Individual ayahs are still not listed: each
// surah's page carries the whole surah, and 6,236 ayah pages would mostly repeat it.
//
// lastmod is when the content last changed -- the last commit to the data file for a surah or dua,
// the publication date for a hadith -- never the day this ran. A sitemap that claims everything
// changed every time it is built teaches a crawler to ignore the field.
//
// The hadith corpus is not in this repository, so building needs the network. Run it again after a
// hadith publication, and commit the result.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const site = 'https://fortressofmuslim.org';
const api = 'https://api.fortressofmuslim.org';
const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

// The date (YYYY-MM-DD) of the last commit that touched a file, or undefined if git cannot say.
function committed(path) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', path], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const latest = (dates) => dates.filter(Boolean).sort().at(-1);

function urlset(urls) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(({ loc, lastmod }) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`),
    '</urlset>',
    '',
  ].join('\n');
}

// The API answers the odd request with a 500 under a burst of 140 pages; a retry gets it.
async function getJson(url) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (response.ok) return response.json();
    if (attempt === 5) throw new Error(`${url}: HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

// --- Pages shipped with the app ----------------------------------------------------------------

const quran = readJson('data/quran/index.json');
const duas = readJson('data/duas.json');
const duasDate = committed('data/duas.json');

const pages = [{ loc: `${site}/`, lastmod: committed('index.html') }];
for (const surah of quran.surahs) {
  pages.push({ loc: `${site}/quran/${surah.number}/1`, lastmod: committed(`data/quran/surah-${surah.number}.json`) });
}
for (const entry of duas.entries) {
  const sequence = Number(entry.sequence);
  if (Number.isInteger(sequence)) pages.push({ loc: `${site}/hisn/chapter${sequence}`, lastmod: duasDate });
}

const sitemaps = [{ file: 'sitemap-pages.xml', urls: pages }];

// --- Hadith, from the API ----------------------------------------------------------------------

const collections = (await getJson(`${api}/v1/collections`)).data.filter((collection) => collection.contentType === 'hadith');
for (const collection of collections) {
  const urls = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ collection: collection.slug, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await getJson(`${api}/v1/hadith?${query}`);
    for (const hadith of page.data) {
      if (!hadith.canonicalUrl?.startsWith(`${site}/`)) continue;
      urls.push({ loc: hadith.canonicalUrl, lastmod: hadith.publishedAt?.slice(0, 10) });
    }
    cursor = page.pagination?.nextCursor ?? '';
  } while (cursor);
  if (urls.length !== collection.recordCount) {
    throw new Error(`${collection.slug}: the API lists ${urls.length} hadith but counts ${collection.recordCount}`);
  }
  sitemaps.push({ file: `sitemap-hadith-${collection.slug}.xml`, urls });
}

// --- Write --------------------------------------------------------------------------------------

// A collection that is gone should not leave its old file behind, still listed nowhere.
for (const name of readdirSync(root)) {
  if (/^sitemap-.*\.xml$/.test(name) && !sitemaps.some(({ file }) => file === name)) unlinkSync(new URL(name, root));
}
for (const { file, urls } of sitemaps) writeFileSync(new URL(file, root), urlset(urls));

writeFileSync(new URL('sitemap.xml', root), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemaps.map(({ file, urls }) => {
    const lastmod = latest(urls.map((url) => url.lastmod));
    return `  <sitemap><loc>${site}/${file}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`;
  }),
  '</sitemapindex>',
  '',
].join('\n'));

for (const { file, urls } of sitemaps) console.log(`  ${file}: ${urls.length} URLs`);
console.log(`Wrote sitemap.xml, an index of ${sitemaps.length} sitemaps, ${sitemaps.reduce((sum, { urls }) => sum + urls.length, 0)} URLs`);
