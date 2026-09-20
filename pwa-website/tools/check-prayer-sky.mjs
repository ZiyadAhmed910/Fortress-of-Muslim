import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../.fortress-import/prayer-sky');
await mkdir(output, { recursive: true });
const fixture = `<!doctype html><html><head><link rel="stylesheet" href="/css/online.css"><style>
html,body{margin:0;background:#f4f1e8;font-family:system-ui,sans-serif}#card{min-height:300px;box-sizing:border-box;border-radius:18px}
</style></head><body><div class="prayer-next-card" id="card"><span class="prayer-next-label">Next prayer</span><strong id="name">Dhuhr</strong><span class="prayer-next-time" id="time">11:31 AM</span><span class="prayer-next-countdown">Your local sky, throughout the day</span></div>
<script type="module">
import * as sky from '/js/sky.js'; import * as motion from '/js/art-motion.js'; import { computePrayerTimes, nextPrayer, formatPrayerClock } from '/js/prayer-times.js';
window.draw = (hour) => { window.hour = hour; const now = new Date(2026,8,20,0,hour*60);
  const upcoming = nextPrayer(window.times, now);
  document.getElementById('name').textContent = upcoming.label;
  document.getElementById('time').textContent = formatPrayerClock(upcoming.time);
  return sky.renderSky(document.getElementById('card'), {latitude:22.57,longitude:88.36,now}); };
window.motion = motion; window.times = computePrayerTimes(22.57,88.36,new Date(2026,8,20));
window.draw(Number(new URLSearchParams(location.search).get('hour') || 12)); window.ready = true;
</script></body></html>`;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/fixture') { response.writeHead(200, { 'Content-Type': 'text/html' }).end(fixture); return; }
  const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const context = await browser.newContext({ timezoneId: 'Asia/Kolkata', viewport: { width: 360, height: 400 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/fixture`);
  await page.waitForFunction(() => window.ready);
  const times = await page.evaluate(() => window.times);
  const phases = [['Fajr', times.fajr.decimalHours], ['Morning', 8], ['Dhuhr', times.dhuhr.decimalHours], ['Asr', times.asr.decimalHours], ['Maghrib', times.maghrib.decimalHours + .1], ['Night', 22]];
  for (const [label, hour] of phases) {
    await page.evaluate(({ hour, label }) => { draw(hour); document.getElementById('name').textContent = label; }, { hour, label });
    await page.locator('#card').screenshot({ path: `${output}/${label.toLowerCase()}.png` });
  }
  const movement = await page.evaluate(() => {
    draw(8); const morning = document.querySelector('.sky-sun-position').getAttribute('transform');
    draw(15); const afternoon = document.querySelector('.sky-sun-position').getAttribute('transform');
    draw(20); const earlyMoon = document.querySelector('.sky-moon-position').getAttribute('transform');
    draw(23); const lateMoon = document.querySelector('.sky-moon-position').getAttribute('transform');
    return { morning, afternoon, earlyMoon, lateMoon, count: document.querySelectorAll('.sky').length };
  });
  assert.notEqual(movement.morning, movement.afternoon);
  assert.notEqual(movement.earlyMoon, movement.lateMoon);
  assert.equal(movement.count, 1);
  for (const hour of [8, 15]) {
    assert.equal(await page.evaluate(hour => { draw(hour); return document.querySelector('.sky-sun-position').style.opacity; }, hour), '1');
    assert.equal(await page.evaluate(() => document.querySelector('.sky-moon-position').style.opacity), '0');
  }
  await page.evaluate(() => { draw(12); motion.setArtMotionPreference('full'); });
  const lighting = await page.evaluate(() => {
    const animations = document.getAnimations();
    const read = time => {
      animations.forEach(animation => { animation.pause(); animation.currentTime = time; });
      return ['.sky-rays path', '.sky-aura', '.sky-corona'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector)); return [style.opacity, style.transform];
      });
    };
    return [read(0), read(2300)];
  });
  lighting[0].forEach((value, i) => assert.notDeepEqual(value, lighting[1][i]));
  await page.evaluate(() => motion.setArtMotionPreference('still'));
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  const before = await page.locator('#card').screenshot();
  await page.waitForTimeout(400);
  assert.ok(before.equals(await page.locator('#card').screenshot()));
  await page.evaluate(() => motion.setArtMotionPreference('full'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [320, 390, 960]) {
    await page.setViewportSize({ width, height: 400 });
    await page.evaluate(() => draw(window.times.dhuhr.decimalHours));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const bounds = await page.locator('.sky-sun-disc').boundingBox();
    assert.ok(bounds.y > 0 && bounds.x > 0 && bounds.x + bounds.width < width, 'Noon sun remains visible after resizing');
  }
  // A contact sheet uses independent SVG documents, as the app has one live prayer card.
  await page.setViewportSize({ width: 1120, height: 770 });
  await page.setContent(`<html><body style="margin:0;padding:28px;background:#f4f1e8;font-family:system-ui"><h1 style="font-size:24px;margin:0 0 22px;color:#183b44">One sky, throughout your day</h1><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px">${phases.map(([label, hour]) => `<section><div style="font-size:12px;letter-spacing:1px;color:#53666c;margin-bottom:9px">${label.toUpperCase()}</div><iframe style="border:0;width:100%;height:300px" src="${origin}/fixture?hour=${hour}"></iframe></section>`).join('')}</div></body></html>`);
  for (const frame of page.frames().slice(1)) { await frame.waitForFunction(() => window.ready); await frame.evaluate(() => motion.setArtMotionPreference('still')); }
  await page.screenshot({ path: `${output}/day-cycle.png`, fullPage: true });
  // Exercise the real prayer tab and its timer, rather than just calling the renderer.
  const app = await context.newPage();
  app.on('pageerror', error => errors.push(error.message));
  await app.clock.install({ time: new Date('2026-09-20T08:00:00+05:30') });
  await app.addInitScript(() => {
    localStorage.setItem('manualLatitude', '22.57');
    localStorage.setItem('manualLongitude', '88.36');
    localStorage.setItem('fortress_onboarding_seen', '2');
    localStorage.setItem('artMotion', 'still');
  });
  await app.goto(`${origin}/index.html`);
  await app.waitForFunction(() => window.__fortressAppReady);
  await app.locator('[data-content-group="worship"]').click();
  await app.locator('#prayerNextCard .sky').waitFor();
  const position = () => app.locator('.sky-sun-position').getAttribute('transform');
  const morning = await position();
  await app.clock.setSystemTime(new Date('2026-09-20T15:00:00+05:30'));
  await app.clock.runFor(20001);
  assert.notEqual(await position(), morning, 'The live countdown moves the sun as real time changes, even in Still.');
  await app.clock.setSystemTime(new Date('2026-09-20T22:00:00+05:30'));
  await app.clock.runFor(20001);
  assert.equal(await app.locator('.sky').getAttribute('data-phase'), 'night');
  await app.setViewportSize({ width: 320, height: 844 });
  const nameBounds = await app.locator('#prayerNextName').boundingBox();
  const timeBounds = await app.locator('#prayerNextTime').boundingBox();
  assert.ok(nameBounds.x + nameBounds.width <= timeBounds.x, 'Tomorrow label and clock do not overlap on a small phone');
  assert.ok(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await app.setViewportSize({ width: 390, height: 844 });
  await app.screenshot({ path: `${output}/prayer-tab-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Prayer sky: live prayer-tab clock updates, changing light, Still, reduced motion, resizing and six visual phases passed. Screenshots:', output);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
