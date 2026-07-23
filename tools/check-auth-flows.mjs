import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const developerRoot = join(process.cwd(), 'apps', 'developers', 'dist');
const adminRoot = join(process.cwd(), 'apps', 'admin', 'dist');
const developerServer = await serve(developerRoot, 8091);
const adminServer = await serve(adminRoot, 8092);
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});

try {
  await checkDeveloperSignOut(browser);
  await checkAdminSignOut(browser);
  console.log('Developer and Admin sign-out state checks passed.');
} finally {
  await browser.close();
  await close(developerServer);
  await close(adminServer);
}

async function checkDeveloperSignOut(browserInstance) {
  const context = await browserInstance.newContext();
  let signedIn = true;
  await mockAuth(context, () => signedIn, () => { signedIn = false; });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8091/console.html', { waitUntil: 'networkidle' });
  await page.locator('[data-auth-only]').waitFor({ state: 'visible' });
  await page.locator('[data-profile-toggle]').click();
  await page.locator('[data-sign-out]').click();
  await page.locator('#signed-out').waitFor({ state: 'visible' });
  if (await page.locator('[data-auth-only]:visible').count()) throw new Error('Developer profile remained visible after sign-out.');
  await context.close();
}

async function checkAdminSignOut(browserInstance) {
  const context = await browserInstance.newContext();
  let signedIn = true;
  await mockAuth(context, () => signedIn, () => { signedIn = false; });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8092/', { waitUntil: 'networkidle' });
  await page.locator('#console').waitFor({ state: 'visible' });
  await page.locator('a[href="#users"]').click();
  await page.locator('[data-user-tab="team"]').waitFor({ state: 'visible' });
  await page.locator('[data-user-tab="developers"]').click();
  await page.locator('[data-user-panel="developers"]').waitFor({ state: 'visible' });
  await page.locator('[data-profile]').click();
  await page.locator('[data-profile-menu] [data-sign-out]').click();
  await page.locator('#login').waitFor({ state: 'visible' });
  if (await page.locator('#console:visible').count()) throw new Error('Admin Console remained visible after sign-out.');
  await context.close();
}

async function mockAuth(context, isSignedIn, signOut) {
  await context.route('http://127.0.0.1:8788/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/auth/sign-out') {
      signOut();
      return fulfill(route, { success: true });
    }
    if (path === '/api/auth/get-session') {
      return fulfill(route, isSignedIn() ? {
        user: { id: 'user.test', name: 'Test Admin', email: 'admin@example.test', twoFactorEnabled: false },
        session: { id: 'session.current', expiresAt: '2099-01-01T00:00:00Z' },
      } : null);
    }
    if (path === '/v1/admin/session') return fulfill(route, {
      data: {
        user: { id: 'user.test', name: 'Test Admin', email: 'admin@example.test' },
        role: 'admin',
        security: { sessionId: 'session.current', sessionExpiresAt: '2099-01-01T00:00:00Z', twoFactorEnabled: false },
      },
    });
    if (path === '/v1/admin/editorial/overview') return fulfill(route, { data: { queues: {} } });
    if (path === '/v1/admin/overview') return fulfill(route, { data: { counts: {}, services: [], audit: [] } });
    if (path === '/api/auth/api-key/list' || path === '/api/auth/oauth2/get-clients' || path === '/api/auth/passkey/list-user-passkeys') return fulfill(route, []);
    if (path === '/v1/control/mcp/catalog') return fulfill(route, { data: [] });
    return fulfill(route, { data: [] });
  });
}

function fulfill(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': route.request().headers().origin || '*', 'Access-Control-Allow-Credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function serve(root, port) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = normalize(join(root, requested));
    if (!file.startsWith(root)) return response.writeHead(403).end();
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

function contentType(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream';
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
