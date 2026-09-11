// Run from any directory: node pwa-website/tools/build-living-art.mjs
// Emit separate render modes: SVG image-fragment state is not reliable across browsers.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildExteriors } from './living-exteriors.mjs';
import { buildInteriors } from './living-interiors.mjs';

const output = new URL('../assets/cards/living/', import.meta.url);
// Keep the standalone gallery usable through file://, where external ES modules are blocked.
// Generate its inline classic script from the PWA controller so both use the same behavior.
const controller = readFileSync(new URL('../js/art-motion.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n').replace(/^export /gm, '');
if (/^\s*(?:import|export)\s/m.test(controller) || /<\/script/i.test(controller)) {
  throw new Error('The standalone artwork controller must remain self-contained and inline-safe.');
}
const galleryPath = new URL('../art-preview.html', import.meta.url);
const gallery = readFileSync(galleryPath, 'utf8');
const marker = /<!-- BEGIN GENERATED ART MOTION -->[\s\S]*?<!-- END GENERATED ART MOTION -->/;
if (!marker.test(gallery)) throw new Error('Gallery motion script markers are missing.');
writeFileSync(galleryPath, gallery.replace(marker, () => `<!-- BEGIN GENERATED ART MOTION -->
  <!-- Generated from js/art-motion.js by tools/build-living-art.mjs. Do not edit this block. -->
  <script>
  (() => {
${controller}
    initArtMotion();
  })();
  </script>
  <!-- END GENERATED ART MOTION -->`));
mkdirSync(output, { recursive: true });
for (const mode of ['full', 'still']) mkdirSync(new URL(`${mode}/`, output), { recursive: true });
const scenes = { ...buildExteriors(), ...buildInteriors() };
let bytes = 0;
let compressed = 0;
for (const [name, svg] of Object.entries(scenes)) {
  const rawSize = Buffer.byteLength(svg);
  const gzipSize = gzipSync(svg).byteLength;
  writeFileSync(new URL(`${name}.svg`, output), svg + '\n');
  for (const mode of ['full', 'still']) {
    let variant = svg.replace('data-motion="optimized"', `data-motion="${mode}"`);
    // <use> creates a shadow tree (the mosque reflection). Ancestor-based disabling rules do
    // not reliably reach it, so the Still file contains no animation declarations at all.
    if (mode === 'still') variant = variant.replace(/\banimation(?:-[a-z]+)?\s*:[^;}"']*;?/g, '');
    writeFileSync(new URL(`${mode}/${name}.svg`, output), variant + '\n');
  }
  bytes += rawSize;
  compressed += gzipSize;
  console.log(`${name.padEnd(14)} ${(rawSize / 1024).toFixed(1).padStart(6)} KB · gzip ${(gzipSize / 1024).toFixed(1)} KB`);
}
console.log(`Wrote ${Object.keys(scenes).length} scenes in Optimized, Full and Still modes to ${fileURLToPath(output)}. Each set: ${(bytes / 1024).toFixed(1)} KB raw / ${(compressed / 1024).toFixed(1)} KB gzip.`);
