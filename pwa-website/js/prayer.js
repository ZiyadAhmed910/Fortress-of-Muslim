import { state } from './state.js';
import { els } from './dom.js';
import { toast } from './utils.js';
import {
  computePrayerTimes,
  HIGH_LATITUDE_RULES,
  computeQiblaBearing,
  compassDirectionLabel,
  formatPrayerClock,
  getLocation,
  nextPrayer,
  prayerTimesList,
} from './prayer-times.js';

const COUNTDOWN_TICK_MS = 20_000;
// How long to wait for a usable compass reading before admitting none is coming.
const COMPASS_TIMEOUT_MS = 2_500;
// Fraction of the way to move toward each new reading: enough to feel immediate, enough to settle.
const COMPASS_SMOOTHING = 0.25;
const DEG = Math.PI / 180;
let countdownTimer = null;
let deviceOrientationHandler = null;
let compassWatchdog = null;
let smoothedHeading = null;
let compassStatusNote = '';
let compassSource = null;
// Shared across both tabs -- resolving a location from either Prayer Times or Qibla immediately
// benefits the other one too, since they're both just different views onto the same coordinates.
let currentCoordinates = null;

export function initPrayer() {
  initLocationUi({
    tab: 'prayerTimes',
    label: els.prayerTimesLocationLabel,
    button: els.prayerTimesLocationButton,
    form: els.prayerTimesLocationForm,
    hint: els.prayerTimesLocationHint,
    cancel: els.prayerTimesLocationCancel,
    retry: els.prayerTimesLocationRetry,
    onResolved: () => { computeAndRenderPrayerTimes(); startCountdown(); },
  });
  initLocationUi({
    tab: 'qibla',
    label: els.qiblaLocationLabel,
    button: els.qiblaLocationButton,
    form: els.qiblaLocationForm,
    hint: els.qiblaLocationHint,
    cancel: els.qiblaLocationCancel,
    retry: els.qiblaLocationRetry,
    onResolved: () => computeAndRenderQibla(),
  });

  els.qiblaCompassButton.addEventListener('click', enableLiveCompass);
  els.calculationMethodSelect.addEventListener('change', () => {
    state.calculationMethod = els.calculationMethodSelect.value;
    localStorage.setItem('calculationMethod', state.calculationMethod);
    if (state.contentMode === 'prayerTimes') computeAndRenderPrayerTimes();
  });
  els.highLatitudeSelect.addEventListener('change', () => {
    state.highLatitudeRule = els.highLatitudeSelect.value;
    localStorage.setItem('highLatitudeRule', state.highLatitudeRule);
    if (state.contentMode === 'prayerTimes') computeAndRenderPrayerTimes();
  });

  els.asrMethodSelect.addEventListener('change', () => {
    state.asrMethod = els.asrMethodSelect.value;
    localStorage.setItem('asrMethod', state.asrMethod);
    if (state.contentMode === 'prayerTimes') computeAndRenderPrayerTimes();
  });
  document.addEventListener('visibilitychange', () => {
    // A prayer schedule is only valid for the calendar day it was computed for -- recompute
    // whenever the tab becomes visible again, not just on load, so a device left open overnight
    // (or one whose clock/timezone changed) always shows today's actual times. Qibla's bearing has
    // no time-of-day dependency, so it doesn't need this.
    if (document.visibilityState === 'visible' && state.contentMode === 'prayerTimes' && currentCoordinates) {
      computeAndRenderPrayerTimes();
    }
  });
}

export function syncPrayerSettingsControls() {
  els.calculationMethodSelect.value = state.calculationMethod;
  els.asrMethodSelect.value = state.asrMethod;
  els.highLatitudeSelect.value = state.highLatitudeRule;
}

export async function activatePrayerTimes() {
  syncPrayerSettingsControls();
  const coordinates = await resolveCoordinates();
  if (!coordinates) {
    showLocationNeeded('prayerTimes');
    return;
  }
  currentCoordinates = coordinates;
  showLocationKnown('prayerTimes', coordinates);
  computeAndRenderPrayerTimes();
  startCountdown();
}

