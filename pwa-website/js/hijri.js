// Today's date in the Hijri calendar, and the next date in it that matters.
//
// Where the date comes from, and why it is labelled
// --------------------------------------------------
// The Hijri calendar is not settled by astronomy the way prayer times are. A month begins when the
// new crescent is sighted, and who sights it and where is decided locally -- the same day can be
// the 29th of a month in one country and the 1st of the next in another. So there is no single
// correct Hijri date to compute, only conventions for estimating one.
//
// This uses the browser's own Umm al-Qura calendar (Intl, `islamic-umalqura`): the pre-calculated
// calendar Saudi Arabia publishes, and the most widely used civil convention -- then shifts it by a
// whole number of days for where you are. Saudi Arabia and the Gulf follow Umm al-Qura. South Asia
// and Morocco usually begin each month a day later, because the month there starts with a local
// sighting of the crescent. The region comes from the prayer-times location when there is one, and
// from the device's time zone when there is not (HIJRI_REGIONS below) -- both known on the device,
// offline, with no extra permission. Anyone can set the shift themselves, because the local
// announcement, not a table, is the final word; the screen says which rule it used.
//
// Month names come from HIJRI_MONTHS, not from Intl. Chrome on Android ships trimmed calendar data
// with no Hijri month names, and there Intl falls back to the Gregorian name of the same number
// without saying so: Rabi' al-Thani, month 4, was shown as "April". The month number Intl gives is
// right; only its name was borrowed.
//
// Where the browser has no Umm al-Qura calendar, this returns nothing and the card is hidden. It
// deliberately does not fall back to a second calculation: one clearly labelled date is honest, but
// two quietly different dates in one app -- depending on which browser someone happens to use --
// would be worse than no date at all.

const LOCALE = 'en-u-ca-islamic-umalqura';
// A Hijri year is 354 or 355 days, so every event recurs within this window.
const SEARCH_DAYS = 390;

let numericFormat = null;

export const HIJRI_MONTHS = [
  'Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani", 'Jumada al-Ula', 'Jumada al-Akhirah',
  'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qa'dah", 'Dhu al-Hijjah',
];

/**
 * Where the usual practice is known well enough to set a default. `days` is the shift from Umm
 * al-Qura: -1 means the month begins a day later than in Saudi Arabia, so the local date is a day
 * behind. Everywhere else defaults to Umm al-Qura unchanged.
 *
 * `area` is a rough outline, [longitude, latitude] pairs, used for a prayer-times location. It is
 * deliberately coarse -- a few dozen points around each region, following borders only where a
 * neighbour's practice differs (Afghanistan and Myanmar are outside South Asia's outline; the sea is
 * inside it) -- because it only picks a default the screen shows and anyone can change. `zones` is
 * the fallback when no location has been set.
 */
