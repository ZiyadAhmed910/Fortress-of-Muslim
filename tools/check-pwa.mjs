import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = join(process.cwd(), 'pwa-website');
const output = join(process.cwd(), '.fortress-import');
const origin = 'http://test.fortress.local:8090';
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = normalize(join(root, requested));
  if (!file.startsWith(root)) return respond(response, 403, 'Forbidden');
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    respond(response, 404, 'Not found');
  }
});

await new Promise((resolve) => server.listen(8090, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: [
    '--host-resolver-rules=MAP test.fortress.local 127.0.0.1',
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
  ],
});

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('.dua-row').first().waitFor();
  await page.screenshot({ path: join(output, 'pwa-mobile.png'), fullPage: true });

  await page.locator('[data-content-mode="hadith"]').click();
  await page.locator('.hadith-row').first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(output, 'pwa-hadith-mobile.png'), fullPage: true });

  await page.locator('[data-content-mode="ask"]').click();
  await page.locator('#assistantQuestion').waitFor();
  await page.screenshot({ path: join(output, 'pwa-ask-mobile.png'), fullPage: true });

  await page.locator('[data-content-mode="duas"]').click();
  await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Service worker did not become ready.')), 15_000)),
  ]));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.dua-row').first().waitFor();

  await context.setOffline(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('.dua-row').first().waitFor();
  await page.screenshot({ path: join(output, 'pwa-desktop.png'), fullPage: true });
  console.log('PWA mobile, desktop, Hadith, Ask, and offline checks passed.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

function respond(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function contentType(file) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  })[extname(file)] ?? 'application/octet-stream';
}