export function deactivatePrayerTimes() {
  stopCountdown();
}

export async function activateQibla() {
  const coordinates = await resolveCoordinates();
  if (!coordinates) {
    showLocationNeeded('qibla');
    return;
  }
  currentCoordinates = coordinates;
  showLocationKnown('qibla', coordinates);
  computeAndRenderQibla();
}

export function deactivateQibla() {
  disableLiveCompass();
}

// Read-only lookup of whatever location is already known -- never prompts for a fresh geolocation
// reading. Reminders scheduling uses this (not resolveCoordinates) because requesting location
// access should only ever happen from an explicit user action on a Prayer/Qibla tab, never silently
// as a side effect of the reminders feature running in the background.
export function getKnownCoordinates() {
  if (state.manualLatitude !== null && state.manualLongitude !== null) {
    return { latitude: state.manualLatitude, longitude: state.manualLongitude, source: 'manual' };
  }
  if (state.lastKnownLatitude !== null && state.lastKnownLongitude !== null) {
    return { latitude: state.lastKnownLatitude, longitude: state.lastKnownLongitude, source: 'cached' };
  }
  return null;
}

// Manual coordinates always win (an explicit user choice); otherwise fall back to the last
// successful geolocation reading cached in this browser, so a returning offline user still sees
// times without a fresh permission prompt; otherwise ask geolocation directly.
async function resolveCoordinates() {
  if (state.manualLatitude !== null && state.manualLongitude !== null) {
    return { latitude: state.manualLatitude, longitude: state.manualLongitude, source: 'manual' };
  }
  if (state.lastKnownLatitude !== null && state.lastKnownLongitude !== null) {
    refreshDeviceLocationQuietly();
    return { latitude: state.lastKnownLatitude, longitude: state.lastKnownLongitude, source: 'cached' };
  }
  const located = await getLocation();
  if (!located) return null;
  rememberDeviceLocation(located);
  return { ...located, source: 'device' };
}

// Called when the cached coordinates are already being shown, to quietly bring them up to date in
// the background without blocking the initial render or re-prompting for permission (a browser
// that already granted geolocation access won't re-prompt for a background refresh).
function refreshDeviceLocationQuietly() {
  getLocation().then((located) => {
    if (!located) return;
    const moved = Math.abs(located.latitude - state.lastKnownLatitude) > 0.01 || Math.abs(located.longitude - state.lastKnownLongitude) > 0.01;
    rememberDeviceLocation(located);
    if (!moved || state.manualLatitude !== null) return;
    currentCoordinates = { ...located, source: 'device' };
    if (state.contentMode === 'prayerTimes') {
      showLocationKnown('prayerTimes', currentCoordinates);
      computeAndRenderPrayerTimes();
    } else if (state.contentMode === 'qibla') {
      showLocationKnown('qibla', currentCoordinates);
      computeAndRenderQibla();
    }
  // Deliberately swallowed: this refresh is best-effort background polish on top of coordinates
  // already on screen. Letting it reject would surface as an unhandled rejection, which the boot
  // watchdog in index.html reads as a failed startup.
  }).catch(() => {});
}

function rememberDeviceLocation(located) {
  state.lastKnownLatitude = located.latitude;
  state.lastKnownLongitude = located.longitude;
  localStorage.setItem('lastKnownLatitude', String(located.latitude));
  localStorage.setItem('lastKnownLongitude', String(located.longitude));
}

