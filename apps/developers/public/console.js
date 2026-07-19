const authBase = location.hostname.startsWith('developers-test.') ? 'https://auth-test.fortressofmuslim.org' : location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8788' : 'https://auth.fortressofmuslim.org';
const apiBase = authBase.includes('auth-test.') ? 'https://api-test.fortressofmuslim.org/v1' : 'https://api.fortressofmuslim.org/v1';
const state = { user: null, keys: [], apps: [], devices: [], mcp: [], queries: [], standardTools: [] };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

$$('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
  $$('[data-auth-tab]').forEach((item) => item.classList.toggle('active', item === tab));
  $$('[data-auth-panel]').forEach((panel) => { panel.hidden = panel.dataset.authPanel !== tab.dataset.authTab; });
  $('#auth-message').textContent = '';
}));

$('#sign-in-form').addEventListener('submit', (event) => submitAuth(event, '/api/auth/sign-in/email'));
$('#register-form').addEventListener('submit', (event) => submitAuth(event, '/api/auth/sign-up/email'));
$('[data-sign-out]').addEventListener('click', signOut);

async function submitAuth(event, path) {
  event.preventDefault();
  const form = event.currentTarget;
  $('#auth-message').textContent = 'Working...';
  try {
    const body = Object.fromEntries(new FormData(form));
    if (path.includes('sign-up')) {
      if (body.password !== body.passwordConfirm) throw new Error('Passwords do not match.');
      delete body.passwordConfirm;
    }
    await authJson(path, { method: 'POST', body });
    form.reset();
    await refreshSession();
  } catch (error) { $('#auth-message').textContent = error.message; }
}

async function signOut() {
  await authFetch('/api/auth/sign-out', { method: 'POST' });
  state.user = null;
  closeProfile();
  await refreshSession();
}

$$('[data-console-nav], .quick-actions a, .profile-dropdown a[href^="#"]').forEach((link) => link.addEventListener('click', () => setView(link.hash.slice(1))));
window.addEventListener('hashchange', () => setView(location.hash.slice(1) || 'overview'));
function setView(id) {
  if (!$(`#${CSS.escape(id)}`)?.matches('[data-console-view]')) id = 'overview';
  $$('[data-console-view]').forEach((view) => view.classList.toggle('active', view.id === id));
  $$('[data-console-nav]').forEach((link) => link.classList.toggle('active', link.hash === `#${id}`));
  $('#signed-in').classList.remove('nav-open');
}

$('[data-console-menu]').addEventListener('click', () => $('#signed-in').classList.add('nav-open'));
$('[data-console-close]').addEventListener('click', () => $('#signed-in').classList.remove('nav-open'));

$('[data-profile-toggle]').addEventListener('click', () => {
  const menu = $('[data-profile-menu]'); menu.hidden = !menu.hidden;
  $('[data-profile-toggle]').setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', (event) => { if (!event.target.closest('.profile-menu')) closeProfile(); });
function closeProfile() { $('[data-profile-menu]').hidden = true; $('[data-profile-toggle]').setAttribute('aria-expanded', 'false'); }

$$('[data-drawer-open]').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.drawerOpen)));
$$('[data-drawer-close]').forEach((button) => button.addEventListener('click', closeDrawers));
$('[data-drawer-backdrop]').addEventListener('click', closeDrawers);
function openDrawer(id) { $(`#${id}`).hidden = false; $('[data-drawer-backdrop]').hidden = false; }
function closeDrawers() { $$('.drawer').forEach((drawer) => { drawer.hidden = true; }); $('[data-drawer-backdrop]').hidden = true; }

$('#api-key-form [name="duration"]').addEventListener('change', (event) => { $('[data-custom-expiry]').hidden = event.target.value !== 'custom'; });
$('#oauth-form [name="client_type"]').addEventListener('change', updateOAuthForm);
$('#device-form [name="authMethod"]').addEventListener('change', (event) => { $('[data-device-jwks]').hidden = event.target.value !== 'private_key_jwt'; });
$('#tool-form [name="toolType"]').addEventListener('change', updateToolForm);
$('[data-add-callback]').addEventListener('click', () => {
  $('#callback-list').insertAdjacentHTML('beforeend', '<div class="callback-row"><input name="redirect_uri" type="url" placeholder="https://app.example/callback"><button type="button" class="icon-button" data-remove-callback aria-label="Remove callback"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button></div>');
});
$('#callback-list').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove-callback]');
  if (remove && $$('.callback-row', $('#callback-list')).length > 1) remove.closest('.callback-row').remove();
});

