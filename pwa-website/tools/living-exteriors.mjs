// Original, deterministic vector scenery. Geometry stays static; only light and air move.
const f = n => Math.round(n * 10) / 10;
const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');
function random(seed) {
  let n = seed;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const palettes = {
  'all-duas': ['#091e36', '#325875', '#91a4a0', '#415f73', '#233e50', '#132e39', '#071e29', '#c6d6d4', '#809b9f', '#37565b', '#225867', '#91b3b9', '#f7c276'],
  morning: ['#558493', '#bad0c6', '#ffe4a4', '#9eb2ab', '#758f87', '#365f60', '#173d43', '#f4ead1', '#c0ba9c', '#69786b', '#4d8178', '#b9d5c0', '#ffda91'],
  evening: ['#423e66', '#ac7a83', '#f0b38d', '#b095a0', '#8c768c', '#5d526a', '#302f4b', '#ddafa0', '#ad827c', '#705568', '#694965', '#c0929e', '#ffd398'],
  travel: ['#819faa', '#d7ceba', '#f9d9a0', '#d8b48e', '#bb8c69', '#90705b', '#3e5950', '#f4d3a0', '#d5a16d', '#986c4a', '#518780', '#bfd1b1', '#ffe0a2'],
  moods: ['#759c9b', '#bad0b2', '#efdfa2', '#a3b5a1', '#789c8e', '#417969', '#153e39', '#ece5c5', '#b5b999', '#647d69', '#4e8d7e', '#c4dfc2', '#ffdd9b'],
  ruqyah: ['#102d36', '#3d6a68', '#a4ae87', '#6d9590', '#3d7470', '#24554e', '#103b35', '#cfdbc0', '#8fa88e', '#4b7667', '#2b7464', '#9dcbbb', '#f9d59b'],
};

function defs(p) {
  return `<defs>
  <linearGradient id="sky" x2="0" y2="1"><stop stop-color="${p[0]}"/><stop offset=".63" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient>
  <radialGradient id="halo"><stop stop-color="${p[12]}" stop-opacity=".48"/><stop offset=".45" stop-color="${p[12]}" stop-opacity=".14"/><stop offset="1" stop-color="${p[12]}" stop-opacity="0"/></radialGradient>
  <radialGradient id="vignette" r=".7"><stop offset=".35" stop-color="${p[6]}" stop-opacity="0"/><stop offset="1" stop-color="${p[6]}" stop-opacity=".4"/></radialGradient>
  <linearGradient id="mist" x2="0" y2="1"><stop stop-color="${p[2]}" stop-opacity="0"/><stop offset="1" stop-color="${p[2]}" stop-opacity=".2"/></linearGradient>
  <linearGradient id="stone"><stop stop-color="${p[7]}"/><stop offset=".6" stop-color="${p[8]}"/><stop offset="1" stop-color="${p[9]}"/></linearGradient>
  <linearGradient id="shaft"><stop stop-color="${p[9]}"/><stop offset=".22" stop-color="${p[7]}"/><stop offset=".5" stop-color="${p[8]}"/><stop offset="1" stop-color="${p[9]}"/></linearGradient>
  <linearGradient id="side" x2="1" y2="1"><stop stop-color="${p[8]}"/><stop offset="1" stop-color="${p[5]}"/></linearGradient>
  <radialGradient id="dome" cx=".3" cy=".17" r=".95"><stop stop-color="${p[11]}"/><stop offset=".27" stop-color="${p[10]}"/><stop offset=".75" stop-color="${p[5]}"/><stop offset="1" stop-color="${p[6]}"/></radialGradient>
  <linearGradient id="lamp" x2="0" y2="1"><stop stop-color="#fff4d0"/><stop offset=".42" stop-color="${p[12]}"/><stop offset="1" stop-color="#b37638"/></linearGradient>
  <linearGradient id="water" x2="0" y2="1"><stop stop-color="${p[4]}"/><stop offset=".4" stop-color="${p[5]}"/><stop offset="1" stop-color="${p[6]}"/></linearGradient>
  <linearGradient id="fade" x2="0" y2="1"><stop stop-color="white" stop-opacity=".5"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>
  <mask id="reflection"><rect x="0" y="380" width="1200" height="140" fill="url(#fade)"/></mask>
  <mask id="crescent"><rect width="1200" height="520" fill="white"/><circle cx="341" cy="86" r="32" fill="black"/></mask>
  <pattern id="carving" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M9 0 12 6 18 9 12 12 9 18 6 12 0 9 6 6Z M0 0 18 18M18 0 0 18" fill="none" stroke="${p[7]}" stroke-opacity=".34" stroke-width=".65"/></pattern>
  <pattern id="masonry" width="44" height="22" patternUnits="userSpaceOnUse"><path d="M0 0H44M0 22H44M22 0V11M0 11H44M7 11V22" stroke="${p[9]}" stroke-width=".6" opacity=".38" fill="none"/></pattern>
  </defs>
  <style>
  .cloud{animation:cloud 32s ease-in-out infinite alternate}.cloud.slow{animation-duration:43s;animation-delay:-12s}
  .glow{animation:glow 5.7s ease-in-out infinite}.glow.late{animation-delay:-3.1s;animation-duration:7.3s}
  .star{animation:star 5s ease-in-out infinite;animation-delay:var(--delay,0s)}
  .celestial{animation:rise 38s ease-in-out infinite alternate}.flock{animation:fly 28s ease-in-out infinite alternate}
  .ripples{animation:water 8s ease-in-out infinite alternate}.leaves{animation:sway 9s ease-in-out infinite alternate;transform-origin:50% 100%;transform-box:fill-box}
  @keyframes cloud{to{transform:translateX(38px)}}@keyframes glow{0%,100%{opacity:.75}23%{opacity:.9}48%{opacity:.69}73%{opacity:1}}
  @keyframes star{0%,100%{opacity:.3}50%{opacity:.95}}@keyframes rise{to{transform:translateY(-13px)}}
  @keyframes fly{from{transform:translate(-20px,3px)}to{transform:translate(45px,-8px)}}
  @keyframes water{from{opacity:.28;transform:translateX(-3px)}to{opacity:.65;transform:translateX(5px)}}@keyframes sway{to{transform:rotate(.7deg)}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important}}
  </style>`;
}

function sky(p, night = false, seed = 5) {
  const r = random(seed);
  const stars = night ? `<g fill="#fff5d7">${range(65, i => `<circle class="${i % 4 === 0 ? 'star' : ''}" style="--delay:-${f(r() * 9)}s" cx="${f(70 + r() * 1090)}" cy="${f(18 + r() * 208)}" r="${f(.45 + r() * 1.15)}" opacity="${f(.2 + r() * .65)}"/>`)}</g>` : '';
  const orb = night ? `<g class="celestial"><circle cx="325" cy="98" r="150" fill="url(#halo)" opacity=".62"/><circle cx="325" cy="98" r="34" fill="#fff0c8" mask="url(#crescent)"/></g>` : `<g class="celestial"><circle cx="860" cy="200" r="240" fill="url(#halo)"/><circle cx="860" cy="200" r="53" fill="#fff0bc" opacity=".87"/><circle cx="860" cy="200" r="58" fill="#fff0bc" opacity=".12"/></g>`;
  return `<rect width="1200" height="520" fill="url(#sky)"/>${stars}${orb}
  <g fill="${p[7]}" opacity="${night ? '.1' : '.26'}"><g class="cloud"><path d="M38 145Q98 127 175 140Q207 117 259 133Q295 121 328 143Q369 137 405 151Q244 158 38 145Z"/><path d="M660 77Q745 67 783 76Q813 63 844 77Q898 65 957 83Q847 88 660 77Z"/></g><g class="cloud slow"><path d="M503 191Q561 176 617 185Q657 167 705 187Q755 174 785 189Q875 177 934 199Q677 204 503 191Z"/><path d="M80 223Q169 199 259 218Q325 203 424 224Q225 234 80 223Z"/></g></g>`;
}

function ridge(base, height, seed, color, smooth = false) {
  const r = random(seed);
  let d = `M-50 550V${base}`;
  for (let x = -50; x <= 1350; x += 175) {
    const y = f(base - r() * height);
    d += smooth ? `Q${x - 70} ${y - 15} ${x} ${y}` : `L${x - 130} ${f(y + 18)}L${x - 89} ${f(y - 8)}L${x - 70} ${f(y - 4)}L${x - 39} ${f(y - 26)}L${x} ${y}`;
  }
  return `<path d="${d}V550Z" fill="${color}"/>`;
}

function cypress(x, y, s, color, seed = 1) {
  const r = random(seed);
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${color}"><path d="M-4 0-3-83H3L4 0Z"/>
  <path d="M0-133C-8-115-24-91-21-71C-31-41-15-20 0-18C18-22 27-40 21-66C27-89 9-113 0-133Z"/>
  <g stroke="#b3ceaa" stroke-width=".7" opacity=".13">${range(22, () => {const yy = -22 - r() * 86;const xx = (r() - .5) * 23;return `<path d="M${f(xx)} ${f(yy)}l-3 8"/>`;})}</g></g>`;
}

function palm(x, y, s, color, seed = 1) {
  const r = random(seed);
  let leaves = '';
  const fronds = [[-106, 19, -29], [-92, -26, -63], [-62, -68, -78], [-25, -75, -76], [19, -82, -83], [58, -68, -79], [99, -27, -57], [114, 19, -32], [-68, 45, -8], [68, 45, -10]];
  for (const [tx, ty, bend] of fronds) {
    const xx = tx * (.9 + r() * .16);const yy = ty;
    leaves += `<path d="M0-176Q${f(xx * .56)} ${-176 + bend} ${f(xx)} ${-176 + yy}" stroke-width="1.8" fill="none"/>`;
    for (let j = 1; j < 12; j++) {
      const t = j / 12;
      const px = 2 * (1 - t) * t * xx * .56 + t * t * xx;
      const py = -176 + 2 * (1 - t) * t * bend + t * t * yy;
      const dx = 2 * (1 - t) * xx * .56 + 2 * t * xx * .44;
      const dy = 2 * (1 - t) * bend + 2 * t * (yy - bend);
      const norm = Math.hypot(dx, dy);const nx = -dy / norm;const ny = dx / norm;
      const len = (19 * Math.sin(t * Math.PI) + 4) * (.8 + r() * .35);
      for (const side of [-1, 1]) {
        const ex = px + nx * len * side + dx / norm * 9;
        const ey = py + ny * len * side + dy / norm * 9 + 3;
        leaves += `<path d="M${f(px)} ${f(py)}Q${f((px + ex) / 2 - 2)} ${f((py + ey) / 2 - 2)} ${f(ex)} ${f(ey)}Q${f((px + ex) / 2 + 2.5)} ${f((py + ey) / 2 + 2)} ${f(px + 1)} ${f(py + 1)}Z" stroke="none"/>`;
      }
    }
  }
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-7 0Q6-91-3-176L3-179Q20-93 6 0Z" fill="${color}"/><path d="M-4 0Q9-92 0-176" stroke="#d9ba84" stroke-width="1.5" opacity=".28" fill="none"/>${range(13, i => `<path d="M1 ${-i * 11 - 8}l8-3" stroke="${color}" stroke-width="2"/>`)}<g class="leaves" fill="${color}" stroke="${color}" stroke-linecap="round">${leaves}</g></g>`;
}

function plant(x, y, s, color, seed = 2) {
  const r = random(seed);
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${color}">${range(9, i => {const a = -2.8 + i * .29;const xx = Math.cos(a) * (38 + r() * 22);const yy = Math.sin(a) * (50 + r() * 25);return `<path d="M0 0Q${f(xx - 16)} ${f(yy * .68)} ${f(xx)} ${f(yy)}Q${f(xx + 17)} ${f(yy * .73)} 0 0Z"/><path d="M0 0Q${f(xx * .35)} ${f(yy * .65)} ${f(xx)} ${f(yy)}" fill="none" stroke="#c1d1a2" stroke-width=".6" opacity=".16"/>`;})}</g>`;
}

function flock(x, y, color, count = 5) {
  return `<g class="flock" stroke="${color}" fill="none" stroke-width="1.8" stroke-linecap="round">${range(count, i => `<path d="M${x + i * 24} ${y + (i % 3) * 10}q6-5 12 1q6-5 12-2"/>`)}</g>`;
}

function dome(x, y, rx, h) {
  return `<g transform="translate(${x} ${y})"><path d="M${-rx} 0C${-rx - 5} ${-h * .48} ${-rx * .4} ${-h * .53} 0 ${-h}C${rx * .4} ${-h * .53} ${rx + 5} ${-h * .48} ${rx} 0Z" fill="url(#dome)"/>
  ${[-.76, -.42, 0, .42, .76].map(t => `<path d="M0 ${-h}Q${f(t * rx * .55)} ${-h * .56} ${f(t * rx)} 0" fill="none" stroke="#d7d7ad" stroke-opacity="${t < 0 ? '.28' : '.1'}" stroke-width="1"/>`).join('')}
  <path d="M${-rx} 0C${-rx - 5} ${-h * .48} ${-rx * .4} ${-h * .53} 0 ${-h}" stroke="#eee1b6" stroke-width="1.5" opacity=".6" fill="none"/><rect x="${-rx - 2}" y="0" width="${rx * 2 + 4}" height="5" fill="url(#shaft)"/><path d="M0 ${-h}v-14" stroke="#edc985" stroke-width="2"/><circle cx="0" cy="${-h - 16}" r="3.5" fill="#efcd8f"/></g>`;
}

function arch(x, y, w, h, fill) {
  return `<path d="M${x} ${y}v${-h * .6}Q${x} ${y - h * .84} ${x + w / 2} ${y - h}Q${x + w} ${y - h * .84} ${x + w} ${y - h * .6}V${y}Z" fill="${fill}"/>`;
}

function minaret(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-13 0-9-225H9L13 0Z" fill="url(#shaft)"/><path d="M-12 0V-190H12V0" fill="url(#masonry)"/>
  <path d="M-18-91H18L12-82H-12ZM-16-166H16L10-157H-10Z" fill="url(#stone)"/>
  <rect x="-19" y="-98" width="38" height="8" rx="1" fill="url(#shaft)"/><rect x="-17" y="-173" width="34" height="7" fill="url(#shaft)"/>
  <g stroke="#dacba9" stroke-width="1">${range(7, i => `<path d="M${-15 + i * 5}-99v-10M${-12 + i * 4}-174v-8"/>`)}</g>
  ${arch(-5, -189, 10, 23, 'url(#lamp)')}${arch(-4, -113, 8, 19, 'url(#lamp)')}
  <path d="M-10-225Q-10-241 0-254Q10-241 10-225Z" fill="url(#dome)"/><path d="M0-253v-12" stroke="#e4c38d" stroke-width="2"/><circle cy="-267" r="2.5" fill="#e4c38d"/>
  <path d="M-10-221H10M-10-217H10M-11-148H11M-12-54H12" stroke="#dbc89f" stroke-width="1.2" opacity=".65"/></g>`;
}

function mosque(x, y, s, id = 'building') {
  const window = (xx, yy, w = 21, h = 44) => `${arch(xx - 2, yy, w + 4, h + 5, '#304748')}${arch(xx, yy, w, h, 'url(#lamp)')}<path d="M${xx + w / 2} ${yy}v${-h + 7}M${xx} ${yy - 17}h${w}" stroke="#796f51" stroke-width="1.3"/><g fill="url(#halo)" class="glow"><ellipse cx="${xx + w / 2}" cy="${yy - 11}" rx="${w * 1.8}" ry="${h * .95}"/></g>`;
  return `<g id="${id}" transform="translate(${x} ${y}) scale(${s})">
  ${minaret(-172, -2, 1.13)}${minaret(168, -24, .92)}
  <path d="M-228 0V-95H-148V0Z" fill="url(#stone)"/><path d="M-227-96H-147V-102H-227Z" fill="url(#shaft)"/>
  ${dome(-190, -119, 36, 40)}<path d="M-226-119H-154V-103H-226Z" fill="url(#shaft)"/>
  <path d="M150-147 207-173V-24L150 0Z" fill="url(#side)"/><path d="M150-147 207-173V-24L150 0Z" fill="url(#masonry)"/>
  <path d="M-148-147H150V0H-148Z" fill="url(#stone)"/><path d="M-148-147H150V0H-148Z" fill="url(#masonry)"/>
  <path d="M-148-147H150V-137H-148Z" fill="url(#shaft)"/><path d="M150-147 207-173V-166L150-138Z" fill="url(#stone)"/>
  <path d="M-148-136H150V-125H-148Z" fill="url(#carving)"/>
  <rect x="-67" y="-190" width="134" height="42" fill="url(#shaft)"/>
  ${range(7, i => window(-56 + i * 17, -154, 8, 24))}${dome(0, -192, 70, 80)}
  <rect x="-149" y="-119" width="18" height="116" fill="url(#shaft)"/><rect x="132" y="-119" width="18" height="116" fill="url(#shaft)"/>
  ${window(-115, -10, 25, 70)}${window(-71, -10, 25, 70)}${window(64, -10, 25, 70)}${window(106, -10, 18, 67)}
  <path d="M-34 0V-105Q-34-127 6-146Q46-127 46-105V0Z" fill="url(#shaft)"/>
  ${arch(-25, 0, 62, 131, 'url(#carving)')}${arch(-17, 0, 46, 117, '#324a47')}${arch(-12, 0, 36, 110, 'url(#lamp)')}
  <path d="M6-106V0M-10-20H27M-10-44H27" stroke="#876b40" opacity=".55" stroke-width="1"/>
  <path d="M-8-5V-79Q-8-93 6-99Q21-93 21-79V-5" stroke="#ffedbe" stroke-width="1" fill="none"/>
  <path d="M-32-6H44V0H-32Z" fill="url(#stone)"/>
  <g class="glow late"><ellipse cx="6" cy="-38" rx="89" ry="83" fill="url(#halo)"/></g>
  ${window(-215, -6, 17, 57)}${window(-183, -6, 17, 57)}
  <path d="M164-13V-89Q169-103 178-104V-18ZM188-23V-99Q193-113 201-114V-27Z" fill="url(#lamp)" opacity=".6"/>
  ${range(15, i => `<path d="M${-146 + i * 21}-148v-8l4-4 4 4v8Z" fill="url(#stone)"/>`)}
  <g stroke="#e3ce9f" fill="none" opacity=".56">${[-102, -58, 76, 113].map(cx => `<path d="M${cx}-116l6 6-6 6-6-6Z"/>`).join('')}</g>
  <path d="M-240 0H155L216-27V-19L157 8H-240Z" fill="url(#shaft)"/><path d="M-249 8H159L225-20V-12L162 16H-249Z" fill="url(#stone)"/>
  <path d="M-259 16H163L234-14V-7L166 24H-259Z" fill="url(#shaft)"/>
  <path d="M-18 0H31L82 24H-53Z" fill="#ffe0a0" opacity=".24"/>
  </g>`;
}

function lamp(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0V-37" stroke="#8e8060" stroke-width="3"/><path d="M-8-57 0-65 8-57V-37H-8Z" fill="url(#lamp)"/><path d="M-10-57H10L0-67Z" fill="#46615a"/><path d="M-8-37H8M-6-55V-39M6-55V-39M0-55V-39" stroke="#626d56" stroke-width="1.5"/><circle class="glow" cy="-48" r="51" fill="url(#halo)"/></g>`;
}

function ripples(p, seed = 33, top = 390) {
  const r = random(seed);
  return `<g class="ripples" fill="none" stroke="${p[7]}" stroke-linecap="round">${range(54, () => {const y = top + r() * (520 - top);const x = r() * 1200;return `<path d="M${f(x)} ${f(y)}q${f(5 + r() * 20)}-1 ${f(9 + r() * 70)} 0" stroke-width="${f(.4 + (y - top) / 110)}" opacity="${f(.1 + r() * .4)}"/>`;})}</g>`;
}

function terrain(p, seed = 3) {
  const r = random(seed);
  return `${ridge(335, 151, seed, p[3])}<rect y="230" width="1200" height="130" fill="url(#mist)"/>${ridge(356, 118, seed + 5, p[4])}<rect y="250" width="1200" height="120" fill="url(#mist)"/>${ridge(371, 78, seed + 11, p[5], true)}
  <path d="M0 354Q320 322 620 361T1200 347V399H0Z" fill="${p[5]}"/>
  ${range(33, i => cypress(i * 41, 379 + r() * 8, .2 + r() * .32, p[5], i))}
  <path d="M0 378Q350 369 600 381T1200 376V392H0Z" fill="${p[6]}"/>`;
}

function waterside(p, type) {
  const night = type === 'all-duas' || type === 'evening';
  const scale = type === 'all-duas' ? 1.03 : type === 'morning' ? .83 : .91;
  const x = type === 'morning' ? 764 : 750;
  return `${sky(p, night, 15)}${terrain(p, 43)}${flock(442, night ? 160 : 142, night ? p[7] : p[5], 5)}
  <path d="M436 380Q788 356 1100 370L1200 409H413Z" fill="${p[4]}"/>
  ${mosque(x, 360, scale)}
  ${cypress(453, 378, .55, p[5], 4)}${cypress(1014, 373, .79, p[5], 7)}
  <rect y="386" width="1200" height="134" fill="url(#water)"/>
  <g mask="url(#reflection)"><g transform="translate(0 617) scale(1 -.62)"><use href="#building"/></g></g>
  <path d="M0 427Q148 382 389 408Q422 414 481 423Q415 430 361 445Q169 464 146 520H0Z" fill="${p[6]}"/>
  <path d="M1200 394Q1101 390 1020 423Q941 453 927 520H1200Z" fill="${p[6]}"/>
  <path d="M1200 411Q1080 410 1029 447Q968 485 1003 520H918Q925 456 1020 423Q1101 390 1200 394Z" fill="${p[8]}" opacity=".72"/>
  <path d="M1200 410Q1080 409 1027 446Q969 484 1001 520" stroke="${p[7]}" stroke-width="2" opacity=".52" fill="none"/>
  ${ripples(p)}${lamp(1057, 445, .55)}${lamp(985, 483, .75)}${lamp(1156, 412, .35)}
  ${palm(133, 462, 1.55, p[6], 8)}${palm(1144, 478, 1.55, p[6], 4)}
  ${plant(57, 517, 1.5, p[6])}${plant(260, 460, .8, p[6])}${plant(1119, 524, 1.25, p[6], 7)}
  <rect width="1200" height="520" fill="url(#vignette)"/>`;
}

function travel(p) {
  return `${sky(p, false, 25)}
  <path d="M0 314Q209 220 405 295Q561 351 766 277Q999 210 1200 284V520H0Z" fill="${p[3]}"/>
  <path d="M0 346Q209 255 438 325Q510 348 566 371Q317 357 0 411Z" fill="${p[4]}"/>
  <path d="M0 346Q209 255 438 325Q321 290 197 332Q93 358 0 395Z" fill="${p[2]}" opacity=".5"/>
  <path d="M492 395Q848 257 1200 319V520H492Z" fill="${p[4]}"/>
  <path d="M492 395Q848 257 1200 319Q1051 302 994 341Q738 400 492 395Z" fill="${p[7]}"/>
  ${mosque(765, 350, .61)}${palm(977, 363, .68, p[5], 5)}${palm(1009, 368, .57, p[5], 9)}${palm(454, 389, .52, p[5], 4)}
  <path d="M0 481Q227 333 568 389Q687 417 587 457Q338 464 195 520H0Z" fill="url(#water)"/>
  ${ripples(p, 13, 415)}
  <path d="M1200 365Q980 355 921 385Q814 412 832 440Q851 468 679 520H361Q758 451 752 432Q692 382 926 368Q1041 343 1200 353Z" fill="${p[7]}"/>
  <path d="M1182 357Q992 351 912 380Q783 410 796 441Q781 475 507 520" fill="none" stroke="${p[8]}" stroke-width="2"/>
  ${range(17, i => `<path d="M${585 + i * 17} ${501 - i * 6}l${70 - i * 2}-5" stroke="${p[9]}" stroke-width=".8" opacity=".24"/>`)}
  ${flock(397, 178, p[5], 4)}${palm(140, 471, 1.53, p[6], 7)}${palm(1134, 513, 1.38, p[6], 3)}
  <path d="M0 511Q148 469 281 492L359 520H0ZM1055 520Q1102 448 1200 445V520Z" fill="${p[6]}"/>
  ${plant(133, 516, .76, p[5])}${plant(1110, 509, .86, p[6], 4)}<rect width="1200" height="520" fill="url(#vignette)"/>`;
}

function pine(x, y, height, color, seed) {
  const r = random(seed);
  const half = height * .22;
  const outline = side => range(19, i => {
    const t = (i + 1) / 20;
    const yy = -height + t * height * .89;
    const xx = half * t * (.75 + r() * .3) * side;
    return `L${f(xx * .45)} ${f(yy - height * .017)}L${f(xx)} ${f(yy)}L${f(xx * .72)} ${f(yy + height * .012)}`;
  });
  return `<g transform="translate(${x} ${y})"><path d="M-4 0-2 ${-height}H2L5 0Z" fill="${color}"/><path d="M0 ${-height}${outline(-1)}L0-19Z M0 ${-height}${outline(1)}L0-19Z" fill="${color}"/><path d="M-1-25V${-height * .95}" stroke="#c1cfa6" stroke-width="1" opacity=".17"/></g>`;
}

function dawn(p) {
  const r = random(12);
  return `${sky(p)}
  ${ridge(340, 160, 87, p[3])}<rect y="220" width="1200" height="130" fill="url(#mist)"/>
  ${ridge(365, 128, 89, p[4])}<rect y="250" width="1200" height="120" fill="url(#mist)"/>
  <path d="M0 336Q225 246 402 326Q522 381 699 343Q1001 282 1200 334V520H0Z" fill="${p[5]}"/>
  ${range(26, i => pine(i * 49, 376, 24 + r() * 52, p[5], i))}
  <path d="M704 372Q594 370 599 397Q604 417 487 433Q272 464 286 520H579Q556 486 673 450Q814 414 728 397Q679 386 814 373Z" fill="url(#water)"/>
  <path d="M814 373Q679 386 728 397Q814 414 673 450Q556 486 579 520H625Q592 476 724 450Q847 411 757 395Q721 386 863 375Z" fill="${p[8]}" opacity=".6"/>
  <path d="M602 394Q598 381 705 375M679 416Q630 430 528 441M512 468Q478 479 482 487" stroke="${p[7]}" stroke-width="2" fill="none" opacity=".7"/>
  <path d="M742 352Q1003 320 1200 361V406Q967 375 707 390Z" fill="${p[4]}"/>
  ${mosque(858, 350, .63)}${cypress(1061, 372, .51, p[5], 7)}
  <path d="M913 230 381 501 532 520 936 230Z" fill="#fff0be" opacity=".08"/>
  <path d="M0 427Q188 366 469 431Q392 459 323 520H0Z" fill="${p[6]}"/>
  <path d="M1200 414Q1018 385 814 453L711 520H1200Z" fill="${p[6]}"/>
  ${pine(122, 520, 367, p[6], 2)}${pine(233, 489, 227, p[6], 4)}${pine(41, 526, 257, p[6], 5)}
  ${pine(1118, 522, 305, p[6], 11)}${pine(1006, 507, 201, p[6], 13)}
  ${flock(441, 147, p[5], 6)}${ripples(p, 18, 425)}
  ${plant(104, 522, .75, p[5], 1)}${plant(236, 511, .55, p[5], 3)}${plant(1098, 530, .75, p[5], 5)}
  <rect width="1200" height="520" fill="url(#vignette)"/>`;
}

function dusk(p) {
  const r = random(55);
  return `${sky(p, true, 33)}${ridge(354, 105, 66, p[3])}<rect y="240" width="1200" height="130" fill="url(#mist)"/>
  ${ridge(376, 64, 22, p[4], true)}
  <g fill="${p[4]}">${range(23, i => {const x = i * 58;const top = 331 + r() * 35;return `<path d="M${x} 390V${f(top)}h48v${f(390 - top)}Z"/><path d="M${x - 2} ${f(top)}h52v-4h-52Z"/>${range(3, j => arch(x + 7 + j * 13, top + 21, 5, 10, p[12]))}`;})}</g>
  ${mosque(801, 370, .68)}${minaret(361, 384, .52)}${dome(477, 348, 37, 45)}<path d="M440 349H514V386H440Z" fill="${p[4]}"/>
  ${palm(1018, 410, .62, p[5], 14)}${palm(203, 400, .59, p[5], 10)}
  <path d="M0 397Q541 363 1200 406V520H0Z" fill="${p[5]}"/>
  <path d="M0 440H1200V520H0Z" fill="url(#side)"/>
  <g stroke="${p[7]}" stroke-width="1" opacity=".2">${range(12, i => `<path d="M${200 + i * 67} 440L${-600 + i * 212} 520"/>`)}<path d="M0 474H1200M0 506H1200"/></g>
  <rect y="386" width="1200" height="9" fill="url(#shaft)"/>
  ${range(21, i => `<path d="M${i * 59} 396h11v45h-11Z" fill="url(#shaft)"/>${arch(i * 59 + 11, 440, 48, 40, p[5])}`)}
  <rect y="438" width="1200" height="8" fill="url(#stone)"/>
  <path d="M0 0H390Q267 45 198 155V520H0Z" fill="${p[6]}"/>
  <path d="M216 520V154Q277 52 403 0" stroke="${p[8]}" stroke-width="11" fill="none"/>
  <path d="M188 520V145Q250 34 365 0" stroke="url(#carving)" stroke-width="27" fill="none"/>
  <path d="M386 0V180" stroke="#d7b17e" stroke-width="2"/><g transform="translate(386 219)">
  <circle r="95" fill="url(#halo)" class="glow"/><path d="M-21-33 0-49 21-33 27 29 0 46-27 29Z" fill="url(#lamp)"/>
  <path d="M-24-35 0-52 24-35ZM-29 30H29L0 49Z" fill="#b2916d"/><path d="M-20-32-25 28M20-32 25 28M-9-39-11 37M9-39 11 37" stroke="#7b6b53" stroke-width="2"/>
  <path d="M-25-24H25V20H-25Z" fill="url(#carving)"/><path d="M0 48v9" stroke="#d7b17e" stroke-width="2"/></g>
  <ellipse cx="387" cy="483" rx="137" ry="32" fill="url(#halo)" class="glow late"/>
  <path d="M1020 520 998 457H1082L1068 520Z" fill="url(#shaft)"/>
  ${plant(1041, 459, 1.04, p[6], 5)}${plant(113, 527, 1.37, p[5], 8)}
  <rect width="1200" height="520" fill="url(#vignette)"/>`;
}

function pavilion(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-102 0V-107H102V0H78V-73Q78-102 54-103Q28-102 28-73V0H-28V-73Q-28-102-54-103Q-78-102-78-73V0Z" fill="url(#stone)"/>
  <rect x="-105" y="-110" width="210" height="10" fill="url(#shaft)"/><rect x="-108" y="-127" width="216" height="16" fill="url(#carving)"/>
  <rect x="-108" y="-130" width="216" height="4" fill="url(#stone)"/>${dome(0, -147, 77, 71)}<rect x="-77" y="-147" width="154" height="17" fill="url(#shaft)"/>
  <path d="M-113 0H112V8H-113ZM-123 8H122V17H-123Z" fill="url(#stone)"/><path d="M-110-92H-91M91-92H110M-12-92H12" stroke="#eee2b9" stroke-width="3"/>
  ${lamp(0, -8, .78)}<path d="M-68 8H-42L-86 52H-154ZM39 8H69L40 52H-26Z" fill="#e9dca6" opacity=".19"/></g>`;
}

function garden(p, sanctuary = false) {
  const r = random(82);
  const floor = sanctuary ? '#668579' : '#a0ab86';
  let bg = `${sky(p, sanctuary, 72)}${terrain(p, 25)}${flock(400, 148, p[5], 4)}
  <path d="M0 364Q654 337 1200 368V520H0Z" fill="${floor}"/>
  <path d="M584 355H787L1073 520H304Z" fill="url(#stone)" opacity=".75"/>
  <path d="M638 355H733L852 520H488Z" fill="url(#water)"/>
  <path d="M625 355H638L488 520H468ZM733 355H745L873 520H852Z" fill="${p[7]}"/>
  <path d="M0 408Q331 368 585 399L467 520H0ZM791 389Q1041 362 1200 396V520H873Z" fill="${p[5]}"/>
  ${pavilion(685, 351, .85)}${cypress(483, 375, 1.22, p[5], 4)}${cypress(905, 381, 1.32, p[5], 6)}${cypress(421, 381, .92, p[5], 6)}${cypress(962, 384, .97, p[5], 3)}
  ${ripples(p, 43, 410)}
  <ellipse cx="669" cy="449" rx="52" ry="14" fill="${p[9]}"/><ellipse cx="669" cy="445" rx="55" ry="13" fill="${p[7]}"/><ellipse cx="669" cy="444" rx="47" ry="9" fill="${p[10]}"/>
  <path d="M663 440V417H675V440Z" fill="url(#shaft)"/><ellipse cx="669" cy="418" rx="25" ry="7" fill="${p[7]}"/><ellipse cx="669" cy="416" rx="21" ry="5" fill="${p[10]}"/>
  <g class="ripples" stroke="${p[7]}" fill="none" opacity=".7"><path d="M669 414Q654 391 646 439M669 414Q685 391 692 439M669 414V403" stroke-width="1.5"/></g>
  ${range(21, i => plant(i < 11 ? 160 + i * 26 : 888 + (i - 11) * 28, 414 + r() * 110, .28 + r() * .4, i % 3 ? p[6] : p[4], i))}
  <g fill="${sanctuary ? '#e8dba1' : '#e6b7aa'}">${range(40, () => {const side = r() > .5;return `<circle cx="${f(side ? 890 + r() * 215 : 150 + r() * 275)}" cy="${f(396 + r() * 109)}" r="${f(1.3 + r() * 2)}"/>`;})}</g>
  ${lamp(525, 406, .65)}${lamp(845, 410, .65)}${plant(1065, 526, 1.14, p[6], 8)}${plant(83, 526, 1.45, p[6], 2)}`;
  if (sanctuary) {
    bg += `<path d="M0 0H1200V520H1113V251Q1113 93 683 30Q263 93 263 251V520H0Z" fill="${p[6]}"/>
    <path d="M231 520V252Q231 72 683 5Q1146 72 1146 252V520" fill="none" stroke="${p[9]}" stroke-width="22"/>
    <path d="M259 520V252Q259 92 683 29Q1115 92 1115 252V520" fill="none" stroke="${p[7]}" stroke-width="2" opacity=".46"/>
    <path d="M202 520V255Q202 60 683-12Q1171 60 1171 255V520" fill="none" stroke="url(#carving)" stroke-width="20"/>
    <rect x="34" y="39" width="129" height="426" fill="url(#carving)" opacity=".45"/>
    <path d="M320 0V121" stroke="#bcb687" stroke-width="2"/>${lamp(320, 190, 1.05)}
    <g fill="#ebd8a1">${range(12, i => `<circle class="star" style="--delay:-${i}s" cx="${390 + r() * 580}" cy="${235 + r() * 170}" r="${1 + r()}" opacity=".5"/>`)}</g>`;
  } else {
    bg += `${palm(105, 473, 1.69, p[6], 11)}${palm(1134, 458, 1.45, p[6], 5)}
    <path d="M0 0H224Q101 45 0 54ZM1200 0H1011Q1111 47 1200 58Z" fill="${p[6]}" opacity=".76"/>`;
  }
  return bg + '<rect width="1200" height="520" fill="url(#vignette)"/>';
}

export function buildExteriors() {
  return Object.fromEntries(Object.entries(palettes).map(([name, p]) => {
    const content = name === 'travel' ? travel(p) : name === 'moods' ? garden(p) : name === 'ruqyah' ? garden(p, true) : name === 'morning' ? dawn(p) : name === 'evening' ? dusk(p) : waterside(p, name);
    return [name, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520">${defs(p)}${content}</svg>`];
  }));
}
