// Splits a content bundle into ordered parts small enough for D1 to accept.
//
//   node apps/api/tools/split-content-bundle.mjs .fortress-import/content-bundle-<digest>.sql
//   node apps/api/tools/split-content-bundle.mjs <bundle> --max-mb=20
//
// A full bundle is around 140 MB and 325,000 statements, which is more than one `wrangler d1
// execute --file` will take. This cuts it into numbered parts that are applied in order.
//
// Order is the whole point, and the parts are not interchangeable:
//
//   - The statements are already sequenced so every foreign key is satisfied as rows land. Cutting
//     the file preserves that only if the parts go in the order they were written, so they are
//     numbered and each carries a header saying which it is.
//   - Part 1 must carry the preamble that frees the single active-dataset slot (idx_dataset_active
//     is a partial unique index permitting exactly one active dataset). Without it, every hadith
//     fails a foreign key to a dataset that was never allowed to land.
//   - The last part must carry the closing UPDATEs that set each dataset's real publication status.
//     Until those run the corpus is present but the wrong dataset is active, so the API serves the
//     old one and everything looks like it did nothing.
//
// Both of those fall out of splitting on statement boundaries in order and never reordering, which
// is all this does -- but they are the reason it must not do anything cleverer.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const input = process.argv[2];
if (!input) {
  console.error('Usage: node apps/api/tools/split-content-bundle.mjs <bundle.sql> [--max-mb=20]');
  process.exit(2);
}
const maxMatch = process.argv.find((value) => value.startsWith('--max-mb='));
const maxBytes = (maxMatch ? Number(maxMatch.slice('--max-mb='.length)) : 20) * 1024 * 1024;

const inputPath = resolve(repositoryRoot, input);
const outputDir = dirname(inputPath);
const stem = basename(inputPath).replace(/\.sql$/, '');
mkdirSync(outputDir, { recursive: true });

const header = (part, total) => [
  `-- ${stem} -- part ${part}${total ? ` of ${total}` : ''}.`,
  '--',
  '-- Apply the parts IN ORDER, to a database that has already had every migration run against it.',
  '-- Part 1 frees the active-dataset slot and the final part sets the real dataset statuses, so a',
  '-- partial application leaves the corpus present but not yet served. Re-running any part is a',
  '-- no-op; if one fails, re-run that part and continue.',
  '',
  '',
].join('\n');

const parts = [];
let buffer = [];
let size = 0;

const flush = () => {
  if (!buffer.length) return;
  parts.push(buffer.join('\n'));
  buffer = [];
  size = 0;
};

const rl = createInterface({ input: createReadStream(inputPath, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  // Comment and blank lines from the original header are dropped: each part gets its own.
  if (!line.trim() || line.startsWith('--')) continue;
  const bytes = Buffer.byteLength(line, 'utf8') + 1;
  // Cut before the line that would overflow, never mid-statement. Every statement in a bundle is a
  // single line, which is what makes a line-wise split safe here.
  if (size + bytes > maxBytes && buffer.length) flush();
  buffer.push(line);
  size += bytes;
}
flush();

const total = parts.length;
const written = [];
parts.forEach((body, index) => {
  const number = String(index + 1).padStart(2, '0');
  const path = resolve(outputDir, `${stem}.part${number}.sql`);
  writeFileSync(path, `${header(index + 1, total)}${body}\n`);
  written.push(path);
});

const statements = parts.reduce((sum, part) => sum + part.split('\n').filter(Boolean).length, 0);
console.log(`Split into ${total} part(s), ${statements} statements total:\n`);
for (const path of written) {
  const { size: bytes } = await import('node:fs').then((fs) => fs.statSync(path));
  console.log(`  ${basename(path)}  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}
console.log('\nApply in order:');
for (const path of written) {
  console.log(`  npx wrangler d1 execute <database> --remote --yes --file=${path.replace(repositoryRoot + '\\', '').replaceAll('\\', '/')}`);
}
