import { solarPosition } from './prayer-times.js';
import { getArtMotionPreference } from './art-motion.js';

// A decorative clock-driven sky. Solar colours use the actual altitude; the display arc is
// normalized between the same horizon crossings as Sunrise/Maghrib, with Dhuhr at its peak.
// The moon represents progress through the night, not a measured lunar position. Only light,
// haze and stars loop: celestial positions change with time, including in Still mode.

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 100;
const HEIGHT = 34;
const HORIZON_Y = 27;

/**
 * The sky's colours, keyed by solar altitude in degrees. Interpolated between, so dusk is a
 * continuous slide rather than four discrete states that snap.
 *
 * The stops are the standard twilight boundaries, which is why they are at these particular angles:
 * -18 is astronomical dawn, -12 nautical, -6 civil, 0 the horizon itself.
 */
const SKY_STOPS = [
  { altitude: -18, top: '#050b18', bottom: '#0a1526', glow: '#0a1526' },
  { altitude: -12, top: '#071023', bottom: '#122238', glow: '#1d3352' },
  { altitude: -6, top: '#0d1b33', bottom: '#38385c', glow: '#8a5a7a' },
  { altitude: -1, top: '#1b3358', bottom: '#8c5b6b', glow: '#e08a5a' },
  { altitude: 4, top: '#2f5d93', bottom: '#d98a5e', glow: '#ffb774' },
  { altitude: 14, top: '#2f7cc0', bottom: '#8fc4e6', glow: '#ffd9a0' },
  { altitude: 40, top: '#1f6fc4', bottom: '#79c0ea', glow: '#fff2c4' },
  { altitude: 90, top: '#1766bd', bottom: '#8fd2f2', glow: '#fff8dc' },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function mixChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function mixHex(from, to, t) {
  const parse = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const hex = (value) => value.toString(16).padStart(2, '0');
  return `#${hex(mixChannel(r1, r2, t))}${hex(mixChannel(g1, g2, t))}${hex(mixChannel(b1, b2, t))}`;
}

/** The palette at a given solar altitude, blended between the two stops it falls between. */
export function skyPalette(altitude) {
  const value = clamp(altitude, SKY_STOPS[0].altitude, SKY_STOPS[SKY_STOPS.length - 1].altitude);
  for (let index = 0; index < SKY_STOPS.length - 1; index += 1) {
    const low = SKY_STOPS[index];
    const high = SKY_STOPS[index + 1];
    if (value > high.altitude) continue;
    const span = high.altitude - low.altitude;
    const t = span === 0 ? 0 : (value - low.altitude) / span;
    return {
      top: mixHex(low.top, high.top, t),
      bottom: mixHex(low.bottom, high.bottom, t),
      glow: mixHex(low.glow, high.glow, t),
    };
  }
  const last = SKY_STOPS[SKY_STOPS.length - 1];
  return { top: last.top, bottom: last.bottom, glow: last.glow };
}

/**
 * Where to draw a body of the given altitude and hour angle, in the SVG's own coordinates.
 *
 * Hour angle rather than azimuth for the horizontal: it runs cleanly from negative in the morning
 * through zero at solar noon to positive in the afternoon, which is exactly left-to-right across a
 * card. Azimuth is the truer compass answer but it wraps at north and would send the sun off one
 * edge and back in the other during a summer night at high latitude.
 */
export function bodyPosition(altitude, hourAngle) {
  const x = 50 + clamp(hourAngle, -120, 120) / 120 * 46;
  // Above the horizon the arc uses the full height; below it the body only dips a little way out of
  // sight, so a moon rising just under the horizon is still hinted at rather than vanishing.
  const y = altitude >= 0
    ? HORIZON_Y - (clamp(altitude, 0, 90) / 90) * (HORIZON_Y - 6.5)
    : HORIZON_Y + clamp(-altitude, 0, 18) / 18 * 6;
  return { x, y };
}

/** A normalized semicircle, projected to the card's aspect ratio when rendered. */
export function arcPosition(progress) {
  const t = clamp(progress, 0, 1);
  return { x: .5 - .42 * Math.cos(Math.PI * t), height: Math.sin(Math.PI * t) };
}

/** Clock-derived positions remain continuous across solar midnight and device midnight. */
export function skyState(latitude, longitude, now = new Date()) {
  const solar = solarPosition(latitude, longitude, now);
  const angle = ((solar.hourAngle + 180) % 360 + 360) % 360 - 180;
  const horizon = solar.horizonHourAngle;
  const polar = !Number.isFinite(horizon) || horizon <= 0 || horizon >= 180;
  if (polar) {
    // Do not invent a sunrise or sunset when none occurs at this latitude.
    const at = bodyPosition(solar.altitude, angle);
    return { ...solar, polar, day: solar.altitude >= -.833,
      sun: { x: at.x / 100, height: clamp((27 - at.y) / 20.5, 0, 1) },
      moon: arcPosition(((angle + 360) % 360) / 360), sunProgress: .5, moonProgress: .5 };
  }
  const sunProgress = (angle + horizon) / (2 * horizon);
  const moonProgress = ((angle - horizon + 360) % 360) / (360 - 2 * horizon);
  return { ...solar, polar, day: Math.abs(angle) <= horizon,
    sun: arcPosition(sunProgress), moon: arcPosition(moonProgress), sunProgress, moonProgress };
}

const element = (name, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};

/** Stars, scattered once and kept, so they do not jump about on every redraw. */
const STARS = Array.from({ length: 34 }, (_unused, index) => {
  // Deterministic rather than Math.random(): the same sky every time it is drawn, and identical
  // between reloads, which is what stops it reading as noise.
  const golden = (index * 137.508) % 360;
  return {
    x: (golden / 360) * 96 + 2,
    y: ((index * 41) % 22) + 2,
    r: index % 7 === 0 ? 0.7 : index % 3 === 0 ? 0.5 : 0.35,
    delay: (index % 9) * 0.55,
  };
});

let root = null;
let parts = null;
let observer = null;
let lastInput = null;
let serial = 0;

function build(container) {
  const id = `prayerSky${++serial}`;
  const svg = element('svg', { class: 'sky', viewBox: '0 0 100 70',
    'aria-hidden': 'true', focusable: 'false' });
  // Geometry is normalized to the actual card dimensions, keeping discs round at every width.
  svg.innerHTML = `<defs>
    <linearGradient id="${id}sky" x2="0" y2="1"><stop offset="0"/><stop offset=".65"/><stop offset="1"/></linearGradient>
    <radialGradient id="${id}halo"><stop stop-color="#fff6d1" stop-opacity=".8"/><stop offset=".24" stop-color="#ffd6a0" stop-opacity=".35"/><stop offset="1" stop-color="#ffc28a" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}moon"><stop stop-color="#d0e6ff" stop-opacity=".4"/><stop offset=".3" stop-color="#bad5ff" stop-opacity=".12"/><stop offset="1" stop-color="#aac9ef" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}beam" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fffbe4" stop-opacity="0"/><stop offset=".38" stop-color="#fff4d0" stop-opacity=".22"/><stop offset=".68" stop-color="#ffeac1" stop-opacity=".12"/><stop offset="1" stop-color="#ffe6b6" stop-opacity="0"/></linearGradient>
    <radialGradient id="${id}daylight" gradientUnits="userSpaceOnUse" r="65"><stop stop-color="#fff5d9" stop-opacity=".24"/><stop offset=".4" stop-color="#fff1cf" stop-opacity=".11"/><stop offset="1" stop-color="#ffe6bf" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}veil" x2="0" y2="1"><stop stop-color="#071728" stop-opacity="0"/><stop offset="1" stop-color="#061726" stop-opacity=".96"/></linearGradient>
    <filter id="${id}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.1"/></filter>
    <clipPath id="${id}clip"><rect width="100"/></clipPath>
  </defs>
  <rect class="sky-backdrop" width="100" fill="url(#${id}sky)"/>
  <g class="sky-stars"></g>
  <g clip-path="url(#${id}clip)">
    <g class="sky-daylight">
      <rect class="sky-light-wash" width="100" fill="url(#${id}daylight)"/>
      <g class="sky-ray-direction"><g class="sky-rays" fill="url(#${id}beam)" filter="url(#${id}soft)">${Array.from({ length: 7 }, (_, i) => `<path style="--ray-delay:-${i * 1.1}s"/>`).join('')}</g></g>
    </g>
    <path class="sky-orbit" fill="none" stroke="#fff3d5" stroke-opacity=".16" stroke-width=".2" stroke-dasharray=".5 1.6"/>
    <g class="sky-sun-position"><g class="sky-aura"><circle r="19" fill="url(#${id}halo)"/></g>
      <circle class="sky-corona" r="4.4" fill="#fff3cf" opacity=".18"/>
      <circle class="sky-sun-disc" r="3.3" fill="#fff4cf"/>
    </g>
    <g class="sky-moon-position"><g class="sky-moon-glow"><circle r="13" fill="url(#${id}moon)"/></g>
      <path d="M1.2-3.5A3.8 3.8 0 1 0 3.6 1.8A3.4 3.4 0 0 1 1.2-3.5Z" fill="#e8f2ff"/>
      <path d="M1.2-3.5A3.8 3.8 0 0 0-2.8 2" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".2"/>
    </g>
    <g class="sky-haze" fill="#ffe6cd" opacity=".16"><path d="M-10 0Q9-2 24 0T66 0T112 0L112 1Q80 3 55 1T-10 2Z"/><path d="M-5 6Q20 4 43 6T110 5V6Q70 9 42 7T-5 8Z" opacity=".55"/></g>
  </g>
  <path class="sky-ridge-far"/>
  <path class="sky-ridge-near"/>
  <rect class="sky-veil" width="100" fill="url(#${id}veil)"/>`;
  const find = selector => svg.querySelector(selector);
  const starField = find('.sky-stars');
  for (const star of STARS) {
    const dot = element('circle', { cx: star.x, cy: star.y, r: star.r * .25, fill: '#f4f3e7' });
    dot.style.setProperty('--twinkle-delay', `-${star.delay}s`);
    starField.append(dot);
  }
  container.prepend(svg);
  return { svg, stops: [...find('linearGradient').children], background: find('.sky-backdrop'),
    starField, clip: find('clipPath rect'), orbit: find('.sky-orbit'), sun: find('.sky-sun-position'),
    moon: find('.sky-moon-position'), haze: find('.sky-haze'), far: find('.sky-ridge-far'),
    near: find('.sky-ridge-near'), veil: find('.sky-veil'), daylight: find('.sky-daylight'),
    lightWash: find('.sky-light-wash'), lightGradient: find(`#${id}daylight`),
    rayDirection: find('.sky-ray-direction'), rays: [...svg.querySelectorAll('.sky-rays path')] };
}

export function renderSky(container, { latitude, longitude, now = new Date() } = {}) {
  if (!container || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!root || !container.contains(root)) {
    resetSky();
    parts = build(container);
    root = parts.svg;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => { if (lastInput) renderSky(container, lastInput); });
      observer.observe(container);
    }
  }
  lastInput = { latitude, longitude, now };
  const state = skyState(latitude, longitude, now);
  const palette = skyPalette(state.altitude);
  const width = container.clientWidth || 360;
  const height = (container.clientHeight || 300) / width * 100;
  const labelTop = container.querySelector('.prayer-next-label')?.offsetTop;
  const horizon = Math.max(12, labelTop > 0 ? (labelTop - 14) / width * 100 : height - 90 / width * 100);
  const peak = 30 / width * 100;
  const radiusScale = clamp(400 / width, .5, 1);
  root.setAttribute('viewBox', `0 0 100 ${height}`);
  parts.background.setAttribute('height', height);
  parts.stops.forEach((stop, i) => stop.setAttribute('stop-color', [palette.top, palette.bottom, palette.glow][i]));
  parts.clip.setAttribute('height', horizon);
  parts.orbit.setAttribute('d', `M8 ${horizon}A42 ${horizon - peak} 0 0 1 92 ${horizon}`);
  parts.orbit.style.opacity = state.polar ? '0' : '.8';
  parts.starField.style.opacity = clamp((-state.altitude - 1) / 13, 0, 1);
  [...parts.starField.children].forEach((dot, i) => dot.setAttribute('cy', STARS[i].y / 26 * horizon));
  const place = (node, point) => node.setAttribute('transform',
    `translate(${point.x * 100} ${horizon - point.height * (horizon - peak)}) scale(${radiusScale})`);
  const sunHeight = state.polar ? state.sun.height
    : Math.sin(Math.PI * clamp(state.sunProgress, -.1, 1.1));
  place(parts.sun, { ...state.sun, height: sunHeight });
  place(parts.moon, state.moon);
  // Sunlight lives in the sky behind the disc. Broad, off-frame shafts never converge into a
  // spotlight at its centre; their angle and wash follow the clock while intensity gently varies.
  parts.lightWash.setAttribute('height', horizon);
  parts.lightGradient.setAttribute('cx', state.sun.x * 100);
  parts.lightGradient.setAttribute('cy', horizon - sunHeight * (horizon - peak));
  parts.rayDirection.setAttribute('transform', `rotate(${(state.sun.x - .5) * 60} 50 ${horizon / 2})`);
  const offsets = [-45, -20, 4, 32, 63, 94, 122];
  parts.rays.forEach((ray, i) => {
    const x = offsets[i], spread = 12 + (i % 3) * 4;
    ray.setAttribute('d', `M${x} -35Q${x-4} ${horizon*.4} ${x-8} ${horizon+35}H${x+spread}Q${x+spread-3} ${horizon*.4} ${x+spread-5} -35Z`);
  });
  parts.daylight.style.opacity = clamp((state.altitude + 3) / 14, 0, 1);
  // Independent bodies: each goes below the clipped horizon instead of turning into the other.
  parts.sun.style.opacity = state.polar ? (state.day ? '1' : '0')
    : clamp(Math.min(1 + state.sunProgress / .04, 1 + (1 - state.sunProgress) / .04), 0, 1);
  parts.moon.style.opacity = state.day ? '0'
    : state.polar ? '1' : clamp(Math.min(state.moonProgress, 1 - state.moonProgress) / .035, 0, 1);
  parts.haze.setAttribute('transform', `translate(0 ${horizon * .68})`);
  parts.far.setAttribute('d', `M0 ${horizon+1}Q12 ${horizon-3} 27 ${horizon+1}T58 ${horizon}T100 ${horizon-1}V${height}H0Z`);
  parts.near.setAttribute('d', `M0 ${horizon+4}Q20 ${horizon+1} 40 ${horizon+5}T75 ${horizon+3}T100 ${horizon+4}V${height}H0Z`);
  parts.far.setAttribute('fill', mixHex(palette.bottom, '#10283b', .7));
  parts.near.setAttribute('fill', mixHex(palette.top, '#061621', .84));
  parts.veil.setAttribute('y', horizon - 5);
  parts.veil.setAttribute('height', height - horizon + 5);
  parts.svg.querySelector('.sky-sun-disc').setAttribute('fill', state.altitude < 8 ? '#ffda9b' : '#fff7dd');
  const motion = document.documentElement.classList.contains('reduce-motion') ? 'still' : getArtMotionPreference();
  root.classList.toggle('sky-static', motion === 'still');
  root.classList.toggle('sky-full', motion === 'full');
  root.dataset.phase = !state.day ? 'night' : state.altitude < 8 ? 'golden' : 'day';
  return { ...state, isNight: !state.day, palette };
}

export function resetSky() {
  observer?.disconnect();
  observer = null;
  lastInput = null;
  root?.remove();
  root = null;
  parts = null;
}
