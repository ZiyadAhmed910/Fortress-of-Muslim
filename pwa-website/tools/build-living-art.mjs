// Run from any directory: node pwa-website/tools/build-living-art.mjs
// Reference artwork stays untouched; only this collection's nine SVGs are generated.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildExteriors } from './living-exteriors.mjs';
import { buildInteriors } from './living-interiors.mjs';

const output = new URL('../assets/cards/living/', import.meta.url);
mkdirSync(output, { recursive: true });
const scenes = { ...buildExteriors(), ...buildInteriors() };
let bytes = 0;
let compressed = 0;
for (const [name, svg] of Object.entries(scenes)) {
  const rawSize = Buffer.byteLength(svg);
  const gzipSize = gzipSync(svg).byteLength;
  writeFileSync(new URL(`${name}.svg`, output), svg + '\n');
  bytes += rawSize;
  compressed += gzipSize;
  console.log(`${name.padEnd(14)} ${(rawSize / 1024).toFixed(1).padStart(6)} KB · gzip ${(gzipSize / 1024).toFixed(1)} KB`);
}
console.log(`Wrote ${Object.keys(scenes).length} scenes to ${fileURLToPath(output)} (${(bytes / 1024).toFixed(1)} KB raw / ${(compressed / 1024).toFixed(1)} KB gzip).`);
