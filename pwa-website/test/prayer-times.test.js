import { describe, expect, it } from 'vitest';
import {
  compassDirectionLabel,
  computePrayerTimes,
  computeQiblaBearing,
  formatPrayerClock,
  nextPrayer,
  prayerTimesList,
  HIGH_LATITUDE_RULES,
  DEFAULT_HIGH_LATITUDE_RULE,
} from '../js/prayer-times.js';

// Times are compared against published values with a tolerance, because calculation methods differ
// by a minute or two between implementations. The point of these tests is that the maths is sane
// and stays sane, not that it matches one particular mosque's printed timetable exactly.
const minutesOf = (time) => time.hours * 60 + time.minutes;
const near = (time, hh, mm, tolerance = 4) => {
  expect(time).not.toBeNull();
  expect(Math.abs(minutesOf(time) - (hh * 60 + mm))).toBeLessThanOrEqual(tolerance);
};

describe('computePrayerTimes', () => {
  it('computes Makkah times that sit in the right part of the day', () => {
    const times = computePrayerTimes(21.4225, 39.8262, new Date(2026, 5, 15), 'ummalqura', 'standard', 3);
    near(times.dhuhr, 12, 26, 6);
    expect(minutesOf(times.fajr)).toBeLessThan(minutesOf(times.sunrise));
    expect(minutesOf(times.sunrise)).toBeLessThan(minutesOf(times.dhuhr));
    expect(minutesOf(times.dhuhr)).toBeLessThan(minutesOf(times.asr));
    expect(minutesOf(times.asr)).toBeLessThan(minutesOf(times.maghrib));
    expect(minutesOf(times.maghrib)).toBeLessThan(minutesOf(times.isha));
  });

  it('keeps prayers in order across a whole year at a mid latitude', () => {
    for (let month = 0; month < 12; month += 1) {
      const times = computePrayerTimes(51.5074, -0.1278, new Date(2026, month, 15), 'mwl', 'standard', 0);
      const ordered = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib'];
      for (let i = 1; i < ordered.length; i += 1) {
        expect(times[ordered[i]], `${ordered[i]} in month ${month + 1}`).not.toBeNull();
        expect(minutesOf(times[ordered[i]]), `${ordered[i]} after ${ordered[i - 1]} in month ${month + 1}`)
          .toBeGreaterThan(minutesOf(times[ordered[i - 1]]));
      }
    }
  });

  it('puts Hanafi Asr later than standard Asr', () => {
    const date = new Date(2026, 3, 10);
    const standard = computePrayerTimes(24.7136, 46.6753, date, 'ummalqura', 'standard', 3);
    const hanafi = computePrayerTimes(24.7136, 46.6753, date, 'ummalqura', 'hanafi', 3);
    expect(minutesOf(hanafi.asr)).toBeGreaterThan(minutesOf(standard.asr));
  });

  it('marks nothing as estimated at a latitude where the sun sets normally', () => {
    const times = computePrayerTimes(21.4225, 39.8262, new Date(2026, 5, 15), 'mwl', 'standard', 3);
    expect(times.estimated).toEqual([]);
  });
});