// Wires up one tab's "Set location" button, manual-entry form, and cancel/retry actions. Both the
// Prayer Times and Qibla tabs get their own independent copy of this UI (each tab is meant to be
// self-contained if someone opens it without ever visiting the other), but they resolve to and
// write back the same underlying coordinates, so setting a location from either one updates both.
// `showLocationKnown` (tab-level) rather than `showLocationKnownFor` (label and button only): the
// card and the prayer list are hidden while a location is unknown, and only the tab-level call
// reveals them. Resolving a location here used to update the label and quietly leave the content
// hidden, so entering coordinates by hand appeared to do nothing at all.
function initLocationUi({ tab, label, button, form, hint, cancel, retry, onResolved }) {
  const requestDeviceLocation = async () => {
    label.textContent = 'Locating...';
    hint.hidden = true;
    const located = await getLocation({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
    if (!located) {
      showLocationNeededFor({ label, button, form });
      await explainLocationFailure(hint);
      return;
    }
    rememberDeviceLocation(located);
    state.manualLatitude = null;
    state.manualLongitude = null;
    localStorage.removeItem('manualLatitude');
    localStorage.removeItem('manualLongitude');
    form.hidden = true;
    hint.hidden = true;
    currentCoordinates = { ...located, source: 'device' };
    showLocationKnown(tab, currentCoordinates);
    onResolved();
  };

  button.addEventListener('click', requestDeviceLocation);
  retry.addEventListener('click', requestDeviceLocation);
  cancel.addEventListener('click', () => { form.hidden = true; });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const latitude = Number(data.get('latitude'));
    const longitude = Number(data.get('longitude'));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      toast('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }
    state.manualLatitude = latitude;
    state.manualLongitude = longitude;
    localStorage.setItem('manualLatitude', String(latitude));
    localStorage.setItem('manualLongitude', String(longitude));
    form.hidden = true;
    hint.hidden = true;
    currentCoordinates = { latitude, longitude, source: 'manual' };
    showLocationKnown(tab, currentCoordinates);
    onResolved();
    toast('Location saved.');
  });
}

// Once a browser has been told no, the page cannot ask again -- getCurrentPosition simply fails,
// which is how "Allow location" came to look like a dead button. The Permissions API can tell the
// two cases apart, so the blocked one can say where the switch actually is.
async function explainLocationFailure(hint) {
  hint.hidden = false;
  hint.textContent = await geolocationBlocked()
    ? 'Location is blocked for this site, so the app cannot ask again. Allow it from the padlock (or site settings) beside the address bar -- in an installed app, from the app info screen -- then tap "Try device location again". Or enter coordinates below.'
    : 'Could not get a location fix. Try again near a window or outdoors, or enter coordinates below -- they are saved on this device.';
}

async function geolocationBlocked() {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state === 'denied';
  } catch {
    return false; // Safari has no geolocation permission query; the generic message covers it.
  }
}

function showLocationNeededFor({ label, button, form }) {
  label.textContent = 'Location needed.';
  button.textContent = 'Allow location';
  form.hidden = false;
}

function showLocationKnownFor({ label, button }, coordinates) {
  const sourceLabel = { manual: 'Manual location', cached: 'Last known location', device: 'Current location' }[coordinates.source] || 'Location';
  label.textContent = `${sourceLabel}: ${coordinates.latitude.toFixed(3)}, ${coordinates.longitude.toFixed(3)}`;
  button.textContent = 'Change';
}

function showLocationNeeded(tab) {
  // Opening the tab with the permission already blocked is the state that felt like a dead end:
  // a "Set location" button that can never succeed, and nothing saying why.
  const hint = tab === 'prayerTimes' ? els.prayerTimesLocationHint : els.qiblaLocationHint;
  hint.hidden = true;
  geolocationBlocked().then((blocked) => { if (blocked) explainLocationFailure(hint); }).catch(() => {});
  if (tab === 'prayerTimes') {
    showLocationNeededFor({ label: els.prayerTimesLocationLabel, button: els.prayerTimesLocationButton, form: els.prayerTimesLocationForm });
    els.prayerTimesTimezoneNote.hidden = true;
    els.prayerTimesList.hidden = true;
    els.prayerEstimatedNote.hidden = true;
    els.prayerNextName.textContent = '–';
    els.prayerNextTime.textContent = '––:––';
    els.prayerNextCountdown.textContent = '';
  } else {
    showLocationNeededFor({ label: els.qiblaLocationLabel, button: els.qiblaLocationButton, form: els.qiblaLocationForm });
    els.qiblaCard.hidden = true;
  }
}

