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
// calendar Saudi Arabia publishes, and the most widely used civil convention. It is one convention,
// not "the" date, which is why the card says plainly that local sighting may differ by a day --
// the same honesty the prayer times use when a high-latitude time is estimated rather than
// measured.
//
// Where the browser has no Umm al-Qura calendar, this returns nothing and the card is hidden. It
// deliberately does not fall back to a second calculation: one clearly labelled date is honest, but
// two quietly different dates in one app -- depending on which browser someone happens to use --
// would be worse than no date at all.

const LOCALE = 'en-u-ca-islamic-umalqura';
// A Hijri year is 354 or 355 days, so every event recurs within this window.
const SEARCH_DAYS = 390;

let numericFormat = null;
let monthFormat = null;

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
  if (!numericFormat) {
    numericFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'numeric', year: 'numeric' });
    monthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long' });
  }
  return { numericFormat, monthFormat };
}

/**
 * The Hijri date of a Gregorian day: `{ year, month, day, monthName }`, or null where unsupported.
 *
 * Read at local midday rather than at the instant passed in. The calendar changes date at local
 * midnight here, and a Date created a few minutes either side of it can otherwise land on the
 * neighbouring day depending on how the engine rounds.
 */
export function gregorianToHijri(date = new Date()) {
  if (!hijriSupported()) return null;
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  return { ...hijriNumbers(noon), monthName: formats().monthFormat.format(noon) };
}

/**
 * Just the numbers, for the day-by-day search below. Formatting a month name is the slower half of
 * a conversion and the search throws it away for every day that is not an event -- up to 390 of
 * them per call -- so the name is only added for the handful of days that match.
 */
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
export function nextIslamicEvent(events, from = new Date()) {
  return upcomingIslamicEvents(events, from)[0] ?? null;
}

/**
 * Every event in the coming Hijri year, soonest first -- each one once.
 *
 * The next event is just the first of these, so the card at the top and the list beneath it are
 * one calculation and cannot disagree about when anything falls.
 */
export function upcomingIslamicEvents(events, from = new Date()) {
  if (!hijriSupported() || !events?.length) return [];
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  const wanted = new Map(events.map((event) => [`${event.month}-${event.day}`, event]));
  const found = [];
  const seen = new Set();
  for (let offset = 0; offset <= SEARCH_DAYS && seen.size < wanted.size; offset += 1) {
    // Built from the calendar date rather than by adding milliseconds, so a daylight-saving
    // change cannot shift a day by an hour and, near midnight, onto the wrong date.
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, 12);
    const numbers = hijriNumbers(day);
    const key = `${numbers.month}-${numbers.day}`;
    const event = wanted.get(key);
    if (event && !seen.has(key)) {
      seen.add(key);
      found.push({ ...event, date: day, daysUntil: offset, hijri: gregorianToHijri(day) });
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
