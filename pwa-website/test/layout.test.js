import { beforeEach, describe, expect, it } from 'vitest';
import { state } from '../js/state.js';
import {
  CONFIGURABLE_TABS,
  getTabConfig,
  isTabVisible,
  parentTabOf,
  setTabEnabled,
  setTabVisibility,
  visibleWorshipTabs,
  writeLayoutStorage,
} from '../js/layout.js';

// Prayer is one nav button that opens three screens, so it is a parent: switching it off has to
// take Prayer Times, Qibla and Tasbih with it, and none of them can be reachable without it. The
// bug these cover is a child that stayed reachable while its parent was switched off.
const CHILDREN = ['prayerTimes', 'qibla', 'tasbih'];
const allOn = () => Object.fromEntries(
  CONFIGURABLE_TABS.map((tab) => [tab.id, { enabled: true, visibility: 'both' }]),
);

beforeEach(() => {
  state.advancedUi = false;
  writeLayoutStorage(allOn());
});

describe('prayer is a parent of its three screens', () => {
  it('declares the parent relationship', () => {
    for (const child of CHILDREN) expect(parentTabOf(child)).toBe('prayer');
    expect(parentTabOf('prayer')).toBeNull();
    expect(parentTabOf('quran')).toBeNull();
  });

  it('hides every child when the parent is switched off', () => {
    expect(CHILDREN.every(isTabVisible)).toBe(true);
    setTabEnabled('prayer', false);
    for (const child of CHILDREN) expect(isTabVisible(child), child).toBe(false);
    expect(visibleWorshipTabs()).toEqual([]);
  });

  it('leaves each child its own setting so it returns unchanged', () => {
    setTabEnabled('qibla', false);
    setTabEnabled('prayer', false);
    setTabEnabled('prayer', true);
    // Qibla was off before the parent went off, so it stays off. The others come back.
    expect(isTabVisible('qibla')).toBe(false);
    expect(isTabVisible('prayerTimes')).toBe(true);
    expect(isTabVisible('tasbih')).toBe(true);
  });

  it('switches the parent on when a child is switched on', () => {
    setTabEnabled('prayer', false);
    setTabEnabled('qibla', true);
    expect(getTabConfig('prayer').enabled).toBe(true);
    expect(isTabVisible('qibla')).toBe(true);
  });

  it('applies the parent Simple/Advanced setting to its children', () => {
    setTabVisibility('prayer', 'advanced');
    state.advancedUi = false;
    for (const child of CHILDREN) expect(isTabVisible(child), child).toBe(false);
    state.advancedUi = true;
    for (const child of CHILDREN) expect(isTabVisible(child), child).toBe(true);
  });

  it('still honours a child narrower than its parent', () => {
    setTabVisibility('qibla', 'advanced');
    state.advancedUi = false;
    expect(isTabVisible('qibla')).toBe(false);
    expect(isTabVisible('prayerTimes')).toBe(true);
  });

  it('refuses a stored config that enables a child under a disabled parent', () => {
    // Hand-edited or imported configs must not be able to smuggle a child past its parent.
    writeLayoutStorage({
      ...allOn(),
      prayer: { enabled: false, visibility: 'both' },
      qibla: { enabled: true, visibility: 'both' },
    });
    expect(isTabVisible('qibla')).toBe(false);
    expect(visibleWorshipTabs()).toEqual([]);
  });

  it('leaves unrelated tabs alone', () => {
    setTabEnabled('prayer', false);
    expect(isTabVisible('quran')).toBe(true);
    expect(isTabVisible('hadith')).toBe(true);
    expect(isTabVisible('duas')).toBe(true);
  });
});
