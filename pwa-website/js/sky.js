import { moonIllumination, solarPosition } from './prayer-times.js';
import { getArtMotionPreference } from './art-motion.js';

// The sky behind the next-prayer card, drawn from where the sun actually is.
//
// Not an animation of a day, and not a loop: it is a reading. The sun sits where the sun sits, from
// this location, at this moment -- so at Dhuhr it is overhead because the hour angle is zero, and
// at Maghrib it is on the horizon because its altitude is zero. The same solar position the prayer
// times themselves are computed from, asked to draw itself.
//
// That is the whole idea, and it is why nothing here interpolates between sunrise and sunset. A real
// sun does not trace a symmetrical arc about clock noon; it traces one about solar noon, and the two
// are up to sixteen minutes apart before longitude is considered. Faking it would look approximately
// right and be wrong exactly when someone is watching -- at the prayer time itself.
//
// What moves and what does not
// ----------------------------
// The sun's position changes with the clock, which means it moves about a degree every four minutes:
// invisible while you watch, clearly different when you come back. The only continuous motion is the
// shimmer of the rays and the twinkle of the stars, and both stop when the reader has asked for less
// motion. Nothing here animates position, because a sun that visibly slides is telling a lie about
// how fast the sky moves.

const SVG_NS = 'http://www.w3.org/2000/svg';
// Wide and short, to match the card. The viewBox has to be roughly the card's own proportions:
// with a square viewBox and preserveAspectRatio "slice", a 350x124 card shows only the middle third
// of the drawing, and the sun at its zenith is cropped off the top entirely -- which is precisely
// the moment the card most wants to show it.
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

