import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '..', '.fortress-import', 'living-art');
const names = ['all-duas', 'morning', 'evening', 'before-sleep', 'salah', 'travel', 'favourites', 'moods', 'ruqyah'];
const paths = names.map((name) => `/assets/cards/living/${name}.svg`);
const viewportSizes = [{ width: 390, height: 844 }, { width: 1440, height: 1000 }];
const executablePath = process.env.EDGE_EXECUTABLE_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// The application intentionally disables service workers on localhost. Use the same local-only
// hostname mapping as check-pwa.mjs so this check exercises the real production registration path.
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    const withinRoot = relative(root, file);
    if (withinRoot.startsWith('..') || isAbsolute(withinRoot)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

let browser;
try {
  await access(executablePath);
  await access(join(root, 'art-preview.html'));
  const sizes = await Promise.all(paths.map(async (path) => {
    const source = await readFile(join(root, path.slice(1)));
    return { name: path.split('/').pop(), bytes: source.length, gzipBytes: gzipSync(source).length };
  }));
  await mkdir(output, { recursive: true });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://test.fortress.local:${server.address().port}`;
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--host-resolver-rules=MAP test.fortress.local 127.0.0.1',
      `--unsafely-treat-insecure-origin-as-secure=${origin}`,
    ],
  });

  const artwork = await newContext(origin, { serviceWorkers: 'block', viewport: viewportSizes[1] });
  const scenePage = await artwork.newPage();
  for (const path of paths) {
    await scenePage.emulateMedia({ reducedMotion: 'no-preference' });
    const response = await scenePage.goto(`${origin}${path}`, { waitUntil: 'load' });
    assert.equal(response.status(), 200, `${path}: HTTP response`);
    assert.match(response.headers()['content-type'], /^image\/svg\+xml/, `${path}: SVG MIME type`);
    const inspection = await inspectSvg(scenePage);
    assert.deepEqual(inspection.problems, [], `${path}: ${inspection.problems.join('; ')}`);
    assert.deepEqual(inspection.size, [1200, 520], `${path}: intrinsic dimensions`);
    assert.deepEqual(inspection.viewBox, [0, 0, 1200, 520], `${path}: viewBox`);
    assert.ok(inspection.animations > 0, `${path}: no running CSS animations`);
    await scenePage.goto(`${origin}${path.replace('/living/', '/living/full/')}`, { waitUntil: 'load' });
    const full = await inspectSvg(scenePage);
    assert.ok(full.animations > inspection.animations,
      `${path}: Full should enable additional movement (${full.animations} versus ${inspection.animations}).`);
    if (path.endsWith('/travel.svg')) {
      const phases = await scenePage.evaluate(() => {
        const animations = document.getAnimations();
        function readAt(time) {
          animations.forEach((animation) => { animation.pause(); animation.currentTime = time; });
          return ['.sun-disc', '.sun-radiance', '.ambient-light', '.leaves', '.flock'].map((selector) => {
            const style = getComputedStyle(document.querySelector(selector));
            return { fill: style.fill, opacity: style.opacity, transform: style.transform };
          });
        }
        return [readAt(0), readAt(6000)];
      });
      phases[0].forEach((start, index) => assert.notDeepEqual(start, phases[1][index],
        `Full Travel: sun colour, intensity, scene tone, foliage and birds must each change (layer ${index}).`));
      await scenePage.screenshot({ path: join(output, 'travel-full-bright.png') });
    }
    await scenePage.goto(`${origin}${path.replace('/living/', '/living/still/')}`, { waitUntil: 'load' });
    assert.equal((await inspectSvg(scenePage)).animations, 0, `${path}: Still should stop every animation.`);
    await scenePage.goto(`${origin}${path.replace('/living/', '/living/full/')}`, { waitUntil: 'load' });
    await scenePage.emulateMedia({ reducedMotion: 'reduce' });
    await scenePage.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 3000 });
  }
  console.log('All nine SVGs parse: Optimized animates, Full adds motion, Still and reduced motion stop every animation.');
  await scenePage.close();

  const gallery = await artwork.newPage();
  await gallery.emulateMedia({ reducedMotion: 'no-preference' });
  for (const viewport of viewportSizes) {
    await gallery.setViewportSize(viewport);
    await gallery.goto(`${origin}/art-preview.html`, { waitUntil: 'load' });
    await waitArtMode(gallery, 'optimized');
    assert.equal(await gallery.locator('#artMotion').inputValue(), 'optimized', 'Optimized is the default.');
    await checkImages(gallery, '.collection img.art');
    await checkOverflow(gallery, `Gallery at ${viewport.width}px`);
    await gallery.evaluate(() => document.fonts.ready);
    await gallery.screenshot({ path: join(output, `gallery-${viewport.width}.png`), fullPage: true });
  }

  // An SVG image document can reuse a previous fragment's rendering in Edge. Exercise transitions
  // in one page as well as initial loads, so a Still selection cannot silently keep an old animation.
  const hero = gallery.locator('.collection img.art').first();
  await assertMovingImage(hero, 'Optimized');
  await gallery.locator('#artMotion').selectOption('full');
  await waitArtMode(gallery, 'full');
  await assertMovingImage(hero, 'Full');
  await gallery.locator('#artMotion').selectOption('still');
  await waitArtMode(gallery, 'still');
  await assertStillGallery(gallery, 'gallery-still');
  await gallery.locator('#artMotion').selectOption('full');
  await waitArtMode(gallery, 'full');
  await assertMovingImage(hero, 'Full after Still');
  await gallery.emulateMedia({ reducedMotion: 'reduce' });
  await waitArtMode(gallery, 'still');
  assert.equal(await gallery.locator('#artMotion').inputValue(), 'full', 'OS override preserves the saved selection.');
  await gallery.locator('#artMotionSystemNote').waitFor({ state: 'visible' });
  await assertStillGallery(gallery, 'gallery-reduced-motion');
  await gallery.emulateMedia({ reducedMotion: 'no-preference' });
  await waitArtMode(gallery, 'full');
  await gallery.reload({ waitUntil: 'load' });
  await waitArtMode(gallery, 'full');
  assert.equal(await gallery.locator('#artMotion').inputValue(), 'full', 'Gallery selection survives reload.');
  await artwork.close();
  console.log('Gallery fits mobile and desktop; all embedded modes, persistence, and OS override render correctly.');

  // Direct-file opening must work with normal browser security, without an external module load.
  const local = await browser.newContext({ viewport: viewportSizes[1], reducedMotion: 'no-preference' });
  const localGallery = await local.newPage();
  const localErrors = [];
  localGallery.on('pageerror', (error) => localErrors.push(error.message));
  localGallery.on('console', (message) => { if (message.type() === 'error') localErrors.push(message.text()); });
  localGallery.on('requestfailed', (request) => localErrors.push(request.url()));
  await localGallery.goto(pathToFileURL(join(root, 'art-preview.html')).href, { waitUntil: 'load' });
  await waitArtMode(localGallery, 'optimized');
  await localGallery.locator('#artMotion').selectOption('full');
  await waitArtMode(localGallery, 'full');
  await assertMovingImage(localGallery.locator('img[data-living-art]').first(), 'Direct-file Full');
  await localGallery.reload({ waitUntil: 'load' });
  await waitArtMode(localGallery, 'full');
  await localGallery.locator('#artMotion').selectOption('still');
  await waitArtMode(localGallery, 'still');
  await assertStillGallery(localGallery, 'gallery-file-still');
  await localGallery.locator('#artMotion').selectOption('full');
  await localGallery.emulateMedia({ reducedMotion: 'reduce' });
  await waitArtMode(localGallery, 'still');
  assert.deepEqual(localErrors, [], 'Direct-file gallery has no CORS, script or image loading errors.');
  await local.close();
  console.log('Direct-file gallery: no console errors; Full animates, Still stops, preferences persist and reduced motion applies.');

  const onboardingSource = await readFile(join(root, 'js', 'onboarding.js'), 'utf8');
  const onboardingKey = onboardingSource.match(/const STORAGE_KEY = '([^']+)'/)?.[1];
  const onboardingVersion = onboardingSource.match(/const VERSION = (\d+)/)?.[1];
  assert.ok(onboardingKey && onboardingVersion, 'Read the current walkthrough storage key and version.');
  const app = await newContext(origin, { viewport: viewportSizes[0] });
  await app.addInitScript(({ key, version }) => {
    localStorage.setItem('advancedUi', 'true');
    localStorage.setItem(key, version);
  }, { key: onboardingKey, version: onboardingVersion });
  const home = await app.newPage();
  const pageErrors = [];
  home.on('pageerror', (error) => pageErrors.push(error.message));
  await home.goto(origin, { waitUntil: 'load' });
  await home.waitForFunction(() => window.__fortressAppReady === true);
  // First activation claims the page and the app reloads on controllerchange. Wait for the
  // controller before testing cards, so that expected reload cannot interrupt a click or screenshot.
  await home.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20000 });
  await home.locator('#advancedHome').waitFor({ state: 'visible' });
  await home.locator('.dua-row').first().waitFor({ state: 'attached' });
  await waitArtMode(home, 'optimized');
  for (const viewport of viewportSizes) {
    await home.setViewportSize(viewport);
    await checkImages(home, '#advancedHome img');
    await checkOverflow(home, `Home at ${viewport.width}px`);
    if (viewport.width === 390) {
      await home.screenshot({ path: join(output, 'home-390.png'), fullPage: true });
    }
  }
  const accessibleCards = await home.locator('#advancedHome .advanced-card').evaluateAll((cards) =>
    cards.every((card) => card.getAttribute('aria-label')?.trim() && card.querySelector('img').alt === ''));
  assert.ok(accessibleCards, 'Every decorative card retains its button accessible name and empty image alt.');
  await home.locator('#advancedHome [data-advanced-filter="morning"]').click();
  await home.locator('#simpleHome').waitFor({ state: 'visible' });
  await home.locator('.dua-row').first().waitFor({ state: 'visible' });
  assert.match(await home.locator('#screenTitle').textContent(), /morning/i, 'Morning card opens its category.');
  await home.locator('[data-advanced-home]').click();
  await home.locator('#advancedHome').waitFor({ state: 'visible' });
  await setAppArtMode(home, 'full');
  await home.reload({ waitUntil: 'load' });
  await home.waitForFunction(() => window.__fortressAppReady === true);
  await waitArtMode(home, 'full');
  assert.equal(await home.locator('#artMotion').inputValue(), 'full', 'PWA selection survives reload.');
  await home.emulateMedia({ reducedMotion: 'reduce' });
  await waitArtMode(home, 'still');
  assert.equal(await home.locator('#artMotion').inputValue(), 'full', 'PWA OS override retains Full selection.');
  await home.emulateMedia({ reducedMotion: 'no-preference' });
  await waitArtMode(home, 'full');

  const cached = await home.evaluate(async (assetPaths) => Promise.all(assetPaths.map(async (path) => {
    const response = await caches.match(new URL(path, location.href).href);
    return {
      path,
      status: response?.status,
      isSvg: response ? (response.headers.get('Content-Type') || '').startsWith('image/svg+xml')
        && (await response.text()).trimStart().startsWith('<svg') : false,
    };
  })), paths);
  for (const entry of cached) {
    assert.equal(entry.status, 200, `${entry.path}: service worker cached response`);
    assert.ok(entry.isSvg, `${entry.path}: service worker cached the SVG body`);
  }
  // Visiting the art gallery must not replace the cached application document.
  const appShellBefore = await home.evaluate(async () => (await caches.match('./index.html')).text());
  const review = await app.newPage();
  await review.goto(`${origin}/art-preview.html`, { waitUntil: 'load' });
  await review.waitForFunction(async () => Boolean(await caches.match('./art-preview.html')));
  const appShellAfter = await review.evaluate(async () => (await caches.match('./index.html')).text());
  assert.equal(appShellAfter, appShellBefore, 'Gallery navigation preserves the cached PWA shell.');
  await review.close();
  await app.setOffline(true);
  await home.reload({ waitUntil: 'load' });
  await home.waitForFunction(() => window.__fortressAppReady === true);
  await home.locator('#advancedHome').waitFor({ state: 'visible' });
  // Switch all modes without network, including a mode never selected online in this context.
  // Every mode is an independent SVG file and must be cached before it is selected.
  for (const mode of ['still', 'full', 'optimized']) {
    await setAppArtMode(home, mode);
    await checkImages(home, '#advancedHome img');
    if (mode === 'still') await assertStillGallery(home, 'home-offline-still', '#advancedHome img');
    else await assertMovingImage(home.locator('#advancedHome img').first(), `Offline ${mode}`);
  }
  await home.locator('#advancedHome [data-advanced-filter="all"]').click();
  await home.locator('.dua-row').first().waitFor({ state: 'visible' });
  assert.deepEqual(pageErrors, [], 'PWA should have no uncaught browser errors.');
  await app.close();
  console.log('PWA cards route correctly; preferences persist, and all three modes render correctly from cached SVGs offline.');
  console.table(sizes);
  console.log(`Artwork: ${sizes.reduce((sum, size) => sum + size.bytes, 0)} bytes raw; `
    + `${sizes.reduce((sum, size) => sum + size.gzipBytes, 0)} bytes gzipped. Screenshots: ${output}`);
} finally {
  try {
    await browser?.close();
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  }
}

