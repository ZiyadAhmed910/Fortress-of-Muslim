import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPrefs } from '../js/quran.js';

// Defaults get flipped as the app finds its shape, and the danger every time is the same one: the
// new default quietly overwriting somebody's answer. A stored preference is an answer someone gave,
// so each default here is tested twice -- once for the fresh install that gets the new default, and
// once for the reader whose stored choice has to survive it.
const QURAN_KEY = 'fortress_quran';
const storeQuran = (prefs) => localStorage.setItem(QURAN_KEY, JSON.stringify(prefs));

// state.js reads localStorage once, at import, so the stored value has to be in place before the
// module is evaluated -- hence a reset and a fresh import per case rather than the shared singleton.
async function freshState() {
  vi.resetModules();
  return (await import('../js/state.js')).state;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('dark mode is the app, and light is the opt-out', () => {
  it('is on for a fresh install', async () => {
    expect((await freshState()).darkMode).toBe(true);
  });

  it('stays off for someone who chose light', async () => {
    localStorage.setItem('darkMode', 'false');
    expect((await freshState()).darkMode).toBe(false);
  });

  it('stays on for someone who chose dark before it was the default', async () => {
    localStorage.setItem('darkMode', 'true');
    expect((await freshState()).darkMode).toBe(true);
  });
});

describe('the reader opens in continuous scroll, and pages are the opt-out', () => {
  it('scrolls for a fresh install', () => {
    expect(loadPrefs().paginated).toBe(false);
  });

  it('scrolls when nothing readable is stored', () => {
    localStorage.setItem(QURAN_KEY, 'not json at all');
    expect(loadPrefs().paginated).toBe(false);
  });

  it('keeps pages for a reader whose stored prefs say pages', () => {
    // markRead() persists the whole prefs object on every surah opened, so every existing reader
    // carries paginated: true. Reading it as "explicitly on" is what leaves them undisturbed.
    storeQuran({ lastRead: { surah: 2, ayah: 5 }, paginated: true });
    expect(loadPrefs().paginated).toBe(true);
  });

  it('keeps scroll for someone who chose scroll', () => {
    storeQuran({ paginated: false });
    expect(loadPrefs().paginated).toBe(false);
  });

  it('leaves the rest of a stored prefs object alone while it does it', () => {
    storeQuran({ favouriteSurahs: [36, 67], browseMode: 'juz', paginated: true });
    const prefs = loadPrefs();
    expect(prefs.favouriteSurahs).toEqual([36, 67]);
    expect(prefs.browseMode).toBe('juz');
  });
});

describe('tajweed colouring is on, and plain Arabic is the opt-out', () => {
  it('is on for a fresh install', () => {
    expect(loadPrefs().tajweed).toBe(true);
  });

  it('is on when stored prefs predate the setting', () => {
    storeQuran({ lastRead: { surah: 18, ayah: 1 } });
    expect(loadPrefs().tajweed).toBe(true);
  });

  it('stays off for someone who switched it off', () => {
    storeQuran({ tajweed: false });
    expect(loadPrefs().tajweed).toBe(false);
  });
});
