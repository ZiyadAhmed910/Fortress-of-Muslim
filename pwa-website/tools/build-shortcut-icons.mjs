// Builds the icons for the install shortcuts -- the menu an installed app shows on long-press
// (Android) or right-click (desktop).
//
//   node pwa-website/tools/build-shortcut-icons.mjs
//
// Each shortcut gets its own glyph rather than the app's logo. Four identical logos in a four-item
// menu would make the icons carry no information at all, and the menu is small enough that the
// icon is most of what a reader scans. The glyphs are the same ones the app's own navigation draws
// for these screens, so a shortcut looks like the button it stands in for; the colours are the
// brand's (tools/build-brand.mjs) so they still read as this app.
//
// 96 and 192 pixels: 96 is what the manifest spec suggests, and 192 is what a high-density screen
// actually requests for a 96dp slot. The padding keeps the glyph inside the safe zone of a maskable
// circle, since some launchers crop shortcut icons exactly the way they crop the app icon.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Copied from the nav buttons in index.html, which is where they are drawn for these screens. Kept
// as stroke paths, the way the nav renders them, so the weight matches what people already see.
export const SHORTCUT_GLYPHS = {
  'prayer-times': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  qibla: '<path d="m12 2 2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2Z"/>',
  tasbih: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="1.6"/><circle cx="20" cy="12" r="1.6"/><circle cx="12" cy="20" r="1.6"/><circle cx="4" cy="12" r="1.6"/>',
  quran: '<path d="M12 6.5S9.5 4 6 4a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2c3.5 0 6 2.5 6 2.5"/><path d="M12 6.5S14.5 4 18 4a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2c-3.5 0-6 2.5-6 2.5"/><path d="M12 6.5V17"/>',
};

const svg = (glyph) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs>
    <radialGradient id="g" cx="0.3" cy="0.2" r="1">
      <stop offset="0" stop-color="#245d60"/>
      <stop offset="0.55" stop-color="#113f45"/>
      <stop offset="1" stop-color="#092c35"/>
    </radialGradient>
  </defs>
  <rect width="96" height="96" rx="22" fill="url(#g)"/>
  <g transform="translate(24 24) scale(2)" fill="none" stroke="#e7c581" stroke-width="1.7"
     stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>`;

const output = new URL('../icons/shortcuts/', import.meta.url);
mkdirSync(output, { recursive: true });

for (const [name, glyph] of Object.entries(SHORTCUT_GLYPHS)) {
  for (const size of [96, 192]) {
    const file = new URL(`${name}-${size}.png`, output);
    await sharp(Buffer.from(svg(glyph)), { density: size * 1.5 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(fileURLToPath(file));
  }
  console.log(`  ${name}: 96, 192`);
}
console.log(`Wrote ${fileURLToPath(output)}`);