async function newContext(origin, options) {
  const context = await browser.newContext(options);
  context.setDefaultTimeout(12000);
  // No API, remote font, or analytics response is needed to validate local artwork and dua data.
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.abort();
  });
  return context;
}

async function checkImages(page, selector) {
  const images = page.locator(selector);
  assert.equal(await images.count(), 9, `${selector}: nine images`);
  for (let index = 0; index < names.length; index++) await images.nth(index).scrollIntoViewIfNeeded();
  await page.waitForFunction((query) => [...document.querySelectorAll(query)]
    .every((image) => image.complete && image.naturalWidth === 1200 && image.naturalHeight === 520), selector);
  assert.deepEqual(await images.evaluateAll((nodes) => nodes.map((image) => new URL(image.currentSrc).pathname
    .replace(/^.*\/assets\//, '/assets/').replace(/\/living\/(?:full|still)\//, '/living/'))), paths);
  await page.evaluate(() => scrollTo(0, 0));
}

async function checkOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `${label}: horizontal overflow ${overflow}px`);
}

async function waitArtMode(page, mode) {
  await checkImages(page, 'img[data-living-art]');
  await page.waitForFunction((expectedMode) => {
    const images = [...document.querySelectorAll('img[data-living-art]')];
    return images.length === 9 && images.every((image) => {
      if (!image.complete || !image.naturalWidth) return false;
      const source = new URL(image.currentSrc);
      const actualMode = source.pathname.includes('/living/full/') ? 'full'
        : source.pathname.includes('/living/still/') ? 'still' : 'optimized';
      return actualMode === expectedMode && !source.hash && !source.searchParams.has('art-motion');
    });
  }, mode);
}

async function assertMovingImage(image, label) {
  const before = await image.screenshot({ animations: 'allow' });
  await image.page().waitForTimeout(700);
  const after = await image.screenshot({ animations: 'allow' });
  assert.ok(!before.equals(after), `${label}: embedded SVG should visibly animate.`);
}

async function assertStillGallery(page, name, selector = '.collection img.art') {
  await checkImages(page, selector);
  const subject = page.locator(selector === '.collection img.art' ? '.collection' : '#advancedHome');
  await page.evaluate(() => document.fonts.ready);
  const before = await subject.screenshot({ path: join(output, `${name}-a.png`), animations: 'allow' });
  await page.waitForTimeout(700);
  const after = await subject.screenshot({ path: join(output, `${name}-b.png`), animations: 'allow' });
  assert.ok(before.equals(after), `${name}: all nine embedded SVGs must remain still.`);
}

async function setAppArtMode(page, mode) {
  await page.locator('#settingsButton').click();
  const appearance = page.locator('[data-settings-toggle="appearance"]');
  if (await appearance.getAttribute('aria-expanded') !== 'true') await appearance.click();
  await page.locator('#artMotion').selectOption(mode);
  await page.locator('#settingsDialog button[value="close"]').click();
  await waitArtMode(page, mode);
}

async function inspectSvg(page) {
  return page.evaluate(() => {
    const svg = document.documentElement;
    const problems = [];
    if (svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg') problems.push('Invalid SVG root');
    if (document.querySelector('parsererror')) problems.push('XML parser error');
    if (document.querySelector('script, foreignObject, text')) problems.push('Script, foreignObject, or visible text');
    for (const node of document.querySelectorAll('*')) {
      for (const attribute of node.attributes) {
        if (/^on/i.test(attribute.name)) problems.push(`Event handler: ${attribute.name}`);
        if (['href', 'src'].includes(attribute.localName) && !attribute.value.startsWith('#')) {
          problems.push(`External resource: ${attribute.value}`);
        }
      }
    }
    const markup = svg.outerHTML;
    for (const match of markup.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
      if (!match[1].startsWith('#')) problems.push(`External CSS resource: ${match[1]}`);
    }
    if (/@import\b/i.test(markup)) problems.push('External stylesheet import');
    svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    return {
      problems,
      size: [Number(svg.getAttribute('width')), Number(svg.getAttribute('height'))],
      viewBox: viewBox ? [viewBox.x, viewBox.y, viewBox.width, viewBox.height] : null,
      animations: document.getAnimations().filter((animation) => animation.playState === 'running').length,
    };
  });
}

function contentType(file) {
  return ({
    '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
  })[extname(file)] || 'application/octet-stream';
}
