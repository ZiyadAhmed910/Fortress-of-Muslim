// Builds sitemap.xml from the app's own data, so the list cannot drift from what the app has.
//
//   node pwa-website/tools/build-sitemap.mjs
//
// What goes in, and what deliberately does not
// --------------------------------------------
// This app renders on the client. Every URL below is served the identical HTML shell by the
// catch-all rewrite in .htaccess, and the thing that makes one different from another only exists
// after JavaScript runs. Search engines that render JavaScript will see the difference; the rest
// see one page repeated.
//
// That shapes what is worth listing. A sitemap naming 6,236 ayah URLs would be asking a crawler to
// fetch 6,236 copies of the same shell, which spends crawl budget to produce near-duplicates and
// makes the site look thinner rather than larger. So the entry point of each surah is listed --
// 114 pages, each a real destination a person might search for by name -- and individual ayahs are
// not. Duas are listed for the same reason: 132 of them, each with its own title.
//
// Hadith is left out entirely. Those records are served from the API rather than shipped with the
// app, the corpus is deliberately not part of this repository, and 14,357 identical shells is the
// clearest possible case of the problem above.
//
// The real fix for all of this is server-rendered or prerendered pages, at which point this file
// should grow. Until then it lists what can honestly be called a distinct page.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const site = 'https://fortressofmuslim.org';
const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

const quran = readJson('data/quran/index.json');
const duas = readJson('data/duas.json');

// Lastmod is the date the content was generated, not today: claiming a page changed when it did not
// teaches a crawler to stop believing the field.
const lastmod = new Date().toISOString().slice(0, 10);

const urls = [
  { loc: `${site}/`, priority: '1.0', changefreq: 'weekly' },
];

for (const surah of quran.surahs) {
  urls.push({
    loc: `${site}/quran/${surah.number}/1`,
    priority: '0.8',
    changefreq: 'yearly',
  });
}

for (const entry of duas.entries) {
  const sequence = Number(entry.sequence);
  if (!Number.isInteger(sequence)) continue;
  urls.push({
    loc: `${site}/hisn/chapter${sequence}`,
    priority: '0.7',
    changefreq: 'yearly',
  });
}

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(({ loc, priority, changefreq }) => [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n')),
  '</urlset>',
  '',
].join('\n');

const output = new URL('sitemap.xml', root);
writeFileSync(output, xml);
console.log(`Wrote ${fileURLToPath(output)}`);
console.log(`  ${urls.length} URLs: 1 home, ${quran.surahs.length} surahs, ${urls.length - 1 - quran.surahs.length} duas`);
console.log('  Individual ayahs and hadith are deliberately excluded -- see the comment at the top.');
