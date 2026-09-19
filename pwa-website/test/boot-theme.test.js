import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// index.html applies the theme inline, before the first paint, because app.js is a module and
// modules are deferred -- waiting for one means painting a light page first and snapping dark after.
// The cost of that is a second copy of two defaults, in markup, where nothing type-checks it. This
// runs the real script out of the real file against a fresh import of state.js for every stored
// combination, so the copy cannot quietly drift away from the thing it is copying.
const HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

const DARK = '#071827';
const LIGHT = '#f3f3f0';

/** The inline boot script, taken from index.html rather than retyped here. */
const bootScript = (() => {
  const head = HTML.slice(0, HTML.indexOf('<title>'));
  const opened = head.lastIndexOf('<script>');
  const closed = head.indexOf('</script>', opened);
  expect(opened, 'index.html no longer has an inline script before <title>').toBeGreaterThan(-1);
  return head.slice(opened + '<script>'.length, closed);
})();

function runBootScript(stored) {
  document.documentElement.className = 'dark';
  document.head.innerHTML = `<meta name="theme-color" content="${DARK}">`;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => stored[key] ?? null);
  // eslint-disable-next-line no-new-func -- the point is to run the shipped script, not a copy of it
  new Function(bootScript)();
  return {
    dark: document.documentElement.classList.contains('dark'),
    themeColor: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
  };
}

/** state.js reads localStorage once at import, so each case needs a fresh module. */
async function freshState(stored) {
  vi.resetModules();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => stored[key] ?? null);
  const { state } = await import('../js/state.js');
  return state;
}

const CASES = [
  { name: 'a fresh install, nothing stored', stored: {} },
  { name: 'someone who explicitly chose light', stored: { darkMode: 'false' } },
  { name: 'someone who explicitly chose dark', stored: { darkMode: 'true' } },
  { name: 'light plus the Simple layout', stored: { darkMode: 'false', advancedUi: 'false' } },
  { name: 'light but the Advanced layout', stored: { darkMode: 'false', advancedUi: 'true' } },
  { name: 'dark plus the Simple layout', stored: { darkMode: 'true', advancedUi: 'false' } },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the theme applied before the first paint', () => {
  it.each(CASES)('agrees with state.js for $name', async ({ stored }) => {
    const painted = runBootScript(stored);
    vi.restoreAllMocks();
    const state = await freshState(stored);
    expect(painted.dark).toBe(state.darkMode);
  });

  it.each(CASES)('sets the theme colour settings.js would settle on for $name', async ({ stored }) => {
    const painted = runBootScript(stored);
    vi.restoreAllMocks();
    const state = await freshState(stored);
    // Mirrors the expression in applySettings(); the browser chrome should not change colour a
    // moment after opening either.
    expect(painted.themeColor).toBe(state.darkMode || state.advancedUi ? DARK : LIGHT);
  });

  it('defaults to dark, which is what the markup already paints', () => {
    expect(runBootScript({})).toEqual({ dark: true, themeColor: DARK });
    // The <html> element and the meta carry the defaults, so a first paint that never runs the
    // script at all still lands on them.
    expect(HTML).toMatch(/<html[^>]*class="dark"/);
    expect(HTML).toMatch(/<meta name="theme-color" content="#071827">/);
  });

  it('only ever removes the default, never adds it back', () => {
    // If the script could add "dark" it would be capable of overriding a light choice made later in
    // the same session; it is deliberately one-directional.
    expect(bootScript).not.toMatch(/classList\.add/);
    expect(bootScript).toMatch(/classList\.remove\('dark'\)/);
  });

  it('survives storage being unavailable, as it is in private browsing', () => {
    document.documentElement.className = 'dark';
    document.head.innerHTML = `<meta name="theme-color" content="${DARK}">`;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('The operation is insecure.');
    });
    expect(() => new Function(bootScript)()).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
