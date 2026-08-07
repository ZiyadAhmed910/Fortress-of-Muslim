import { state } from './state.js';
import { els } from './dom.js';
import { toast } from './utils.js';
import {
  computePrayerTimes,
  computeQiblaBearing,
  compassDirectionLabel,
  formatPrayerClock,
  getLocation,
  nextPrayer,
  prayerTimesList,
} from './prayer-times.js';

const COUNTDOWN_TICK_MS = 20_000;
let countdownTimer = null;
let deviceOrientationHandler = null;
let currentCoordinates = null;

export function initPrayer() {
  els.prayerLocationButton.addEventListener('click', requestDeviceLocation);
  els.prayerLocationRetry.addEventListener('click', requestDeviceLocation);
  els.prayerLocationCancel.addEventListener('click', () => { els.prayerLocationForm.hidden = true; });
  els.prayerLocationForm.addEventListener('submit', onManualLocationSubmit);
  els.qiblaCompassButton.addEventListener('click', enableLiveCompass);
  els.calculationMethodSelect.addEventListener('change', () => {
    state.calculationMethod = els.calculationMethodSelect.value;
    localStorage.setItem('calculationMethod', state.calculationMethod);
    if (state.contentMode === 'prayer') computeAndRender();
  });
  els.asrMethodSelect.addEventListener('change', () => {
    state.asrMethod = els.asrMethodSelect.value;
    localStorage.setItem('asrMethod', state.asrMethod);
    if (state.contentMode === 'prayer') computeAndRender();
  });
  document.addEventListener('visibilitychange', () => {
    // A prayer schedule is only valid for the calendar day it was computed for -- recompute
    // whenever the tab becomes visible again, not just on load, so a device left open overnight
    // (or one whose clock/timezone changed) always shows today's actual times.
    if (document.visibilityState === 'visible' && state.contentMode === 'prayer' && currentCoordinates) {
      computeAndRender();
    }
  });
}

export function syncPrayerSettingsControls() {
  els.calculationMethodSelect.value = state.calculationMethod;
  els.asrMethodSelect.value = state.asrMethod;
}

export async function activatePrayer() {
  syncPrayerSettingsControls();
  const coordinates = await resolveCoordinates();
  if (!coordinates) {
    showLocationNeeded();
    return;
  }
  currentCoordinates = coordinates;
  showLocationKnown(coordinates);
  computeAndRender();
  startCountdown();
}

export function deactivatePrayer() {
  stopCountdown();
  disableLiveCompass();
}

// Read-only lookup of whatever location is already known -- never prompts for a fresh geolocation
// reading. Reminders scheduling uses this (not resolveCoordinates) because requesting location
// access should only ever happen from an explicit user action on the Prayer tab, never silently
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
    if (moved && state.manualLatitude === null && state.contentMode === 'prayer') {
      currentCoordinates = { ...located, source: 'device' };
      showLocationKnown(currentCoordinates);
      computeAndRender();
    }
  });
}

function rememberDeviceLocation(located) {
  state.lastKnownLatitude = located.latitude;
  state.lastKnownLongitude = located.longitude;
  localStorage.setItem('lastKnownLatitude', String(located.latitude));
  localStorage.setItem('lastKnownLongitude', String(located.longitude));
}

