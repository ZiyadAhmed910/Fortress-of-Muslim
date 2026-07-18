const sections = [...document.querySelectorAll('[data-search-title]')];
const searchDialog = document.querySelector('.search-dialog');
const searchInput = document.querySelector('#doc-search');
const searchResults = document.querySelector('#search-results');

function openSearch() {
  searchDialog.hidden = false;
  document.body.style.overflow = 'hidden';
  searchInput.focus();
}

function closeSearch() {
  searchDialog.hidden = true;
  document.body.style.overflow = '';
}

document.querySelector('[data-search-open]').addEventListener('click', openSearch);
document.querySelector('[data-search-close]').addEventListener('click', closeSearch);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
  if (event.key === 'Escape' && !searchDialog.hidden) closeSearch();
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLocaleLowerCase();
  if (!query) { searchResults.innerHTML = '<p>Start typing to search this page.</p>'; return; }
  const matches = sections.filter((section) => section.textContent.toLocaleLowerCase().includes(query)).slice(0, 10);
  searchResults.innerHTML = matches.length ? matches.map((section) => `
    <a class="search-result" href="#${section.id}">
      <strong>${escapeHtml(section.dataset.searchTitle)}</strong>
      <small>${escapeHtml(section.querySelector('p')?.textContent.slice(0, 110) || 'API documentation')}</small>
    </a>`).join('') : '<p>No documentation matched that search.</p>';
  searchResults.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeSearch));
});

document.querySelectorAll('[data-code-group]').forEach((group) => {
  group.querySelectorAll('[data-code-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const name = tab.dataset.codeTab;
    group.querySelectorAll('[data-code-tab]').forEach((item) => item.classList.toggle('active', item === tab));
    group.querySelectorAll('[data-code-panel]').forEach((panel) => {
      const active = panel.dataset.codePanel === name;
      panel.hidden = !active;
      panel.classList.toggle('active-code', active);
    });
  }));
});

const navLinks = [...document.querySelectorAll('#doc-nav a[href^="#"]')];
const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  navLinks.forEach((link) => link.classList.toggle('active', link.hash === `#${visible.target.id}`));
}, { rootMargin: '-20% 0px -65%', threshold: [0, .2, .6] });
sections.forEach((section) => observer.observe(section));
navLinks.forEach((link) => link.addEventListener('click', () => document.body.classList.remove('nav-open')));

const environment = document.querySelector('#environment');
const pathInput = document.querySelector('#api-path');
const sendButton = document.querySelector('#send-request');
const responseBody = document.querySelector('#response-body');
const responseState = document.querySelector('#response-state');
const responseTime = document.querySelector('#response-time');
const explorerKey = document.querySelector('#explorer-key');

explorerKey.value = sessionStorage.getItem('fortress-explorer-key') || '';
explorerKey.addEventListener('input', () => sessionStorage.setItem('fortress-explorer-key', explorerKey.value.trim()));

document.querySelectorAll('[data-explorer-path]').forEach((link) => link.addEventListener('click', () => {
  pathInput.value = link.dataset.explorerPath;
}));

sendButton.addEventListener('click', async () => {
  const path = pathInput.value.trim();
  if (!path.startsWith('/')) { responseState.textContent = 'Invalid path'; responseState.className = 'response-state error'; return; }
  sendButton.disabled = true;
  responseState.textContent = 'Loading'; responseState.className = 'response-state';
  responseBody.textContent = 'Sending request...'; responseTime.textContent = '';
  const started = performance.now();
  try {
    const key = explorerKey.value.trim();
    if (!key) throw new Error('Enter a Fortress API key or create one in Developer account.');
    const response = await fetch(`${environment.value}${path}`, { headers: { 'X-Fortress-API-Key': key } });
    const data = await response.json();
    responseBody.textContent = JSON.stringify(data, null, 2);
    responseState.textContent = `${response.status} ${response.ok ? 'OK' : 'Error'}`;
    responseState.className = `response-state ${response.ok ? 'ok' : 'error'}`;
  } catch (error) {
    responseBody.textContent = JSON.stringify({ error: { message: error.message } }, null, 2);
    responseState.textContent = 'Network error'; responseState.className = 'response-state error';
  } finally {
    responseTime.textContent = `${Math.round(performance.now() - started)} ms`;
    sendButton.disabled = false;
  }
});

const authBase = location.hostname.startsWith('developers-test.')
  ? 'https://auth-test.fortressofmuslim.org'
  : location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8788'
    : 'https://auth.fortressofmuslim.org';
const apiAudience = authBase.includes('auth-test.') ? 'https://api-test.fortressofmuslim.org' : 'https://api.fortressofmuslim.org';
const signedOut = document.querySelector('#account-signed-out');
const signedIn = document.querySelector('#account-signed-in');
const authMessage = document.querySelector('#auth-message');
const controlMessage = document.querySelector('#control-message');

document.querySelector('[data-account-open]').addEventListener('click', () => document.querySelector('#account').scrollIntoView({ behavior: 'smooth' }));
document.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('[data-auth-tab]').forEach((item) => item.classList.toggle('active', item === tab));
  document.querySelectorAll('[data-auth-panel]').forEach((panel) => { panel.hidden = panel.dataset.authPanel !== tab.dataset.authTab; });
  authMessage.textContent = '';
}));
document.querySelectorAll('[data-form-toggle]').forEach((button) => button.addEventListener('click', () => {
  const form = document.querySelector(`#${button.dataset.formToggle}`);
  form.hidden = !form.hidden;
}));

document.querySelector('#sign-in-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitAuth('/api/auth/sign-in/email', event.currentTarget, 'Signing in...');
});

