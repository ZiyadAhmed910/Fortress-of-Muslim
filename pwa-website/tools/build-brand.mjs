// Rebuild the PWA brand assets from one vector source. No runtime drawing dependency.
// Run: node pwa-website/tools/build-brand.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const output = new URL('../icons/', import.meta.url);
await mkdir(output, { recursive: true });
async function writeAsset(name, content) {
  const path = new URL(name, output);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const existing = await readFile(path).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  // Avoid rewriting unchanged files held open by a Windows image preview or browser.
  if (!existing?.equals(bytes)) await writeFile(path, bytes);
}
const crescent = 'M64.26 17.06A45 45 0 1 0 106.94 59.74A40 40 0 1 1 64.26 17.06Z';
const star = 'M94 24L97 31 104 34 97 37 94 44 91 37 84 34 91 31Z';
const gate = 'M65 74V63C65 53 74 50 78 44C82 50 91 53 91 63V74H84V63C84 59 80 57 78 55C76 57 72 59 72 63V74Z';

// Canvas PNGs favor encoding speed. Recompress their scanlines losslessly for the offline cache.
function compressPng(png) {
  const before = [], after = [], data = [];
  let seenData = false;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const chunk = png.subarray(offset, offset + length + 12);
    if (chunk.toString('ascii', 4, 8) === 'IDAT') {
      data.push(chunk.subarray(8, 8 + length)); seenData = true;
    } else (seenData ? after : before).push(chunk);
    offset += length + 12;
  }
  const payload = deflateSync(inflateSync(Buffer.concat(data)), { level: 9 });
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length); chunk.write('IDAT', 4); payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, 8), ...before, chunk, ...after]);
}

function svg({ simple = false, square = false, maskable = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Fortress of Muslim">
  <defs>
    <linearGradient id="teal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#245d60"/><stop offset=".55" stop-color="#113f45"/><stop offset="1" stop-color="#092c35"/></linearGradient>
    <linearGradient id="gold" x1=".15" y1="0" x2=".75" y2="1"><stop stop-color="#fff0c5"/><stop offset=".45" stop-color="#e7c581"/><stop offset="1" stop-color="#bd8c4e"/></linearGradient>
  </defs>
  <rect width="128" height="128" rx="${square ? 0 : 28}" fill="url(#teal)"/>
  ${simple || square ? '' : '<rect x="2" y="2" width="124" height="124" rx="26" fill="none" stroke="#f3dbac" stroke-opacity=".18"/>'}
  <g transform="translate(64 64) scale(${maskable ? .84 : .92}) translate(-64 -64)" fill="${simple ? '#f3d99e' : 'url(#gold)'}">
    <path d="${crescent}"/>
    <path d="${star}"/>
    ${simple ? '' : `<path d="${gate}"/>`}
  </g>
</svg>\n`.replace(/^[ \t]+$/gm, '');
}

await writeAsset('logo.svg', svg());
await writeAsset('favicon.svg', svg({ simple: true }));
await writeAsset('icon-maskable.svg', svg({ square: true, maskable: true }));

const browser = await chromium.launch({
  executablePath: process.env.EDGE_EXECUTABLE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const page = await browser.newPage();
  const favicons = [];
  for (const [name, size, options] of [
    ['icon-192.png', 192, {}], ['icon-512.png', 512, {}],
    ['icon-maskable-192.png', 192, { square: true, maskable: true }],
    ['icon-maskable-512.png', 512, { square: true, maskable: true }],
    ['apple-touch-icon.png', 180, { square: true }],
    ['favicon-16.png', 16, { simple: true }], ['favicon-32.png', 32, { simple: true }],
  ]) {
    const data = await page.evaluate(async ({ markup, size }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { markup: svg(options), size });
    const png = compressPng(Buffer.from(data, 'base64'));
    await writeAsset(name, png);
    if (size <= 32) favicons.push({ size, png });
  }
  // ICO directory containing the same small PNG renditions for legacy favicon consumers.
  const header = Buffer.alloc(6 + favicons.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(favicons.length, 4);
  let offset = header.length;
  favicons.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeAsset('favicon.ico', Buffer.concat([header, ...favicons.map(({ png }) => png)]));
} finally {
  await browser.close();
}
console.log(`Brand assets written to ${fileURLToPath(output)}`);
