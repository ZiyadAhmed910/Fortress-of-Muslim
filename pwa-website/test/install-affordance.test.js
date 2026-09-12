import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Installing had become invisible: the browser stopped showing its own banner, and the app's own
// Install row was display:none unless the browser fired beforeinstallprompt -- an event that never
// fires on iOS and never fires again once installed. So on a phone there was nothing to find, and
// nothing saying why. These hold the three states the row now has to cover.
const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8');
const html = read('index.html');
const pwa = read('js/pwa.js');
const settingsCss = read('css/settings.css');

describe('the Install row in Settings', () => {
  it('is never hidden by CSS', () => {
    expect(settingsCss).not.toMatch(/\.install-row\s*\{[^}]*display:\s*none/);
  });

  it('tells an iPhone reader where installing actually lives', () => {
    expect(pwa).toContain('Add to Home Screen');
    expect(pwa).toMatch(/iPad\|iPhone\|iPod/);
  });

  it('tells an Android reader the same', () => {
    expect(pwa).toMatch(/Install app.*Add to Home screen|Add to Home screen.*Install app/);
  });

  it('says so when the app is already installed', () => {
    expect(pwa).toContain('Already installed on this device.');
    expect(pwa).toContain("matchMedia?.('(display-mode: standalone)')");
  });

  it('only shows the Install button when the browser will actually prompt', () => {
    expect(pwa).toContain('els.installButton.hidden = !canPrompt');
    expect(html).toMatch(/id="installButton"[^>]*hidden/);
  });
});

describe('the install banner', () => {
  it('is offered, dismissed, and then left alone', () => {
    expect(pwa).toContain('INSTALL_DISMISSED_KEY');
    expect(pwa).toContain('!bannerDismissed()');
    expect(html).toContain('id="dismissInstallButton"');
  });

  it('never covers the update banner, which matters more', () => {
    expect(pwa).toContain("!els.updateBanner.classList.contains('visible')");
  });

  it('survives storage being unavailable', () => {
    // Private browsing throws on localStorage; an install hint is not worth breaking boot over.
    expect(pwa).toMatch(/try \{ localStorage\.setItem\(INSTALL_DISMISSED_KEY/);
    expect(pwa).toMatch(/try \{ return localStorage\.getItem\(INSTALL_DISMISSED_KEY\)[^}]*\} catch \{ return false; \}/);
  });
});

describe('brand icons leave room for the launcher to crop', () => {
  const generator = read('tools/build-brand.mjs');

  it('sizes the maskable symbol for the visible area, not the safe zone', () => {
    const scale = Number(generator.match(/maskable:\s*([0-9.]+)/)[1]);
    expect(scale).toBeLessThanOrEqual(0.7);
  });

  it('keeps every rendition driven by one scale table', () => {
    expect(generator).toContain('SYMBOL_SCALE');
    expect(generator).not.toMatch(/scale\(\$\{maskable \? \.?[0-9]/);
  });
});
