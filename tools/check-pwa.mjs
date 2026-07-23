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
  await page.evaluate(() => localStorage.setItem('advancedUi', 'true'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-advanced-filter="all"]').click();
  await page.locator('.dua-row').first().waitFor();
  await assertMobileAccessibility(page);
  await assertPerformanceBudget(page);
  await page.screenshot({ path: join(output, 'pwa-mobile.png'), fullPage: true });

  await page.locator('[data-content-mode="hadith"]').click();
  await page.locator('.hadith-row').first().waitFor({ timeout: 20_000 });
  await assertDuaContentHidden(page, 'Hadith');
  await page.screenshot({ path: join(output, 'pwa-hadith-mobile.png'), fullPage: true });

  await page.locator('[data-content-mode="ask"]').click();
  await page.locator('#assistantQuestion').waitFor();
  await assertDuaContentHidden(page, 'Ask');
  await page.screenshot({ path: join(output, 'pwa-ask-mobile.png'), fullPage: true });

  await page.locator('[data-content-mode="duas"]').click();
  await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Service worker did not become ready.')), 15_000)),
  ]));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-advanced-filter="all"]').click();
  await page.locator('.dua-row').first().waitFor();

  await context.setOffline(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('[data-advanced-filter="all"]').click();
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

async function assertDuaContentHidden(page, mode) {
  const visibleDuaSections = await page.locator('#advancedHome:visible, #simpleHome:visible').count();
  if (visibleDuaSections !== 0) {
    throw new Error(`${mode} mode still shows content from the Duas section.`);
  }
}

async function assertMobileAccessibility(page) {
  const audit = await page.evaluate(() => {
    const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      });
    const unnamed = interactive.filter((element) => {
      const labels = 'labels' in element ? [...element.labels].map((label) => label.textContent).join(' ') : '';
      return !(element.getAttribute('aria-label') || element.getAttribute('title') || labels || element.textContent?.trim());
    }).map((element) => element.outerHTML.slice(0, 120));
    const undersized = interactive.filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width < 24 || box.height < 24;
    }).map((element) => element.outerHTML.slice(0, 120));
    return {
      unnamed,
      undersized,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (audit.unnamed.length) throw new Error(`Visible controls without accessible names: ${audit.unnamed.join(', ')}`);
  if (audit.undersized.length) throw new Error(`Visible controls smaller than 24px: ${audit.undersized.join(', ')}`);
  if (audit.overflow > 1) throw new Error(`Mobile layout overflows horizontally by ${audit.overflow}px.`);
}

async function assertPerformanceBudget(page) {
  const resources = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => /\.(?:js|css)(?:\?|$)/.test(entry.name))
    .reduce((total, entry) => total + (entry.decodedBodySize || entry.transferSize || 0), 0));
  if (resources > 250_000) throw new Error(`Initial JavaScript and CSS exceeded 250 KB (${resources} bytes).`);
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
