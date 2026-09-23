import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHORTCUT_SCREENS, shortcutScreen } from '../js/routes.js';

// Install shortcuts are the menu an installed app shows on long-press or right-click. How that menu
// looks, how many items it shows and whether it appears at all is decided by each OS and browser,
// and none of that can be tested here. What can be tested is everything on this side of the
// launcher: that every shortcut the manifest declares points at a screen the app will actually
// open, that its icons exist, and that a URL the app did not declare opens nothing.
const ROOT = process.cwd();
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
const MODES_JS = readFileSync(resolve(ROOT, 'js/modes.js'), 'utf8');
const MODES = MODES_JS.match(/const MODES = \[([^\]]+)\]/)[1]
  .split(',').map((entry) => entry.trim().replace(/'/g, '')).filter(Boolean);

const screenOf = (url) => shortcutScreen(new URL(url, 'https://fortressofmuslim.org/').search);

describe('install shortcuts', () => {
  it('are few, because the launcher gives them very little room', () => {
    expect(MANIFEST.shortcuts.length).toBeGreaterThan(0);
    expect(MANIFEST.shortcuts.length).toBeLessThanOrEqual(4);
  });

  it.each(MANIFEST.shortcuts.map((shortcut) => [shortcut.name, shortcut]))('%s opens a screen the app has', (_name, shortcut) => {
    const screen = screenOf(shortcut.url);
    expect(screen, `${shortcut.url} does not resolve to a declared screen`).not.toBeNull();
    expect(MODES).toContain(screen);
  });

  it.each(MANIFEST.shortcuts.map((shortcut) => [shortcut.name, shortcut]))('%s stays inside the app scope', (_name, shortcut) => {
    // A shortcut outside scope opens in a browser tab rather than in the installed app.
    expect(shortcut.url.startsWith('./')).toBe(true);
  });

  it.each(MANIFEST.shortcuts.map((shortcut) => [shortcut.name, shortcut]))('%s has icons that exist', (_name, shortcut) => {
    expect(shortcut.icons.length).toBeGreaterThan(0);
    for (const icon of shortcut.icons) {
      expect(existsSync(resolve(ROOT, icon.src)), icon.src).toBe(true);
      expect(icon.sizes).toMatch(/^\d+x\d+$/);
    }
  });

  it('declares every screen the router accepts, and nothing more', () => {
    const declared = MANIFEST.shortcuts.map((shortcut) => screenOf(shortcut.url)).sort();
    expect(declared).toEqual([...SHORTCUT_SCREENS].sort());
  });

  it('gives each shortcut its own icon', () => {
    // Four copies of the logo in a four-item menu would make the icons say nothing.
    const sources = MANIFEST.shortcuts.map((shortcut) => shortcut.icons[0].src);
    expect(new Set(sources).size).toBe(sources.length);
  });
});

describe('reading a shortcut URL', () => {
  it('ignores a screen the manifest did not declare', () => {
    // The URL is handed to the app by the OS; only the shortcuts the app itself declared act.
    expect(shortcutScreen('?screen=admin')).toBeNull();
    expect(shortcutScreen('?screen=')).toBeNull();
    expect(shortcutScreen('')).toBeNull();
  });

  it('ignores other parameters', () => {
    expect(shortcutScreen('?adhkar=morning')).toBeNull();
    expect(shortcutScreen('?screen=qibla&utm_source=x')).toBe('qibla');
  });
});
