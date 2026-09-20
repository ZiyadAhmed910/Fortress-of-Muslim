import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { compassAxes, headingFromAxes, headingFromOrientationEvent, nextSmoothedHeading } from '../js/prayer.js';

// The compass was reported as "does not move and was inaccurate", and then as only working flat.
// A phone is held two ways -- flat in the palm, or stood up and pointed -- and each pose has an
// axis that answers "which way is this facing" and an axis that cannot answer it at all. These pin
// the 3D maths that picks between them, plus the older faults: readings with no north reference
// being trusted, a phone held sideways reading 90 degrees off, and a dial that spun the long way
// round at north.

const orientation = (fields) => ({ absolute: false, alpha: null, beta: 0, gamma: 0, ...fields });
const bearing = (axis) => ((Math.atan2(axis[0], axis[1]) * 180 / Math.PI) % 360 + 360) % 360;
const flat = (axis) => Math.hypot(axis[0], axis[1]);

describe('the device axes in Earth coordinates', () => {
  it('puts the top edge of a flat phone on the horizon, and its back on the ground', () => {
    const { top, back } = compassAxes(0, 0, 0);
    expect(bearing(top)).toBeCloseTo(0);        // top edge points north
    expect(flat(top)).toBeCloseTo(1);           // and lies entirely in the horizontal plane
    expect(flat(back)).toBeCloseTo(0);          // the back points straight down: no bearing at all
  });

  it('puts the back of an upright phone on the horizon, and its top edge in the sky', () => {
    const { top, back } = compassAxes(0, 90, 0);
    expect(bearing(back)).toBeCloseTo(0);       // the phone points north
    expect(flat(back)).toBeCloseTo(1);
    expect(flat(top)).toBeCloseTo(0);
  });

  it('agrees between the two axes wherever both can be read', () => {
    // Tilting a phone up does not change which way it faces, so the handover has nothing to jump.
    for (const beta of [30, 45, 60]) {
      const { top, back } = compassAxes(0, beta, 0);
      expect(bearing(back)).toBeCloseTo(bearing(top), 6);
    }
  });

  it('leaves the pointing direction alone when an upright phone is rolled to landscape', () => {
    // All three of these are the same phone, back facing north, turned in the hand: portrait, then
    // rolled each way into landscape. Which way it points must not care how the picture is turned.
    for (const [alpha, beta, gamma] of [[0, 90, 0], [270, 90, 90], [90, 90, -90]]) {
      const { back } = compassAxes(alpha, beta, gamma);
      expect(bearing(back), `${alpha}/${beta}/${gamma}`).toBeCloseTo(0, 6);
      expect(flat(back)).toBeCloseTo(1);
    }
  });

  it('does turn when the phone is actually turned, roll or no roll', () => {
    // The mirror of the case above, and the one that catches a formula that merely ignores gamma:
    // rolling about an axis that happens to point at the sky really does swing where a phone faces.
    expect(bearing(compassAxes(0, 90, 90).back)).toBeCloseTo(270, 6);
    expect(bearing(compassAxes(90, 90, 0).back)).toBeCloseTo(270, 6);
  });

  it('always leaves one axis readable, whatever the pose', () => {
    let worst = 1;
    for (let a = 0; a < 360; a += 17) {
      for (let b = -90; b <= 90; b += 13) {
        for (let g = -90; g <= 90; g += 13) {
          const { top, back } = compassAxes(a, b, g);
          worst = Math.min(worst, Math.max(flat(top), flat(back)));
        }
      }
    }
    expect(worst).toBeGreaterThan(0.7);
  });
});

describe('choosing which axis to believe', () => {
  it('reads the top edge when the phone is flat', () => {
    expect(headingFromAxes(compassAxes(0, 0, 0)).source).toBe('top');
  });

  it('reads the back of the phone when it is stood up', () => {
    expect(headingFromAxes(compassAxes(0, 90, 0)).source).toBe('back');
  });

  it('keeps the axis it is already using across the crossover, rather than chattering', () => {
    // At 45 degrees the two are equally readable; without the margin the source would flip on noise.
    expect(headingFromAxes(compassAxes(0, 45, 0), 'top').source).toBe('top');
    expect(headingFromAxes(compassAxes(0, 45, 0), 'back').source).toBe('back');
  });

  it('still hands over once the other axis is clearly better', () => {
    expect(headingFromAxes(compassAxes(0, 80, 0), 'top').source).toBe('back');
    expect(headingFromAxes(compassAxes(0, 10, 0), 'back').source).toBe('top');
  });
});

describe('reading a compass heading from the device', () => {
  beforeEach(() => {
    Object.defineProperty(window.screen, 'orientation', { value: { angle: 0 }, configurable: true });
  });

  it('converts iOS true-north heading into the same 3D maths', () => {
    // Safari never north-references alpha; webkitCompassHeading is the top edge's bearing, which is
    // what alpha encodes, so it converts back and the upright pose works on iOS too.
    const flatPhone = headingFromOrientationEvent(orientation({ webkitCompassHeading: 123.4, beta: 0, gamma: 0 }));
    expect(flatPhone.heading).toBeCloseTo(123.4);
    expect(flatPhone.source).toBe('top');
    const upright = headingFromOrientationEvent(orientation({ webkitCompassHeading: 123.4, beta: 90, gamma: 0 }));
    expect(upright.source).toBe('back');
    expect(upright.heading).toBeCloseTo(123.4);
  });

  it('converts an absolute alpha, which counts the other way round', () => {
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 0 })).heading).toBeCloseTo(0);
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 90 })).heading).toBeCloseTo(270);
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 270 })).heading).toBeCloseTo(90);
  });

  it('refuses a reading with no north reference rather than pointing somewhere wrong', () => {
    // absolute:false means alpha is measured from wherever the device happened to be pointing when
    // the sensor started. Using it is what made the needle confidently incorrect.
    expect(headingFromOrientationEvent(orientation({ absolute: false, alpha: 90 }))).toBeNull();
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: null }))).toBeNull();
  });

  it('accounts for a phone held sideways while flat', () => {
    Object.defineProperty(window.screen, 'orientation', { value: { angle: 90 }, configurable: true });
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 270 })).heading).toBeCloseTo(180);
  });

  it('ignores the screen rotation once it is reading the back of the phone', () => {
    // Which way the phone points does not depend on how the picture on its screen is turned.
    Object.defineProperty(window.screen, 'orientation', { value: { angle: 90 }, configurable: true });
    const reading = headingFromOrientationEvent(orientation({ absolute: true, alpha: 0, beta: 90, gamma: 0 }));
    expect(reading.source).toBe('back');
    expect(reading.heading).toBeCloseTo(0);
  });

  it('survives a browser with no screen.orientation at all', () => {
    Object.defineProperty(window.screen, 'orientation', { value: undefined, configurable: true });
    expect(headingFromOrientationEvent(orientation({ absolute: true, alpha: 90 })).heading).toBeCloseTo(270);
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
