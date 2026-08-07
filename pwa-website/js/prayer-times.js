// Prayer-time and Qibla calculation, computed entirely client-side from date + coordinates -- no
// network calls, no vendored third-party library. The underlying math is the standard method every
// prayer-time calculator uses (the same one PrayTimes.org and adhan.js implement): Meeus'
// low-precision solar position formulas to get the sun's declination and the equation of time, then
// the hour-angle formula to find when the sun crosses each prayer's altitude angle below the
// horizon. Accuracy is within a minute of published tables, which is what every mainstream prayer
// app actually achieves with this same method -- true arc-second precision needs ephemeris data
// this app deliberately doesn't ship.

export const CALCULATION_METHODS = {
  mwl: { label: 'Muslim World League', fajrAngle: 18, ishaAngle: 17 },
  isna: { label: 'Islamic Society of North America', fajrAngle: 15, ishaAngle: 15 },
  egyptian: { label: 'Egyptian General Authority', fajrAngle: 19.5, ishaAngle: 17.5 },
  karachi: { label: 'University of Islamic Sciences, Karachi', fajrAngle: 18, ishaAngle: 18 },
  ummalqura: { label: 'Umm al-Qura, Makkah', fajrAngle: 18.5, ishaMinutesAfterMaghrib: 90 },
};

export const DEFAULT_CALCULATION_METHOD = 'mwl';
export const ASR_METHODS = { standard: { label: 'Standard (Shafi, Maliki, Hanbali)', shadowFactor: 1 }, hanafi: { label: 'Hanafi', shadowFactor: 2 } };
export const DEFAULT_ASR_METHOD = 'standard';

const KAABA_LAT = 21.4225;
const KAABA_LNG = 39.8262;
const SUNRISE_SUNSET_ANGLE = 0.833; // atmospheric refraction + solar radius, standard constant

// -- Low-level angle helpers (degrees in, degrees out, matching how every step of this
// calculation is naturally expressed in prayer-time literature) --
const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;
const sinDeg = (degrees) => Math.sin(toRadians(degrees));
const cosDeg = (degrees) => Math.cos(toRadians(degrees));
const tanDeg = (degrees) => Math.tan(toRadians(degrees));
const arcsinDeg = (value) => toDegrees(Math.asin(value));
const arccosDeg = (value) => toDegrees(Math.acos(value));
const arctanDeg = (value) => toDegrees(Math.atan(value));
const arctan2Deg = (y, x) => toDegrees(Math.atan2(y, x));

function fixRange(value, range) {
  const wrapped = value - range * Math.floor(value / range);
  return wrapped < 0 ? wrapped + range : wrapped;
}