export const HIJRI_REGIONS = [
  {
    id: 'arabia',
    days: 0,
    name: 'Saudi Arabia and the Gulf',
    note: 'Saudi Arabia and the Gulf follow the Umm al-Qura calendar.',
    area: [
      [34.6, 29.5], [36.5, 29.4], [37.0, 31.5], [39.2, 32.2], [42.0, 31.1], [44.7, 29.2], [46.5, 29.1],
      // The Gulf coast is drawn a little out to sea: the cities are on the shore, and an edge drawn
      // along the shore puts Dubai on the wrong side of it. Iran's coast is well north of these points.
      [47.7, 30.1], [48.8, 28.5], [50.4, 26.6], [51.7, 26.3], [52.2, 24.5], [54.5, 25.0], [55.5, 25.8],
      [56.3, 26.5], [56.6, 25.5], [56.2, 24.0],
      [55.2, 22.7], [55.0, 20.0], [52.0, 19.0], [53.1, 16.6], [52.2, 15.3], [48.0, 13.7], [45.0, 12.5],
      [43.4, 12.4], [42.4, 15.6], [38.8, 21.5], [34.8, 28.0],
    ],
    zones: {
      'Asia/Riyadh': 'Saudi Arabia', 'Asia/Qatar': 'Qatar', 'Asia/Bahrain': 'Bahrain',
      'Asia/Kuwait': 'Kuwait', 'Asia/Dubai': 'the UAE', 'Asia/Aden': 'Yemen',
    },
  },
  {
    id: 'south-asia',
    days: -1,
    name: 'South Asia',
    note: 'The month there usually begins a day after Saudi Arabia, with a local moon sighting.',
    area: [
      [61.6, 24.9], [62.4, 27.2], [60.9, 29.8], [66.3, 29.9], [67.9, 31.5], [69.3, 31.9], [70.5, 33.9],
      [71.1, 34.9], [71.6, 36.4], [74.5, 37.0], [77.8, 35.5], [79.5, 32.5], [81.1, 30.2], [88.1, 27.9],
      [92.0, 27.5], [97.0, 28.2], [95.1, 26.6], [94.6, 24.5], [93.3, 22.9], [92.6, 21.3], [92.3, 20.7],
      [82.2, 5.5], [79.6, 5.5], [77.5, 7.5], [72.0, 15.0], [68.2, 23.5], [66.5, 24.3],
    ],
    zones: {
      'Asia/Kolkata': 'India', 'Asia/Calcutta': 'India', 'Asia/Karachi': 'Pakistan',
      'Asia/Dhaka': 'Bangladesh', 'Asia/Colombo': 'Sri Lanka', 'Asia/Kathmandu': 'Nepal',
      'Asia/Katmandu': 'Nepal',
    },
  },
  {
    id: 'morocco',
    days: -1,
    name: 'Morocco',
    note: 'The month there usually begins a day after Saudi Arabia, with a local moon sighting.',
    area: [
      [-5.9, 35.9], [-1.8, 35.1], [-1.2, 32.1], [-3.7, 30.9], [-8.7, 28.3], [-8.7, 27.3], [-12.0, 23.4],
      // The Atlantic coast is drawn out to sea for the same reason as the Gulf's: Casablanca, Rabat and
      // Tangier are on the shore.
      [-13.1, 21.3], [-17.3, 21.4], [-16.3, 24.0], [-13.6, 27.7], [-10.1, 29.8], [-9.8, 32.3],
      [-7.8, 33.9], [-6.9, 34.4], [-6.2, 35.9],
    ],
    zones: { 'Africa/Casablanca': 'Morocco', 'Africa/El_Aaiun': 'Morocco' },
  },
];

export const HIJRI_ADJUST_KEY = 'hijriAdjustment';
export const ADJUST_CHOICES = [-2, -1, 0, 1, 2];

/** Ray casting: whether [longitude, latitude] falls inside a closed outline. */
export function insideArea([x, y], area) {
  let inside = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i, i += 1) {
    const [xi, yi] = area[i];
    const [xj, yj] = area[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * The region for a place: `{ id, name, days, note, from: 'location' | 'timeZone' }`, or null.
 * A location, when there is one, decides -- it is where someone actually is. Only without one does
 * the time zone speak, and a location outside every region is not overruled by it.
 */
export function regionFor({ latitude, longitude, timeZone } = {}) {
  const pick = (region, from, label) => ({ id: region.id, name: label || region.name, days: region.days, note: region.note, from });
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const region = HIJRI_REGIONS.find((candidate) => insideArea([longitude, latitude], candidate.area));
    return region ? pick(region, 'location') : null;
  }
  for (const region of HIJRI_REGIONS) {
    const country = region.zones[timeZone];
    if (country) return pick(region, 'timeZone', country);
  }
  return null;
}

/** 'auto', or a whole number of days someone has chosen. Anything unreadable is 'auto'. */
export function readAdjustmentSetting(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(HIJRI_ADJUST_KEY);
    const days = Number(raw);
    return raw !== null && raw !== undefined && raw !== 'auto' && ADJUST_CHOICES.includes(days) ? days : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeAdjustmentSetting(value, storage = globalThis.localStorage) {
  try {
    if (value === 'auto') storage?.removeItem(HIJRI_ADJUST_KEY);
    else if (ADJUST_CHOICES.includes(Number(value))) storage?.setItem(HIJRI_ADJUST_KEY, String(Number(value)));
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts until the page closes.
  }
}

/**
 * The shift to apply, and why: `{ days, source: 'manual' | 'region' | 'default', region }`.
 * A choice someone made wins over the region; the region wins over plain Umm al-Qura.
 */
export function resolveAdjustment(setting, place) {
  const region = regionFor(place);
  if (setting !== 'auto' && ADJUST_CHOICES.includes(setting)) return { days: setting, source: 'manual', region };
  if (region) return { days: region.days, source: 'region', region };
  return { days: 0, source: 'default', region: null };
}

/** Whether this browser actually has the calendar, rather than silently substituting Gregorian. */
export function hijriSupported() {
  try {
    // An unknown calendar does not throw -- Intl quietly resolves it to 'gregory'. Checking what it
    // resolved to is the only way to tell "supported" from "pretending".
    return new Intl.DateTimeFormat(LOCALE).resolvedOptions().calendar === 'islamic-umalqura';
  } catch {
    return false;
  }
}

function formats() {
  numericFormat ||= new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'numeric', year: 'numeric' });
  return { numericFormat };
}

