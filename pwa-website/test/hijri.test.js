import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HIJRI_MONTHS,
  countdownLabel,
  gregorianToHijri,
  hijriSupported,
  nextIslamicEvent,
  readAdjustmentSetting,
  regionFor,
  resolveAdjustment,
  upcomingIslamicEvents,
  writeAdjustmentSetting,
} from '../js/hijri.js';

// The Hijri date comes from the browser's own Umm al-Qura calendar. That is one convention among
// several -- the start of a month is set by local moon sighting, and can differ by a day -- so these
// do not claim the dates are "correct". They pin the conversion to the published Umm al-Qura
// calendar on dates that are a matter of record, and they pin the parts that are this app's own
// logic: finding the soonest event, crossing the Hijri year, and refusing to guess when the
// calendar is not there.

const EVENTS = JSON.parse(readFileSync(resolve(process.cwd(), 'data/hijri-events.json'), 'utf8')).events;
const day = (year, month, date) => new Date(year, month - 1, date, 12);

afterEach(() => vi.restoreAllMocks());

describe('converting a date', () => {
  it.each([
    ['1 Ramadan 1445', day(2024, 3, 11), { year: 1445, month: 9, day: 1 }],
    ['1 Shawwal 1445, Eid al-Fitr', day(2024, 4, 10), { year: 1445, month: 10, day: 1 }],
    ['10 Dhul Hijjah 1445, Eid al-Adha', day(2024, 6, 16), { year: 1445, month: 12, day: 10 }],
    ['1 Muharram 1446, the new year', day(2024, 7, 7), { year: 1446, month: 1, day: 1 }],
    ['1 Ramadan 1446', day(2025, 3, 1), { year: 1446, month: 9, day: 1 }],
  ])('gives %s', (_label, date, expected) => {
    expect(gregorianToHijri(date)).toMatchObject(expected);
  });

  it('names the month', () => {
    expect(gregorianToHijri(day(2024, 3, 11)).monthName).toBe('Ramadan');
  });

  it('reads the calendar day, not the instant', () => {
    // A minute after midnight and a minute before the next are the same Hijri date.
    const early = gregorianToHijri(new Date(2024, 2, 11, 0, 1));
    const late = gregorianToHijri(new Date(2024, 2, 11, 23, 59));
    expect(early).toEqual(late);
  });
});

describe('the next date that matters', () => {
  it('finds Ramadan from the day before it', () => {
    const next = nextIslamicEvent(EVENTS, day(2024, 3, 10));
    expect(next.key).toBe('ramadan');
    expect(next.daysUntil).toBe(1);
  });

  it('counts an event today as today', () => {
    const next = nextIslamicEvent(EVENTS, day(2024, 4, 10));
    expect(next.key).toBe('eid-al-fitr');
    expect(next.daysUntil).toBe(0);
  });

  it('puts Arafah the day before Eid al-Adha', () => {
    const list = upcomingIslamicEvents(EVENTS, day(2024, 6, 1));
    const arafah = list.find((event) => event.key === 'arafah');
    const eid = list.find((event) => event.key === 'eid-al-adha');
    expect(eid.daysUntil - arafah.daysUntil).toBe(1);
  });

  it('crosses into the next Hijri year for an event already passed', () => {
    // The day after Ashura 1446: the new year and Ashura have both gone, so they must come round
    // again in 1447 rather than being missed or found in the past.
    const list = upcomingIslamicEvents(EVENTS, day(2024, 7, 17));
    const newYear = list.find((event) => event.key === 'new-year');
    expect(newYear.hijri.year).toBe(1447);
    expect(newYear.daysUntil).toBeGreaterThan(300);
  });

  it('lists every event once, soonest first', () => {
    const list = upcomingIslamicEvents(EVENTS, day(2025, 1, 1));
    expect(list).toHaveLength(EVENTS.length);
    expect(new Set(list.map((event) => event.key)).size).toBe(EVENTS.length);
    for (let index = 1; index < list.length; index += 1) {
      expect(list[index].daysUntil).toBeGreaterThanOrEqual(list[index - 1].daysUntil);
    }
  });

  it('agrees with the list about which is next', () => {
    for (const from of [day(2024, 1, 1), day(2024, 5, 20), day(2024, 12, 31), day(2025, 8, 8)]) {
      expect(nextIslamicEvent(EVENTS, from)).toEqual(upcomingIslamicEvents(EVENTS, from)[0]);
    }
  });

  it('finds every event within a year from any day of the year', () => {
    for (let offset = 0; offset < 366; offset += 7) {
      const from = new Date(2024, 0, 1 + offset, 12);
      expect(upcomingIslamicEvents(EVENTS, from)).toHaveLength(EVENTS.length);
    }
  });
});

