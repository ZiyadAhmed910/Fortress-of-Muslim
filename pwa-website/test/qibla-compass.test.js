import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { headingFromOrientationEvent, nextSmoothedHeading } from '../js/prayer.js';

// The compass was reported as "does not move and was inaccurate". Three separate causes, all of
// them invisible from the outside: readings with no north reference being used as if they had one,
// a phone held sideways reading 90 degrees off, and a dial that spun the long way round every time
// the user faced north. The maths for all three lives here.
const orientation = (fields) => ({ absolute: false, alpha: null, beta: 0, gamma: 0, ...fields });

describe('reading a compass heading from the device', () => {
  beforeEach(() => {
    Object.defineProperty(window.screen, 'orientation', { value: { angle: 0 }, configurable: true });
  });

  it('takes iOS at its word -- webkitCompassHeading is already north-referenced', () => {
    expect(headingFromOrientationEvent(orientation({ webkitCompassHeading: 123.4 }))).toBe(123.4);
  });

  it('converts an absolute alpha, which counts the other way round', () => {
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 0 }))).toBe(0);
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 90 }))).toBe(270);
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 270 }))).toBe(90);
  });

  it('refuses a reading with no north reference rather than pointing somewhere wrong', () => {
    // absolute:false means alpha is measured from wherever the device happened to be pointing when
    // the sensor started. Using it is what made the needle confidently incorrect.
    expect(headingFromOrientationEvent(orientation({ absolute: false, alpha: 90 }))).toBeNull();
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: null }))).toBeNull();
  });

  it('accounts for a phone held sideways', () => {
    Object.defineProperty(window.screen, 'orientation', { value: { angle: 90 }, configurable: true });
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 270 }))).toBe(180);
  });

  it('survives a browser with no screen.orientation at all', () => {
    Object.defineProperty(window.screen, 'orientation', { value: undefined, configurable: true });
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 90 }))).toBe(270);
  });
});

describe('smoothing the needle', () => {
  it('starts wherever the first reading is', () => {
    expect(nextSmoothedHeading(null, 42)).toBe(42);
  });

  it('eases toward a new reading instead of snapping to every twitch', () => {
    expect(nextSmoothedHeading(0, 100, 0.25)).toBe(25);
  });

  it('crosses north the short way, never the long way round', () => {
    // 350 -> 10 is 20 degrees clockwise. Treated as plain numbers it is 340 degrees backwards, and
    // the dial visibly spins every time the user faces north.
    expect(nextSmoothedHeading(350, 10, 1)).toBe(370);
    expect(nextSmoothedHeading(10, 350, 1)).toBe(-10);
  });

  it('keeps a continuous angle so repeated crossings do not unwind', () => {
    let heading = 350;
    for (const reading of [10, 30, 350, 330]) heading = nextSmoothedHeading(heading, reading, 1);
    expect(heading).toBe(330);
  });
});

describe('getting a location when the browser has already been told no', () => {
  const prayer = readFileSync(resolve(process.cwd(), 'js/prayer.js'), 'utf8');
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const locationUi = prayer.slice(prayer.indexOf('function initLocationUi'), prayer.indexOf('async function explainLocationFailure'));

  it('shows the content once a location resolves, not just the label', () => {
    // Entering coordinates by hand updated the label and left the Qibla card and the prayer list
    // hidden, so it looked like nothing had happened at all.
    expect(locationUi).toContain('showLocationKnown(tab, currentCoordinates)');
    expect(locationUi).not.toContain('showLocationKnownFor({ label, button }, currentCoordinates)');
  });

  it('tells the reader where the switch is, in the page rather than a toast', () => {
    expect(prayer).toContain('Location is blocked for this site');
    expect(prayer).toContain("name: 'geolocation'");
    for (const tab of ['prayerTimes', 'qibla']) expect(html).toContain(`id="${tab}LocationHint"`);
  });

  it('treats an unanswerable permission query as "not blocked"', () => {
    // Safari has no geolocation permission query; guessing "blocked" there would tell everyone on
    // iOS to go and unblock something that was never blocked.
    const blocked = prayer.slice(prayer.indexOf('async function geolocationBlocked'));
    expect(blocked.slice(0, 400)).toContain('return false;');
  });
});

describe('a compass that cannot work says so', () => {
  const prayer = readFileSync(resolve(process.cwd(), 'js/prayer.js'), 'utf8');

  it('waits for a real reading before claiming to be live', () => {
    expect(prayer).toContain('COMPASS_TIMEOUT_MS');
    expect(prayer).toContain('compassWatchdog = setTimeout');
  });

  it('keeps its explanation when the card re-renders', () => {
    // A background location refresh re-renders this card and used to reset the note to
    // "tap to start", erasing the reason the compass had just failed.
    expect(prayer).toContain('} else if (compassStatusNote) {');
  });

  it('only gives up when the permission was actually refused', () => {
    // Chromium exposes requestPermission too and can reject it without meaning "no".
    expect(prayer).toContain("if (permission === 'denied')");
    expect(prayer).toContain("permission = 'failed'");
  });
});
