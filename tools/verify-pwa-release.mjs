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
for (const icon of manifest.icons) await access(join(root, icon.src));

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

const shellBytes = await directoryBytes(join(root, 'js')) + await directoryBytes(join(root, 'css'))
  + (await stat(join(root, 'styles.css'))).size;
if (shellBytes > 250_000) throw new Error(`PWA JavaScript and CSS shell exceeds 250 KB (${shellBytes} bytes).`);

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
