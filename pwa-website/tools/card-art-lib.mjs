// Drawing primitives shared by every card in assets/cards.
//
// The density this art needs -- a treeline of thirty conifers, a bank of a hundred grass blades, a
// palm frond built from twenty leaflets -- is work a loop does well and a person does badly by hand.
// Everything here is a silhouette: at card size, outline reads and interior detail turns to mush.

/** Deterministic RNG, so regenerating never reshuffles the art and dirties the diff. */
export function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

// Coordinates are rounded to a tenth and trailing zeros dropped: at this canvas size finer
// precision is invisible, and "12" instead of "12.0" is a third of the bytes across ~4000 numbers.
export const f = (n) => String(Math.round(Number(n) * 10) / 10);

/**
 * A conifer, drawn as one irregular silhouette rather than stacked tiers.
 *
 * Two earlier attempts failed in instructive ways. Sawtooth bands with hollow middles rendered as a
 * stack of combs; solid overlapping tiers rendered as a pagoda, because anything that regular reads
 * as architecture. What makes a fir is an uneven outline: the profile narrows toward the apex, and
 * every step out to a branch tip is a different length, with a notch cut back in behind it.
 */
export function conifer(x, baseY, height, width, fill, opacity, seed) {
  const next = rng(seed);
  const steps = 13;
  const half = width / 2;
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;                                   // 0 at the base, 1 at the tip
    const y = baseY - height * t;
    const taper = (1 - t) ** 0.8;
    const stepY = (height / steps) * 0.5;
    const wl = half * taper * (0.72 + next() * 0.5);
    const wr = half * taper * (0.72 + next() * 0.5);
    left.push(`${f(x - wl)},${f(y)}`);
    left.push(`${f(x - wl * 0.34)},${f(y - stepY)}`);       // notch cut back behind the branch tip
    right.push(`${f(x + wr)},${f(y)}`);
    right.push(`${f(x + wr * 0.34)},${f(y - stepY)}`);
  }
  const points = [...left, `${f(x)},${f(baseY - height * 1.03)}`, ...right.reverse()].join(' ');
  const trunkTop = baseY - height * 0.1;
  return `<g fill="${fill}" fill-opacity="${opacity}">`
    + `<rect x="${f(x - width * 0.03)}" y="${f(trunkTop)}" width="${f(width * 0.06)}" height="${f(baseY - trunkTop)}"/>`
    + `<polygon points="${points}"/></g>`;
}

/** A palm: leaning trunk, fronds drawn as an arcing spine with leaflets stepping down both sides. */
export function palm(x, baseY, scale, fill, opacity, seed) {
  const next = rng(seed);
  const trunkH = 118 * scale;
  const lean = (next() - 0.5) * 24 * scale;
  const topX = x + lean;
  const topY = baseY - trunkH;
  const parts = [
    `<path d="M${f(x - 3.6 * scale)} ${f(baseY)} Q${f(x + lean * 0.4 - 2.2 * scale)} ${f(baseY - trunkH * 0.55)} ${f(topX - 2.6 * scale)} ${f(topY)} `
    + `L${f(topX + 2.6 * scale)} ${f(topY)} Q${f(x + lean * 0.4 + 2.8 * scale)} ${f(baseY - trunkH * 0.55)} ${f(x + 3.8 * scale)} ${f(baseY)} Z"/>`,
  ];
  // Leaflets are drawn only when the palm is big enough for them to survive to the screen. A
  // treeline palm at scale 0.25 is about thirty pixels tall in the rendered card, which puts its
  // leaflets under a pixel each -- they were invisible and cost 48KB of the first build's 105KB.
  const detailed = scale >= 0.55;
  const fronds = detailed ? 9 : 6;
  for (let i = 0; i < fronds; i += 1) {
    const spread = -0.12 + (i / (fronds - 1)) * 1.24;
    const angle = Math.PI + spread * Math.PI;
    const len = (46 + next() * 20) * scale;
    const tipX = topX + Math.cos(angle) * len;
    const tipY = topY + Math.sin(angle) * len * 0.5 + 24 * scale;
    const midX = (topX + tipX) / 2;
    const midY = (topY + tipY) / 2 - 16 * scale;
    parts.push(`<path d="M${f(topX)} ${f(topY)} Q${f(midX)} ${f(midY)} ${f(tipX)} ${f(tipY)}" stroke="${fill}" stroke-opacity="${opacity}" stroke-width="${f(2.1 * scale)}" fill="none" stroke-linecap="round"/>`);
    if (!detailed) continue;
    const leaflets = 9;
    for (let l = 1; l <= leaflets; l += 1) {
      const p = l / (leaflets + 1);
      const bx = topX * (1 - p) * (1 - p) + midX * 2 * p * (1 - p) + tipX * p * p;
      const by = topY * (1 - p) * (1 - p) + midY * 2 * p * (1 - p) + tipY * p * p;
      const size = (11 - 7.5 * p) * scale;
      const dir = Math.cos(angle) >= 0 ? 1 : -1;
      parts.push(`<path d="M${f(bx)} ${f(by)} q${f(dir * size * 0.55)} ${f(size * 0.62)} ${f(dir * size * 0.18)} ${f(size * 1.2)} `
        + `q${f(-dir * size * 0.34)} ${f(-size * 0.6)} ${f(-dir * size * 0.18)} ${f(-size * 1.2)} Z"/>`);
    }
  }
  parts.push(`<circle cx="${f(topX)}" cy="${f(topY)}" r="${f(3.2 * scale)}"/>`);
  return `<g fill="${fill}" fill-opacity="${opacity}">${parts.join('')}</g>`;
}

