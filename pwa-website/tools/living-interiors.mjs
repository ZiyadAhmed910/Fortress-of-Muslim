/** Layered architectural illustrations for the living card collection.
 * Pure, deterministic SVG builders: no fonts, requests, scripts, or text.
 */
const n = (value) => Math.round(value * 100) / 100;
function random(seed) { let state = seed; return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296); }
const seq = (count, fn) => Array.from({ length: count }, (_, i) => fn(i)).join('');
const arch = (x, y, w, h) => `M${x} ${y + h}V${y + h * .43}C${x} ${y + h * .19} ${x + w * .31} ${y + h * .13} ${x + w / 2} ${y}C${x + w * .69} ${y + h * .13} ${x + w} ${y + h * .19} ${x + w} ${y + h * .43}V${y + h}Z`;
const star = (cx, cy, r, fill, stroke = 'none') => `<path d="${seq(16, (i) => `${i ? 'L' : 'M'}${n(cx + Math.cos(i * Math.PI / 8) * (i % 2 ? r * .46 : r))} ${n(cy + Math.sin(i * Math.PI / 8) * (i % 2 ? r * .46 : r))}`)}Z" fill="${fill}" stroke="${stroke}"/>`;
const foliage = (x, y, scale = 1, color = '#183f3e', seed = 3) => {
  const rand = random(seed);
  const leaves = scale < .5 ? 9 : 19;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${color}"><path d="M-3 0Q8-60 0-138L5-138Q14-67 4 0Z"/>${seq(leaves, i => {
    const yy = -14 - i * (114 / leaves); const side = i % 2 ? 1 : -1; const len = 18 + rand() * 30;
    return `<path d="M3 ${yy}Q${side * len * .54} ${yy - 35} ${side * len} ${yy - 24}Q${side * len * .67} ${yy - 2} 3 ${yy}"/><path d="M3 ${yy}L${side * len * .82} ${yy - 22}" fill="none" stroke="#bfd7a2" stroke-opacity=".09"/>`;
  })}</g>`;
};
function definitions() {
  return `<defs>
    <linearGradient id="night" x2=".2" y2="1"><stop stop-color="#111e39"/><stop offset=".6" stop-color="#294457"/><stop offset="1" stop-color="#61868b"/></linearGradient>
    <linearGradient id="nightWall" x2="1" y2=".7"><stop stop-color="#091e2a"/><stop offset=".5" stop-color="#193b43"/><stop offset="1" stop-color="#364c4a"/></linearGradient>
    <linearGradient id="daySky" x2="0" y2="1"><stop stop-color="#99c8c9"/><stop offset=".67" stop-color="#e0e2c3"/><stop offset="1" stop-color="#f5dca2"/></linearGradient>
    <linearGradient id="stone" x2="1" y2=".4"><stop stop-color="#eddab2"/><stop offset=".25" stop-color="#d8bd8e"/><stop offset=".56" stop-color="#c3a678"/><stop offset="1" stop-color="#778778"/></linearGradient>
    <linearGradient id="paleStone" x2="0" y2="1"><stop stop-color="#f3e5c4"/><stop offset=".5" stop-color="#decea6"/><stop offset="1" stop-color="#b4aa86"/></linearGradient>
    <linearGradient id="carved" x2="1" y2="0"><stop stop-color="#2b5357"/><stop offset=".16" stop-color="#51706b"/><stop offset=".5" stop-color="#203b43"/><stop offset=".8" stop-color="#244b50"/><stop offset="1" stop-color="#829188"/></linearGradient>
    <linearGradient id="wood" x2=".3" y2="1"><stop stop-color="#a27b4c"/><stop offset=".2" stop-color="#73513c"/><stop offset=".65" stop-color="#352e2a"/><stop offset="1" stop-color="#182a2c"/></linearGradient>
    <linearGradient id="brass" x2="1" y2="0"><stop stop-color="#523b28"/><stop offset=".19" stop-color="#b68b4e"/><stop offset=".4" stop-color="#f7d58d"/><stop offset=".6" stop-color="#bf9250"/><stop offset=".84" stop-color="#705032"/><stop offset="1" stop-color="#e8be73"/></linearGradient>
    <linearGradient id="glass" x2="0" y2="1"><stop stop-color="#fff1b0"/><stop offset=".5" stop-color="#f7b852"/><stop offset="1" stop-color="#ab6b32"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="#ffcf73" stop-opacity=".65"/><stop offset=".3" stop-color="#ffc575" stop-opacity=".23"/><stop offset="1" stop-color="#e79b48" stop-opacity="0"/></radialGradient>
    <radialGradient id="moonGlow"><stop stop-color="#cee9de" stop-opacity=".2"/><stop offset=".24" stop-color="#c4dedc" stop-opacity=".1"/><stop offset="1" stop-color="#b6d5d7" stop-opacity="0"/></radialGradient>
    <linearGradient id="beam" x1="1" x2=".1" y2="1"><stop stop-color="#d9f0d8" stop-opacity=".18"/><stop offset="1" stop-color="#acd2c4" stop-opacity="0"/></linearGradient>
    <linearGradient id="floor" x2=".3" y2="1"><stop stop-color="#456063"/><stop offset=".48" stop-color="#29484e"/><stop offset="1" stop-color="#0b242e"/></linearGradient>
    <linearGradient id="sandFloor" x2=".4" y2="1"><stop stop-color="#f1dfa9"/><stop offset=".5" stop-color="#cabb92"/><stop offset="1" stop-color="#597474"/></linearGradient>
    <linearGradient id="bookCover" x2=".8" y2="1"><stop stop-color="#4b7270"/><stop offset=".42" stop-color="#1c4d53"/><stop offset="1" stop-color="#0b293a"/></linearGradient>
    <linearGradient id="pages" x2="0" y2="1"><stop stop-color="#eed9a2"/><stop offset=".4" stop-color="#b39d72"/><stop offset="1" stop-color="#f0d7a1"/></linearGradient>
    <pattern id="tile" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" fill="#244b50"/><path d="M24 0L48 24 24 48 0 24Z" fill="none" stroke="#8ba59a" stroke-width="1.5"/><path d="M0 0H48V48H0Z" fill="none" stroke="#d1bd83" stroke-opacity=".3"/><path d="M24 7L29 19 41 24 29 29 24 41 19 29 7 24 19 19Z" fill="#b89b65"/><path d="M24 13L35 24 24 35 13 24Z" fill="#315c60"/><circle cx="24" cy="24" r="3.3" fill="#bfa674"/><path d="M0 12L12 0M36 0L48 12M48 36L36 48M12 48L0 36" stroke="#859786" fill="none"/></pattern>
    <pattern id="fineTile" width="30" height="30" patternUnits="userSpaceOnUse"><rect width="30" height="30" fill="#426661"/><path d="M0 15L15 0 30 15 15 30Z M6 15L15 6 24 15 15 24Z" fill="none" stroke="#cbbb8d" stroke-opacity=".7"/><path d="M15 10L20 15 15 20 10 15Z" fill="#b69a69"/></pattern>
    <pattern id="lattice" width="26" height="26" patternUnits="userSpaceOnUse"><rect width="26" height="26" fill="#0c262f"/><path d="M13-13L39 13 13 39-13 13Z M0 0H26V26H0Z" stroke="#8a7852" stroke-width="2" fill="none"/><circle cx="13" cy="13" r="3.4" fill="#bba376"/><path d="M10 10L16 16M16 10L10 16" stroke="#413b2c"/></pattern>
    <pattern id="rug" width="46" height="46" patternUnits="userSpaceOnUse"><rect width="46" height="46" fill="#1b5159"/><path d="M23 3L43 23 23 43 3 23Z" fill="none" stroke="#a99869" stroke-opacity=".62"/><path d="M23 10L27 18 36 23 27 28 23 36 18 28 10 23 18 18Z" fill="#708173"/><circle cx="23" cy="23" r="4" fill="#173c46"/><path d="M0 0L8 8M46 0L38 8M0 46L8 38M46 46L38 38" stroke="#b49e6c" stroke-width="2"/></pattern>
    <pattern id="border" width="26" height="16" patternUnits="userSpaceOnUse"><rect width="26" height="16" fill="#ad9865"/><path d="M0 8L6 2 13 8 20 2 26 8 20 14 13 8 6 14Z" fill="#274c50"/><circle cx="13" cy="8" r="2" fill="#f1d596"/></pattern>
    <pattern id="stoneJoint" width="160" height="60" patternUnits="userSpaceOnUse"><path d="M0 0H160M0 60H160M0 0V30H160M80 30V60" stroke="#193e42" stroke-opacity=".17" fill="none"/><path d="M1 1H159M1 31H159" stroke="#f5e3b8" stroke-opacity=".16" fill="none"/></pattern>
    <pattern id="woodGrain" width="130" height="25" patternUnits="userSpaceOnUse"><path d="M0 3Q40-2 90 4T160 5M0 11Q45 17 80 11T150 12M0 20Q47 14 110 20T150 19" fill="none" stroke="#d3ab6d" stroke-opacity=".17"/><path d="M16 8Q39 5 62 9Q35 13 16 8Z" fill="none" stroke="#302b24" stroke-opacity=".25"/></pattern>
    <radialGradient id="vignette" cx=".65" cy=".4" r=".75"><stop offset=".38" stop-color="#071b25" stop-opacity="0"/><stop offset="1" stop-color="#071b25" stop-opacity=".42"/></radialGradient>
    <g id="rosette" fill="none" stroke="currentColor"><circle r="26" stroke-width="1"/><circle r="23" stroke-width=".6"/>${star(0, 0, 20, 'none', 'currentColor')}${star(0, 0, 13, 'none', 'currentColor')}<circle r="4" fill="currentColor"/>${seq(8, i => `<circle cx="${n(Math.cos(i * Math.PI / 4) * 23)}" cy="${n(Math.sin(i * Math.PI / 4) * 23)}" r="1.3" fill="currentColor"/>`)}</g>
  </defs>`;
}
function interiorMotionCSS() {
  return `
    @keyframes flameFlicker{0%,100%{opacity:.94;transform:scale(.96,1)}17%{opacity:.85;transform:scale(1.06,.93)}33%{opacity:1;transform:scale(.92,1.09)}47%{opacity:.88;transform:scale(1.03,.97)}61%{opacity:.97;transform:scale(.96,1.07)}80%{opacity:.87;transform:scale(1.05,.97)}}
    @keyframes lampLight{0%,100%{opacity:.76}17%{opacity:.59}33%{opacity:.9}47%{opacity:.68}61%{opacity:.83}80%{opacity:.64}}
    @keyframes glassFlicker{0%,100%{opacity:.95}17%{opacity:.8}33%{opacity:1}47%{opacity:.87}61%{opacity:.97}80%{opacity:.85}}
    @keyframes dustDrift{0%,100%{transform:translate(0,0);opacity:.25}50%{transform:translate(14px,-18px);opacity:.75}}
    @keyframes starPulse{0%,100%{opacity:.3}50%{opacity:.85}}
    @keyframes moonDrift{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
    @keyframes cloudDrift{0%,100%{transform:translate(-7px,0)}50%{transform:translate(23px,2px)}}
    @keyframes shaftDrift{0%,100%{opacity:.62;transform:translateX(0)}50%{opacity:1;transform:translateX(9px)}}
    @keyframes foliageSway{0%,100%{transform:rotate(-.7deg)}45%{transform:rotate(1.3deg)}72%{transform:rotate(.3deg)}}
    @keyframes waterRipple{0%{opacity:.62;transform:scale(.76)}100%{opacity:.05;transform:scale(1.65)}}
    @keyframes fountainFall{0%{opacity:.25;transform:translateY(-2px)}40%{opacity:.8}100%{opacity:.1;transform:translateY(8px)}}
    .lamp-flame{transform-box:fill-box;transform-origin:50% 100%;animation:flameFlicker 2.8s linear infinite}
    .lamp-glass{animation:glassFlicker 2.8s linear infinite}
    .lamp-glow,.lamp-reflection{animation:lampLight 2.8s linear infinite}
    .stars{animation:starPulse 6s ease-in-out infinite}
    .dust{opacity:.3}
    .water-ripple{transform-box:fill-box;transform-origin:center;animation:waterRipple 3.4s linear infinite}
    .enhanced-motion{animation:none}
    .ambient-light{opacity:0;pointer-events:none}
    svg[data-motion="full"] .scene .ambient-light{animation:roomLight 12s ease-in-out infinite}
    @keyframes roomLight{0%,100%{opacity:.02}45%,60%{opacity:.19}}
    svg[data-motion="full"] .scene .dust{animation:dustDrift 9s ease-in-out infinite;animation-delay:-2s}
    svg[data-motion="full"] .scene .moon{animation:moonDrift 18s ease-in-out infinite;animation-delay:-4s}
    svg[data-motion="full"] .scene .cloud-motion{animation:cloudDrift 18s ease-in-out infinite;animation-delay:-4s}
    svg[data-motion="full"] .scene .light-shaft{animation:shaftDrift 11s ease-in-out infinite;animation-delay:-2s}
    svg[data-motion="full"] .scene .foliage-motion{animation:foliageSway 7s ease-in-out infinite;animation-delay:-1.5s}
    svg[data-motion="full"] .scene .fountain-drops{animation:fountainFall 2.4s linear infinite}
    svg[data-motion="full"] .scene .extra-ripple{animation:waterRipple 3.4s linear infinite;animation-delay:-1.7s}
    svg[data-motion="still"] .scene *{animation:none!important}
    @media(prefers-reduced-motion:reduce){*{animation:none!important}}
  `;
}
function wrap(label, content, extraDefs = '') {
  return `<svg data-motion="optimized" xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520" role="img" aria-label="${label}">${definitions()}${extraDefs}<style>${interiorMotionCSS()}</style><g class="scene">${content}<rect class="ambient-light" width="1200" height="520" fill="${label.startsWith('Moonlit') ? '#9dc4d5' : '#ffc77f'}"/><rect width="1200" height="520" fill="url(#vignette)" pointer-events="none"/></g></svg>`.replace(/-?\d+\.\d{3,}/g, value => String(n(Number(value))));
}
function dust(x, y, w, h, seed = 4, fill = '#f4d697') {
  const rand = random(seed);
  return `<g class="dust enhanced-motion" fill="${fill}">${seq(24, () => `<circle cx="${n(x + rand() * w)}" cy="${n(y + rand() * h)}" r="${n(.5 + rand() * 1)}" opacity="${n(.12 + rand() * .5)}"/>`)}</g>`;
}
function joints(x, y, w, h, opacity = 1) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#stoneJoint)" opacity="${opacity}"/>`; }
// Mortar lines follow the vault, so successive rings read as carved stone depth.
function vaultJoints(x, y, w, h, thickness, tint = '#173b43', opacity = .25) {
  const cubic = (a, b, c, d, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
  return `<g stroke="${tint}" stroke-opacity="${opacity}" stroke-width="1.5">${seq(18, i => {
    const t = (i % 9 + .5) / 9;
    const px = cubic(x, x, x + w * .31, x + w / 2, t);
    const py = cubic(y + h * .43, y + h * .19, y + h * .13, y, t);
    const dx = px - x - w / 2;
    const dy = py - y - h * .6;
    const len = Math.hypot(dx, dy);
    const side = i < 9 ? 1 : -1;
    const xx = x + w / 2 + dx * side;
    return `<path d="M${n(xx)} ${n(py)}l${n(dx / len * thickness * side)} ${n(dy / len * thickness)}"/>`;
  })}</g>`;
}
function rosette(x, y, size, tint = '#c9b587') {
  return `<g transform="translate(${x} ${y}) scale(${size / 30})" color="${tint}"><use href="#rosette"/></g>`;
}
function lamp(x, y, scale = 1, chainLength = 40, footed = false) {
  const chain = footed ? '' : `<path d="M0 ${-chainLength}V-65" stroke="#c1a067" stroke-width="2"/><path d="M-3 ${-chainLength}V-65" stroke="#172f33" stroke-width="1"/>${seq(Math.max(0, Math.floor((chainLength - 65) / 8)), i => `<ellipse cx="0" cy="${-chainLength + i * 8}" rx="2" ry="4" fill="none" stroke="#ccad6b" stroke-width=".8"/>`)}`;
  const base = footed
    ? '<path d="M-13 39Q-11 48-7 50V57H7V50Q11 48 13 39Z" fill="url(#brass)"/><path d="M-7 54Q-12 59-27 61V65Q0 72 27 65V61Q12 59 7 54Z" fill="url(#brass)"/><ellipse cy="61" rx="26" ry="5" fill="url(#brass)"/><path d="M-22 63Q0 68 22 63" stroke="#f6d68c" stroke-opacity=".6" fill="none"/>'
    : '<path d="M-13 39Q0 52 13 39" fill="url(#brass)"/><path d="M0 46V55" stroke="#c6a067" stroke-width="2"/><circle cy="57" r="3" fill="#d7b275"/>';
  return `<g transform="translate(${x} ${y}) scale(${scale})">${chain}<g class="lamp-glow"><ellipse cy="0" rx="137" ry="116" fill="url(#glow)"/></g><path d="M-5-64Q-12-73 0-77Q12-73 5-64" fill="none" stroke="url(#brass)" stroke-width="2"/><path d="M-20-36Q-17-51-6-58V-64H6V-58Q17-51 20-36Z" fill="url(#brass)"/><path class="lamp-glass" d="M-17-31H17L24 18 14 38H-14L-24 18Z" fill="url(#glass)"/><path d="M-20-35H20V-29H-20Z M-26 16H26V23H-26Z M-16 35H16V40H-16Z" fill="url(#brass)"/><path d="M-20-29L-24 16-14 37M20-29L24 16 14 37M-7-29L-8 16-5 37M7-29L8 16 5 37" fill="none" stroke="#8c6739" stroke-width="2.8"/><path d="M-19-27L-22 15M-6-27L-6 14M8-27L9 14" stroke="#ffe8a0" stroke-opacity=".75" stroke-width="1"/>${base}${seq(5, i => `<path d="M${-13 + i * 6.5}-42l2-6 2 6" fill="none" stroke="#503d2b" stroke-width="1.2"/>`)}${seq(7, i => `<circle cx="${-18 + i * 6}" cy="19" r="1" fill="#f8d696"/>`)}<g class="lamp-flame"><path d="M0 8Q-8-3 0-14Q9-1 0 8Z" fill="#fff7c4"/><path d="M0 7Q-3 1 1-5Q5 3 0 7Z" fill="#fffde4"/></g><ellipse cy="9" rx="7" ry="2" fill="#7c552d"/></g>`;
}
function skyStars() {
  const rand = random(793);
  return `<g fill="#d8ebe0">${seq(45, () => `<circle cx="${n(620 + rand() * 340)}" cy="${n(42 + rand() * 170)}" r="${n(.45 + rand() * 1)}" opacity="${n(.15 + rand() * .6)}"/>`)}</g><g class="stars" fill="#f5f4d8"><path d="M694 71l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5Z M869 154l1 3.5 3.5 1-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1Z"/></g>`;
}
function distantCity(night = false) {
  return `<g fill="${night ? '#3c636b' : '#aec2ab'}" opacity=".8"><path d="M530 315V286H562V279H586V293H619V269H658V288H690V279H730V294H766V277H803V287H838V267H867V281H915V272H952V315Z"/><path d="M718 278Q718 253 745 242Q772 253 772 278Z M842 268Q842 246 860 240Q878 246 878 268Z"/><path d="M738 244V234H742V244M783 291V229H791V291M780 234H794V239H780Z M784 228L787 215 790 228Z"/></g><path d="M550 322Q622 306 690 314T845 311T999 323V360H550Z" fill="${night ? '#214953' : '#7c9b85'}"/>`;
}
function floorLines(vanishX, startY, fill = '#bed3c3', opacity = .17) {
  return `<g fill="none" stroke="${fill}" stroke-opacity="${opacity}" stroke-width="1.1">${seq(16, i => `<path d="M${vanishX + (i - 6) * 26} ${startY}L${-220 + i * 125} 550"/>`)}${[startY + 16, startY + 40, startY + 74, startY + 122, startY + 187].map(y => `<path d="M0 ${y}H1200"/>`).join('')}</g>`;
}
function rug(x, y, width = 380, height = 185, skew = -30, opacity = 1) {
  return `<g transform="translate(${x} ${y}) matrix(1 0 ${skew / 100} .48 0 0)" opacity="${opacity}"><rect x="-3" y="2" width="${width + 8}" height="${height + 9}" fill="#061c25" opacity=".4"/><rect width="${width}" height="${height}" fill="url(#rug)"/><rect x="5" y="5" width="${width - 10}" height="${height - 10}" fill="none" stroke="#c2ab75" stroke-width="2"/><rect x="12" y="12" width="${width - 24}" height="${height - 24}" fill="none" stroke="#998a62" stroke-width="7"/><rect x="19" y="19" width="${width - 38}" height="${height - 38}" fill="none" stroke="#e2c58b" stroke-width="1"/><path d="${arch(width * .29, 32, width * .42, height - 60)}" fill="#244e50" stroke="#c0a26b" stroke-width="2"/>${rosette(width / 2, height * .6, 34, '#bea577')}${seq(35, i => `<path d="M${5 + (width - 10) * i / 34} 0v-8M${5 + (width - 10) * i / 34} ${height}v8" stroke="#c1b287" stroke-width="1.8"/>`)}</g>`;
}
function nightRoom() {
  const opening = arch(637, 42, 268, 291);
  return wrap('Moonlit chamber with carved window, woven rug and a softly glowing brass lamp', `
    <rect width="1200" height="520" fill="url(#nightWall)"/>
    <path d="M0 0H442L578 49V345L0 401Z" fill="#102d37"/>
    <path d="M444 0H1200V361L575 347V48Z" fill="url(#nightWall)"/>
    ${joints(450, 0, 750, 350, .6)}
    <path d="M0 389L571 333 1200 362V520H0Z" fill="url(#floor)"/>
    ${floorLines(776, 345)}
    <path d="M0 375L570 324 1200 348V365L570 342 0 395Z" fill="#345251"/>
    <path d="M0 381L570 331 1200 355" fill="none" stroke="#819084" stroke-opacity=".25" stroke-width="2"/>
    <path d="M0 252L437 250 576 275V325L0 377Z" fill="url(#tile)" opacity=".47"/>
    <path d="M0 245H437L576 268V277L437 258H0Z" fill="url(#wood)"/>
    <path d="M0 249H437L576 273" stroke="#c0ac7f" stroke-opacity=".24" fill="none"/>
    <path d="M35 62L391 73V215L35 222Z" fill="#0b232e" stroke="#57716a" stroke-width="3"/>
    <path d="M47 74L379 84V204L47 210Z" fill="url(#lattice)" opacity=".4"/>
    <path d="M51 77L378 86M50 207L378 202" fill="none" stroke="#c7b17c" stroke-opacity=".19"/>
    ${rosette(183, 143, 48, '#58706a')}
    <path d="${arch(583, 0, 377, 353)}" fill="#0b232d" stroke="#677e74" stroke-width="2"/>
    <path d="${arch(592, 6, 360, 343)}" fill="url(#carved)"/>
    <path d="${arch(608, 16, 327, 327)}" fill="#0f2c35" stroke="#8b9986" stroke-opacity=".64" stroke-width="2"/>
    <path d="${arch(619, 25, 305, 313)}" fill="#304f53" stroke="#729086" stroke-width="2"/>
    ${vaultJoints(609, 16, 327, 327, 18, '#a6b8a0', .2)}
    <path d="${opening}" fill="url(#night)"/>
    <g clip-path="url(#nightWindow)">
      ${skyStars()}
      <g class="moon enhanced-motion"><circle cx="823" cy="117" r="97" fill="url(#moonGlow)"/><circle cx="823" cy="117" r="20" fill="#e7e8c5"/><circle cx="817" cy="112" r="6" fill="#c6d7c6" opacity=".28"/><circle cx="829" cy="123" r="4" fill="#a5bcb8" opacity=".21"/></g>
      <path class="cloud-motion enhanced-motion" d="M575 240Q653 218 716 236T858 232T1000 220" stroke="#9cb8b5" stroke-opacity=".12" stroke-width="10" fill="none"/>
      <path d="M569 299L655 263 710 277 782 250 861 278 950 246 1020 282V340H569Z" fill="#5a7b80" opacity=".42"/>
      ${distantCity(true)}
      ${foliage(907, 350, .55, '#1d414b', 8)}
    </g>
    <path d="M637 163V333H905L888 347H621V175Z" fill="#112c34"/>
    <path d="M905 164V333L888 347V177Z" fill="#456363"/>
    <path d="M628 331H918L944 351H608Z" fill="#78867c"/>
    <path d="M608 351H944V360H608Z" fill="#2a4548"/>
    <path d="M613 352H940" stroke="#b8c1a3" stroke-opacity=".45"/>
    <path d="M638 284H902M638 287H902" stroke="#49636a" stroke-width="2"/>
    <path d="M766 86V334M775 85V334" stroke="#54716e" stroke-width="2"/>
    ${seq(15, i => rosette(622 + i * 21, 365, 6, '#9caa8c'))}
    <path class="light-shaft enhanced-motion" d="M663 277L904 319 639 520H187Z" fill="url(#beam)"/>
    <path d="M756 329L772 328 476 520H439Z M639 306L640 327 246 520H205Z" fill="#0b2a36" opacity=".3"/>
    <path d="${arch(1011, 44, 133, 287)}" fill="#09242d" stroke="#466764" stroke-width="5"/>
    <path d="${arch(1022, 61, 111, 263)}" fill="url(#lattice)" opacity=".65"/>
    <path d="M1005 331H1151V341H1005Z" fill="#4b6158"/>
    ${rosette(1077, 23, 17, '#6e8375')}
    <path d="M950 0H970V362H952Z" fill="#08242d" opacity=".42"/>
    <path d="M963 0H976V363H970V0" fill="#718375" opacity=".2"/>
    ${rug(471, 398, 429, 191, -50)}
    <ellipse cx="984" cy="463" rx="179" ry="37" fill="#061f28" opacity=".6"/>
    <path d="M864 434Q862 405 891 397L1075 383Q1114 388 1120 416L1110 451Q1022 474 872 459Z" fill="#274d51"/>
    <path d="M865 433Q983 445 1120 416L1108 451Q1019 474 872 459Z" fill="#163841"/>
    <path d="M867 432Q983 445 1117 416" fill="none" stroke="#779083" stroke-width="2"/>
    <path d="M889 403Q899 401 907 401L899 431M919 400L910 435M1055 386L1058 426M1071 386L1075 423" fill="none" stroke="#b6a475" stroke-opacity=".45" stroke-width="2"/>
    <path d="M1004 405Q985 385 987 351Q1025 325 1068 348Q1080 370 1073 398Z" fill="#7b6951" stroke="#ae9569" stroke-width="1"/>
    <path d="M1006 399Q1011 368 997 355M1012 349Q1039 361 1063 352M1047 403Q1041 377 1069 354" fill="none" stroke="#273e3e" stroke-opacity=".42" stroke-width="2"/>
    ${rosette(1034, 375, 19, '#b49d72')}
    <ellipse cx="438" cy="423" rx="96" ry="19" fill="#081f29" opacity=".66"/>
    <path d="M400 369H470L469 415 459 419 455 384H414L413 420 404 418Z" fill="url(#wood)"/>
    <ellipse cx="435" cy="368" rx="47" ry="17" fill="url(#wood)" stroke="#a0885d" stroke-width="1"/>
    <ellipse cx="435" cy="365" rx="43" ry="12" fill="#957b4f"/>
    <ellipse cx="435" cy="364" rx="37" ry="9" fill="#66583c"/>
    <g opacity=".6"><ellipse class="lamp-reflection" cx="435" cy="364" rx="43" ry="11" fill="url(#glow)"/></g>
    <ellipse cx="435" cy="364" rx="22" ry="5" fill="#172a27" opacity=".75"/>
    ${lamp(435, 319, .67, 66, true)}
    <g opacity=".48"><ellipse class="lamp-reflection" cx="438" cy="391" rx="154" ry="68" fill="url(#glow)"/></g>
    ${dust(380, 223, 192, 153, 23)}
    ${foliage(84, 454, 1.05, '#0c2b34', 33)}
    <path d="M53 438H121L109 486Q89 496 67 486Z" fill="#18383e"/>
    <ellipse cx="87" cy="440" rx="35" ry="8" fill="#244a4c"/>
    <path d="M59 449Q86 457 116 448M65 473Q87 480 112 472" fill="none" stroke="#52706a" stroke-opacity=".4"/>
    <path d="M0 0H31V520H0Z" fill="#061c26" opacity=".7"/>
  `, `<defs><clipPath id="nightWindow"><path d="${opening}"/></clipPath></defs>`);
}
function column(x, y, height, width = 40, fill = 'url(#stone)') {
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/><rect x="${x + width * .15}" y="${y}" width="${width * .11}" height="${height}" fill="#fbebbf" opacity=".25"/><rect x="${x + width * .81}" y="${y}" width="${width * .19}" height="${height}" fill="#24494a" opacity=".27"/><rect x="${x - 7}" y="${y - 5}" width="${width + 14}" height="9" fill="url(#paleStone)"/><path d="M${x - 5} ${y + 4}H${x + width + 5}L${x + width} ${y + 17}H${x}Z" fill="url(#stone)"/><rect x="${x - 6}" y="${y + height - 8}" width="${width + 12}" height="8" fill="url(#paleStone)"/><rect x="${x - 10}" y="${y + height}" width="${width + 20}" height="10" fill="url(#stone)"/>${seq(Math.floor(height / 52), i => `<path d="M${x} ${y + 33 + i * 52}H${x + width}" stroke="#224c4b" stroke-opacity=".18"/>`)}</g>`;
}
function mosqueArcade() {
  const mainOpening = arch(568, 20, 490, 330);
  return wrap('Sunlit mosque courtyard with layered stone arches, geometric tilework and a woven prayer rug', `
    <rect width="1200" height="520" fill="url(#daySky)"/>
    <circle cx="884" cy="105" r="42" fill="#fff0bd" opacity=".65"/>
    <path d="M449 179Q645 147 792 169T1200 141" fill="none" stroke="#fff2c6" stroke-width="13" opacity=".2"/>
    <g clip-path="url(#courtyardOpening)">
      <path d="M510 258Q596 214 705 246T920 230T1200 238V361H510Z" fill="#a6b6a0"/>
      <path d="M579 288V219H710V196H768V219H1018V285Z" fill="#d6c49b"/>
      <path d="M635 222Q635 184 672 170Q709 184 709 222Z" fill="url(#paleStone)"/>
      <path d="M661 176Q672 157 684 176M671 173V159" fill="none" stroke="#9f8d65" stroke-width="2"/>
      <path d="M972 261V145H985V261Z" fill="#dacba6"/><path d="M967 174H990V181H967Z M969 145H989V152H969Z M973 145V131L979 116 984 131V145Z" fill="#c2ac82"/>
      ${seq(7, i => `<path d="${arch(595 + i * 59, 235, 36, 51)}" fill="#7c9487" stroke="#ecd7a9" stroke-width="3"/>`)}
      <path d="M580 291H1028V305H580Z" fill="#e1cda0"/><path d="M580 295H1028" stroke="#fbebbc" stroke-width="3"/>
      ${seq(12, i => foliage(583 + i * 45, 307, .2 + (i % 3) * .09, ['#6c8c70', '#587f70', '#819b76'][i % 3], 38 + i))}
      <path d="M570 306H1100V350H570Z" fill="#c5be96"/>
      <path d="M568 320H1064V330H568Z" fill="#ead7a7"/>
      <path d="M622 304H968L1020 338H578Z" fill="#567f79"/>
      <path d="M642 309H949L984 332H609Z" fill="#95b8a3"/>
      <path d="M661 314H932M646 322H954" stroke="#e6e2b4" stroke-opacity=".52"/>
      <path d="M819 288V310M812 305Q819 273 827 305" stroke="#d5e4c0" stroke-width="2" fill="none"/>
      <g class="fountain-drops enhanced-motion" fill="#f5f0cf"><circle cx="816" cy="291" r="1.1"/><circle cx="822" cy="286" r=".9"/><circle cx="826" cy="298" r=".8"/><circle cx="811" cy="306" r=".9"/></g>
      <ellipse class="water-ripple" cx="819" cy="312" rx="17" ry="4" fill="none" stroke="#e2e7bd"/>
      <ellipse class="water-ripple extra-ripple enhanced-motion" cx="819" cy="313" rx="26" ry="5.5" fill="none" stroke="#e2e7bd" stroke-opacity=".55"/>
    </g>
    <path d="M0 0H1200V353H0Z ${mainOpening}" fill="url(#stone)" fill-rule="evenodd"/>
    <path d="M0 0H560V352H0Z" fill="#627f77"/>
    <path d="M0 0H1200V353H0Z ${mainOpening}" fill="url(#stoneJoint)" fill-rule="evenodd" opacity=".6"/>
    <path d="M0 345H1200V520H0Z" fill="url(#sandFloor)"/>
    ${floorLines(819, 345, '#274c4d', .26)}
    <path d="M0 343H1200V354H0Z" fill="#899a7d"/><path d="M0 344H1200" stroke="#f9e5b3" stroke-opacity=".75" stroke-width="2"/>
    <path d="M526 354L224 520H0L355 354Z M1065 347L790 520H940L1185 347Z" fill="#335b5d" opacity=".63"/>
    <path d="M568 345L393 520H533L660 346Z M713 346L589 520H614L736 346Z" fill="#f9e3a7" opacity=".55"/>
    <path d="${arch(536, -18, 555, 371)}" fill="none" stroke="#e1cd9f" stroke-width="31"/>
    <path d="${arch(550, -5, 529, 355)}" fill="none" stroke="#fbebc0" stroke-width="5"/>
    <path d="${arch(566, 14, 496, 334)}" fill="none" stroke="#8e9276" stroke-width="9"/>
    <path d="${arch(570, 20, 486, 330)}" fill="none" stroke="#f4dfab" stroke-width="2"/>
    ${vaultJoints(560, 5, 510, 347, 26, '#777d66', .25)}
    ${column(518, 158, 192, 43)}
    ${column(1060, 158, 192, 48)}
    ${rosette(505, 91, 27, '#cbb984')}
    ${rosette(1106, 91, 27, '#cbb984')}
    <path d="M0 0H470V37L0 71Z" fill="#214748"/>
    <path d="M0 80L470 39V51L0 94Z" fill="#bcac86"/>
    <path d="M0 88L470 47" fill="none" stroke="#eee0b2" stroke-opacity=".5" stroke-width="2"/>
    <path d="${arch(291, 83, 155, 267)}" fill="#224d51" stroke="#a9ac8b" stroke-width="11"/>
    <path d="${arch(310, 103, 121, 241)}" fill="#547b74" stroke="#d0c59c" stroke-width="3"/>
    <path d="${arch(327, 127, 83, 217)}" fill="#a8b69a"/>
    <path d="${arch(349, 156, 42, 188)}" fill="#345e5d"/>
    <rect x="318" y="281" width="93" height="63" fill="url(#fineTile)"/>
    <path d="M294 348H449L449 359H294Z" fill="#889680"/>
    <path d="M453 62L494 48V352L453 356Z" fill="url(#stone)"/>
    <path d="M457 67L466 63V350L457 352Z" fill="#e5d3a4" opacity=".5"/>
    <path d="M441 59L502 39V50L441 70Z M443 348L500 341V354L443 364Z" fill="url(#paleStone)"/>
    <path d="${arch(64, 113, 176, 260)}" fill="#173e45" stroke="#919f84" stroke-width="14"/>
    <path d="${arch(86, 137, 135, 222)}" fill="#385f5c" stroke="#c0bb94" stroke-width="3"/>
    <path d="${arch(113, 165, 88, 190)}" fill="url(#lattice)"/>
    <rect x="63" y="299" width="180" height="61" fill="url(#tile)" opacity=".7"/>
    <path d="M42 94L64 88V370L41 375Z" fill="#b5ae88"/><path d="M229 76L253 68V354L230 358Z" fill="url(#stone)"/>
    <path d="M11 83L262 58V69L11 94Z" fill="#8c9a7b"/>
    ${rosette(270, 166, 18, '#bec39f')}
    <path d="M0 366L508 347V364L0 396Z" fill="#b5b492"/><path d="M0 377L508 355" stroke="#e7d8ac" fill="none"/>
    <path d="M1105 240H1200V344H1105Z" fill="url(#tile)"/>
    <path d="M1106 235H1200V245H1106Z" fill="url(#border)"/>
    <path d="M1099 0H1115V350H1099Z" fill="#738774" opacity=".3"/>
    ${seq(6, i => rosette(1126 + i * 20, 221, 6, '#bba779'))}
    ${rug(733, 408, 286, 166, -95)}
    <g opacity=".38"><path class="light-shaft enhanced-motion" d="M552 173L888 347 589 519H125Z" fill="url(#beam)"/></g>
    ${lamp(382, 217, .4, 200)}
    ${lamp(814, 71, .4, 255)}
    ${dust(546, 160, 500, 222, 32, '#ffedb1')}
    ${foliage(1171, 419, .86, '#315f55', 12)}
    <path d="M1138 410H1201L1192 456Q1171 466 1150 455Z" fill="#997951"/><ellipse cx="1170" cy="411" rx="32" ry="7" fill="#bfa574"/><ellipse cx="1170" cy="410" rx="26" ry="4" fill="#314b41"/>
    <path d="M1146 427Q1170 435 1197 427M1149 438Q1170 445 1194 438" stroke="#d6b680" stroke-opacity=".5" fill="none"/>
    <path d="M0 0H24V520H0Z" fill="#143a42" opacity=".8"/>
  `, `<defs><clipPath id="courtyardOpening"><path d="${mainOpening}"/></clipPath></defs>`);
}
function bookOnStand() {
  return `<g>
    <ellipse cx="887" cy="453" rx="153" ry="28" fill="#06232c" opacity=".47"/>
    <path d="M781 340L942 450 967 445 803 331Z" fill="url(#wood)" stroke="#ac8759" stroke-width="1.5"/>
    <path d="M1015 338L811 458 786 450 992 329Z" fill="url(#wood)" stroke="#a98457" stroke-width="1.5"/>
    <path d="M796 345L949 448M1001 343L802 451" stroke="#dfb878" stroke-opacity=".42" stroke-width="2"/>
    <path d="M807 356L875 402 851 415 798 372Z M932 397L960 380 947 394 942 410Z" fill="#17363c"/>
    <path d="M772 341L896 273 1038 337 902 405Z" fill="url(#wood)" stroke="#b99865" stroke-width="2"/>
    <path d="M787 341L897 283 1018 337 901 395Z" fill="none" stroke="#bf9a60" stroke-opacity=".6"/>
    <path d="M774 342L902 405 1037 338V348L902 416 774 352Z" fill="#3d362d"/>
    <path d="M774 343L902 406 1037 339" stroke="#dfb374" stroke-opacity=".7" fill="none"/>
    <path d="M793 338L921 278 1028 337 895 405Z" fill="#061c24" opacity=".72"/>
    <g class="resting-book" transform="translate(0 30)">
    <path d="M789 297L922 238 1029 302 894 363 789 306Z" fill="#a18859"/>
    <path d="M796 292L924 236 1021 294V312L895 371 796 312Z" fill="url(#pages)"/>
    ${seq(7, i => `<path d="M798 ${296 + i * 2}L895 ${354 + i * 2}L1019 ${296 + i * 2}" stroke="#715f43" stroke-opacity="${.22 + i * .04}" stroke-width=".7" fill="none"/>`)}
    <path d="M792 280L922 223 1031 285 895 350Z" fill="url(#bookCover)" stroke="#c7b176" stroke-width="2"/>
    <path d="M791 280L895 340V352L791 293Z" fill="#15414a"/>
    <path d="M791 287L895 347" stroke="#a99b68" stroke-width="1"/>
    <path d="M806 279L923 232 1017 285 895 339Z" fill="none" stroke="#c6ad71" stroke-width="1.2"/>
    <path d="M813 280L923 238 1009 285 895 333Z" fill="none" stroke="#b69c64" stroke-opacity=".7" stroke-width=".8"/>
    <g transform="matrix(.89 -.4 .91 .51 908 285)">
      <path d="M-37-34H37V34H-37Z" fill="none" stroke="#cbb37b" stroke-width="1.2"/>
      ${rosette(0, 0, 28, '#d5bd82')}
      ${seq(4, i => `<g transform="rotate(${i * 90})"><path d="M-18-34Q0-17 18-34M-33-29L-25-21-33-12M33-29L25-21 33-12" fill="none" stroke="#bfaa76" stroke-width="1.1"/></g>`)}
    </g>
    <path d="M818 279L832 274 821 289Z M920 244L917 253 936 251Z M991 284L977 282 978 293Z M895 326L905 316 886 317Z" fill="#d0b67b"/>
    <path d="M836 310L843 307M860 324L867 321M814 297L821 294" stroke="#dcc388" stroke-width="2"/>
    <path d="M955 340L973 334 989 367 978 364 974 376Z" fill="#c99d53"/><path d="M960 340L979 369" stroke="#f0ca79" stroke-opacity=".55"/>
    </g>
  </g>`;
}
function library() {
  const opening = arch(83, 26, 403, 330);
  return wrap('Quiet library niche with a geometric bound book on a wooden reading stand and warm hanging lantern', `
    <rect width="1200" height="520" fill="url(#nightWall)"/>
    <path d="M0 0H1200V347H0Z" fill="#29464b"/>
    ${joints(0, 0, 1200, 346, .5)}
    <path d="${arch(38, -33, 495, 391)}" fill="#14333c" stroke="#627a70" stroke-width="5"/>
    <path d="${arch(60, -11, 451, 365)}" fill="url(#carved)" stroke="#799487" stroke-width="3"/>
    <path d="${opening}" fill="url(#daySky)"/>
    <g clip-path="url(#gardenOpening)">
      <rect x="70" y="32" width="442" height="331" fill="url(#daySky)"/>
      <circle cx="322" cy="144" r="48" fill="#f2e4b1" opacity=".45"/>
      <path d="M55 265Q172 194 260 230T503 218V351H55Z" fill="#9daf91"/>
      <path d="M40 313Q115 256 217 283T429 271L512 293V359H40Z" fill="#648774"/>
      <path d="M341 307V246H443V305Z M351 246Q351 215 391 197Q432 215 432 246Z" fill="#baae83" opacity=".7"/>
      <path d="${arch(374, 260, 31, 47)}" fill="#416e64"/>
      <g class="foliage-motion enhanced-motion" style="transform-origin:136px 350px">${foliage(136, 350, 1.15, '#3b6b60', 4)}</g>
      <g class="foliage-motion enhanced-motion" style="transform-origin:480px 355px;animation-delay:-5s">${foliage(480, 355, .94, '#4d7b65', 5)}</g>
      ${foliage(245, 362, .47, '#527e63', 15)}
      <path d="M102 182Q139 87 223 60M128 133Q100 77 88 53M170 96Q170 45 146 11" fill="none" stroke="#456b56" stroke-width="9"/>
      ${seq(22, i => `<ellipse cx="${96 + i * 6.5}" cy="${n(122 - Math.sin(i * .13) * 66)}" rx="${13 + i % 3 * 4}" ry="${8 + i % 4}" transform="rotate(${i * 17} ${96 + i * 6.5} ${n(122 - Math.sin(i * .13) * 66)})" fill="${['#658a67', '#739772', '#517b63'][i % 3]}"/>`)}
      <path d="M71 321H505V334H71Z" fill="#c4bd98"/>
      <path d="M69 327H509V339H69Z" fill="#69887a"/>
      ${seq(13, i => `<path d="M${87 + i * 31} 335h9v36h-9z" fill="#aeb497"/><path d="M${84 + i * 31} 337h15v5h-15z" fill="#d2c8a1"/>`)}
      <path d="M70 367H511V380H70Z" fill="#c4bd9a"/>
    </g>
    <path d="M83 174V356L63 369V178Z" fill="#143d44"/>
    <path d="M487 174V356L507 370V178Z" fill="#637b70"/>
    <path d="M63 357H508L532 376H44Z" fill="#8a9682"/><path d="M44 376H532V384H44Z" fill="#385755"/>
    <path d="M47 376H528" stroke="#c1c5a5" stroke-opacity=".5"/>
    <path d="M0 373L566 337 1200 371V520H0Z" fill="url(#floor)"/>
    ${floorLines(777, 350)}
    <path d="M512 0H586V353L555 356V0Z" fill="url(#carved)"/>
    <path d="M512 0H526V356H512Z" fill="#97a18b" opacity=".25"/>
    <path d="M529 0H536V356H529Z" fill="#11323c" opacity=".6"/>
    <path d="${arch(620, -38, 518, 421)}" fill="#173640" stroke="#849281" stroke-width="3"/>
    <path d="${arch(639, -18, 479, 396)}" fill="url(#carved)"/>
    <path d="${arch(660, 4, 436, 368)}" fill="#0b2c39" stroke="#788b7a" stroke-width="2"/>
    ${vaultJoints(660, 4, 436, 368, 21, '#acb18d', .18)}
    <path d="${arch(680, 23, 397, 343)}" fill="#28494b" stroke="#284746" stroke-width="9"/>
    <path d="${arch(693, 37, 369, 325)}" fill="#26494c"/>
    ${joints(704, 90, 347, 245, .6)}
    <path d="M692 270H1064V366H692Z" fill="url(#tile)" opacity=".72"/>
    <path d="M692 262H1064V274H692Z" fill="url(#border)" opacity=".75"/>
    <path d="M656 365H1098L1128 385H635Z" fill="#738370"/>
    <path d="M635 385H1128V394H635Z" fill="#244547"/>
    <path d="M639 385H1123" stroke="#b1b695" stroke-opacity=".45"/>
    <path d="${arch(749, 80, 262, 187)}" fill="#193e43" stroke="#8b946f" stroke-opacity=".5" stroke-width="2"/>
    <path d="${arch(761, 93, 238, 172)}" fill="url(#fineTile)" opacity=".23"/>
    ${rosette(879, 162, 44, '#859479')}
    ${seq(12, i => rosette(662 + i * 39, 396, 7, '#9b9c78'))}
    <g opacity=".8"><path class="light-shaft enhanced-motion" d="M681 306L166 520H644L1045 349Z" fill="url(#beam)"/></g>
    <g opacity=".3"><path class="light-shaft enhanced-motion" d="M126 357L483 358 766 520H404Z" fill="url(#beam)"/></g>
    <path d="M34 388L486 389 454 404 0 410Z" fill="#091f29" opacity=".4"/>
    ${rug(657, 413, 452, 196, -65, .85)}
    <path d="M1129 36H1200V367H1129Z" fill="#0c2b35" stroke="#566d5c" stroke-width="3"/>
    <path d="M1140 50H1200V123H1140Z M1140 139H1200V228H1140Z M1140 244H1200V350H1140Z" fill="#112d33"/>
    ${seq(14, i => `<g transform="translate(${1145 + i % 5 * 13} ${i < 5 ? 58 : i < 10 ? 157 : 274})"><path d="M0 0H10V${i < 5 ? 62 : i < 10 ? 65 : 70}H0Z" fill="${['#647161', '#a58b61', '#3a5b56', '#786b50', '#456358'][i % 5]}"/><path d="M2 3V${i < 5 ? 56 : i < 10 ? 59 : 64}M1 9H9M1 15H9M1 ${i < 5 ? 51 : i < 10 ? 54 : 59}H9" stroke="#cdb47b" stroke-opacity=".45" stroke-width=".8"/></g>`)}
    <path d="M1136 123H1200V139H1136Z M1136 229H1200V245H1136Z M1136 351H1200V364H1136Z" fill="url(#wood)"/>
    <path d="M1137 124H1200M1137 230H1200M1137 352H1200" stroke="#b09260" stroke-opacity=".5"/>
    <g opacity=".48"><ellipse class="lamp-reflection" cx="918" cy="261" rx="209" ry="173" fill="url(#glow)"/></g>
    ${lamp(943, 115, .75, 170)}
    ${bookOnStand()}
    ${dust(788, 166, 263, 202, 543)}
    <ellipse cx="180" cy="472" rx="84" ry="17" fill="#0a242d" opacity=".6"/>
    ${foliage(175, 444, 1.06, '#1b4b48', 58)}
    ${foliage(182, 445, .7, '#2f6256', 50)}
    <path d="M136 429H214L201 476Q175 490 150 476Z" fill="url(#wood)" stroke="#56716a" stroke-width="1"/>
    <ellipse cx="175" cy="430" rx="39" ry="9" fill="#49675b"/><ellipse cx="175" cy="428" rx="32" ry="6" fill="#102d30"/>
    <path d="M146 448Q176 461 207 448M149 463Q176 475 203 464" fill="none" stroke="#8a9a7f" stroke-opacity=".4"/>
    <path d="M0 0H21V520H0Z" fill="#0d2933"/>
  `, `<defs><clipPath id="gardenOpening"><path d="${opening}"/></clipPath></defs>`);
}

/** Return standalone SVG strings; the parent builder owns the output directory. */
export function buildInteriors() {
  return { 'before-sleep': nightRoom(), salah: mosqueArcade(), favourites: library() };
}
