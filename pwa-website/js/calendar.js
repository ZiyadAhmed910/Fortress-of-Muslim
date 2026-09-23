import { els } from './dom.js';
import { escapeHtml } from './utils.js';
import { countdownLabel, gregorianToHijri, hijriSupported, upcomingIslamicEvents } from './hijri.js';

// The Calendar screen, the fourth tool behind the Prayer button alongside Times, Qibla and Tasbih.
// All the date logic lives in hijri.js; this only draws it.
//
// Statically imported, unlike a lazily loaded module would be. tools/stamp_version.py versions
// `from './x.js'` imports and nothing else, and the service worker precaches the versioned URL --
// so a dynamic import() would ask for an unversioned file that is not in the cache, and the screen
// would fail offline while working perfectly online.

const EVENTS_URL = './data/hijri-events.json';
let events = null;
let renderedFor = '';

const shortDate = (date) => date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Draws the screen. Cheap to call on every visit: it does nothing if the day has not changed. */
export async function activateCalendar(now = new Date()) {
  if (!els.calendarHome) return;
  const supported = hijriSupported();
  els.calendarUnsupported.hidden = supported;
  for (const part of [els.calendarToday, els.calendarList, els.calendarHeading, els.calendarCaveat]) {
    if (part) part.hidden = !supported;
  }
  if (!supported) {
    els.calendarNext.hidden = true;
    return;
  }

  const dayKey = now.toDateString();
  if (renderedFor === dayKey) return;

  const today = gregorianToHijri(now);
  els.calendarHijri.textContent = `${today.day} ${today.monthName} ${today.year} AH`;
  els.calendarGregorian.textContent = now.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  try {
    if (!events) events = (await (await fetch(EVENTS_URL)).json()).events;
  } catch {
    // Today's date needs nothing but the browser. Only the events need the file, so if it did not
    // load, show the part that is still right rather than hiding the screen.
    els.calendarNext.hidden = true;
    els.calendarList.innerHTML = '';
    renderedFor = '';
    return;
  }

  const upcoming = upcomingIslamicEvents(events, now);
  const [next] = upcoming;
  els.calendarNext.hidden = !next;
  if (next) {
    els.calendarNextName.textContent = next.name;
    els.calendarNextWhen.textContent = next.daysUntil === 0
      ? 'Today'
      : `${countdownLabel(next.daysUntil)} · ${shortDate(next.date)}`;
  }
  els.calendarList.innerHTML = upcoming.map((event) => `
    <li class="calendar-row${event.daysUntil === 0 ? ' is-today' : ''}">
      <span class="calendar-row-name">
        <strong>${escapeHtml(event.name)}</strong>
        <small>${event.hijri.day} ${escapeHtml(event.hijri.monthName)} ${event.hijri.year}</small>
      </span>
      <span class="calendar-row-when">
        <strong>${escapeHtml(shortDate(event.date))}</strong>
        <small>${escapeHtml(countdownLabel(event.daysUntil))}</small>
      </span>
    </li>
  `).join('');
  renderedFor = dayKey;
}
