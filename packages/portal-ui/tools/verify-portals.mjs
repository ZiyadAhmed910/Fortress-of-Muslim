import { access, readFile } from 'node:fs/promises';

const repositoryRoot = new URL('../../../', import.meta.url);

// A portal's mark and the app's are the same drawing, generated together by
// pwa-website/tools/build-brand.mjs. The first portal mark was a hand-drawn copy and quietly kept
// the old logo through an entire rebrand, so what ships is compared against the app's own icon
// here: the only difference either file may carry is the product name it announces.
const withoutLabel = (svg) => svg.replace(/ aria-label="[^"]*"/, '').replace(/\s+/g, ' ').trim();
async function checkMarkMatchesTheApp(output, portal) {
  for (const [shipped, drawn] of [
    ['assets/fortress-mark.svg', 'pwa-website/icons/logo.svg'],
    ['assets/fortress-favicon.svg', 'pwa-website/icons/favicon.svg'],
  ]) {
    const shippedMark = withoutLabel(await readFile(new URL(shipped, output), 'utf8'));
    const appMark = withoutLabel(await readFile(new URL(drawn, repositoryRoot), 'utf8'));
    if (shippedMark !== appMark) {
      throw new Error(`${portal} ships ${shipped}, which no longer matches ${drawn}. Run node pwa-website/tools/build-brand.mjs.`);
    }
  }
}

/** Every custom property a block assigns, as a map of name to value. */
function tokensIn(css, selector) {
  const at = css.indexOf(selector);
  if (at === -1) return null;
  const block = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z-]+)\s*:\s*([^;]+)/g)].map((match) => [match[1], match[2].trim()]),
  );
}

/**
 * Every portal loads portal.css and then its own stylesheet, so the second one silently wins. Admin
 * used to redefine :root there with a hard-coded light palette, which overrode portal.css's tokens
 * including both of its dark themes, and pinned color-scheme to light on top of that. With no theme
 * toggle in its header either, there was no way back.
 *
 * What that looked like was the complaint that arrived: anything styled by portal.css followed the
 * theme and anything styled by the portal's own stylesheet did not, so half the console went dark
 * and half stayed white. Each of the faults below is silent when it returns -- a stylesheet that
 * quietly wins, a token with no dark value, a token defined in terms of itself -- so each is checked
 * rather than left to be noticed.
 */
async function checkTheming(output, portal, stylesheet) {
  const css = await readFile(new URL(stylesheet, output), 'utf8');
  const html = await readFile(new URL('index.html', output), 'utf8');

  if (!html.includes('data-theme-toggle')) throw new Error(`${portal} has no theme toggle.`);
  if (!html.includes('portal.js')) throw new Error(`${portal} does not load portal.js, which owns the toggle.`);
  if (/color-scheme\s*:\s*light/.test(css)) {
    throw new Error(`${portal} pins color-scheme to light, which renders form controls light inside a dark page.`);
  }

  const own = tokensIn(css, ':root{') ?? tokensIn(css, ':root {') ?? {};
  for (const shared of ['--bg', '--surface', '--ink', '--muted', '--line', '--brand', '--shadow']) {
    if (shared in own) throw new Error(`${portal}'s ${stylesheet} redefines ${shared}, overriding portal.css's themes.`);
  }

  // Written without a backreference deliberately. The backreference version is correct and was
  // silently destroyed on the way into this file: an escape collapsed and left a control character
  // where the \1 should have been, so the pattern matched nothing and this check passed while the
  // exact bug it exists to catch was present in the stylesheet. Comparing the two captured names in
  // code cannot be mangled by whatever writes the file.
  const circular = [...css.matchAll(/(--[a-z-]+)\s*:\s*var\((--[a-z-]+)\)/g)]
    .filter((match) => match[1] === match[2])
    .map((match) => match[1]);
  if (circular.length) throw new Error(`${portal} defines ${circular.join(', ')} in terms of itself, which resolves to nothing.`);

  const ownValues = Object.entries(own).filter(([, value]) => !value.startsWith('var('));
  if (ownValues.length) {
    const explicit = tokensIn(css, ':root[data-theme="dark"]{') ?? {};
    const system = tokensIn(css, ':root:not([data-theme="light"]){') ?? {};
    for (const [token] of ownValues) {
      if (!(token in explicit)) throw new Error(`${portal} defines ${token} with no dark value.`);
    }
    // Two blocks: an explicit choice, and the system preference when none has been made. With only
    // the first, a reader whose machine is in dark mode gets a white console until they find the
    // toggle -- and the two drifting apart is how one theme silently stops matching the other.
    const explicitKeys = Object.keys(explicit).sort();
    const systemKeys = Object.keys(system).sort();
    if (explicitKeys.join() !== systemKeys.join()) {
      throw new Error(`${portal}'s explicit and system dark blocks define different tokens.`);
    }
    for (const [token, value] of Object.entries(explicit)) {
      if (system[token] !== value) throw new Error(`${portal}'s ${token} differs between its two dark blocks.`);
    }
  }
}