async function requestDeviceLocation() {
  els.prayerLocationLabel.textContent = 'Locating...';
  const located = await getLocation({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
  if (!located) {
    toast('Location permission was denied or is unavailable.');
    showLocationNeeded();
    return;
  }
  rememberDeviceLocation(located);
  state.manualLatitude = null;
  state.manualLongitude = null;
  localStorage.removeItem('manualLatitude');
  localStorage.removeItem('manualLongitude');
  els.prayerLocationForm.hidden = true;
  currentCoordinates = { ...located, source: 'device' };
  showLocationKnown(currentCoordinates);
  computeAndRender();
  startCountdown();
}

function onManualLocationSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const latitude = Number(form.get('latitude'));
  const longitude = Number(form.get('longitude'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    toast('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
    return;
  }
  state.manualLatitude = latitude;
  state.manualLongitude = longitude;
  localStorage.setItem('manualLatitude', String(latitude));
  localStorage.setItem('manualLongitude', String(longitude));
  els.prayerLocationForm.hidden = true;
  currentCoordinates = { latitude, longitude, source: 'manual' };
  showLocationKnown(currentCoordinates);
  computeAndRender();
  startCountdown();
  toast('Location saved.');
}

function showLocationNeeded() {
  els.prayerLocationLabel.textContent = 'Location needed to compute prayer times.';
  els.prayerLocationButton.textContent = 'Allow location';
  els.prayerLocationForm.hidden = false;
  els.prayerTimezoneNote.hidden = true;
  els.prayerTimesList.hidden = true;
  els.qiblaCard.hidden = true;
  els.prayerNextName.textContent = '–';
  els.prayerNextTime.textContent = '––:––';
  els.prayerNextCountdown.textContent = '';
}

function showLocationKnown(coordinates) {
  const sourceLabel = { manual: 'Manual location', cached: 'Last known location', device: 'Current location' }[coordinates.source] || 'Location';
  els.prayerLocationLabel.textContent = `${sourceLabel}: ${coordinates.latitude.toFixed(3)}, ${coordinates.longitude.toFixed(3)}`;
  els.prayerLocationButton.textContent = 'Change';
  // Clock times are rendered in this device's own timezone (there's no offline way to look up the
  // IANA timezone for arbitrary coordinates without a network call or a multi-megabyte timezone
  // boundary dataset, both out of scope here). That's silently correct for geolocation/cached
  // readings (the device is physically where it says it is, so its own timezone setting already
  // matches), but not for a manually-entered location the device isn't actually at.
  els.prayerTimezoneNote.hidden = coordinates.source !== 'manual';
  els.prayerTimesList.hidden = false;
  els.qiblaCard.hidden = false;
}

let lastComputedDateKey = '';

function computeAndRender() {
  if (!currentCoordinates) return;
  const { latitude, longitude } = currentCoordinates;
  const now = new Date();
  lastComputedDateKey = now.toDateString();
  const times = computePrayerTimes(latitude, longitude, now, state.calculationMethod, state.asrMethod);
  state.prayerTimes = times;
  renderPrayerList(times);
  renderNextPrayer(times);
  renderQibla(latitude, longitude);
}

function renderPrayerList(times) {
  els.prayerTimesList.innerHTML = prayerTimesList(times).map(({ key, label, time }) => `
    <div class="prayer-row${key === 'sunrise' ? ' prayer-row-sunrise' : ''}" data-prayer-row="${key}">
      <span class="prayer-row-label">${label}</span>
      <span class="prayer-row-time">${formatPrayerClock(time)}</span>
    </div>
  `).join('');
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
    if (new Date().toDateString() !== lastComputedDateKey) { computeAndRender(); return; }
    if (state.prayerTimes) renderNextPrayer(state.prayerTimes);
  }, COUNTDOWN_TICK_MS);
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

// `alpha` on the plain `deviceorientation` event is only guaranteed to be referenced to true/
// magnetic north when `event.absolute` is true -- and on a lot of Android/Chrome devices, the
// plain event fires with absolute:false (alpha measured from whatever direction the device
// happened to be facing when the sensor started, not from north), which is exactly what made the
// needle inaccurate. `deviceorientationabsolute` exists specifically to guarantee a north-
// referenced reading, so it's preferred whenever the browser fires it; the `absolute` check below
// also protects against a non-absolute `deviceorientation` reading being used by mistake.
function headingFromOrientationEvent(event) {
  if (typeof event.webkitCompassHeading === 'number') return event.webkitCompassHeading; // iOS Safari: already north-referenced
  if (event.absolute && event.alpha !== null) return 360 - event.alpha;
  return null;
}

// iOS 13+ requires DeviceOrientationEvent.requestPermission() to be called from a direct user
// gesture (a tap), never automatically on load -- calling it outside a click handler silently
// fails on Safari. Android/other browsers don't have this method at all and fire the event freely.
async function enableLiveCompass() {
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        toast('Compass access was not granted.');
        return;
      }
    }
  } catch {
    toast('Compass permission request failed.');
    return;
  }
  deviceOrientationHandler = (event) => {
    const heading = headingFromOrientationEvent(event);
    if (heading === null) return;
    els.qiblaCompass.style.setProperty('--device-heading', `${heading}deg`);
  };
  // Both listeners are attached -- iOS Safari never fires deviceorientationabsolute but does put
  // webkitCompassHeading on the plain event; Chrome/Android fire deviceorientationabsolute
  // specifically for north-referenced readings. Whichever actually delivers usable data wins;
  // harmless if both fire, since setting the same CSS custom property twice is a no-op in effect.
  window.addEventListener('deviceorientationabsolute', deviceOrientationHandler);
  window.addEventListener('deviceorientation', deviceOrientationHandler);
  state.deviceOrientationActive = true;
  els.qiblaCompass.hidden = false;
  els.qiblaCompassButton.hidden = true;
  els.qiblaNote.textContent = 'Live compass active -- the needle points toward the Qibla as you turn. Uses the device\'s magnetic compass, so accuracy depends on your device and nearby magnetic interference (metal, magnets, some phone cases) -- if it seems off, try moving away from metal objects or recalibrating your phone\'s compass (usually a figure-8 motion) in its system settings.';
}

function disableLiveCompass() {
  if (deviceOrientationHandler) {
    window.removeEventListener('deviceorientationabsolute', deviceOrientationHandler);
    window.removeEventListener('deviceorientation', deviceOrientationHandler);
  }
  deviceOrientationHandler = null;
  state.deviceOrientationActive = false;
}