/** The lit part of the moon, as a path over its disc. */
function moonShadowPath(cx, cy, r, phase, waxing) {
  // The terminator is an ellipse seen edge-on: its half-width shrinks to nothing at full moon and
  // opens to the full radius at new. Signed, so the shadow bulges the correct way either side of half.
  const k = Math.cos(2 * Math.PI * phase); // 1 at new, -1 at full
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 0 : 1;
  const sweepInner = k > 0 ? sweepOuter : 1 - sweepOuter;
  return `M ${cx} ${cy - r}`
    + ` A ${r} ${r} 0 0 ${sweepOuter} ${cx} ${cy + r}`
    + ` A ${rx} ${r} 0 0 ${sweepInner} ${cx} ${cy - r} Z`;
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

function build(container) {
  const svg = element('svg', {
    class: 'sky',
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    preserveAspectRatio: 'xMidYMid slice',
    'aria-hidden': 'true',
    focusable: 'false',
  });

  const defs = element('defs');
  const gradient = element('linearGradient', { id: 'skyGradient', x1: '0', y1: '0', x2: '0', y2: '1' });
  const stopTop = element('stop', { offset: '0%' });
  const stopBottom = element('stop', { offset: '100%' });
  gradient.append(stopTop, stopBottom);

  // The light pooling around whichever body is up, which is what actually sells sunrise and sunset.
  const halo = element('radialGradient', { id: 'skyHalo' });
  const haloInner = element('stop', { offset: '0%', 'stop-opacity': '0.85' });
  const haloOuter = element('stop', { offset: '100%', 'stop-opacity': '0' });
  halo.append(haloInner, haloOuter);
  defs.append(gradient, halo);

  const background = element('rect', { width: WIDTH, height: HEIGHT, fill: 'url(#skyGradient)' });
  const starField = element('g', { class: 'sky-stars' });
  for (const star of STARS) {
    const dot = element('circle', { cx: star.x.toFixed(2), cy: star.y.toFixed(2), r: star.r, fill: '#ffffff' });
    dot.style.setProperty('--twinkle-delay', `${star.delay}s`);
    starField.append(dot);
  }

  const glow = element('circle', { r: 22, fill: 'url(#skyHalo)' });
  const rays = element('g', { class: 'sky-rays' });
  for (let index = 0; index < 12; index += 1) {
    rays.append(element('rect', {
      x: -0.32, y: -9.4, width: 0.64, height: 4.4, rx: 0.32,
      transform: `rotate(${index * 30})`,
    }));
  }
  const body = element('circle', { r: 4 });
  const moonShadow = element('path', { fill: 'rgba(8,16,30,0.92)' });
  const bodyGroup = element('g', { class: 'sky-body' });
  bodyGroup.append(rays, body, moonShadow);

  // A soft band rather than a drawn line: a hard horizon in a card this small reads as a seam.
  const horizon = element('rect', { x: 0, y: HORIZON_Y, width: WIDTH, height: HEIGHT - HORIZON_Y, fill: 'rgba(3,10,20,0.34)' });

  svg.append(defs, background, starField, glow, horizon, bodyGroup);
  container.prepend(svg);
  return { svg, stopTop, stopBottom, haloInner, haloOuter, starField, glow, bodyGroup, body, rays, moonShadow };
}

/**
 * Draws the sky for a place and a moment. Safe to call as often as the countdown ticks: it only
 * writes attributes, and the values change slowly enough that most ticks change nothing visible.
 */
export function renderSky(container, { latitude, longitude, now = new Date() } = {}) {
  if (!container) return null;
  if (!root || !container.contains(root)) {
    parts = build(container);
    root = parts.svg;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const { altitude, hourAngle } = solarPosition(latitude, longitude, now);
  const palette = skyPalette(altitude);
  const { x, y } = bodyPosition(altitude, hourAngle);

  parts.stopTop.setAttribute('stop-color', palette.top);
  parts.stopBottom.setAttribute('stop-color', palette.bottom);
  parts.haloInner.setAttribute('stop-color', palette.glow);
  parts.haloOuter.setAttribute('stop-color', palette.glow);

  // Night is the sun below civil twilight; the stars arrive across that boundary rather than at it.
  const night = clamp((-altitude - 2) / 10, 0, 1);
  parts.starField.style.opacity = night.toFixed(3);

  const isNight = altitude < -2;
  if (isNight) {
    // The moon is opposite the sun, roughly: this puts it on the other side of the sky, which is
    // where it is for most of the month and always is at full. A real lunar ephemeris would be
    // several hundred lines to move it by a few degrees on a card this size.
    const moonHourAngle = hourAngle > 0 ? hourAngle - 180 : hourAngle + 180;
    const moon = moonIllumination(now);
    const at = bodyPosition(Math.max(8, 46 - Math.abs(moonHourAngle) / 2.4), moonHourAngle);
    parts.glow.setAttribute('cx', at.x);
    parts.glow.setAttribute('cy', at.y);
    parts.glow.setAttribute('r', 13);
    parts.bodyGroup.setAttribute('transform', `translate(${at.x} ${at.y})`);
    parts.body.setAttribute('r', 3.2);
    parts.body.setAttribute('fill', '#eef3fb');
    parts.rays.style.display = 'none';
    parts.moonShadow.style.display = '';
    parts.moonShadow.setAttribute('d', moonShadowPath(0, 0, 3.2, moon.phase, moon.waxing));
  } else {
    parts.glow.setAttribute('cx', x);
    parts.glow.setAttribute('cy', y);
    parts.glow.setAttribute('r', 22);
    parts.bodyGroup.setAttribute('transform', `translate(${x} ${y})`);
    parts.body.setAttribute('r', 4);
    parts.body.setAttribute('fill', altitude < 6 ? '#ffd39a' : '#fff6d8');
    parts.rays.style.display = '';
    parts.moonShadow.style.display = 'none';
  }

  // The reader's motion preference decides whether anything moves at all. Still means a sky that is
  // correct and completely static, which is the right answer for someone who asked for that.
  const motion = document.documentElement.classList.contains('reduce-motion')
    ? 'still'
    : getArtMotionPreference();
  root.classList.toggle('sky-static', motion === 'still');
  root.classList.toggle('sky-full', motion === 'full');
  root.dataset.phase = isNight ? 'night' : altitude < 6 ? 'golden' : 'day';

  return { altitude, hourAngle, isNight, palette };
}

/** Drops the built SVG, so a card that is rebuilt does not leave an orphan behind. */
export function resetSky() {
  root?.remove();
  root = null;
  parts = null;
}