for (const portal of ['developers', 'status', 'admin']) {
  const output = new URL(`apps/${portal}/dist/`, repositoryRoot);
  const portalStylesheet = portal === 'admin' ? 'admin.css' : 'styles.css';
  for (const path of ['index.html', 'app.js', portalStylesheet, '_headers', 'assets/portal.css', 'assets/portal.js', 'assets/fortress-mark.svg', 'assets/fortress-favicon.svg']) {
    await access(new URL(path, output));
  }
  await checkMarkMatchesTheApp(output, portal);
  await checkTheming(output, portal, portalStylesheet);
  const html = await readFile(new URL('index.html', output), 'utf8');
  if (!html.includes('/assets/fortress-favicon.svg')) throw new Error(`${portal} does not use the simplified mark as its favicon.`);
  if (!html.includes('Fortress Platform')) throw new Error(`${portal} is missing the platform brand.`);
  const responseHeaders = await readFile(new URL('_headers', output), 'utf8');
  for (const header of ['Access-Control-Allow-Origin: *', 'X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff', 'Strict-Transport-Security:', "Content-Security-Policy: default-src 'self'"]) {
    if (!responseHeaders.includes(header)) throw new Error(`${portal} is missing static response protection: ${header}`);
  }
  if (portal === 'developers') {
    for (const path of ['console.html', 'console.js', 'console.css', 'device.html', 'device.js']) await access(new URL(path, output));
    const consoleHtml = await readFile(new URL('console.html', output), 'utf8');
    const consoleScript = await readFile(new URL('console.js', output), 'utf8');
    for (const marker of ['role="tab"', 'aria-live="polite"', 'aria-controls="profile-dropdown"']) {
      if (!consoleHtml.includes(marker)) throw new Error(`Developer Console is missing accessibility marker ${marker}.`);
    }
    for (const marker of ['AbortSignal.timeout', 'Promise.allSettled', 'trapFocus', 'setFormBusy']) {
      if (!consoleScript.includes(marker)) throw new Error(`Developer Console is missing reliability behavior ${marker}.`);
    }
    if (/[ÃÂÆ]/.test(consoleScript)) throw new Error('Developer Console contains corrupted encoded text.');
  }
  if (portal === 'admin') {
    for (const marker of ['id="queue"', 'id="assignments"', 'id="batches"', 'id="users"', 'id="roles-table"', 'id="record-dialog"']) {
      if (!html.includes(marker)) throw new Error(`Admin portal is missing ${marker}.`);
    }
    const script = await readFile(new URL('app.js', output), 'utf8');
    for (const route of ['/v1/admin/editorial/queue', '/v1/admin/editorial/assignments', '/v1/admin/editorial/batches', '/v1/admin/editorial/roles', '/decision', '/references']) {
      if (!script.includes(route)) throw new Error(`Admin portal is missing editorial route ${route}.`);
    }
    for (const retiredRoute of ['/v1/admin/sources', '/v1/admin/content']) {
      if (script.includes(retiredRoute)) throw new Error(`Admin portal still exposes retired route ${retiredRoute}.`);
    }
  }
  if (portal === 'status') {
    for (const marker of ['data-service="api"', 'data-service="database"', 'data-service="auth"', 'data-service="mcp"', 'data-service="admin"']) {
      if (!html.includes(marker)) throw new Error(`Status portal is missing ${marker}.`);
    }
    const script = await readFile(new URL('app.js', output), 'utf8');
    for (const endpoint of ['/health', '/health/database', 'auth', 'mcp']) {
      if (!script.includes(endpoint)) throw new Error(`Status portal is missing operational check ${endpoint}.`);
    }
  }
}
console.log('Verified developer, status, and admin portal builds.');