function showLocationKnown(tab, coordinates) {
  if (tab === 'prayerTimes') {
    showLocationKnownFor({ label: els.prayerTimesLocationLabel, button: els.prayerTimesLocationButton }, coordinates);
    // Clock times are rendered in this device's own timezone (there's no offline way to look up
    // the IANA timezone for arbitrary coordinates without a network call or a multi-megabyte
    // timezone boundary dataset, both out of scope here). That's silently correct for geolocation/
    // cached readings (the device is physically there), but not for a manually entered location.
    els.prayerTimesTimezoneNote.hidden = coordinates.source !== 'manual';
    els.prayerTimesList.hidden = false;
  } else {
    showLocationKnownFor({ label: els.qiblaLocationLabel, button: els.qiblaLocationButton }, coordinates);
    els.qiblaCard.hidden = false;
  }
}

let lastComputedDateKey = '';

function computeAndRenderPrayerTimes() {
  if (!currentCoordinates) return;
  const { latitude, longitude } = currentCoordinates;
  const now = new Date();
  lastComputedDateKey = now.toDateString();
  const times = computePrayerTimes(
    latitude,
    longitude,
    now,
    state.calculationMethod,
    state.asrMethod,
    -now.getTimezoneOffset() / 60,
    state.highLatitudeRule,
  );
  state.prayerTimes = times;
  renderPrayerList(times);
  renderNextPrayer(times);
}

function computeAndRenderQibla() {
  if (!currentCoordinates) return;
  renderQibla(currentCoordinates.latitude, currentCoordinates.longitude);
}

function renderPrayerList(times) {
  const estimated = new Set(times.estimated || []);
  els.prayerTimesList.innerHTML = prayerTimesList(times).map(({ key, label, time }) => `
    <div class="prayer-row${key === 'sunrise' ? ' prayer-row-sunrise' : ''}" data-prayer-row="${key}">
      <span class="prayer-row-label">${label}${estimated.has(key) ? ' <span class="prayer-row-estimated" title="Estimated -- the sun does not reach this angle here on this date">estimated</span>' : ''}</span>
      <span class="prayer-row-time">${formatPrayerClock(time)}</span>
    </div>
  `).join('');
  renderEstimatedNote(times, estimated);
}