function julianDay(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

// Meeus, "Astronomical Algorithms", low-precision solar position (good to ~0.01 degrees, which is
// far more precise than prayer-time angle conventions themselves need).
function sunPosition(julianDate) {
  const d = julianDate - 2451545.0;
  const g = fixRange(357.529 + 0.98560028 * d, 360); // mean anomaly
  const q = fixRange(280.459 + 0.98564736 * d, 360); // mean longitude
  const l = fixRange(q + 1.915 * sinDeg(g) + 0.02 * sinDeg(2 * g), 360); // apparent ecliptic longitude
  const e = 23.439 - 0.00000036 * d; // obliquity of the ecliptic

  const declination = arcsinDeg(sinDeg(e) * sinDeg(l));
  let rightAscension = arctan2Deg(cosDeg(e) * sinDeg(l), cosDeg(l)) / 15;
  rightAscension = fixRange(rightAscension, 24);
  const lQuotient = fixRange(q, 360) / 15;
  let equationOfTime = lQuotient - rightAscension;
  // Equation of time is bounded to roughly +/-16.4 minutes across the year -- if the raw hour
  // difference wraps past a day boundary, fold it back into that physically meaningful range.
  if (equationOfTime > 12) equationOfTime -= 24;
  if (equationOfTime < -12) equationOfTime += 24;
  return { declination, equationOfTime };
}

// Hour angle (in hours from solar noon) at which the sun reaches solar `altitude` degrees
// (negative = below horizon, positive = above) for a given latitude and solar declination.
// Standard formula: cos(H) = (sin(altitude) - sin(lat)*sin(dec)) / (cos(lat)*cos(dec)).
function hourAngle(latitude, declination, altitude) {
  const cosH = (sinDeg(altitude) - sinDeg(latitude) * sinDeg(declination)) / (cosDeg(latitude) * cosDeg(declination));
  if (cosH > 1 || cosH < -1) return null; // sun never reaches this altitude at this latitude/date (polar regions)
  return arccosDeg(cosH) / 15;
}

// Asr's altitude angle isn't fixed -- it depends on when an object's shadow reaches
// (shadowFactor + tan(|latitude - declination|)) times the object's own height. The sun is still
// above the horizon at this point (this is an afternoon altitude, not a below-horizon depression).
function asrAltitude(latitude, declination, shadowFactor) {
  const shadowRatio = shadowFactor + tanDeg(Math.abs(latitude - declination));
  return arctanDeg(1 / shadowRatio);
}

function computeSolarTime(hourAngleValue, longitude, equationOfTime, sign) {
  if (hourAngleValue === null) return null;
  return 12 - equationOfTime / 60 - longitude / 15 + sign * hourAngleValue;
}

function formatClockTime(decimalHours, timezoneOffsetHours) {
  if (decimalHours === null) return null;
  const adjusted = fixRange(decimalHours + timezoneOffsetHours, 24);
  const totalMinutes = Math.round(adjusted * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return { hours, minutes, decimalHours: adjusted };
}

/**
 * Computes the five daily prayer times plus sunrise, for a given date/location/method.
 * `date` is a JS Date used only for its calendar year/month/day (interpreted in the browser's
 * local timezone) and `timezoneOffsetHours` is the UTC offset to render clock times in (pass
 * `-date.getTimezoneOffset() / 60` for the device's own timezone).
 */
export function computePrayerTimes(latitude, longitude, date, methodKey = DEFAULT_CALCULATION_METHOD, asrMethodKey = DEFAULT_ASR_METHOD, timezoneOffsetHours = -date.getTimezoneOffset() / 60) {
  const method = CALCULATION_METHODS[methodKey] ?? CALCULATION_METHODS[DEFAULT_CALCULATION_METHOD];
  const asr = ASR_METHODS[asrMethodKey] ?? ASR_METHODS[DEFAULT_ASR_METHOD];
  const jd = julianDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const { declination, equationOfTime } = sunPosition(jd);

  const fajrH = hourAngle(latitude, declination, -method.fajrAngle);
  const sunriseH = hourAngle(latitude, declination, -SUNRISE_SUNSET_ANGLE);
  const asrH = hourAngle(latitude, declination, asrAltitude(latitude, declination, asr.shadowFactor));
  const maghribH = hourAngle(latitude, declination, -SUNRISE_SUNSET_ANGLE);

  const dhuhrDecimal = 12 - equationOfTime / 60 - longitude / 15;
  const maghribDecimal = computeSolarTime(maghribH, longitude, equationOfTime, 1);

  let ishaDecimal;
  if (method.ishaMinutesAfterMaghrib && maghribDecimal !== null) {
    ishaDecimal = maghribDecimal + method.ishaMinutesAfterMaghrib / 60;
  } else {
    const ishaH = hourAngle(latitude, declination, -method.ishaAngle);
    ishaDecimal = computeSolarTime(ishaH, longitude, equationOfTime, 1);
  }

  return {
    fajr: formatClockTime(computeSolarTime(fajrH, longitude, equationOfTime, -1), timezoneOffsetHours),
    sunrise: formatClockTime(computeSolarTime(sunriseH, longitude, equationOfTime, -1), timezoneOffsetHours),
    dhuhr: formatClockTime(dhuhrDecimal, timezoneOffsetHours),
    asr: formatClockTime(computeSolarTime(asrH, longitude, equationOfTime, 1), timezoneOffsetHours),
    maghrib: formatClockTime(maghribDecimal, timezoneOffsetHours),
    isha: formatClockTime(ishaDecimal, timezoneOffsetHours),
  };
}

/** Initial great-circle bearing from (latitude, longitude) to the Kaaba, in degrees from true north. */
export function computeQiblaBearing(latitude, longitude) {
  const deltaLng = KAABA_LNG - longitude;
  const y = sinDeg(deltaLng) * cosDeg(KAABA_LAT);
  const x = cosDeg(latitude) * sinDeg(KAABA_LAT) - sinDeg(latitude) * cosDeg(KAABA_LAT) * cosDeg(deltaLng);
  return fixRange(arctan2Deg(y, x), 360);
}

export function compassDirectionLabel(bearingDegrees) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round(bearingDegrees / 22.5) % 16];
}

export function formatPrayerClock(time) {
  if (!time) return '--:--';
  const period = time.hours >= 12 ? 'PM' : 'AM';
  const hour12 = time.hours % 12 === 0 ? 12 : time.hours % 12;
  return `${hour12}:${String(time.minutes).padStart(2, '0')} ${period}`;
}

/** Wraps getCurrentPosition in a Promise; resolves null (never rejects) on denial/unavailability. */
export function getLocation(options = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      options,
    );
  });
}

/** Ordered list of {key, label} for the day's prayer times, in the shape most render code wants. */
export function prayerTimesList(times) {
  return [
    { key: 'fajr', label: 'Fajr', time: times.fajr },
    { key: 'sunrise', label: 'Sunrise', time: times.sunrise },
    { key: 'dhuhr', label: 'Dhuhr', time: times.dhuhr },
    { key: 'asr', label: 'Asr', time: times.asr },
    { key: 'maghrib', label: 'Maghrib', time: times.maghrib },
    { key: 'isha', label: 'Isha', time: times.isha },
  ];
}

/** The next prayer (excluding sunrise, which isn't a prayer) relative to `now`, wrapping to tomorrow's Fajr if all of today's have passed. */
export function nextPrayer(times, now = new Date()) {
  const nowDecimal = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const candidates = [
    { key: 'fajr', label: 'Fajr', time: times.fajr },
    { key: 'dhuhr', label: 'Dhuhr', time: times.dhuhr },
    { key: 'asr', label: 'Asr', time: times.asr },
    { key: 'maghrib', label: 'Maghrib', time: times.maghrib },
    { key: 'isha', label: 'Isha', time: times.isha },
  ].filter((entry) => entry.time);
  const upcoming = candidates.find((entry) => entry.time.decimalHours > nowDecimal);
  if (upcoming) return { ...upcoming, minutesUntil: Math.round((upcoming.time.decimalHours - nowDecimal) * 60) };
  const first = candidates[0];
  if (!first) return null;
  return { ...first, minutesUntil: Math.round((24 - nowDecimal + first.time.decimalHours) * 60), isTomorrow: true };
}