describe('when the calendar is missing', () => {
  it('says so rather than showing a Gregorian date as Hijri', () => {
    // An unknown calendar does not throw in Intl -- it silently becomes Gregorian. So this fakes
    // exactly that and checks nothing downstream pretends otherwise.
    const RealFormat = Intl.DateTimeFormat;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function fallback() {
      const format = new RealFormat('en');
      return { ...format, resolvedOptions: () => ({ ...format.resolvedOptions(), calendar: 'gregory' }), formatToParts: format.formatToParts.bind(format), format: format.format.bind(format) };
    });
    expect(hijriSupported()).toBe(false);
    expect(gregorianToHijri(day(2024, 3, 11))).toBeNull();
    expect(nextIslamicEvent(EVENTS, day(2024, 3, 11))).toBeNull();
    expect(upcomingIslamicEvents(EVENTS, day(2024, 3, 11))).toEqual([]);
  });
});

describe('the countdown', () => {
  it.each([[0, 'Today'], [1, 'Tomorrow'], [12, 'in 12 days']])('%d reads %s', (days, label) => {
    expect(countdownLabel(days)).toBe(label);
  });
});

describe('month names', () => {
  it('names Rabi al-Thani by its own name, never the Gregorian name of the same number', () => {
    // Chrome on Android lacks Hijri month names and Intl lent it "April" for month 4 -- reported
    // on 24 September 2026, which is 13 Rabi' al-Thani 1448 in Umm al-Qura.
    const today = gregorianToHijri(day(2026, 9, 24));
    expect(today).toMatchObject({ year: 1448, month: 4, day: 13, monthName: "Rabi' al-Thani" });
  });

  it('uses the app\'s own name for every month, whatever the browser would call it', () => {
    for (let offset = 0; offset < 360; offset += 29) {
      const hijri = gregorianToHijri(day(2026, 1, 1 + offset));
      expect(hijri.monthName).toBe(HIJRI_MONTHS[hijri.month - 1]);
    }
    expect(HIJRI_MONTHS).toHaveLength(12);
  });
});

describe('where you are', () => {
  it.each([
    ['Mumbai', 19.07, 72.88, 'south-asia'],
    ['Delhi', 28.61, 77.21, 'south-asia'],
    ['Hyderabad', 17.39, 78.49, 'south-asia'],
    ['Karachi', 24.86, 67.01, 'south-asia'],
    ['Lahore', 31.55, 74.34, 'south-asia'],
    ['Dhaka', 23.81, 90.41, 'south-asia'],
    ['Colombo', 6.93, 79.86, 'south-asia'],
    ['Kathmandu', 27.72, 85.32, 'south-asia'],
    ['Riyadh', 24.71, 46.68, 'arabia'],
    ['Makkah', 21.39, 39.86, 'arabia'],
    ['Dubai', 25.2, 55.27, 'arabia'],
    ['Doha', 25.29, 51.53, 'arabia'],
    ['Casablanca', 33.57, -7.59, 'morocco'],
    ['Marrakesh', 31.63, -8.0, 'morocco'],
  ])('puts %s in its region', (_city, latitude, longitude, id) => {
    expect(regionFor({ latitude, longitude })?.id).toBe(id);
  });

  it.each([
    ['Kabul', 34.53, 69.17],
    ['Yangon', 16.84, 96.17],
    ['Tehran', 35.69, 51.39],
    ['Istanbul', 41.01, 28.98],
    ['London', 51.51, -0.13],
    ['Cairo', 30.04, 31.24],
    ['Algiers', 36.75, 3.06],
  ])('leaves %s on plain Umm al-Qura, outside every region', (_city, latitude, longitude) => {
    expect(regionFor({ latitude, longitude })).toBeNull();
  });

  it('falls back to the time zone when there is no prayer location', () => {
    expect(regionFor({ timeZone: 'Asia/Kolkata' })).toMatchObject({ id: 'south-asia', name: 'India', from: 'timeZone' });
    expect(regionFor({ timeZone: 'Asia/Riyadh' })).toMatchObject({ id: 'arabia', days: 0 });
    expect(regionFor({ timeZone: 'Europe/London' })).toBeNull();
  });

  it('believes the prayer location over the time zone -- someone travelling is where they are', () => {
    // An Indian phone in Makkah: the location says Arabia, and Arabia is what counts.
    expect(regionFor({ latitude: 21.39, longitude: 39.86, timeZone: 'Asia/Kolkata' })?.id).toBe('arabia');
    // And a location outside every region is not overruled by the time zone either.
    expect(regionFor({ latitude: 51.51, longitude: -0.13, timeZone: 'Asia/Kolkata' })).toBeNull();
  });
});