function updateOAuthForm() {
  const type = $('#oauth-form [name="client_type"]').value; const privateJwt = type === 'private_key_jwt'; const interactive = type === 'public' || type === 'confidential';
  $('[data-jwks]').hidden = !privateJwt;
  $('[data-callbacks]').hidden = !interactive;
  $$('#callback-list input').forEach((input, index) => { input.required = interactive && index === 0; });
  $('#oauth-form [name="jwks_uri"]').required = privateJwt;
}
function updateToolForm() { const type=$('#tool-form [name="toolType"]').value; $('[data-standard-tool]').hidden=type!=='standard'; $('[data-query-tool]').hidden=type!=='named_query'; $('[data-external-tool]').hidden=type!=='external_api'; }
$('[data-add-filter]').addEventListener('click',addQueryFilter);
$('#query-filters').addEventListener('click',(event)=>{const button=event.target.closest('[data-remove-filter]');if(button)button.closest('.query-filter-row').remove();});
function addQueryFilter(){ $('#query-filters').insertAdjacentHTML('beforeend',`<div class="query-filter-row"><select data-filter-field><option value="title">Title</option><option value="verificationStatus">Verification</option><option value="sequence">Sequence</option><option value="id">ID</option><option value="legacyId">Legacy ID</option></select><select data-filter-operator><option value="eq">Equals</option><option value="contains">Contains</option><option value="starts_with">Starts with</option><option value="neq">Not equal</option><option value="gte">At least</option><option value="lte">At most</option><option value="in">In list</option></select><select data-filter-source><option value="literal">Fixed value</option><option value="parameter">Endpoint parameter</option></select><input data-filter-value placeholder="Value or parameter name" required><button type="button" class="icon-button" data-remove-filter aria-label="Remove filter">ÃƒÆ’Ã¢â‚¬â€</button></div>`); }
function readQueryFilters(){return $$('.query-filter-row').map(row=>({field:$('[data-filter-field]',row).value,operator:$('[data-filter-operator]',row).value,source:$('[data-filter-source]',row).value,value:$('[data-filter-value]',row).value.trim()})).filter(filter=>filter.value);}

$('#api-key-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); let expiresIn;
  if (form.get('duration') === 'custom') {
    expiresIn = Math.floor((new Date(`${form.get('expires_on')}T23:59:59`).getTime() - Date.now()) / 1000);
    if (!Number.isFinite(expiresIn) || expiresIn < 3600) return notify('Choose a future expiration date.', true);
  } else if (form.get('duration') !== 'never') expiresIn = Number(form.get('duration'));
  await action(async () => {
    const body = { name: form.get('name') }; if (expiresIn) body.expiresIn = expiresIn;
    const key = await authJson('/api/auth/api-key/create', { method: 'POST', body });
    rememberBrowserKey(key, form.get('remember') === 'on'); reveal('#api-key-reveal', 'Copy this API key now', key.key, form.get('remember') === 'on' ? 'Saved only in this browser for API Explorer.' : 'The full value is shown only once.');
    formElement.reset(); closeDrawers(); await loadKeys();
  }, 'API key generated.');
});

$('#api-key-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-key]'); if (!button) return;
  await action(async () => { await authJson('/api/auth/api-key/delete', { method: 'POST', body: { keyId: button.dataset.revokeKey } }); forgetBrowserKey(button.dataset.revokeKey); await loadKeys(); }, 'API key revoked.');
});