// The bug this covers: above roughly 48 degrees the sun never reaches the Fajr/Isha depression
// angle on some dates, hourAngle returns null, and the app previously showed nothing at all.
describe('high latitude', () => {
  // Oslo in midsummer: the sun sets, but never descends to the twilight angle, so Fajr and Isha
  // must be derived from the length of the night. This is the common case the rules exist for.
  const OSLO = [59.9139, 10.7522];
  const MIDSUMMER = new Date(2026, 5, 21);
  // Tromso is inside the Arctic Circle, where midsummer has no sunset at all and the nearest
  // latitude convention takes over instead.
  const TROMSO = [69.6492, 18.9553];

  it('would have no Fajr or Isha without a rule applied', () => {
    const times = computePrayerTimes(...OSLO, MIDSUMMER, 'mwl', 'standard', 2, 'none');
    expect(times.fajr).toBeNull();
    expect(times.isha).toBeNull();
    expect(times.estimated).toEqual([]);
  });

  it.each(['angle', 'seventh', 'midnight'])('estimates Fajr and Isha under the %s rule', (rule) => {
    const times = computePrayerTimes(...OSLO, MIDSUMMER, 'mwl', 'standard', 2, rule);
    expect(times.fajr).not.toBeNull();
    expect(times.isha).not.toBeNull();
    expect(times.estimated).toEqual(['fajr', 'isha']);
    expect(times.highLatitudeRule).toBe(rule);
  });

  it('pushes Isha further past Maghrib the larger the night portion', () => {
    // Measured as an offset from Maghrib, not as clock time: at this latitude the midnight rule puts
    // Isha after 00:00, so comparing raw minutes-since-midnight would say it is the earlier of the two.
    const offsetFromMaghrib = (rule) => {
      const t = computePrayerTimes(...OSLO, MIDSUMMER, 'mwl', 'standard', 2, rule);
      return (minutesOf(t.isha) - minutesOf(t.maghrib) + 1440) % 1440;
    };
    expect(offsetFromMaghrib('midnight')).toBeGreaterThan(offsetFromMaghrib('seventh'));
    expect(offsetFromMaghrib('seventh')).toBeGreaterThan(0);
  });

  it('defaults to the angle-based rule', () => {
    const times = computePrayerTimes(...OSLO, MIDSUMMER, 'mwl', 'standard', 2);
    expect(times.highLatitudeRule).toBe(DEFAULT_HIGH_LATITUDE_RULE);
    expect(DEFAULT_HIGH_LATITUDE_RULE).toBe('angle');
  });

  it('offers exactly the conventions the UI expects', () => {
    expect(Object.keys(HIGH_LATITUDE_RULES).sort()).toEqual(['angle', 'midnight', 'none', 'seventh']);
  });

  it('falls back to the nearest latitude inside the Arctic Circle, where there is no night to divide', () => {
    for (const date of [new Date(2026, 5, 21), new Date(2026, 11, 21)]) {
      const times = computePrayerTimes(...TROMSO, date, 'mwl', 'standard', 2, 'angle');
      for (const key of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']) {
        expect(times[key], `${key} on ${date.toDateString()}`).not.toBeNull();
      }
      // Every time is derived rather than observed, so all six are flagged.
      expect(times.estimated).toHaveLength(6);
    }
  });

  it('leaves normal latitudes untouched whichever rule is set', () => {
    const a = computePrayerTimes(21.4225, 39.8262, new Date(2026, 2, 1), 'mwl', 'standard', 3, 'angle');
    const b = computePrayerTimes(21.4225, 39.8262, new Date(2026, 2, 1), 'mwl', 'standard', 3, 'midnight');
    expect(minutesOf(a.fajr)).toBe(minutesOf(b.fajr));
    expect(minutesOf(a.isha)).toBe(minutesOf(b.isha));
  });
});

describe('computeQiblaBearing', () => {
  // Published bearings, tolerance of a degree.
  it.each([
    ['London', 51.5074, -0.1278, 118.9],
    ['New York', 40.7128, -74.0060, 58.5],
    ['Jakarta', -6.2088, 106.8456, 295.1],
    ['Cape Town', -33.9249, 18.4241, 23.4],
  ])('points from %s toward the Kaaba', (_name, lat, lng, expected) => {
    expect(computeQiblaBearing(lat, lng)).toBeCloseTo(expected, 0);
  });

  it('is undefined-but-stable at the Kaaba itself', () => {
    expect(Number.isFinite(computeQiblaBearing(21.4225, 39.8262))).toBe(true);
  });
});

describe('helpers', () => {
  it('labels compass directions', () => {
    expect(compassDirectionLabel(0)).toBe('N');
    expect(compassDirectionLabel(90)).toBe('E');
    expect(compassDirectionLabel(180)).toBe('S');
    expect(compassDirectionLabel(359)).toBe('N');
  });

  it('formats a 12-hour clock', () => {
    expect(formatPrayerClock({ hours: 0, minutes: 5 })).toBe('12:05 AM');
    expect(formatPrayerClock({ hours: 12, minutes: 0 })).toBe('12:00 PM');
    expect(formatPrayerClock({ hours: 17, minutes: 9 })).toBe('5:09 PM');
    expect(formatPrayerClock(null)).toBe('--:--');
  });

  it('excludes sunrise from the prayer list but keeps it in the timetable', () => {
    const times = computePrayerTimes(21.4225, 39.8262, new Date(2026, 5, 15), 'mwl', 'standard', 3);
    expect(prayerTimesList(times).map((p) => p.key)).toContain('sunrise');
    const next = nextPrayer(times, new Date(2026, 5, 15, 5, 30));
    expect(next.key).not.toBe('sunrise');
  });

  it('wraps to tomorrow once the day is over', () => {
    const times = computePrayerTimes(21.4225, 39.8262, new Date(2026, 5, 15), 'mwl', 'standard', 3);
    expect(nextPrayer(times, new Date(2026, 5, 15, 23, 59)).key).toBe('fajr');
  });
});