describe('the date for where you are', () => {
  it('puts India a day behind Umm al-Qura by default', () => {
    const adjustment = resolveAdjustment('auto', { latitude: 17.39, longitude: 78.49 });
    expect(adjustment).toMatchObject({ days: -1, source: 'region' });
    expect(gregorianToHijri(day(2026, 9, 24), adjustment.days)).toMatchObject({ day: 12, month: 4, year: 1448 });
  });

  it('leaves Saudi Arabia on Umm al-Qura', () => {
    const adjustment = resolveAdjustment('auto', { latitude: 24.71, longitude: 46.68 });
    expect(gregorianToHijri(day(2026, 9, 24), adjustment.days)).toMatchObject({ day: 13, month: 4 });
  });

  it('lets a choice someone made win over the region', () => {
    expect(resolveAdjustment(0, { latitude: 17.39, longitude: 78.49 })).toMatchObject({ days: 0, source: 'manual' });
    expect(resolveAdjustment(-2, { timeZone: 'Asia/Riyadh' })).toMatchObject({ days: -2, source: 'manual' });
    expect(resolveAdjustment('auto', {})).toMatchObject({ days: 0, source: 'default', region: null });
  });

  it('moves the events with the date: Ramadan begins a day later in India', () => {
    // 1 Ramadan 1445 was 11 March 2024 in Umm al-Qura; a day behind, it falls on the 12th.
    const saudi = upcomingIslamicEvents(EVENTS, day(2024, 3, 1), 0).find((event) => event.key === 'ramadan');
    const india = upcomingIslamicEvents(EVENTS, day(2024, 3, 1), -1).find((event) => event.key === 'ramadan');
    expect(saudi.date.getDate()).toBe(11);
    expect(india.date.getDate()).toBe(12);
    expect(india.hijri).toMatchObject({ day: 1, month: 9 });
  });

  it('keeps the stored choice to the ones on offer', () => {
    const store = new Map();
    const storage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
    expect(readAdjustmentSetting(storage)).toBe('auto');
    writeAdjustmentSetting(-1, storage);
    expect(readAdjustmentSetting(storage)).toBe(-1);
    writeAdjustmentSetting(7, storage);
    expect(readAdjustmentSetting(storage)).toBe(-1);
    store.set('hijriAdjustment', 'banana');
    expect(readAdjustmentSetting(storage)).toBe('auto');
    writeAdjustmentSetting('auto', storage);
    expect(readAdjustmentSetting(storage)).toBe('auto');
  });
});

describe('the region outlines, at the edges', () => {
  // Coastal cities are where a coarse outline goes wrong -- Dubai, Casablanca, Jeddah, Aden and Gwadar
  // all fell on the sea side of a first draft -- and neighbours with a different practice are where
  // it must not reach.
  const inside = {
    'south-asia': [['Peshawar', 34.01, 71.58], ['Quetta', 30.18, 67.0], ['Srinagar', 34.08, 74.8], ['Chittagong', 22.35, 91.8],
      ['Kochi', 9.93, 76.27], ['Chennai', 13.08, 80.27], ['Kolkata', 22.57, 88.36], ['Guwahati', 26.14, 91.74],
      ['Jaffna', 9.66, 80.02], ['Thiruvananthapuram', 8.52, 76.94], ['Ahmedabad', 23.02, 72.57], ['Gwadar', 25.13, 62.33],
      ['Sylhet', 24.9, 91.87]],
    arabia: [['Jeddah', 21.54, 39.17], ['Madinah', 24.47, 39.61], ['Tabuk', 28.38, 36.57], ['Dammam', 26.43, 50.1],
      ['Kuwait City', 29.37, 47.98], ['Manama', 26.23, 50.59], ['Abu Dhabi', 24.45, 54.37], ['Sharjah', 25.35, 55.42],
      ['Ras al-Khaimah', 25.8, 55.94], ["Sana'a", 15.37, 44.19], ['Aden', 12.79, 45.03], ['Hodeidah', 14.8, 42.95],
      ['Jizan', 16.89, 42.55]],
    morocco: [['Rabat', 34.02, -6.84], ['Tangier', 35.77, -5.8], ['Agadir', 30.43, -9.6], ['Fes', 34.03, -5.0],
      ['Oujda', 34.68, -1.91], ['Laayoune', 27.15, -13.2], ['Dakhla', 23.68, -15.96]],
  };
  const outside = [['Muscat', 23.59, 58.41], ['Salalah', 17.02, 54.09], ['Bandar Abbas', 27.18, 56.27], ['Basra', 30.51, 47.78],
    ['Amman', 31.95, 35.93], ['Herat', 34.35, 62.2], ['Zahedan', 29.5, 60.86], ['Male', 4.17, 73.51], ['Sittwe', 20.15, 92.9],
    ['Lhasa', 29.65, 91.1], ['Tindouf', 27.67, -8.15], ['Nouakchott', 18.08, -15.98], ['Djibouti', 11.59, 43.15],
    ['Asmara', 15.32, 38.93], ['Port Sudan', 19.6, 37.2]];

  for (const [id, cities] of Object.entries(inside)) {
    it.each(cities)(`puts %s in ${id}`, (_city, latitude, longitude) => {
      expect(regionFor({ latitude, longitude })?.id).toBe(id);
    });
  }
  it.each(outside)('keeps %s out of every region', (_city, latitude, longitude) => {
    expect(regionFor({ latitude, longitude })).toBeNull();
  });
});
