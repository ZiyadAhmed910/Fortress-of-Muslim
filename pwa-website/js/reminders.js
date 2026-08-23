import { state } from './state.js';
import { els } from './dom.js';
import { toast } from './utils.js';
import { computePrayerTimes, formatPrayerClock } from './prayer-times.js';
import { getKnownCoordinates } from './prayer.js';
import { openAdvancedFilter } from './home.js';
import { setContentMode } from './modes.js';

// Minutes after the anchor prayer each reminder fires. Kept as a fixed default rather than a
// configurable setting -- the plan explicitly marks a custom offset as optional, and one more
// number input isn't worth the settings-screen clutter until someone actually asks for it.
const MORNING_OFFSET_MINUTES = 15;
const EVENING_OFFSET_MINUTES = 15;

// Reminders only ever schedule via setTimeout while this tab/PWA window exists (open, or open and
// backgrounded -- browsers throttle background timers to roughly once a minute, which is still
// fine for something with a whole day's granularity). There is no reliable way to fire a
// notification from a fully closed tab on the web platform without Periodic Background Sync, which
// is Chrome/Android-only, requires the PWA to actually be installed, is gated behind an opaque
// site-engagement heuristic the browser controls (not something a web app can request reliably),
// and isn't verifiable in any environment available while building this. Rather than half-build
// that and imply a reliability it can't deliver, this deliberately only implements the mechanism
// that actually and predictably works, and says so plainly in the settings UI.
const scheduledTimeouts = [];

export function initReminders() {
  els.remindersEnabledToggle.addEventListener('change', onRemindersEnabledChange);
  els.prayerAdhanToggle.addEventListener('change', () => {
    state.prayerAdhanEnabled = els.prayerAdhanToggle.checked;
    localStorage.setItem('prayerAdhanEnabled', String(state.prayerAdhanEnabled));
    scheduleToday();
  });
  els.morningAdhkarToggle.addEventListener('change', () => {
    state.morningAdhkarEnabled = els.morningAdhkarToggle.checked;
    localStorage.setItem('morningAdhkarEnabled', String(state.morningAdhkarEnabled));
    scheduleToday();
  });
  els.eveningAdhkarToggle.addEventListener('change', () => {
    state.eveningAdhkarEnabled = els.eveningAdhkarToggle.checked;
    localStorage.setItem('eveningAdhkarEnabled', String(state.eveningAdhkarEnabled));
    scheduleToday();
  });

  syncReminderControls();
  if (state.remindersEnabled && hasNotificationPermission()) scheduleToday();

  document.addEventListener('visibilitychange', () => {
    // Recomputed on every return to the tab, same reasoning as prayer.js's own recompute: a
    // schedule built from "now" is only valid for the day it was built on, and setTimeout delays
    // computed while the tab was hidden may have drifted against browser timer throttling anyway.
    if (document.visibilityState === 'visible' && state.remindersEnabled) scheduleToday();
  });

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'OPEN_ADHKAR' && event.data.category) {
        openAdhkarFromNotification(event.data.category);
      }
    });
  }
}

export function syncReminderControls() {
  const granted = hasNotificationPermission();
  els.remindersEnabledToggle.checked = state.remindersEnabled && granted;
  els.prayerAdhanToggle.checked = state.prayerAdhanEnabled;
  els.morningAdhkarToggle.checked = state.morningAdhkarEnabled;
  els.eveningAdhkarToggle.checked = state.eveningAdhkarEnabled;
  els.remindersUnsupportedNote.hidden = 'Notification' in window;
  els.remindersBlockedNote.hidden = !('Notification' in window) || Notification.permission !== 'denied';
  updateLocationNote();
}

function hasNotificationPermission() {
  return 'Notification' in window && Notification.permission === 'granted';
}

async function onRemindersEnabledChange() {
  if (!els.remindersEnabledToggle.checked) {
    state.remindersEnabled = false;
    localStorage.setItem('remindersEnabled', 'false');
    clearScheduled();
    return;
  }
  if (!('Notification' in window)) {
    toast('Notifications are not supported on this device.');
    els.remindersEnabledToggle.checked = false;
    return;
  }
  if (Notification.permission === 'denied') {
    toast('Notifications are blocked for this site in your browser settings.');
    els.remindersEnabledToggle.checked = false;
    syncReminderControls();
    return;
  }
  if (Notification.permission !== 'granted') {
    // The explanation of what these notifications are lives in the settings row's own <small>
    // text, visible before this toggle is ever touched -- matching how every other setting row in
    // this dialog (dark mode, large Arabic, ...) explains itself inline rather than via a separate
    // confirmation step, so the browser's native permission prompt is the very next thing that
    // happens, with no surprise in between.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notification permission was not granted.');
      els.remindersEnabledToggle.checked = false;
      syncReminderControls();
      return;
    }
  }
  state.remindersEnabled = true;
  localStorage.setItem('remindersEnabled', 'true');
  scheduleToday();
  updateLocationNote();
}

