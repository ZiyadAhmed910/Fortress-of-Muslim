import { describe, expect, it } from 'vitest';
import { computePrayerTimes, moonIllumination, solarPosition } from '../js/prayer-times.js';
import { bodyPosition, skyPalette } from '../js/sky.js';

// The sky behind the prayer card is drawn from the real solar position rather than from a fraction
// of the way between sunrise and sunset. That choice is only worth anything if the position is
// actually right, so the tests that matter here are the ones tying it back to the prayer times the
// app already computes: if the sun is not at its highest at Dhuhr, the whole idea is decoration.

const NOON_TOLERANCE_MINUTES = 2;

describe('where the sun is', () => {
  // Three latitudes, both hemispheres, and a solstice -- the day the arc is most extreme.
  const places = [
    { name: 'Makkah', latitude: 21.4225, longitude: 39.8262 },
    { name: 'London', latitude: 51.5, longitude: -0.12 },
    { name: 'Jakarta', latitude: -6.2, longitude: 106.8 },
  ];

  it.each(places)('is highest at Dhuhr in $name', ({ latitude, longitude }) => {
    const times = computePrayerTimes(latitude, longitude, new Date(2026, 5, 21));
    let best = { altitude: -Infinity, minutes: 0 };
    for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
      const { altitude } = solarPosition(latitude, longitude, new Date(2026, 5, 21, 0, minutes));
      if (altitude > best.altitude) best = { altitude, minutes };
    }
    const peakHours = best.minutes / 60;
    // This is the whole claim: solar noon and Dhuhr are the same moment, found two different ways.
    expect(Math.abs(peakHours - times.dhuhr.decimalHours) * 60).toBeLessThan(NOON_TOLERANCE_MINUTES);
  });

  it.each(places)('reaches the altitude geometry predicts in $name', ({ latitude, longitude }) => {
    // At solar noon the sun's altitude is 90 - |latitude - declination|, which is a fact about
    // spheres rather than about this code, and so a check that the code agrees with reality.
    const { declination } = solarPosition(latitude, longitude, new Date(2026, 5, 21, 12));
    let peak = -Infinity;
    for (let minutes = 0; minutes < 24 * 60; minutes += 2) {
      peak = Math.max(peak, solarPosition(latitude, longitude, new Date(2026, 5, 21, 0, minutes)).altitude);
    }
    expect(peak).toBeCloseTo(90 - Math.abs(latitude - declination), 0);
  });

  it('is below the horizon in the middle of the night', () => {
    const { altitude } = solarPosition(21.4225, 39.8262, new Date(2026, 5, 21, 0, 0));
    expect(altitude).toBeLessThan(0);
  });

  it('runs east to west: negative hour angle in the morning, positive after noon', () => {
    const times = computePrayerTimes(21.4225, 39.8262, new Date(2026, 5, 21));
    const dhuhr = times.dhuhr.decimalHours;
    const before = solarPosition(21.4225, 39.8262, new Date(2026, 5, 21, 0, Math.round((dhuhr - 3) * 60)));
    const after = solarPosition(21.4225, 39.8262, new Date(2026, 5, 21, 0, Math.round((dhuhr + 3) * 60)));
    expect(before.hourAngle).toBeLessThan(0);
    expect(after.hourAngle).toBeGreaterThan(0);
  });
});

describe('where it gets drawn', () => {
  it('puts the zenith at the top, dead centre', () => {
    // The thing that was asked for in so many words: at Dhuhr the sun is straight ahead, at twelve.
    const { x, y } = bodyPosition(90, 0);
    expect(x).toBe(50);
    expect(y).toBeLessThan(8);
  });

  it('puts the horizon at the horizon', () => {
    expect(bodyPosition(0, 0).y).toBeCloseTo(27, 5);
  });

  it('puts morning on the left and afternoon on the right', () => {
    expect(bodyPosition(30, -60).x).toBeLessThan(50);
    expect(bodyPosition(30, 60).x).toBeGreaterThan(50);
  });

  it('rises and falls monotonically with altitude', () => {
    let previous = Infinity;
    for (let altitude = 0; altitude <= 90; altitude += 5) {
      const { y } = bodyPosition(altitude, 0);
      expect(y).toBeLessThanOrEqual(previous);
      previous = y;
    }
  });

  it('keeps a body below the horizon just out of sight rather than off the card', () => {
    const { y } = bodyPosition(-40, 0);
    expect(y).toBeGreaterThan(27);
    expect(y).toBeLessThan(34); // still inside the viewBox
  });
});