$('#oauth-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const type = form.get('client_type');
  const redirects = form.getAll('redirect_uri').map(String).map((value) => value.trim()).filter(Boolean);
  const scopes = form.getAll('scope').map(String); const isPublic = type === 'public'; const isPrivateJwt = type === 'private_key_jwt';
  await action(async () => {
    const interactive = isPublic || type === 'confidential';
    const body = { client_name: form.get('client_name'), redirect_uris: interactive ? redirects : ['https://localhost.invalid/fortress-machine-client'], token_endpoint_auth_method: isPublic ? 'none' : isPrivateJwt ? 'private_key_jwt' : 'client_secret_basic', grant_types: interactive ? ['authorization_code','refresh_token'] : ['client_credentials'], response_types: interactive ? ['code'] : [], scope: [...(interactive ? ['openid','profile','offline_access'] : []),...scopes].join(' '), resources: scopes.some((scope)=>scope.startsWith('mcp:')) ? [apiBase.replace('/v1',''),apiBase.replace('api','mcp').replace('/v1','')] : [apiBase.replace('/v1','')] };
    if (isPrivateJwt) body.jwks_uri = form.get('jwks_uri');
    const app = await authJson('/api/auth/oauth2/create-client', { method: 'POST', body });
    reveal('#oauth-reveal', 'Connected app created', `Client ID: ${app.client_id}${app.client_secret ? `\nClient secret: ${app.client_secret}` : ''}`, app.client_secret ? 'Copy the client secret now. It will not be shown again.' : 'Public clients use PKCE and have no client secret.');
    formElement.reset(); resetCallbacks(); updateOAuthForm(); closeDrawers(); await loadApps();
  }, 'Connected app created.');
});

$('#oauth-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-app]'); if (!button) return;
  await action(async () => { await authJson('/api/auth/oauth2/delete-client', { method: 'POST', body: { client_id: button.dataset.deleteApp } }); await loadApps(); }, 'Connected app deleted.');
});

$('#device-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form));
  await action(async () => { await authJson('/v1/control/devices', { method: 'POST', body }); form.reset(); closeDrawers(); await loadDevices(); }, 'Device registered.');
});
$('#device-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-device]'); if (!button) return;
  await action(async () => { await authJson(`/v1/control/devices/${encodeURIComponent(button.dataset.revokeDevice)}/revoke`, { method: 'POST' }); await loadDevices(); }, 'Device access revoked.');
});

$('#mcp-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form));
  await action(async () => { await authJson('/v1/control/mcp/toolsets', { method: 'POST', body }); form.reset(); closeDrawers(); await loadMcp(); }, 'Toolset created.');
});

$('#mcp-list').addEventListener('click', (event) => { const button=event.target.closest('[data-add-tool]'); if(!button)return; $('#tool-form [name="toolsetId"]').value=button.dataset.addTool; openDrawer('tool-drawer'); });
$('#tool-form').addEventListener('submit', async (event) => { event.preventDefault(); const form=event.currentTarget; const body=Object.fromEntries(new FormData(form)); const toolsetId=body.toolsetId; delete body.toolsetId; await action(async()=>{await authJson(`/v1/control/mcp/toolsets/${encodeURIComponent(toolsetId)}/tools`,{method:'POST',body});form.reset();updateToolForm();closeDrawers();await loadMcp();},'Tool added to toolset.'); });

$('#query-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const body = { name:data.get('name'),slug:data.get('slug'),description:data.get('description'),selectedFields:data.getAll('selectedField'),filters:readQueryFilters(),sort:{field:data.get('sortField'),direction:data.get('sortDirection')},maxRows:Number(data.get('maxRows')) };
  await action(async () => { await authJson('/v1/control/named-queries', { method: 'POST', body }); form.reset(); $('#query-filters').innerHTML=''; addQueryFilter(); closeDrawers(); await loadQueries(); }, 'Named query endpoint created.');
});
$('#query-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-test-query]'); if (!button) return;
  sessionStorage.setItem('fortress-explorer-path', `/queries/${button.dataset.testQuery}`); location.href = '/#explorer';
});

async function refreshSession() {
  try { const session = await authJson('/api/auth/get-session'); state.user = session?.user || null; } catch { state.user = null; }
  $('#signed-out').hidden = Boolean(state.user); $('#signed-in').hidden = !state.user;
  $('[data-console-menu]').hidden = !state.user;
  if (!state.user) return;
  const initials = getInitials(state.user.name || state.user.email);
  $('[data-profile-placeholder]')?.remove();
  $$('[data-profile-initials], [data-sidebar-initials]').forEach((node) => { node.textContent = initials; });
  $('[data-profile-name]').textContent = state.user.name || 'Developer'; $('[data-profile-email]').textContent = state.user.email;
  $('[data-sidebar-name]').textContent = state.user.name || 'Developer'; setView(location.hash.slice(1) || 'overview');
  await Promise.all([loadKeys(), loadApps(), loadDevices(), loadMcp(), loadQueries()]);
  if (sessionStorage.getItem('fortress-device-code')) location.href = '/device.html';
}

