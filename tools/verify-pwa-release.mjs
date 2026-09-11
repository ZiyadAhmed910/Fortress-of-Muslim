import { access, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'pwa-website');
const [manifestText, serviceWorker, html, apacheConfig] = await Promise.all([
  readFile(join(root, 'manifest.json'), 'utf8'),
  readFile(join(root, 'sw.js'), 'utf8'),
  readFile(join(root, 'index.html'), 'utf8'),
  readFile(join(root, '.htaccess'), 'utf8'),
]);
const manifest = JSON.parse(manifestText);
if (manifest.display !== 'standalone') throw new Error('PWA manifest must use standalone display mode.');
if (!manifest.start_url || !manifest.scope) throw new Error('PWA manifest requires start_url and scope.');
if (!Array.isArray(manifest.icons) || !manifest.icons.some((icon) => icon.sizes === '192x192')
  || !manifest.icons.some((icon) => icon.sizes === '512x512')) {
  throw new Error('PWA manifest requires 192px and 512px install icons.');
}
for (const icon of manifest.icons) await access(join(root, icon.src.split('?')[0]));

const assetBlock = serviceWorker.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1];
if (!assetBlock) throw new Error('Service worker precache manifest was not found.');
const assets = [...assetBlock.matchAll(/['`](\.\/[^'`]+)['`]/g)]
  .map((match) => match[1].split('?')[0]);
for (const asset of new Set(assets)) {
  const path = asset === './' ? './index.html' : asset;
  await access(normalize(join(root, path)));
}
for (const required of ['SKIP_WAITING', "event.request.mode === 'navigate'", 'response.ok']) {
  if (!serviceWorker.includes(required)) throw new Error(`Service worker is missing ${required}.`);
}
if (!/<Files "sw\.js">[\s\S]*?no-store, no-cache, must-revalidate[\s\S]*?<\/Files>/.test(apacheConfig)) {
  throw new Error('Bluehost must force immediate service-worker revalidation.');
}

// The point of this ceiling is not that anything breaks above it -- it is to make weight visible at
// the moment it is added, so "this feature costs 3KB, is it worth it?" gets asked at all. Nobody
// notices 3KB; everybody notices 300KB two years later, when unwinding it means removing features
// people use.
//
// Raised 250 -> 300KB in 0.24.0 after Quran recitation, word-by-word mode and the walkthrough. The
// agreed escalation from here: 500KB next time it is reached, and if it is reached again, stop
// raising it and add a minification step at deploy instead.
//
// Two known weaknesses, worth fixing before the next raise rather than at it:
//   - It counts raw bytes, so comments count against you. Measured at 0.24.0, comments are 38.6KB
//     raw but 18.3KB gzipped -- a larger share after compression, since code compresses harder than
//     prose. This repo deliberately writes explanatory comments, so the metric taxes documentation.
//   - It covers the shell only. data/duas.json is precached on install and costs about as much
//     again (377KB raw, 77KB gzipped against the shell's 78KB), and nothing watches it.
// Measuring gzipped bytes across everything precached would fix both.
const SHELL_BUDGET_BYTES = 300_000;
const shellBytes = await directoryBytes(join(root, 'js')) + await directoryBytes(join(root, 'css'))
  + (await stat(join(root, 'styles.css'))).size;
if (shellBytes > SHELL_BUDGET_BYTES) {
  throw new Error(`PWA JavaScript and CSS shell exceeds ${SHELL_BUDGET_BYTES / 1000} KB (${shellBytes} bytes).`);
}

if (!html.includes('name="viewport"')) throw new Error('PWA viewport metadata is missing.');
if (!html.includes('aria-live=')) throw new Error('PWA needs an aria-live status region.');
if (/<img(?![^>]*\balt=)[^>]*>/i.test(html)) throw new Error('Every PWA image must include alt text.');

console.log(`Verified PWA install metadata, ${new Set(assets).size} precached assets, accessibility basics, and ${shellBytes} shell bytes.`);

async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
  }
  return total;
}