function updateLocationNote() {
  const needsLocation = state.remindersEnabled && hasNotificationPermission() && !getKnownCoordinates();
  els.remindersLocationNote.hidden = !needsLocation;
}

// Sunrise is in the computed set but is not a prayer, so it never raises an alert.
const PRAYER_ALERTS = [
  { key: 'fajr', label: 'Fajr' },
  { key: 'dhuhr', label: 'Dhuhr' },
  { key: 'asr', label: 'Asr' },
  { key: 'maghrib', label: 'Maghrib' },
  { key: 'isha', label: 'Isha' },
];

export function scheduleToday() {
  clearScheduled();
  if (!state.remindersEnabled || !hasNotificationPermission()) return;
  if (!state.morningAdhkarEnabled && !state.eveningAdhkarEnabled && !state.prayerAdhanEnabled) return;

  const coordinates = getKnownCoordinates();
  updateLocationNote();
  if (!coordinates) return; // nothing to schedule against yet -- the note above explains why

  const now = new Date();
  const times = computePrayerTimes(
    coordinates.latitude,
    coordinates.longitude,
    now,
    state.calculationMethod,
    state.asrMethod,
    -now.getTimezoneOffset() / 60,
    state.highLatitudeRule,
  );
  if (state.morningAdhkarEnabled && times.fajr) {
    scheduleAt(
      timeToDateToday(times.fajr, MORNING_OFFSET_MINUTES),
      'Morning Adhkar',
      `It's been ${MORNING_OFFSET_MINUTES} minutes since Fajr (${formatPrayerClock(times.fajr)}) -- time for your morning remembrances.`,
      'morning',
    );
  }
  if (state.eveningAdhkarEnabled && times.asr) {
    scheduleAt(
      timeToDateToday(times.asr, EVENING_OFFSET_MINUTES),
      'Evening Adhkar',
      `It's been ${EVENING_OFFSET_MINUTES} minutes since Asr (${formatPrayerClock(times.asr)}) -- time for your evening remembrances.`,
      'evening',
    );
  }

  // One notification at each prayer time itself. Sunrise is excluded: it marks the end of Fajr's
  // window rather than a prayer. Fired at the computed minute with no offset, unlike the adhkar
  // reminders which deliberately trail their prayer.
  if (state.prayerAdhanEnabled) {
    PRAYER_ALERTS.forEach(({ key, label }) => {
      const time = times[key];
      if (!time) return;
      scheduleAt(
        timeToDateToday(time, 0),
        `${label} — ${formatPrayerClock(time)}`,
        `It is time for ${label}.`,
        'prayer',
      );
    });
  }
}

function timeToDateToday(time, offsetMinutes) {
  const date = new Date();
  date.setHours(time.hours, time.minutes + offsetMinutes, 0, 0);
  return date;
}

function scheduleAt(fireDate, title, body, category) {
  const delay = fireDate.getTime() - Date.now();
  if (delay <= 0) return; // that reminder's window already passed today -- never fire it retroactively
  const timeoutId = setTimeout(() => showReminderNotification(title, body, category), delay);
  scheduledTimeouts.push(timeoutId);
}

function clearScheduled() {
  scheduledTimeouts.splice(0).forEach((id) => clearTimeout(id));
}

async function showReminderNotification(title, body, category) {
  const options = { body, tag: `fortress-reminder-${category}`, icon: 'icons/icon-192.png', data: { category } };
  if (navigator.serviceWorker?.controller) {
    const registration = await navigator.serviceWorker.ready;
    registration.showNotification(title, options);
    return;
  }
  if (!hasNotificationPermission()) return;
  const notification = new Notification(title, options);
  notification.onclick = () => {
    window.focus();
    notification.close();
    openAdhkarFromNotification(category);
  };
}

export function openAdhkarFromNotification(category) {
  if (category !== 'morning' && category !== 'evening') return;
  setContentMode('duas');
  openAdvancedFilter(category);
}