async function loadKeys() {
  const result = await authJson('/api/auth/api-key/list'); state.keys = Array.isArray(result) ? result : result.apiKeys || [];
  $('#metric-keys').textContent = state.keys.length;
  render('#api-key-list', state.keys, (key) => `<div class="resource-row"><span class="row-title"><strong>${esc(key.name || 'Unnamed key')}</strong><small>${formatDate(key.createdAt)}</small></span><code>${esc(key.start || key.prefix || 'fom_')}...</code><span>${key.expiresAt ? formatDate(key.expiresAt) : 'Never'}</span><span class="status">Active</span><button class="button compact" data-revoke-key="${esc(key.id)}">Revoke</button></div>`);
}
async function loadApps() {
  const result = await authJson('/api/auth/oauth2/get-clients'); state.apps = Array.isArray(result) ? result : result?.clients || [];
  $('#metric-apps').textContent = state.apps.length; updateAppSelects();
  render('#oauth-list', state.apps, (app) => { const id = app.client_id || app.clientId; const redirects = app.redirect_uris || app.redirectUris || []; const method = app.token_endpoint_auth_method || app.tokenEndpointAuthMethod || (app.public ? 'none' : 'client secret'); return `<div class="resource-row apps-grid"><span class="row-title"><strong>${esc(app.client_name || app.name || 'Connected app')}</strong><small>${formatDate(app.created_at || app.createdAt)}</small></span><code>${esc(id)}</code><span>${esc(methodLabel(method))}</span><span title="${esc(arrayValue(redirects).join('\n'))}">${esc(displayRedirect(redirects))}</span><button class="button compact" data-delete-app="${esc(id)}">Delete</button></div>`; });
}
async function loadDevices() {
  const result = await authJson('/v1/control/devices'); state.devices = result.data || []; $('#metric-devices').textContent = state.devices.length;
  render('#device-list', state.devices, (device) => `<div class="resource-row devices-grid"><span class="row-title"><strong>${esc(device.name)}</strong><small>${formatDate(device.createdAt)}</small></span><span>${esc(device.deviceType)}</span><span>${esc(methodLabel(device.authMethod))}</span><code>${esc(device.oauthClientId)}</code>${device.status === 'active' ? `<button class="button compact" data-revoke-device="${esc(device.id)}">Revoke</button>` : '<span class="status revoked">Revoked</span>'}</div>`);
}
async function loadMcp() {
  const [result,catalog] = await Promise.all([authJson('/v1/control/mcp/toolsets'),authJson('/v1/control/mcp/catalog')]); state.mcp = result.data || []; state.standardTools=catalog.data||[]; $('#metric-mcp').textContent = state.mcp.length; updateStandardToolSelect();
  render('#mcp-list', state.mcp, (toolset) => `<section class="toolset-row"><header><span class="row-title"><strong>${esc(toolset.name)}</strong><small>${esc(toolset.description)}</small></span><button class="button compact" data-add-tool="${esc(toolset.id)}">Add tool</button></header><code>https://mcp-test.fortressofmuslim.org/mcp?toolset=${esc(toolset.slug)}</code><div class="tool-chips">${toolset.tools.length?toolset.tools.map(tool=>`<span class="status">${esc(tool.name)} Ãƒâ€šÃ‚Â· ${esc(tool.toolType)}${tool.approvalStatus!=='approved'?` Ãƒâ€šÃ‚Â· ${esc(tool.approvalStatus)}`:''}</span>`).join(''):'<small>No tools added.</small>'}</div></section>`);
}
async function loadQueries() {
  const result = await authJson('/v1/control/named-queries'); state.queries = result.data || []; updateQuerySelect();
  render('#query-list', state.queries, (query) => `<div class="resource-row query-grid"><span class="row-title"><strong>${esc(query.name)}</strong><small>${esc(query.description)}</small></span><span>${query.selectedFields?.length||0} fields Ãƒâ€šÃ‚Â· ${query.filters?.length||0} filters</span><code>/queries/${esc(query.slug)}</code><span class="status">${esc(query.status)}</span><button class="button compact" data-test-query="${esc(query.slug)}">Test</button></div>`);
}