/** Mixed conifers and palms at small scale, for a far shore. */
export function treeline(x0, x1, baseY, count, fill, opacity, seed) {
  const next = rng(seed);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = x0 + ((x1 - x0) * (i + next() * 0.7)) / count;
    const h = 15 + next() * 17;
    if (next() > 0.74) out.push(palm(x, baseY, 0.2 + next() * 0.1, fill, opacity, (seed + i * 7) >>> 0));
    else out.push(conifer(x, baseY, h, h * 0.5, fill, opacity, (seed + i * 13) >>> 0));
  }
  return out.join('');
}

/** Grass: individual blades, leaning both ways, varying height. */
export function grass(x0, x1, baseY, count, fill, opacity, seed) {
  const next = rng(seed);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = x0 + (x1 - x0) * (i / count) + next() * 3;
    const h = 6 + next() * 17;
    const lean = (next() - 0.5) * 14;
    out.push(`<path d="M${f(x)} ${f(baseY)} Q${f(x + lean * 0.4)} ${f(baseY - h * 0.6)} ${f(x + lean)} ${f(baseY - h)} `
      + `Q${f(x + lean * 0.3)} ${f(baseY - h * 0.55)} ${f(x + 1.6)} ${f(baseY)} Z"/>`);
  }
  return `<g fill="${fill}" fill-opacity="${opacity}">${out.join('')}</g>`;
}

/** A fern: arcing stems with paired teardrop leaflets. */
export function fern(x, baseY, scale, fill, opacity, seed) {
  const next = rng(seed);
  const out = [];
  const stems = 3;
  for (let s = 0; s < stems; s += 1) {
    const angle = -Math.PI / 2 + (s - 1) * 0.55;
    const len = (32 + next() * 14) * scale;
    const tipX = x + Math.cos(angle) * len;
    const tipY = baseY + Math.sin(angle) * len;
    const cx = x + Math.cos(angle) * len * 0.5 - 8 * scale;
    const cy = baseY + Math.sin(angle) * len * 0.5;
    out.push(`<path d="M${f(x)} ${f(baseY)} Q${f(cx)} ${f(cy)} ${f(tipX)} ${f(tipY)}" stroke="${fill}" stroke-opacity="${opacity}" stroke-width="${f(1.8 * scale)}" fill="none"/>`);
    for (let l = 1; l <= 5; l += 1) {
      const p = l / 6;
      const bx = x * (1 - p) * (1 - p) + cx * 2 * p * (1 - p) + tipX * p * p;
      const by = baseY * (1 - p) * (1 - p) + cy * 2 * p * (1 - p) + tipY * p * p;
      const size = (9 - 5 * p) * scale;
      for (const dir of [-1, 1]) {
        out.push(`<path d="M${f(bx)} ${f(by)} q${f(dir * size)} ${f(-size * 0.7)} ${f(dir * size * 1.5)} ${f(-size * 0.1)} `
          + `q${f(-dir * size * 0.7)} ${f(size * 0.8)} ${f(-dir * size * 1.5)} ${f(size * 0.1)} Z"/>`);
      }
    }
  }
  return `<g fill="${fill}" fill-opacity="${opacity}">${out.join('')}</g>`;
}

/** A broad-leaved plant, for the very front where shapes must be big and simple. */
export function leafPlant(x, baseY, scale, fill, opacity, seed) {
  const next = rng(seed);
  const out = [];
  const leaves = 5 + Math.floor(next() * 3);
  for (let i = 0; i < leaves; i += 1) {
    const angle = -Math.PI / 2 + (i - (leaves - 1) / 2) * 0.44 + (next() - 0.5) * 0.18;
    const len = (24 + next() * 22) * scale;
    const tipX = x + Math.cos(angle) * len;
    const tipY = baseY + Math.sin(angle) * len;
    const w = (7 + next() * 5) * scale;
    const nx = Math.cos(angle + Math.PI / 2) * w;
    const ny = Math.sin(angle + Math.PI / 2) * w;
    out.push(`<path d="M${f(x)} ${f(baseY)} Q${f((x + tipX) / 2 + nx)} ${f((baseY + tipY) / 2 + ny)} ${f(tipX)} ${f(tipY)} `
      + `Q${f((x + tipX) / 2 - nx)} ${f((baseY + tipY) / 2 - ny)} ${f(x)} ${f(baseY)} Z"/>`);
  }
  return `<g fill="${fill}" fill-opacity="${opacity}">${out.join('')}</g>`;
}

/** A ridgeline of peaks with a flat base, for the mountain layers. */
export function ridge(w, baseY, peaks, amplitude, seed) {
  const next = rng(seed);
  const pts = [`0,${f(baseY)}`];
  for (let i = 0; i <= peaks; i += 1) {
    const x = (w * i) / peaks;
    const shoulder = (w / peaks) * 0.5;
    pts.push(`${f(x - shoulder * 0.6)},${f(baseY - amplitude * 0.18 * next())}`);
    pts.push(`${f(x)},${f(baseY - amplitude * (0.42 + next() * 0.78))}`);
  }
  pts.push(`${f(w)},${f(baseY)}`);
  return `M${pts.join(' L')} L${f(w)},999 L0,999 Z`;
}

/** Birds: two strokes each, small enough to be a suggestion rather than a drawing. */
export function birds(cx, cy, count, fill, opacity, seed) {
  const next = rng(seed);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = cx + (next() - 0.5) * 130;
    const y = cy + (next() - 0.5) * 46;
    const s = 3.4 + next() * 2.6;
    out.push(`<path d="M${f(x - s)} ${f(y)} q${f(s * 0.5)} ${f(-s * 0.62)} ${f(s)} 0 q${f(s * 0.5)} ${f(-s * 0.62)} ${f(s)} 0" `
      + `stroke="${fill}" stroke-opacity="${opacity}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`);
  }
  return out.join('');
}
