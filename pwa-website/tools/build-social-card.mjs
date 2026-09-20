// Builds icons/social-card.png -- the image shown when a link to the site is shared.
//
//   node pwa-website/tools/build-social-card.mjs
//
// 1200x630 because that is what Open Graph consumers expect: below it, Facebook, LinkedIn, Slack
// and iMessage fall back to a small square thumbnail or to nothing, which is how a shared link ends
// up looking broken. The SVG is written here rather than kept as an asset so the wording stays in
// one place with the meta tags it mirrors, and so a change to either is a change to a text file
// somebody can review.
//
// PNG rather than SVG: almost no social platform renders an SVG passed as og:image.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const WIDTH = 1200;
const HEIGHT = 630;

const escapeXml = (value) => value.replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
));

const headline = 'Fortress of Muslim';
const eyebrow = 'FREE  ·  AD-FREE  ·  WORKS OFFLINE';
const body = [
  'The Quran with tajweed and translation, authentic duas',
  'from Hisn al-Muslim, hadith, prayer times and qibla.',
];
const domain = 'fortressofmuslim.org';

// System fonts only: sharp rasterises with whatever fontconfig offers, and a webfont referenced here
// would silently not load and fall back anyway. The stack is ordered for the machines this actually
// runs on.
const FONT = "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="glow" cx="0.88" cy="-0.08" r="0.92">
      <stop offset="0%" stop-color="#6fb6e8" stop-opacity="0.30"/>
      <stop offset="62%" stop-color="#6fb6e8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="deep" cx="0.04" cy="1.08" r="0.78">
      <stop offset="0%" stop-color="#177884" stop-opacity="0.34"/>
      <stop offset="60%" stop-color="#177884" stop-opacity="0"/>
    </radialGradient>
    <mask id="crescent">
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#000"/>
      <circle cx="1038" cy="162" r="52" fill="#fff"/>
      <circle cx="1060" cy="152" r="45" fill="#000"/>
    </mask>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="#071827"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#deep)"/>
  <circle cx="1038" cy="162" r="52" fill="#6fb6e8" mask="url(#crescent)"/>

  <text x="88" y="218" font-family="${FONT}" font-size="21" font-weight="600"
        letter-spacing="5" fill="#7fc3e8">${escapeXml(eyebrow)}</text>

  <text x="88" y="310" font-family="${FONT}" font-size="84" font-weight="700"
        letter-spacing="-1.8" fill="#eaf3fa">${escapeXml(headline)}</text>

  ${body.map((line, index) => `<text x="88" y="${372 + index * 44}" font-family="${FONT}" font-size="31"
        fill="#b7d6ea">${escapeXml(line)}</text>`).join('\n  ')}

  <rect x="88" y="474" width="96" height="6" rx="3" fill="#6fb6e8"/>

  <text x="88" y="${HEIGHT - 56}" font-family="${FONT}" font-size="24" font-weight="600"
        fill="#8fb6cd">${escapeXml(domain)}</text>
</svg>`;

const output = new URL('../icons/social-card.png', import.meta.url);
const info = await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9, palette: false })
  .toFile(fileURLToPath(output));

console.log(`Wrote ${fileURLToPath(output)}`);
console.log(`  ${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
if (info.width !== WIDTH || info.height !== HEIGHT) {
  console.error('  Wrong size -- Open Graph consumers need exactly 1200x630.');
  process.exit(1);
}