function updateAppSelects() { $$('[data-oauth-client-select]').forEach((select) => { select.innerHTML = state.apps.length ? state.apps.map((app) => `<option value="${esc(app.client_id || app.clientId)}">${esc(app.client_name || app.name || app.client_id)}</option>`).join('') : '<option value="">Create a connected app first</option>'; }); }
function updateQuerySelect() { $$('[data-named-query-select]').forEach((select) => { select.innerHTML = state.queries.length ? state.queries.map((query) => `<option value="${esc(query.id)}">${esc(query.name)}</option>`).join('') : '<option value="">Create a named query first</option>'; }); }
function updateStandardToolSelect(){ $$('[data-standard-tool-select]').forEach(select=>{select.innerHTML=state.standardTools.map(tool=>`<option value="${esc(tool.name)}">${esc(tool.name)} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${esc(tool.description)}</option>`).join('');}); }
function resetCallbacks() { $('#callback-list').innerHTML = '<div class="callback-row"><input name="redirect_uri" type="url" placeholder="https://app.example/callback"><button type="button" class="icon-button" data-remove-callback aria-label="Remove callback"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button></div>'; updateOAuthForm(); }
function rememberBrowserKey(key,remember) { if(!remember)return; const keys=readBrowserKeys().filter(item=>item.id!==key.id);keys.push({id:key.id,name:key.name||'API key',key:key.key});localStorage.setItem('fortress-browser-keys',JSON.stringify(keys));localStorage.setItem('fortress-explorer-key',key.key); }
function forgetBrowserKey(id) { localStorage.setItem('fortress-browser-keys',JSON.stringify(readBrowserKeys().filter(item=>item.id!==id))); }
function readBrowserKeys() { try{return JSON.parse(localStorage.getItem('fortress-browser-keys')||'[]');}catch{return [];} }
function reveal(selector, title, secret, note) { const target = $(selector); target.innerHTML = `<strong>${esc(title)}</strong><button class="button compact" type="button" data-copy-secret>Copy</button><code>${esc(secret)}</code><small>${esc(note)}</small>`; target.hidden = false; $('[data-copy-secret]', target).addEventListener('click', async (event) => { await navigator.clipboard.writeText(secret); event.currentTarget.textContent = 'Copied'; }); }
function render(selector, items, renderer) { $(selector).innerHTML = items.length ? items.map(renderer).join('') : '<p class="empty-row">Nothing created yet.</p>'; }
async function action(work, success) { try { await work(); notify(success); } catch (error) { notify(error.message, true); } }
function notify(message, error = false) { const node = $('#console-message'); node.textContent = message; node.style.borderLeftColor = error ? 'var(--bad)' : 'var(--brand)'; node.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { node.hidden = true; }, 5000); }
async function authJson(path, options = {}) { const response = await authFetch(path, options); const data = response.status === 204 ? null : await response.json(); if (!response.ok) throw new Error(data?.message || data?.error_description || data?.error?.message || `Request failed (${response.status}).`); return data; }
function authFetch(path, options = {}) { const headers = new Headers(options.headers || {}); let body = options.body; if (body && !(body instanceof FormData) && typeof body !== 'string') { headers.set('Content-Type','application/json'); body = JSON.stringify(body); } return fetch(`${authBase}${path}`, { ...options, headers, body, credentials: 'include' }); }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]); }
function getInitials(value) { return String(value).split(/\s+/).map((part) => part[0]).join('').slice(0,2).toUpperCase(); }
function formatDate(value) { if (!value) return 'Unknown'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(); }
function methodLabel(value) { return String(value || '').replaceAll('_',' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function displayRedirect(value) { const first=arrayValue(value)[0]; return first?.includes('localhost.invalid/fortress-machine-client') ? 'Not required' : first || 'None'; }
function arrayValue(value) { if (Array.isArray(value)) return value; try { return JSON.parse(value || '[]'); } catch { return []; } }

addQueryFilter(); updateOAuthForm(); updateToolForm(); refreshSession();