// At high latitudes some prayer times cannot be observed at all on some dates, so they are derived
// from a convention instead. Saying which one, in the list itself, matters more than it looks: two
// people in the same city can hold different times and both be right, and a silent number invites
// the user to assume the app is simply wrong.
function renderEstimatedNote(times, estimated) {
  const note = els.prayerEstimatedNote;
  if (!note) return;
  // A blank time needs an explanation just as much as an estimated one does. Choosing "None" is a
  // legitimate position -- some scholars hold that an unobservable time should not be invented --
  // but an unexplained "--:--" is indistinguishable from the app being broken, which is the exact
  // failure this whole feature exists to remove.
  const blank = prayerTimesList(times).filter(({ key, time }) => !time && !estimated.has(key));
  if (!estimated.size && !blank.length) {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  if (!estimated.size) {
    note.textContent = `${listNames(blank.map((p) => p.label))} ${blank.length > 1 ? 'do' : 'does'} not occur at this latitude on this date. Choose a high-latitude convention in Settings to estimate ${blank.length > 1 ? 'them' : 'it'}.`;
    return;
  }
  if (estimated.size >= 6) {
    note.textContent = 'The sun does not rise or set here on this date, so every time is taken from the nearest latitude where it does (48°). Check these against your local mosque.';
    return;
  }
  const rule = HIGH_LATITUDE_RULES[times.highLatitudeRule];
  const names = listNames(prayerTimesList(times).filter(({ key }) => estimated.has(key)).map((p) => p.label));
  const label = (rule ? rule.label : 'angle-based').replace(' (recommended)', '').toLowerCase();
  note.textContent = `${names} cannot be observed at this latitude on this date, and ${estimated.size > 1 ? 'are' : 'is'} estimated using the ${label} convention. You can change this in Settings.`;
}

function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function renderNextPrayer(times) {
  const upcoming = nextPrayer(times);
  if (!upcoming) {
    els.prayerNextName.textContent = '–';
    els.prayerNextTime.textContent = '––:––';
    els.prayerNextCountdown.textContent = '';
    return;
  }
  els.prayerNextName.textContent = upcoming.isTomorrow ? `${upcoming.label} (tomorrow)` : upcoming.label;
  els.prayerNextTime.textContent = formatPrayerClock(upcoming.time);
  const hours = Math.floor(upcoming.minutesUntil / 60);
  const minutes = upcoming.minutesUntil % 60;
  els.prayerNextCountdown.textContent = hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
  els.prayerTimesList.querySelectorAll('[data-prayer-row]').forEach((row) => {
    row.classList.toggle('prayer-row-active', row.dataset.prayerRow === upcoming.key);
  });
}

function renderQibla(latitude, longitude) {
  const bearing = computeQiblaBearing(latitude, longitude);
  els.qiblaBearing.textContent = `${Math.round(bearing)}° ${compassDirectionLabel(bearing)}`;
  els.qiblaNeedle.style.setProperty('--qibla-bearing', `${bearing}deg`);
  const hasOrientation = typeof DeviceOrientationEvent !== 'undefined';
  els.qiblaCompassButton.hidden = !hasOrientation || state.deviceOrientationActive;
  if (!hasOrientation) {
    els.qiblaNote.textContent = 'This device does not support a live compass -- the bearing above is measured clockwise from true north.';
  } else if (compassStatusNote) {
    // A failed compass attempt explains itself; a background location refresh re-renders this card
    // and would otherwise wipe that explanation back to "tap to start", hiding what just happened.
    els.qiblaNote.textContent = compassStatusNote;
  } else if (!state.deviceOrientationActive) {
    els.qiblaNote.textContent = 'Tap "Use live compass" to point the needle in real time as you turn.';
  }
}

function startCountdown() {
  stopCountdown();
  countdownTimer = setInterval(() => {
    // Covers a tab left open and foregrounded exactly across midnight (the visibilitychange
    // handler in initPrayer only fires when the tab regains visibility after being hidden, which
    // this case never triggers) -- cheap to check every tick since it's just a string compare.
    if (new Date().toDateString() !== lastComputedDateKey) { computeAndRenderPrayerTimes(); return; }
    if (state.prayerTimes) renderNextPrayer(state.prayerTimes);
  }, COUNTDOWN_TICK_MS);
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

const COMPASS_ACTIVE_NOTE = 'Live compass active -- the needle points toward the Qibla as you turn. Works held flat like a compass, or stood up in front of you. It reads the magnetic compass, so nearby metal or magnets can pull it off; if it looks wrong, step away from metal and recalibrate the phone compass (usually a figure-8 motion) in its system settings.';
const COMPASS_POINTING_NOTE = 'Live compass active -- you are holding the phone upright, so it now follows where the phone itself points. Turn until the needle points straight up the screen and you are facing the Qibla.';

// A phone is a 3D object and people hold it two ways: flat in the palm like a real compass, or
// stood up in front of them, pointing. Those are different questions -- "which way is the top edge
// facing" versus "which way am I pointing the back of the phone" -- and each has a pose where it
// cannot be answered at all.
//
// Both come out of one rotation matrix. Per the DeviceOrientation spec the angles are ZXY Euler
// angles taking device coordinates into the Earth frame (x east, y north, z up), so the device's
// own axes in Earth coordinates are just its columns:
//
//   top edge  (device +y) = (-sin a cos b,        cos a cos b,       sin b)
//   back      (device -z) = (-(cos a sin g + sin a sin b cos g), -(sin a sin g - cos a sin b cos g), -cos b cos g)
//
// The back-axis form is the spec's own worked compass example, which is written for a device held
// upright; the top-edge one reduces to 360 - alpha, which is why the flat case looks like it
// ignores tilt and does not. Each vector's horizontal part gives a bearing, and how much of the
// vector is left lying in that plane says how much the bearing can be trusted: a flat phone has
// its back pointing at the ground (no bearing), an upright one has its top edge pointing at the
// sky (no bearing). They are orthogonal, so one of them always keeps at least 76% of its length in
// the horizontal plane -- there is no pose with nothing to read.
export function compassAxes(alpha, beta, gamma) {
  const sa = Math.sin(alpha * DEG), ca = Math.cos(alpha * DEG);
  const sb = Math.sin(beta * DEG), cb = Math.cos(beta * DEG);
  const sg = Math.sin(gamma * DEG), cg = Math.cos(gamma * DEG);
  return {
    top: [-sa * cb, ca * cb, sb],
    back: [-(ca * sg + sa * sb * cg), -(sa * sg - ca * sb * cg), -(cb * cg)],
  };
}

const bearingOf = (axis) => ((Math.atan2(axis[0], axis[1]) / DEG) % 360 + 360) % 360;
const horizontalStrength = (axis) => Math.hypot(axis[0], axis[1]);

// Which axis to believe. Whichever has more of itself in the horizontal plane, except that the one
// already in use keeps it unless clearly beaten -- the two agree wherever both are readable (tilting
// a phone forward does not change which way it points), so the handover is invisible, but without
// the margin it would chatter back and forth at the crossover.
const SOURCE_SWITCH_MARGIN = 0.15;

export function headingFromAxes(axes, previousSource = null) {
  const strength = { top: horizontalStrength(axes.top), back: horizontalStrength(axes.back) };
  const better = strength.back > strength.top ? 'back' : 'top';
  const source = previousSource && strength[previousSource] + SOURCE_SWITCH_MARGIN >= strength[better]
    ? previousSource
    : better;
  return { heading: bearingOf(axes[source]), source, strength: strength[source] };
}

// `alpha` on the plain `deviceorientation` event is only guaranteed to be referenced to true/
// magnetic north when `event.absolute` is true -- and on a lot of Android/Chrome devices, the
// plain event fires with absolute:false (alpha measured from whatever direction the device
// happened to be facing when the sensor started, not from north), which is exactly what made the
// needle inaccurate. `deviceorientationabsolute` exists specifically to guarantee a north-
// referenced reading, so it's preferred whenever the browser fires it; the `absolute` check below
// also protects against a non-absolute `deviceorientation` reading being used by mistake.
// Exported for tests: the heading maths is the part that was quietly wrong on a real phone, and it
// is worth pinning without a browser.
export function headingFromOrientationEvent(event, previousSource = null) {
  // Safari does not north-reference alpha at all -- that is what webkitCompassHeading is for -- but
  // that heading is the bearing of the top edge, which is exactly what alpha encodes. Turning it
  // back into an alpha lets iOS use the same 3D maths as everything else, upright pose included.
  const alpha = typeof event.webkitCompassHeading === 'number' && !Number.isNaN(event.webkitCompassHeading)
    ? (360 - event.webkitCompassHeading + 360) % 360
    : (event.absolute && event.alpha !== null ? event.alpha : null);
  if (alpha === null) return null;
  const axes = compassAxes(alpha, typeof event.beta === 'number' ? event.beta : 0, typeof event.gamma === 'number' ? event.gamma : 0);
  const reading = headingFromAxes(axes, previousSource);
  // The top edge is read through the screen, so a browser tab rotated into landscape has to add its
  // own rotation back in. The back of the phone points where it points however the screen is turned.
  const heading = reading.source === 'top' ? (reading.heading + screenAngle() + 360) % 360 : reading.heading;
  return { ...reading, heading };
}

function screenAngle() {
  const angle = window.screen?.orientation?.angle;
  return typeof angle === 'number' ? angle : 0;
}

// Two things the raw reading does badly on screen. A magnetometer at rest wanders by a few degrees,
// which reads as a twitching needle; and rotating the dial from 359 to 1 degrees sends CSS the long
// way round, a full spin backwards, every time the user faces north. Keeping a continuous angle --
// one that is free to run past 360 or below 0 -- and easing toward each new reading fixes both.
export function nextSmoothedHeading(current, reading, smoothing = COMPASS_SMOOTHING) {
  if (current === null) return reading;
  const delta = ((reading - current + 540) % 360) - 180;
  return current + delta * smoothing;
}

function applyHeading(heading) {
  smoothedHeading = nextSmoothedHeading(smoothedHeading, heading);
  els.qiblaCompass.style.setProperty('--device-heading', `${smoothedHeading.toFixed(1)}deg`);
}

// iOS 13+ requires DeviceOrientationEvent.requestPermission() to be called from a direct user
// gesture (a tap), never automatically on load -- calling it outside a click handler silently
// fails on Safari. Android/other browsers don't have this method at all and fire the event freely.
async function enableLiveCompass() {
  compassStatusNote = '';
  let permission = 'unsupported';
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      permission = await DeviceOrientationEvent.requestPermission();
    } catch {
      // Chromium also exposes this method and can reject it; that is not the same as a refusal, so
      // fall through and let the readings themselves decide whether the compass works.
      permission = 'failed';
    }
  }
  if (permission === 'denied') {
    // This used to be a toast, which is gone in three seconds and says nothing about the fix. The
    // page cannot re-ask once refused, so the way back has to stay on screen.
    compassStatusNote = 'Your browser is not allowing compass access for this site. On iPhone, turn on Settings > Apps > Safari > Motion & Orientation Access; on Chrome or Brave, allow Motion sensors under Site settings. Then tap again. The bearing above is still correct, measured clockwise from true north.';
    els.qiblaNote.textContent = compassStatusNote;
    els.qiblaCompassButton.textContent = 'Try the live compass again';
    return;
  }
  let sawEvent = false;
  smoothedHeading = null;
  compassStatusNote = '';
  compassSource = null;
  deviceOrientationHandler = (event) => {
    sawEvent = true;
    const reading = headingFromOrientationEvent(event, compassSource);
    if (reading === null) return;
    if (compassWatchdog) { clearTimeout(compassWatchdog); compassWatchdog = null; }
    if (reading.source !== compassSource) {
      compassSource = reading.source;
      els.qiblaNote.textContent = compassSource === 'back' ? COMPASS_POINTING_NOTE : COMPASS_ACTIVE_NOTE;
    }
    applyHeading(reading.heading);
  };
  // Attaching the listeners is not the same as getting readings. A device with no magnetometer, or
  // a browser with motion sensors switched off, fires either nothing or orientation without a north
  // reference -- and the note used to claim "live compass active" over a needle that never moved.
  compassWatchdog = setTimeout(() => {
    compassWatchdog = null;
    disableLiveCompass();
    els.qiblaCompass.hidden = true;
    els.qiblaCompassButton.hidden = false;
    els.qiblaCompassButton.textContent = 'Try the live compass again';
    compassStatusNote = sawEvent
      ? 'This device reports how it is tilted but not which way is north, so the needle cannot follow you. Its compass sensor may be missing, or may need calibrating in the system settings (usually a figure-8 motion). The bearing above is still correct, measured clockwise from true north.'
      : 'No compass readings arrived. If your browser blocks motion sensors for this site (Chrome: Site settings, Motion sensors; Brave: Shields), allow them and tap again. The bearing above is still correct, measured clockwise from true north.';
    els.qiblaNote.textContent = compassStatusNote;
  }, COMPASS_TIMEOUT_MS);
  // Both listeners are attached -- iOS Safari never fires deviceorientationabsolute but does put
  // webkitCompassHeading on the plain event; Chrome/Android fire deviceorientationabsolute
  // specifically for north-referenced readings. Whichever actually delivers usable data wins;
  // harmless if both fire, since setting the same CSS custom property twice is a no-op in effect.
  window.addEventListener('deviceorientationabsolute', deviceOrientationHandler);
  window.addEventListener('deviceorientation', deviceOrientationHandler);
  state.deviceOrientationActive = true;
  els.qiblaCompass.hidden = false;
  els.qiblaCompassButton.hidden = true;
  els.qiblaNote.textContent = COMPASS_ACTIVE_NOTE;
}

function disableLiveCompass() {
  if (compassWatchdog) { clearTimeout(compassWatchdog); compassWatchdog = null; }
  smoothedHeading = null;
  if (deviceOrientationHandler) {
    window.removeEventListener('deviceorientationabsolute', deviceOrientationHandler);
    window.removeEventListener('deviceorientation', deviceOrientationHandler);
  }
  deviceOrientationHandler = null;
  state.deviceOrientationActive = false;
}