describe('the colour of the sky', () => {
  const luminance = (hex) => [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0);

  it('is darker at night than during the day', () => {
    expect(luminance(skyPalette(-18).top)).toBeLessThan(luminance(skyPalette(45).top));
  });

  it('brightens steadily through twilight, where dawn actually happens', () => {
    // Only across the twilight range. Past it the claim stops being true and stops being desirable:
    // the sky directly overhead at noon is a deeper blue than the same sky at mid-morning, so a
    // palette that kept brightening to the zenith would be wrong about the thing it is drawing.
    let previous = -Infinity;
    for (let altitude = -18; altitude <= 14; altitude += 2) {
      const value = luminance(skyPalette(altitude).top);
      expect(value, `altitude ${altitude}`).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('is brightest near the horizon at noon, not overhead', () => {
    // Which is the same fact from the other side, stated as something a reader would notice.
    expect(luminance(skyPalette(60).bottom)).toBeGreaterThan(luminance(skyPalette(60).top));
  });

  it('is warm at the horizon and cool overhead', () => {
    const red = (hex) => parseInt(hex.slice(1, 3), 16);
    const blue = (hex) => parseInt(hex.slice(5, 7), 16);
    const dusk = skyPalette(0).bottom;
    const noon = skyPalette(60).bottom;
    expect(red(dusk) / blue(dusk)).toBeGreaterThan(red(noon) / blue(noon));
  });

  it('holds at the ends rather than running off the scale', () => {
    expect(skyPalette(-90)).toEqual(skyPalette(-18));
    expect(skyPalette(200)).toEqual(skyPalette(90));
  });

  it('always returns a valid colour', () => {
    for (let altitude = -90; altitude <= 90; altitude += 1) {
      const palette = skyPalette(altitude);
      for (const value of Object.values(palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('the moon', () => {
  it('goes through a full cycle in a synodic month', () => {
    const start = new Date(2026, 0, 1, 12);
    const month = moonIllumination(start);
    const later = moonIllumination(new Date(start.getTime() + 29.530588853 * 86400000));
    expect(later.phase).toBeCloseTo(month.phase, 2);
  });

  it('is dark at new and full halfway through', () => {
    // Walk a month and find the extremes rather than asserting a specific date, which would be
    // asserting the epoch constant rather than the behaviour.
    let darkest = { illuminated: Infinity };
    let brightest = { illuminated: -Infinity };
    for (let day = 0; day < 30; day += 0.25) {
      const value = moonIllumination(new Date(2026, 0, 1 + day, 12));
      if (value.illuminated < darkest.illuminated) darkest = value;
      if (value.illuminated > brightest.illuminated) brightest = value;
    }
    expect(darkest.illuminated).toBeLessThan(0.01);
    expect(brightest.illuminated).toBeGreaterThan(0.99);
    expect(brightest.phase).toBeCloseTo(0.5, 1);
  });

  it('waxes through the first half of the cycle and wanes through the second', () => {
    for (let day = 0; day < 30; day += 0.5) {
      const value = moonIllumination(new Date(2026, 0, 1 + day, 12));
      expect(value.waxing).toBe(value.phase < 0.5);
    }
  });

  it('keeps illumination inside nought and one', () => {
    for (let day = 0; day < 60; day += 0.3) {
      const { illuminated } = moonIllumination(new Date(2026, 0, 1 + day, 6));
      expect(illuminated).toBeGreaterThanOrEqual(0);
      expect(illuminated).toBeLessThanOrEqual(1);
    }
  });
});
