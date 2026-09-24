import { els } from './dom.js';
import { escapeHtml } from './utils.js';
import {
  ADJUST_CHOICES,
  countdownLabel,
  deviceTimeZone,
  gregorianToHijri,
  hijriSupported,
  readAdjustmentSetting,
  resolveAdjustment,
  upcomingIslamicEvents,
  writeAdjustmentSetting,
} from './hijri.js';

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
let bound = false;

const shortDate = (date) => date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Where the prayer times think you are: the location set by hand, else the last one detected.
 * Read from the same keys js/prayer.js writes, so the calendar and the prayer times agree.
 */
export function prayerPlace(storage = globalThis.localStorage) {
  const read = (key) => {
    try {
      const value = storage?.getItem(key);
      return value === null || value === undefined || value === '' ? NaN : Number(value);
    } catch {
      return NaN;
    }
  };
  const manual = [read('manualLatitude'), read('manualLongitude')];
  const known = [read('lastKnownLatitude'), read('lastKnownLongitude')];
  const [latitude, longitude] = Number.isFinite(manual[0]) && Number.isFinite(manual[1]) ? manual : known;
  return { latitude, longitude, timeZone: deviceTimeZone() };
}

const shiftText = (days) => {
  if (days === 0) return 'the Umm al-Qura calendar (Saudi Arabia)';
  const count = Math.abs(days) === 1 ? 'a day' : `${Math.abs(days)} days`;
  return days < 0 ? `Umm al-Qura, ${count} behind` : `Umm al-Qura, ${count} ahead`;
};

/** The sentence under the calendar: which rule the dates follow, and why. */
export function conventionNote(adjustment) {
  const { days, source, region } = adjustment;
  const from = region?.from === 'location' ? 'from your prayer location' : 'from this device\'s time zone';
  if (source === 'manual') return `Dates follow ${shiftText(days)}, as you set it. Your local announcement is the final word.`;
  if (source === 'region') {
    return `Dates follow ${shiftText(days)} for ${region.name} (${from}). ${region.note} Change it below if your local announcement differs.`;
  }
  return 'Dates follow the Umm al-Qura calendar (Saudi Arabia). Your local moon sighting may differ by a day -- change it below if it does.';
}

function optionLabel(days) {
  if (days === 0) return 'Umm al-Qura (Saudi Arabia)';
  const count = Math.abs(days) === 1 ? '1 day' : `${Math.abs(days)} days`;
  return days < 0 ? `${count} behind Umm al-Qura` : `${count} ahead of Umm al-Qura`;
}

function bindControls() {
  if (bound || !els.calendarAdjust) return;
  bound = true;
  els.calendarAdjust.addEventListener('change', () => {
    writeAdjustmentSetting(els.calendarAdjust.value === 'auto' ? 'auto' : Number(els.calendarAdjust.value));
    renderedFor = '';
    activateCalendar();
  });
}

function renderControls(setting, adjustment) {
  if (!els.calendarAdjust) return;
  // "Automatic" names what automatic would give here, so choosing it is not a leap in the dark.
  const regionDays = adjustment.region?.days ?? 0;
  const automatic = `Automatic: ${regionDays === 0 ? 'Umm al-Qura' : optionLabel(regionDays)}${adjustment.region ? ` (${adjustment.region.name})` : ''}`;
  els.calendarAdjust.innerHTML = [
    `<option value="auto">${escapeHtml(automatic)}</option>`,
    ...ADJUST_CHOICES.map((days) => `<option value="${days}">${escapeHtml(optionLabel(days))}</option>`),
  ].join('');
  els.calendarAdjust.value = setting === 'auto' ? 'auto' : String(setting);
}

/** Draws the screen. Cheap to call on every visit: it does nothing if nothing it depends on changed. */
export async function activateCalendar(now = new Date()) {
  if (!els.calendarHome) return;
  bindControls();
  const supported = hijriSupported();
  els.calendarUnsupported.hidden = supported;
  for (const part of [els.calendarToday, els.calendarList, els.calendarHeading, els.calendarCaveat, els.calendarSettings]) {
    if (part) part.hidden = !supported;
  }
  if (!supported) {
    els.calendarNext.hidden = true;
    return;
  }

  const setting = readAdjustmentSetting();
  const place = prayerPlace();
  const adjustment = resolveAdjustment(setting, place);
  // Redrawn when the day, the chosen shift or the region changes -- setting a prayer location in
  // another country moves the dates without anyone touching the calendar.
  const key = `${now.toDateString()}|${setting}|${adjustment.days}|${adjustment.region?.id ?? ''}|${adjustment.region?.from ?? ''}`;
  if (renderedFor === key) return;

  const today = gregorianToHijri(now, adjustment.days);
  els.calendarHijri.textContent = `${today.day} ${today.monthName} ${today.year} AH`;
  els.calendarGregorian.textContent = now.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  if (els.calendarCaveat) els.calendarCaveat.textContent = conventionNote(adjustment);
  renderControls(setting, adjustment);

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

  const upcoming = upcomingIslamicEvents(events, now, adjustment.days);
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
  renderedFor = key;
}
