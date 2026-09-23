// Copies what the public site serves into pwa-website/dist, for Cloudflare to publish.
//
// Run after tools/stamp_version.py, so dist holds the stamped build. What is left out is the same
// list the Bluehost FTP deploy excludes -- development files, tests, tooling -- plus the Cloudflare
// hosting files themselves. On Bluehost .htaccess also had to deny these, because files once
// uploaded stayed on disk; here anything not copied simply does not exist on the site.

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');

// Top-level entries that are never published.
const EXCLUDED_TOP = new Set([
  'dist', 'edge', 'node_modules', 'test', 'tools',
  '.htaccess', 'README.md', 'package.json', 'package-lock.json', 'serve.py',
  'vitest.config.js', 'visualize.html', 'visualize.css', 'wrangler.jsonc', 'wrangler.ci.jsonc',
]);

export function isPublished(path) {
  const parts = path.split(/[\\/]/);
  if (EXCLUDED_TOP.has(parts[0])) return false;
  if (parts.some((part) => part.startsWith('.git') || part === '.DS_Store')) return false;
  return !/\.test\.js$/.test(path);
}

async function copyTree(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const source = join(dir, entry.name);
    const path = relative(ROOT, source).split(sep).join('/');
    if (!isPublished(path)) continue;
    if (entry.isDirectory()) {
      const inner = await copyTree(source);
      files += inner.files;
      bytes += inner.bytes;
    } else {
      await mkdir(dirname(join(OUT, path)), { recursive: true });
      await cp(source, join(OUT, path));
      files += 1;
      bytes += (await stat(source)).size;
    }
  }
  return { files, bytes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await rm(OUT, { recursive: true, force: true });
  const { files, bytes } = await copyTree(ROOT);
  console.log(`dist: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
}
