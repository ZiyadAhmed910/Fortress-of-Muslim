import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORSHIP_TABS } from '../js/layout.js';

// What layout.test.js used to cover was Customize Layout: tabs that could be switched off, and each
// restricted to one home screen or the other. That feature is gone, so those tests went with it --
// a test for behaviour that no longer exists is worse than no test, because it still looks like a
// specification.
//
// What survived the removal is the part that was never configuration: Prayer Times, Qibla and Tasbih
// are three screens behind one "Prayer" button, with a sub-bar to move between them. That is the
// shape of the nav, and it is what this covers. The risk after a removal like this is a leftover --
// markup for a tab nothing renders, or a screen the nav can no longer reach -- so these check the
// three lists that have to agree: the tabs, the nav buttons, and the screens.
const HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const MODES_JS = readFileSync(resolve(process.cwd(), 'js/modes.js'), 'utf8');

const navButtons = [...HTML.matchAll(/data-content-mode="([a-zA-Z]+)"/g)].map((match) => match[1]);

describe('the worship group', () => {
  it('is the three screens behind the Prayer button', () => {
    expect(WORSHIP_TABS).toEqual(['prayerTimes', 'qibla', 'tasbih']);
  });

  it('gives every one of them a way in from the nav', () => {
    for (const tab of WORSHIP_TABS) expect(navButtons, tab).toContain(tab);
  });

  it('has a sub-bar holding exactly those three', () => {
    const start = HTML.indexOf('id="worshipSubnav"');
    expect(start).toBeGreaterThan(-1);
    const bar = HTML.slice(start, HTML.indexOf('</nav>', start));
    const inBar = [...bar.matchAll(/data-content-mode="([a-zA-Z]+)"/g)].map((match) => match[1]);
    expect(inBar.sort()).toEqual([...WORSHIP_TABS].sort());
  });
});

describe('after Customize Layout was removed', () => {
  it('leaves no tab that cannot be reached', () => {
    // Every mode the app can switch to has a button somewhere in the nav. Nothing hides tabs any
    // more, so a mode missing from the markup is unreachable rather than merely switched off.
    const modes = MODES_JS.match(/const MODES = \[([^\]]+)\]/)[1]
      .split(',').map((entry) => entry.trim().replace(/'/g, '')).filter(Boolean);
    for (const mode of modes) expect(navButtons, mode).toContain(mode);
  });

  it('leaves nothing in the nav the app cannot open', () => {
    const modes = new Set(MODES_JS.match(/const MODES = \[([^\]]+)\]/)[1]
      .split(',').map((entry) => entry.trim().replace(/'/g, '')).filter(Boolean));
    for (const button of navButtons) expect(modes, button).toContain(button);
  });

  it('keeps no way to switch a tab off', () => {
    // The settings panel, its markup and its module are all gone; this fails if any of them is
    // reintroduced piecemeal, which is the usual way a removal half-happens.
    expect(HTML).not.toContain('layoutConfigList');
    expect(HTML).not.toContain('Customize layout');
    expect(HTML).not.toContain('settings-panel-layout');
  });
});
