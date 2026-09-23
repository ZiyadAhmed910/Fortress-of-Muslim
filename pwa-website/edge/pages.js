// Gives each content URL its own HTML, before any JavaScript runs.
//
// The app renders on the client, so every route used to be answered with the same index.html: the
// home page's title and description, and a canonical link pointing at the home page. That is what a
// crawler reads first, and to it the 246 dua and surah pages in sitemap.xml were 246 copies of the
// home page -- Search Console listed them as "Discovered - currently not indexed", and the one it did
// crawl as a duplicate whose canonical Google chose itself. js/seo.js corrects all of this at
// runtime, but only for a crawler that runs the app.
//
// So for a dua (/hisn/chapter<n>) and a verse (/quran/<surah>/<ayah>) this fills in, from the same
// data files the app reads: the title, description, canonical and social tags, and the text itself
// in an <article id="prerender"> the app removes as it starts (js/app.js). A URL naming a dua or
// verse that does not exist is a 404 rather than an empty shell. Hadith are served by the API, not
// from these files, and keep the plain shell.
//
// Plain string replacement, not HTMLRewriter: index.html is ours and its tags are fixed, and this
// way the whole thing runs -- and is tested -- outside the Workers runtime.

const SITE = 'Fortress of Muslim';
const ORIGIN = 'https://fortressofmuslim.org';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function summary(text, limit = 155) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : limit).replace(/[,;:.\s]+$/, '')}…`;
}

const arabic = (text) => `<p lang="ar" dir="rtl">${escapeHtml(text)}</p>`;

async function duaPage(sequence, load) {
  const data = await load('/data/duas.json');
  const entry = data?.entries?.find((candidate) => Number(candidate.sequence ?? candidate.number) === sequence);
  if (!entry) return null;
  const segments = entry.parts.flat();
  const translation = segments.find((segment) => segment.kind === 'translation')?.text;
  const body = entry.parts.map((part) => `<section>${part.map((segment) => (
    /[؀-ۿ]/.test(segment.text) ? arabic(segment.text) : `<p>${escapeHtml(segment.text)}</p>`
  )).join('')}</section>`).join('');
  return {
    title: `${entry.id}. ${entry.title}`,
    description: summary(translation ? `${entry.title}: ${translation}` : `${entry.title}, from Hisn al-Muslim.`),
    path: `/hisn/chapter${sequence}`,
    body: `<h2>${escapeHtml(`${entry.id}. ${entry.title}`)}</h2>${entry.titleArabic ? arabic(entry.titleArabic) : ''}${body}`,
  };
}

async function versePage(surahNumber, ayahNumber, load) {
  if (surahNumber < 1 || surahNumber > 114) return null;
  const surah = await load(`/data/quran/surah-${surahNumber}.json`);
  if (!surah || ayahNumber < 1 || ayahNumber > surah.ayahCount) return null;
  const name = `Surah ${surah.nameSimple} (${surah.nameEnglish})`;
  const ayah = (item) => `${arabic(`${item.ar} ﴿${item.n}﴾`)}<p>${escapeHtml(item.en)}</p>`;
  const place = surah.revelationPlace === 'madinah' ? 'Madinah' : 'Makkah';
  if (ayahNumber === 1) {
    // The first ayah's URL is the surah's page -- it is the one sitemap.xml lists -- so it carries
    // the whole surah.
    return {
      title: name,
      description: summary(`${name}, ${surah.ayahCount} ayahs, revealed in ${place}. Arabic with English translation, tajweed and recitation. ${surah.ayahs[0].en}`),
      path: `/quran/${surahNumber}/1`,
      body: `<h2>${escapeHtml(name)}</h2>${arabic(surah.nameArabic)}${surah.ayahs.map(ayah).join('')}`,
    };
  }
  const item = surah.ayahs[ayahNumber - 1];
  return {
    title: `Surah ${surah.nameSimple}, Ayah ${ayahNumber}`,
    description: summary(`${surah.nameSimple} ${surahNumber}:${ayahNumber} — ${item.en}`),
    path: `/quran/${surahNumber}/${ayahNumber}`,
    body: `<h2>${escapeHtml(`Surah ${surah.nameSimple}, Ayah ${ayahNumber}`)}</h2>${ayah(item)}`,
  };
}

/**
 * The page for a content URL: an object to render, null for a dua or verse that does not exist
 * (a 404), or undefined for any other URL (the plain app shell).
 */
export async function pageFor(pathname, load) {
  const path = pathname.replace(/\/+$/, '');
  const dua = path.match(/^\/hisn\/chapter([0-9]{1,4})$/);
  if (dua) return duaPage(Number(dua[1]), load);
  const verse = path.match(/^\/quran\/([0-9]{1,3})\/([0-9]{1,3})$/);
  if (verse) return versePage(Number(verse[1]), Number(verse[2]), load);
  return undefined;
}

function replaceTag(html, pattern, replacement) {
  if (!pattern.test(html)) throw new Error(`index.html is missing ${pattern}`);
  return html.replace(pattern, replacement);
}

/** index.html with the page's own head tags and its text. */
export function applyPage(html, page) {
  const title = escapeHtml(`${page.title} - ${SITE}`);
  const description = escapeHtml(page.description);
  const url = `${ORIGIN}${page.path}`;
  let out = html;
  out = replaceTag(out, /<title>[^<]*<\/title>/, `<title>${title}</title>`);
  out = replaceTag(out, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${description}">`);
  out = replaceTag(out, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
  out = replaceTag(out, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`);
  out = replaceTag(out, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${description}">`);
  out = replaceTag(out, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
  out = replaceTag(out, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${title}">`);
  out = replaceTag(out, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${description}">`);
  // The page has one main heading, and it should name the page: the app header's <h1> said "Fortress
  // of Muslim" on every URL, so it carries the page's title here (the app sets the same on start)
  // and the text below uses <h2>.
  out = replaceTag(out, /<h1 id="screenTitle">[^<]*<\/h1>/, `<h1 id="screenTitle">${escapeHtml(page.title)}</h1>`);
  out = replaceTag(out, /<main>/, `<main>\n        <article id="prerender" class="prerender">${page.body}</article>`);
  return out;
}
