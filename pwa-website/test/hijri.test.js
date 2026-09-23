import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countdownLabel,
  gregorianToHijri,
  hijriSupported,
  nextIslamicEvent,
  upcomingIslamicEvents,
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
