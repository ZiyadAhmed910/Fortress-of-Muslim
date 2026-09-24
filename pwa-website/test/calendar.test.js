import { describe, expect, it } from 'vitest';
import { conventionNote, prayerPlace } from '../js/calendar.js';
import { resolveAdjustment } from '../js/hijri.js';

// The calendar takes where you are from the prayer times, so the two can never disagree about it,
// and says in words which convention its dates follow.

const storage = (values) => ({ getItem: (key) => (key in values ? values[key] : null) });

describe('where the calendar thinks you are', () => {
  it('uses the location set by hand before the one last detected, as the prayer times do', () => {
    const place = prayerPlace(storage({ manualLatitude: '21.39', manualLongitude: '39.86', lastKnownLatitude: '17.39', lastKnownLongitude: '78.49' }));
    expect(place).toMatchObject({ latitude: 21.39, longitude: 39.86 });
  });

  it('falls back to the detected location, then to none', () => {
    expect(prayerPlace(storage({ lastKnownLatitude: '17.39', lastKnownLongitude: '78.49' }))).toMatchObject({ latitude: 17.39, longitude: 78.49 });
    const none = prayerPlace(storage({}));
    expect(Number.isNaN(none.latitude)).toBe(true);
  });
});

describe('what the calendar says about its dates', () => {
  it('names the region and why, when it came from the prayer location', () => {
    const note = conventionNote(resolveAdjustment('auto', { latitude: 17.39, longitude: 78.49 }));
    expect(note).toContain('a day behind');
    expect(note).toContain('for South Asia (from your prayer location)');
    expect(note).toContain('local moon sighting');
  });

  it('names the country from the time zone when there is no location', () => {
    expect(conventionNote(resolveAdjustment('auto', { timeZone: 'Asia/Karachi' }))).toContain("for Pakistan (from this device's time zone)");
  });

  it('says a choice was made by hand when it was', () => {
    expect(conventionNote(resolveAdjustment(0, { timeZone: 'Asia/Kolkata' }))).toMatch(/Umm al-Qura calendar \(Saudi Arabia\), as you set it/);
  });

  it('says plainly where no region is known', () => {
    expect(conventionNote(resolveAdjustment('auto', { timeZone: 'Europe/London' }))).toMatch(/may differ by a day/);
  });
});
