// Generates the Advanced-UI card artwork. See tools/card-art-lib.mjs for the drawing primitives.
//
// Depth is the whole game. Thirteen planes back to front -- sky, cloud, moon, four mountain ranges
// each hazier than the one in front, a far treeline, the subject, water, its reflection, foreground
// banks, and framing trees in near-silhouette. Fewer planes than that and it reads as clip art.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { birds, conifer, fern, grass, leafPlant, palm, ridge, treeline } from './card-art-lib.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/cards');
const W = 928;
const H = 400;
const WATER = 292;     // waterline
const SHORE = 286;     // where the far bank sits

/**
 * The mosque. Its own function because the reflection needs a second copy of it.
 *
 * The lighting is the point. Two sources, and the contrast between them is what gives the building
 * form: cool moonlight from the upper left, and warm lamplight from inside spilling out of every
 * opening. Stone is therefore warm at its base where the lamplight rakes it and cool at the top
 * where only the moon reaches; domes are deep blue and shaded as spheres, not flat plates.
 * A uniformly cool building reads as a cut-out no matter how much geometry it has.
 */
function mosque() {
  // A dome: sphere shading, a lit rim on the moon side, and occlusion where it meets its drum.
  const dome = (cx, baseY, rx, ry, id) => `
    <path d="M${cx - rx} ${baseY} Q${cx - rx - ry * 0.06} ${baseY - ry * 0.62} ${cx} ${baseY - ry} Q${cx + rx + ry * 0.06} ${baseY - ry * 0.62} ${cx + rx} ${baseY} Z" fill="url(#domeSkin)"/>
    <path d="M${cx - rx} ${baseY} Q${cx - rx - ry * 0.06} ${baseY - ry * 0.62} ${cx} ${baseY - ry}" fill="none" stroke="#cfe4f7" stroke-opacity="0.55" stroke-width="${rx * 0.055}"/>
    <path d="M${cx - rx} ${baseY} Q${cx} ${baseY - ry * 0.22} ${cx + rx} ${baseY} Z" fill="#0a1526" opacity="0.3" filter="url(#blurTiny)"/>
    <ellipse cx="${cx - rx * 0.3}" cy="${baseY - ry * 0.62}" rx="${rx * 0.3}" ry="${ry * 0.2}" fill="#dff0ff" opacity="0.2" filter="url(#blurTiny)"/>`;

  // A minaret: the shaft is a cylinder, so it is lit across its width rather than filled flat.
  const minaret = (x) => `
    <rect x="${x}" y="150" width="19" height="136" fill="url(#cyl)"/>
    <rect x="${x}" y="150" width="19" height="136" fill="url(#warmFoot)"/>
    <rect x="${x + 3}" y="160" width="13" height="18" rx="6.5" fill="#101d33" opacity="0.6"/>
    <rect x="${x - 6}" y="186" width="31" height="6" rx="3" fill="url(#stone)"/>
    <rect x="${x - 5}" y="192" width="29" height="4" fill="#1d2743" opacity="0.55"/>
    <rect x="${x - 4}" y="146" width="27" height="6" rx="3" fill="url(#stone)"/>
    <rect x="${x + 3}" y="124" width="13" height="24" fill="url(#cyl)"/>
    <path d="M${x + 2} 124 L${x + 9.5} 96 L${x + 17} 124 Z" fill="url(#domeSkin)"/>
    <path d="M${x + 2} 124 L${x + 9.5} 96" fill="none" stroke="#cfe4f7" stroke-opacity="0.5" stroke-width="1.1"/>
    <rect x="${x + 7.7}" y="86" width="3.5" height="12" rx="1.75" fill="#f3d79a"/>
    <circle cx="${x + 9.5}" cy="85" r="3" fill="#ffe3ac"/>`;

  return `
    ${minaret(322)}
    ${minaret(587)}

    <!-- side wings: their own domes, set back and so slightly darkened -->
    <g opacity="0.94">${dome(396, 218, 24, 42, 'a')}</g>
    <g opacity="0.94">${dome(532, 218, 24, 42, 'b')}</g>
    <rect x="393.5" y="166" width="5" height="12" rx="2.5" fill="#f3d79a"/>
    <rect x="529.5" y="166" width="5" height="12" rx="2.5" fill="#f3d79a"/>

    <!-- drum: a cylinder, with its lit windows and the dome's shadow falling across its top -->
    <rect x="424" y="176" width="80" height="42" fill="url(#cyl)"/>
    <rect x="424" y="176" width="80" height="10" fill="#0a1526" opacity="0.3"/>
    <g fill="url(#lamp)">
      <path d="M436 214 V194 A6 6 0 0 1 448 194 V214 Z"/>
      <path d="M458 214 V192 A6 6 0 0 1 470 192 V214 Z"/>
      <path d="M480 214 V194 A6 6 0 0 1 492 194 V214 Z"/>
    </g>
    <ellipse cx="464" cy="206" rx="52" ry="20" fill="url(#warmBloom)"/>

    <!-- main dome -->
    ${dome(464, 178, 40, 82, 'c')}
    <g stroke="#9fc4e2" stroke-opacity="0.28" stroke-width="1.2" fill="none">
      <path d="M464 97 Q446 136 442 178"/><path d="M464 97 Q482 136 486 178"/>
      <path d="M464 97 Q430 140 428 178"/><path d="M464 97 Q498 140 500 178"/>
    </g>
    <rect x="461" y="72" width="6" height="26" rx="3" fill="#f3d79a"/>
    <circle cx="464" cy="70" r="4.5" fill="#ffe3ac"/>
    <circle cx="464" cy="70" r="11" fill="#ffe3ac" opacity="0.28" filter="url(#blurTiny)"/>

    <!-- main block: warm at the base where the lamplight rakes it, cool at the top -->
    <rect x="350" y="218" width="228" height="68" fill="url(#stone)"/>
    <rect x="350" y="218" width="228" height="68" fill="url(#warmFoot)"/>
    <rect x="350" y="218" width="228" height="7" fill="#0a1526" opacity="0.26"/>
    <rect x="350" y="212" width="228" height="7" fill="url(#stone)"/>
    <g fill="#e6dcc8">
      <rect x="356" y="205" width="7" height="8" rx="2"/><rect x="378" y="205" width="7" height="8" rx="2"/>
      <rect x="400" y="205" width="7" height="8" rx="2"/><rect x="422" y="205" width="7" height="8" rx="2"/>
      <rect x="499" y="205" width="7" height="8" rx="2"/><rect x="521" y="205" width="7" height="8" rx="2"/>
      <rect x="543" y="205" width="7" height="8" rx="2"/><rect x="565" y="205" width="7" height="8" rx="2"/>
    </g>
    <!-- The facade turns away from the moon toward the right. As a flat rect this drew a visible
         vertical seam straight through the parapet, so it is a gradient that fades in instead. -->
    <rect x="350" y="212" width="228" height="74" fill="url(#faceTurn)"/>

    <!-- arcade: each opening is a dark recess with a lit surface behind it and a bloom in front -->
    <g fill="#0b1526" opacity="0.8">
      <path d="M362 286 V254 A11 11 0 0 1 384 254 V286 Z"/><path d="M392 286 V254 A11 11 0 0 1 414 254 V286 Z"/>
      <path d="M514 286 V254 A11 11 0 0 1 536 254 V286 Z"/><path d="M544 286 V254 A11 11 0 0 1 566 254 V286 Z"/>
    </g>
    <g fill="url(#lamp)">
      <path d="M366 286 V256 A7 7 0 0 1 380 256 V286 Z"/><path d="M396 286 V256 A7 7 0 0 1 410 256 V286 Z"/>
      <path d="M518 286 V256 A7 7 0 0 1 532 256 V286 Z"/><path d="M548 286 V256 A7 7 0 0 1 562 256 V286 Z"/>
    </g>
    <g filter="url(#blurTiny)" opacity="0.5">
      <ellipse cx="373" cy="272" rx="16" ry="20" fill="url(#warmBloom)"/>
      <ellipse cx="403" cy="272" rx="16" ry="20" fill="url(#warmBloom)"/>
      <ellipse cx="525" cy="272" rx="16" ry="20" fill="url(#warmBloom)"/>
      <ellipse cx="555" cy="272" rx="16" ry="20" fill="url(#warmBloom)"/>
    </g>

    <!-- central iwan: deepest recess, brightest light, and the widest bloom -->
    <path d="M428 286 V250 A74 74 0 0 1 464 226 A74 74 0 0 1 500 250 V286 Z" fill="#0a1424"/>
    <path d="M434 286 V252 A62 62 0 0 1 464 233 A62 62 0 0 1 494 252 V286 Z" fill="url(#lamp)"/>
    <ellipse cx="464" cy="262" rx="62" ry="46" fill="url(#warmBloom)" filter="url(#blurTiny)"/>

    <!-- terrace, catching the spill -->
    <rect x="336" y="286" width="256" height="6" fill="#ded2ba"/>
    <rect x="344" y="286" width="240" height="3" fill="#fff1d8" opacity="0.75"/>
    <ellipse cx="464" cy="290" rx="120" ry="7" fill="url(#warmBloom)" opacity="0.7"/>`;
}