// Local midday of the calendar day `days` after `date`. Built from the calendar date rather than by
// adding milliseconds, so a daylight-saving change cannot move it onto a neighbouring day.
const middayOf = (date, days = 0) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

/**
 * The Hijri date of a Gregorian day: `{ year, month, day, monthName }`, or null where unsupported.
 * `adjustDays` shifts it from Umm al-Qura (see resolveAdjustment); -1 is a day behind.
 *
 * Read at local midday rather than at the instant passed in. The calendar changes date at local
 * midnight here, and a Date created a few minutes either side of it can otherwise land on the
 * neighbouring day depending on how the engine rounds.
 */
export function gregorianToHijri(date = new Date(), adjustDays = 0) {
  if (!hijriSupported()) return null;
  const numbers = hijriNumbers(middayOf(date, adjustDays));
  return { ...numbers, monthName: HIJRI_MONTHS[numbers.month - 1] };
}

/** Just the numbers, for the day-by-day search below. */
function hijriNumbers(noon) {
  let year;
  let month;
  let day;
  for (const part of formats().numericFormat.formatToParts(noon)) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }
  return { year, month, day };
}

/**
 * The soonest of `events` on or after `from`, with how many days away it is.
 *
 * Intl only converts one way -- Gregorian to Hijri -- so this walks forward a day at a time until
 * a day's Hijri date is one of the events. That is a few hundred conversions at most and it means
 * nothing here has to know how long any Hijri month is, which is exactly the thing that varies.
 * It also handles the year boundary for free: an event already passed this Hijri year is simply
 * found again next year.
 */
export function nextIslamicEvent(events, from = new Date(), adjustDays = 0) {
  return upcomingIslamicEvents(events, from, adjustDays)[0] ?? null;
}

/**
 * Every event in the coming Hijri year, soonest first -- each one once.
 *
 * The next event is just the first of these, so the card at the top and the list beneath it are
 * one calculation and cannot disagree about when anything falls.
 */
export function upcomingIslamicEvents(events, from = new Date(), adjustDays = 0) {
  if (!hijriSupported() || !events?.length) return [];
  const start = middayOf(from);
  const wanted = new Map(events.map((event) => [`${event.month}-${event.day}`, event]));
  const found = [];
  const seen = new Set();
  for (let offset = 0; offset <= SEARCH_DAYS && seen.size < wanted.size; offset += 1) {
    const day = middayOf(start, offset);
    const numbers = hijriNumbers(middayOf(day, adjustDays));
    const key = `${numbers.month}-${numbers.day}`;
    const event = wanted.get(key);
    if (event && !seen.has(key)) {
      seen.add(key);
      found.push({ ...event, date: day, daysUntil: offset, hijri: gregorianToHijri(day, adjustDays) });
    }
  }
  return found;
}

/** "Today", "Tomorrow", "in 12 days". */
export function countdownLabel(daysUntil) {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `in ${daysUntil} days`;
}
