import { access, readFile } from 'node:fs/promises';

const repositoryRoot = new URL('../../../', import.meta.url);
for (const portal of ['developers', 'status', 'admin']) {
  const output = new URL(`apps/${portal}/dist/`, repositoryRoot);
  const portalStylesheet = portal === 'admin' ? 'admin.css' : 'styles.css';
  for (const path of ['index.html', 'app.js', portalStylesheet, '_headers', 'assets/portal.css', 'assets/portal.js', 'assets/fortress-mark.svg']) {
    await access(new URL(path, output));
  }
  const html = await readFile(new URL('index.html', output), 'utf8');
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
    for (const marker of ['id="queue"', 'id="assignments"', 'id="batches"', 'id="roles"', 'id="record-dialog"']) {
      if (!html.includes(marker)) throw new Error(`Admin portal is missing ${marker}.`);
    }
    const script = await readFile(new URL('app.js', output), 'utf8');
    for (const route of ['/v1/admin/editorial/queue', '/v1/admin/editorial/assignments', '/v1/admin/editorial/batches', '/field-reviews', '/references']) {
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