function hero() {
  const body = mosque();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation">
  <defs>
    <!-- Sky in two passes: a deep vertical ramp, then a warm horizon wash over it. One gradient
         cannot hold a near-black zenith and a glowing horizon without going muddy in between. -->
    <linearGradient id="skyDeep" x1="0" y1="0" x2="0.12" y2="1">
      <stop offset="0" stop-color="#030616"/><stop offset="0.18" stop-color="#08102e"/>
      <stop offset="0.38" stop-color="#101f48"/><stop offset="0.58" stop-color="#1b3160"/>
      <stop offset="0.76" stop-color="#2d4a78"/><stop offset="1" stop-color="#5b7397"/>
    </linearGradient>
    <linearGradient id="horizonWash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffb877" stop-opacity="0"/>
      <stop offset="0.6" stop-color="#ffa96a" stop-opacity="0.05"/>
      <stop offset="0.85" stop-color="#ffb478" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#ffd0a0" stop-opacity="0.3"/>
    </linearGradient>
    <radialGradient id="moonHalo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff8e8" stop-opacity="0.9"/>
      <stop offset="0.16" stop-color="#ffeeca" stop-opacity="0.32"/>
      <stop offset="0.42" stop-color="#ffe0ae" stop-opacity="0.09"/>
      <stop offset="1" stop-color="#ffe0ae" stop-opacity="0"/>
    </radialGradient>
    <!-- Stone: cool moonlight at the top, warm lamplight rising from the base. The warm/cool split
         is what gives the walls form; a single cool ramp read as a flat cut-out. -->
    <linearGradient id="stone" x1="0" y1="1" x2="0.08" y2="0">
      <stop offset="0" stop-color="#ffeac6"/><stop offset="0.3" stop-color="#f6e6d2"/>
      <stop offset="0.7" stop-color="#d9dfee"/><stop offset="1" stop-color="#aebbd6"/>
    </linearGradient>
    <!-- Lamplight pooling at the foot of every vertical surface, laid over the stone. -->
    <linearGradient id="warmFoot" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ffb867" stop-opacity="0.42"/>
      <stop offset="0.4" stop-color="#ffc47c" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#ffc47c" stop-opacity="0"/>
    </linearGradient>
    <!-- A cylinder, for minaret shafts and the drum: dark edge, lit face, dark edge. -->
    <linearGradient id="cyl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7d8aa8"/><stop offset="0.26" stop-color="#f0efe6"/>
      <stop offset="0.56" stop-color="#d3d6e0"/><stop offset="1" stop-color="#5d688a"/>
    </linearGradient>
    <!-- A sphere lit from the upper left, deep blue as in the reference art. -->
    <radialGradient id="domeSkin" cx="0.33" cy="0.24" r="0.88">
      <stop offset="0" stop-color="#b6d6ee"/><stop offset="0.3" stop-color="#5384b0"/>
      <stop offset="0.66" stop-color="#2a4d75"/><stop offset="1" stop-color="#14263f"/>
    </radialGradient>
    <linearGradient id="faceTurn" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0d1a30" stop-opacity="0"/>
      <stop offset="0.45" stop-color="#0d1a30" stop-opacity="0"/>
      <stop offset="1" stop-color="#0d1a30" stop-opacity="0.28"/>
    </linearGradient>
    <radialGradient id="warmBloom" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffcb83" stop-opacity="0.5"/>
      <stop offset="0.55" stop-color="#ffbb6d" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#ffbb6d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="lamp" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6dc"/><stop offset="0.45" stop-color="#ffd489"/>
      <stop offset="1" stop-color="#eb9e4e"/>
    </linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#33496f"/><stop offset="0.3" stop-color="#1d2e52"/>
      <stop offset="1" stop-color="#070d22"/>
    </linearGradient>
    <linearGradient id="fadeDown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="0.42" stop-color="#ffffff" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <mask id="reflectionFade"><rect x="0" y="${WATER}" width="${W}" height="${H - WATER}" fill="url(#fadeDown)"/></mask>
    <filter id="blurMirror" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.4"/></filter>
    <filter id="blurTiny" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2"/></filter>
    <filter id="blurCloud" x="-40%" y="-60%" width="180%" height="260%"><feGaussianBlur stdDeviation="11"/></filter>
    <filter id="blurHaze" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#skyDeep)"/>

  <g fill="#fff9ec">
    <circle cx="58" cy="26" r="1.7" opacity="0.95"/><circle cx="104" cy="64" r="1" opacity="0.5"/>
    <circle cx="152" cy="18" r="1.2" opacity="0.7"/><circle cx="238" cy="42" r="1.9" opacity="0.9"/>
    <circle cx="292" cy="20" r="1" opacity="0.55"/><circle cx="346" cy="58" r="1.4" opacity="0.75"/>
    <circle cx="392" cy="16" r="1.1" opacity="0.6"/><circle cx="452" cy="44" r="1.7" opacity="0.85"/>
    <circle cx="512" cy="22" r="1" opacity="0.5"/><circle cx="566" cy="52" r="1.3" opacity="0.7"/>
    <circle cx="624" cy="18" r="1.8" opacity="0.9"/><circle cx="678" cy="48" r="1" opacity="0.5"/>
    <circle cx="736" cy="26" r="1.4" opacity="0.75"/><circle cx="792" cy="60" r="1.1" opacity="0.55"/>
    <circle cx="850" cy="22" r="1.6" opacity="0.85"/><circle cx="898" cy="54" r="1" opacity="0.5"/>
    <circle cx="30" cy="96" r="1" opacity="0.4"/><circle cx="180" cy="104" r="0.9" opacity="0.35"/>
    <circle cx="322" cy="112" r="1" opacity="0.4"/><circle cx="486" cy="98" r="0.9" opacity="0.3"/>
    <circle cx="648" cy="108" r="1" opacity="0.38"/><circle cx="806" cy="100" r="0.9" opacity="0.32"/>
  </g>
  <g fill="#fff9ec" filter="url(#blurTiny)" opacity="0.75">
    <circle cx="238" cy="42" r="2.4"/><circle cx="624" cy="18" r="2.2"/><circle cx="452" cy="44" r="2"/>
  </g>

  <circle cx="176" cy="88" r="128" fill="url(#moonHalo)"/>
  <circle cx="176" cy="88" r="33" fill="#fff8e6"/>
  <circle cx="190" cy="79" r="29" fill="#0a1330" opacity="0.94"/>

  <g filter="url(#blurCloud)">
    <ellipse cx="300" cy="150" rx="150" ry="13" fill="#7d93bd" opacity="0.2"/>
    <ellipse cx="640" cy="128" rx="180" ry="11" fill="#7d93bd" opacity="0.16"/>
    <ellipse cx="820" cy="176" rx="130" ry="10" fill="#8ea4cc" opacity="0.14"/>
    <ellipse cx="120" cy="196" rx="140" ry="12" fill="#8ea4cc" opacity="0.12"/>
  </g>

  ${birds(300, 118, 5, '#dfe8f8', 0.5, 91)}
  <rect width="${W}" height="${H}" fill="url(#horizonWash)"/>

  <!-- four ranges, each darker and sharper as it comes forward -->
  <path d="${ridge(W, 232, 7, 62, 11)}" fill="#4d648f" opacity="0.3"/>
  <path d="${ridge(W, 248, 5, 54, 23)}" fill="#3b5081" opacity="0.42"/>
  <path d="${ridge(W, 262, 6, 40, 37)}" fill="#2a3c69" opacity="0.55"/>
  <path d="${ridge(W, 274, 4, 28, 53)}" fill="#1a2745" opacity="0.7"/>

  <!-- haze pooling at the foot of the ranges, which is what sells the distance -->
  <ellipse cx="${W / 2}" cy="278" rx="${W * 0.6}" ry="14" fill="#8ea4cc" opacity="0.2" filter="url(#blurHaze)"/>

  <!-- far treeline along the opposite bank, kept low so it does not crowd the subject -->
  ${treeline(4, 322, SHORE, 13, '#16223c', 0.9, 7)}
  ${treeline(604, W - 4, SHORE, 13, '#16223c', 0.9, 19)}
  <rect x="0" y="${SHORE}" width="${W}" height="6" fill="#16223c" opacity="0.9"/>

  <g id="mosque">${body}</g>

  <rect x="0" y="${WATER}" width="${W}" height="${H - WATER}" fill="url(#water)"/>

  <g mask="url(#reflectionFade)" opacity="0.78" filter="url(#blurMirror)">
    <g transform="translate(0, 436) scale(1, -0.5)">${body}</g>
  </g>
  <g fill="#ffeec8" opacity="0.28" filter="url(#blurTiny)">
    <ellipse cx="176" cy="304" rx="20" ry="2.6"/><ellipse cx="176" cy="318" rx="30" ry="2.8"/>
    <ellipse cx="176" cy="334" rx="24" ry="2.4"/><ellipse cx="176" cy="352" rx="34" ry="2.6"/>
  </g>
  <g fill="#cddcf5">
    <rect x="360" y="300" width="200" height="2.4" rx="1.2" opacity="0.14"/>
    <rect x="130" y="312" width="150" height="2.2" rx="1.1" opacity="0.09"/>
    <rect x="600" y="322" width="220" height="2.6" rx="1.3" opacity="0.1"/>
    <rect x="300" y="338" width="280" height="2.6" rx="1.3" opacity="0.11"/>
  </g>

  <!-- Foreground: the darkest, sharpest plane. The banks rise higher than feels natural in
       isolation, because the plants standing on them are what give the frame its weight. -->
  <path d="M0 336 Q86 316 184 332 Q266 346 330 384 L330 400 L0 400 Z" fill="#080f20"/>
  <path d="M${W} 330 Q816 312 720 330 Q642 346 580 386 L580 400 L${W} 400 Z" fill="#080f20"/>
  ${grass(6, 316, 340, 26, '#080f20', 1, 61)}
  ${grass(600, W - 6, 336, 26, '#080f20', 1, 73)}
  ${leafPlant(126, 350, 2.1, '#080f20', 1, 101)}
  ${leafPlant(238, 364, 1.7, '#080f20', 1, 113)}
  ${leafPlant(300, 380, 1.4, '#080f20', 1, 137)}
  ${leafPlant(662, 356, 1.9, '#080f20', 1, 127)}
  ${leafPlant(772, 344, 1.6, '#080f20', 1, 131)}
  ${fern(196, 348, 1.5, '#080f20', 1, 149)}
  ${fern(720, 340, 1.4, '#080f20', 1, 151)}

  <!-- Framing trees: nearest plane, fully black, holding both edges of the frame. -->
  ${conifer(64, 388, 260, 108, '#05090f', 1, 5)}
  ${conifer(10, 400, 200, 84, '#05090f', 1, 17)}
  ${conifer(146, 396, 156, 64, '#05090f', 1, 23)}
  ${palm(844, 392, 1.5, '#05090f', 1, 29)}
  ${conifer(908, 400, 240, 96, '#05090f', 1, 41)}
  ${conifer(800, 398, 132, 56, '#05090f', 1, 47)}
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
const svg = hero();
writeFileSync(resolve(OUT, '_hero-proof.svg'), svg);
console.log(`hero ${(Buffer.byteLength(svg) / 1024).toFixed(1)}KB`);