document.querySelector('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitAuth('/api/auth/sign-up/email', event.currentTarget, 'Creating account...');
});

document.querySelector('#sign-out').addEventListener('click', async () => {
  await authFetch('/api/auth/sign-out', { method: 'POST' });
  await refreshAccount();
});

document.querySelector('#api-key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await runControlAction(async () => {
    const result = await authJson('/api/auth/api-key/create', { method: 'POST', body: { name: form.get('name') } });
    const reveal = document.querySelector('#api-key-reveal');
    reveal.querySelector('code').textContent = result.key;
    reveal.hidden = false;
    explorerKey.value = result.key;
    sessionStorage.setItem('fortress-explorer-key', result.key);
    event.currentTarget.hidden = true;
    await loadApiKeys();
  }, 'API key created. Its full value is shown once.');
});

document.querySelector('#api-key-reveal .copy-text').addEventListener('click', async (event) => {
  await navigator.clipboard.writeText(document.querySelector('#api-key-reveal code').textContent);
  event.currentTarget.textContent = 'Copied';
});

document.querySelector('#oauth-app-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const isPublic = form.get('client_type') === 'public';
  await runControlAction(async () => {
    const result = await authJson('/api/auth/oauth2/create-client', {
      method: 'POST',
      body: {
        client_name: form.get('client_name'),
        redirect_uris: [form.get('redirect_uri')],
        token_endpoint_auth_method: isPublic ? 'none' : 'client_secret_post',
        grant_types: isPublic ? ['authorization_code', 'refresh_token'] : ['authorization_code', 'refresh_token', 'client_credentials'],
        response_types: ['code'],
        scope: 'openid profile content:read content:search dataset:read',
        resources: [apiAudience],
      },
    });
    const reveal = document.querySelector('#oauth-secret-reveal');
    reveal.innerHTML = `<strong>Connected app created</strong><code>${escapeHtml(result.client_id || '')}</code>${result.client_secret ? `<code>${escapeHtml(result.client_secret)}</code><small>Copy the client secret now. It will not be shown again.</small>` : '<small>Public clients use PKCE and do not receive a secret.</small>'}`;
    reveal.hidden = false;
    event.currentTarget.hidden = true;
    await loadOAuthApps();
  }, 'Connected app created.');
});

document.querySelector('#mcp-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await runControlAction(async () => {
    await authJson('/v1/control/mcp-servers', { method: 'POST', body: Object.fromEntries(form.entries()) });
    event.currentTarget.reset();
    event.currentTarget.hidden = true;
    await loadMcpServers();
  }, 'MCP server draft saved. Ownership verification and review come before publishing.');
});

async function submitAuth(path, formElement, pending) {
  authMessage.textContent = pending;
  const body = Object.fromEntries(new FormData(formElement).entries());
  try {
    await authJson(path, { method: 'POST', body });
    formElement.reset();
    await refreshAccount();
  } catch (error) {
    authMessage.textContent = error.message;
  }
}

async function refreshAccount() {
  try {
    const session = await authJson('/api/auth/get-session');
    const user = session?.user;
    signedOut.hidden = Boolean(user);
    signedIn.hidden = !user;
    document.querySelector('[data-account-open]').textContent = user ? user.name || 'Account' : 'Sign in';
    if (!user) return;
    document.querySelector('#account-name').textContent = user.name || 'Developer';
    document.querySelector('#account-email').textContent = user.email;
    await Promise.all([loadApiKeys(), loadOAuthApps(), loadMcpServers()]);
  } catch {
    signedOut.hidden = false;
    signedIn.hidden = true;
  }
}

async function loadApiKeys() {
  const result = await authJson('/api/auth/api-key/list');
  const keys = Array.isArray(result) ? result : result.apiKeys || [];
  renderResources('#api-key-list', keys, (key) => `<strong>${escapeHtml(key.name || 'Unnamed key')}</strong><code>${escapeHtml(key.start || key.prefix || 'fom_')}...</code><span>${key.enabled === false ? 'Disabled' : 'Active'}</span>`);
}

async function loadOAuthApps() {
  const result = await authJson('/api/auth/oauth2/get-clients');
  const apps = Array.isArray(result) ? result : result.clients || result.data || [];
  renderResources('#oauth-app-list', apps, (app) => `<strong>${escapeHtml(app.client_name || app.name || 'Connected app')}</strong><code>${escapeHtml(app.client_id || app.clientId || '')}</code><span>${app.public ? 'Public + PKCE' : 'Confidential'}</span>`);
}

async function loadMcpServers() {
  const result = await authJson('/v1/control/mcp-servers');
  renderResources('#mcp-list', result.data || [], (server) => `<strong>${escapeHtml(server.name)}</strong><code>/servers/${escapeHtml(server.slug)}/mcp</code><span>${escapeHtml(server.status)}</span>`);
}

function renderResources(selector, resources, render) {
  const target = document.querySelector(selector);
  target.innerHTML = resources.length ? resources.map((item) => `<div class="resource-row">${render(item)}</div>`).join('') : '<p class="empty-state">Nothing created yet.</p>';
}

async function runControlAction(action, success) {
  controlMessage.textContent = 'Working...';
  try { await action(); controlMessage.textContent = success; }
  catch (error) { controlMessage.textContent = error.message; }
}

async function authJson(path, options = {}) {
  const response = await authFetch(path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.message || data?.error?.message || `Request failed (${response.status}).`);
  return data;
}

function authFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  return fetch(`${authBase}${path}`, { ...options, headers, body, credentials: 'include' });
}

refreshAccount();

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
