const authBase = location.hostname.startsWith('developers-test.') ? 'https://auth-test.fortressofmuslim.org' : location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8788' : 'https://auth.fortressofmuslim.org';
const apiBase = authBase.includes('auth-test.') ? 'https://api-test.fortressofmuslim.org/v1' : 'https://api.fortressofmuslim.org/v1';
const mcpBase = authBase.includes('auth-test.') ? 'https://mcp-test.fortressofmuslim.org/mcp' : 'https://mcp.fortressofmuslim.org/mcp';
const state = { user: null, keys: [], apps: [], devices: [], mcp: [], queries: [], standardTools: [], passkeys: [], usage: null, webhooks: [] };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
if ($('#mcp-endpoint')) $('#mcp-endpoint').textContent = mcpBase;
const REQUEST_TIMEOUT_MS = 12_000;
// WebAuthn ceremonies wait on a human (touch a sensor, approve on a phone, scan a cross-device QR
// code) and legitimately take much longer than a network request -- 12s would abort real, slow,
// successful flows. This is still bounded, unlike leaving it unset: without a signal, a stalled
// browser/OS passkey prompt leaves the await pending forever with the button stuck disabled and no
// feedback, which is indistinguishable from "the click didn't register."
const PASSKEY_CEREMONY_TIMEOUT_MS = 60_000;
let drawerReturnFocus = null;

$$('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
  $$('[data-auth-tab]').forEach((item) => item.classList.toggle('active', item === tab));
  $$('[data-auth-tab]').forEach((item) => item.setAttribute('aria-selected', String(item === tab)));
  $$('[data-auth-panel]').forEach((panel) => { panel.hidden = panel.dataset.authPanel !== tab.dataset.authTab; });
  $('#auth-message').textContent = '';
  $(`[data-auth-panel="${tab.dataset.authTab}"] input`)?.focus();
}));

$('#sign-in-form').addEventListener('submit', (event) => submitAuth(event, '/api/auth/sign-in/email'));
$('#register-form').addEventListener('submit', (event) => submitAuth(event, '/api/auth/sign-up/email'));
$('[data-sign-out]').addEventListener('click', signOut);

async function submitAuth(event, path) {
  event.preventDefault();
  const form = event.currentTarget;
  $('#auth-message').textContent = 'Working...';
  $('#auth-message').setAttribute('role', 'status');
  setFormBusy(form, true);
  try {
    const body = Object.fromEntries(new FormData(form));
    if (path.includes('sign-up')) {
      if (body.password !== body.passwordConfirm) throw new Error('Passwords do not match.');
      delete body.passwordConfirm;
    }
    const result = await authJson(path, { method: 'POST', body });
    if (result?.twoFactorRedirect) {
      $$('[data-auth-panel]').forEach((panel) => { panel.hidden = true; });
      $('#two-factor-form').hidden = false;
      $('#two-factor-form input[name="code"]').focus();
      $('#auth-message').textContent = '';
      return;
    }
    form.reset();
    await refreshSession();
  } catch (error) {
    $('#auth-message').setAttribute('role', 'alert');
    $('#auth-message').textContent = error.message;
  } finally { setFormBusy(form, false); }
}

$('#two-factor-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setFormBusy(form, true);
  try {
    const values = new FormData(form);
    await authJson('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: { code: values.get('code'), trustDevice: values.get('trustDevice') === 'on' },
    });
    form.reset();
    form.hidden = true;
    await refreshSession();
  } catch (error) {
    $('#auth-message').setAttribute('role', 'alert');
    $('#auth-message').textContent = error.message;
  } finally { setFormBusy(form, false); }
});
$('[data-cancel-two-factor]').addEventListener('click', resetAuthPanels);
$('[data-passkey-sign-in]').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  try {
    if (!window.PublicKeyCredential) throw new Error('This browser does not support passkeys.');
    const options = await authJson('/api/auth/passkey/generate-authenticate-options');
    const credential = await navigator.credentials.get({
      publicKey: decodeRequestOptions(options),
      signal: AbortSignal.timeout(PASSKEY_CEREMONY_TIMEOUT_MS),
    });
    if (!credential) throw new Error('Passkey sign-in was cancelled.');
    await authJson('/api/auth/passkey/verify-authentication', {
      method: 'POST',
      body: { response: serializeCredential(credential) },
    });
    await refreshSession();
  } catch (error) {
    $('#auth-message').setAttribute('role', 'alert');
    $('#auth-message').textContent = friendlyCredentialError(error);
  } finally { event.currentTarget.disabled = false; }
});

async function signOut() {
  const button = $('[data-sign-out]'); button.disabled = true;
  try {
    await authJson('/api/auth/sign-out', { method: 'POST', body: {} });
    closeProfile();
    closeDrawers();
    clearAuthenticatedState();
    setSessionView(false);
    history.replaceState(null, '', location.pathname);
    $('#sign-in-form input[name="email"]')?.focus();
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
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
  if (!menu.hidden) $('[role="menuitem"]', menu)?.focus();
});
document.addEventListener('click', (event) => { if (!event.target.closest('.profile-menu')) closeProfile(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('[data-profile-menu]').hidden) { closeProfile(true); return; }
    if ($$('.drawer').some((drawer) => !drawer.hidden)) closeDrawers();
  }
  const menu = event.target.closest?.('[role="menu"]');
  if (menu && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const items = $$('[role="menuitem"]', menu);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    items[(items.indexOf(document.activeElement) + offset + items.length) % items.length]?.focus();
  }
  const drawer = event.target.closest?.('.drawer');
  if (drawer && event.key === 'Tab') trapFocus(event, drawer);
});
function closeProfile(returnFocus = false) { $('[data-profile-menu]').hidden = true; $('[data-profile-toggle]').setAttribute('aria-expanded', 'false'); if (returnFocus) $('[data-profile-toggle]').focus(); }

$$('[data-drawer-open]').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.drawerOpen)));
$$('[data-drawer-close]').forEach((button) => button.addEventListener('click', closeDrawers));
$('[data-drawer-backdrop]').addEventListener('click', closeDrawers);
$$('.drawer').forEach((drawer) => { drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-label', $('h2', drawer)?.textContent || 'Developer Console form'); });
function openDrawer(id) { drawerReturnFocus = document.activeElement; const drawer = $(`#${id}`); drawer.hidden = false; $('[data-drawer-backdrop]').hidden = false; document.body.classList.add('drawer-open'); requestAnimationFrame(() => firstFocusable(drawer)?.focus()); }
function closeDrawers() { const hadOpenDrawer = $$('.drawer').some((drawer) => !drawer.hidden); $$('.drawer').forEach((drawer) => { drawer.hidden = true; }); $('[data-drawer-backdrop]').hidden = true; document.body.classList.remove('drawer-open'); if (hadOpenDrawer && drawerReturnFocus?.focus) drawerReturnFocus.focus(); drawerReturnFocus = null; }

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
// Kept in sync by hand with apps/auth/src/index.ts's RECORD_QUERY_FIELDS -- these are the fields
// each content type actually supports server-side.
const QUERY_FIELD_OPTIONS = {
  duas: [['title','Title'],['verificationStatus','Verification'],['sequence','Sequence'],['id','ID'],['legacyId','Legacy ID']],
  hadith: [['title','Title'],['verificationStatus','Verification'],['sequence','Sequence'],['id','ID'],['legacyId','Legacy ID'],['narrator','Narrator'],['grade','Grade'],['gradingAuthority','Grading authority'],['displayNumber','Display number'],['collection','Collection'],['bookNumber','Book number'],['chapterNumber','Chapter number']],
};
function currentQueryObjectType(){ return $('#query-form [data-object-type]').value === 'hadith' ? 'hadith' : 'duas'; }
function fieldOptionsHtml(){ return QUERY_FIELD_OPTIONS[currentQueryObjectType()].map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join(''); }
$('#query-form [data-object-type]').addEventListener('change', updateQueryObjectType);
function updateQueryObjectType(){
  const isHadith = currentQueryObjectType() === 'hadith';
  $$('[data-hadith-field]', $('#query-form')).forEach((label) => {
    label.hidden = !isHadith;
    if (!isHadith) $('input', label).checked = false;
  });
  $$('.query-filter-row [data-filter-field]').forEach((select) => {
    const current = select.value;
    select.innerHTML = fieldOptionsHtml();
    if (QUERY_FIELD_OPTIONS[currentQueryObjectType()].some(([value]) => value === current)) select.value = current;
  });
  const sortField = $('[data-sort-field]', $('#query-form'));
  const currentSort = sortField.value;
  sortField.innerHTML = fieldOptionsHtml();
  if (QUERY_FIELD_OPTIONS[currentQueryObjectType()].some(([value]) => value === currentSort)) sortField.value = currentSort;
}
$('[data-add-filter]').addEventListener('click',()=>{addQueryFilter();updateQueryPreview();});
$('#query-filters').addEventListener('click',(event)=>{const button=event.target.closest('[data-remove-filter]');if(button){button.closest('.query-filter-row').remove();updateQueryPreview();}});
$('#query-filters').addEventListener('change',(event)=>{const select=event.target.closest('[data-filter-source]');if(select)applyFilterRowConstraints(select.closest('.query-filter-row'));});
$('#query-filters').addEventListener('input',updateQueryPreview);
function addQueryFilter(){ $('#query-filters').insertAdjacentHTML('beforeend',`<div class="query-filter-row"><select data-filter-field aria-label="Filter field">${fieldOptionsHtml()}</select><select data-filter-operator aria-label="Filter operator"><option value="eq">Equals</option><option value="contains">Contains</option><option value="starts_with">Starts with</option><option value="neq">Not equal</option><option value="gte">At least</option><option value="lte">At most</option><option value="in">In list</option></select><select data-filter-source aria-label="Filter value type"><option value="literal">Fixed value</option><option value="parameter">Endpoint parameter</option></select><input data-filter-value aria-label="Filter value or parameter name" placeholder="Value or parameter name" required><button type="button" class="icon-button" data-remove-filter aria-label="Remove filter"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button></div>`); applyFilterRowConstraints($('#query-filters').lastElementChild); }
function readQueryFilters(){return $$('.query-filter-row').map(row=>({field:$('[data-filter-field]',row).value,operator:$('[data-filter-operator]',row).value,source:$('[data-filter-source]',row).value,value:$('[data-filter-value]',row).value.trim()})).filter(filter=>filter.value);}
// The server (parseRecordQuery in apps/auth) rejects a parameter-sourced filter whose value isn't
// [a-z][a-zA-Z0-9_]{0,39} -- mirrored here via the input's own pattern so the browser's native
// validation bubble catches it before the round-trip, instead of only after a failed submit.
function applyFilterRowConstraints(row){
  if(!row)return;
  const source=$('[data-filter-source]',row).value;
  const valueInput=$('[data-filter-value]',row);
  if(source==='parameter'){ valueInput.pattern='[a-z][a-zA-Z0-9_]{0,39}'; valueInput.title='Parameter names start with a lowercase letter and contain only letters, numbers, and underscores.'; valueInput.placeholder='parameterName'; }
  else { valueInput.removeAttribute('pattern'); valueInput.removeAttribute('title'); valueInput.placeholder='Value or parameter name'; }
}
function updateQueryPreview(){
  const form=$('#query-form'); const preview=$('[data-preview="query-form"]');
  const slug=form.slug.value.trim().toLowerCase();
  if(!slug){preview.hidden=true;return;}
  const fieldCount=$$('input[name="selectedField"]:checked',form).length;
  const filterCount=$$('.query-filter-row',form).length;
  const maxRows=Number(form.maxRows.value)||50;
  preview.hidden=false;
  preview.innerHTML=`Will be callable at <code>${esc(apiBase)}/queries/${esc(slug)}</code> &middot; ${fieldCount} field${fieldCount===1?'':'s'} &middot; ${filterCount} filter${filterCount===1?'':'s'} &middot; up to ${maxRows} row${maxRows===1?'':'s'}`;
}
function updateMcpPreview(){
  const form=$('#mcp-form'); const preview=$('[data-preview="mcp-form"]');
  const slug=form.slug.value.trim().toLowerCase();
  if(!slug){preview.hidden=true;return;}
  preview.hidden=false;
  preview.innerHTML=`MCP endpoint: <code>${esc(mcpBase)}?toolset=${esc(slug)}</code>`;
}
function updateToolPreview(){
  const form=$('#tool-form'); const preview=$('[data-preview="tool-form"]');
  const name=form.name.value.trim().toLowerCase();
  if(!name){preview.hidden=true;return;}
  preview.hidden=false;
  preview.innerHTML=`Agents will call this tool as <strong><code>${esc(name)}</code></strong>`;
}
$('#query-form').addEventListener('input',updateQueryPreview);
$('#mcp-form').addEventListener('input',updateMcpPreview);
$('#tool-form').addEventListener('input',updateToolPreview);

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
  }, 'API key generated.', formElement);
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
    revealCredentials('#oauth-reveal', 'Connected app created', [
      { label: 'Client ID', value: app.client_id },
      { label: 'Client secret', value: app.client_secret },
    ], app.client_secret ? 'Copy the client secret now. It will not be shown again.' : 'Public clients use PKCE and have no client secret.');
    formElement.reset(); resetCallbacks(); updateOAuthForm(); closeDrawers(); await loadApps();
  }, 'Connected app created.', formElement);
});

$('#oauth-list').addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-app-status]');
  if (toggle) {
    const status = toggle.dataset.appStatus;
    return action(async () => {
      await authJson(`/v1/control/oauth-clients/${encodeURIComponent(toggle.dataset.app)}/status`, { method: 'POST', body: { status } });
      await loadApps();
    }, `Connected app ${status}.`);
  }
  const button = event.target.closest('[data-delete-app]'); if (!button) return;
  await action(async () => { await authJson('/api/auth/oauth2/delete-client', { method: 'POST', body: { client_id: button.dataset.deleteApp } }); await loadApps(); }, 'Connected app deleted.');
});

$('#device-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form));
  await action(async () => { await authJson('/v1/control/devices', { method: 'POST', body }); form.reset(); closeDrawers(); await loadDevices(); }, 'Device registered.', form);
});
$('#device-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-device]'); if (!button) return;
  await action(async () => { await authJson(`/v1/control/devices/${encodeURIComponent(button.dataset.revokeDevice)}/revoke`, { method: 'POST' }); await loadDevices(); }, 'Device access revoked.');
});

$('#mcp-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const body = Object.fromEntries(new FormData(form));
  await action(async () => { await authJson('/v1/control/mcp/toolsets', { method: 'POST', body }); form.reset(); updateMcpPreview(); closeDrawers(); await loadMcp(); }, 'Toolset created.', form);
});

$('#mcp-list').addEventListener('click', async (event) => {
  const add = event.target.closest('[data-add-tool]');
  if (add) { $('#tool-form [name="toolsetId"]').value=add.dataset.addTool; openDrawer('tool-drawer'); return; }
  const toolset = event.target.closest('[data-toolset-status]');
  if (toolset) return action(async () => {
    await authJson(`/v1/control/mcp/toolsets/${encodeURIComponent(toolset.dataset.toolset)}/status`, { method: 'POST', body: { status: toolset.dataset.toolsetStatus } });
    await loadMcp();
  }, `Toolset ${toolset.dataset.toolsetStatus}.`);
  const tool = event.target.closest('[data-tool-status]');
  if (tool) return action(async () => {
    await authJson(`/v1/control/mcp/toolsets/${encodeURIComponent(tool.dataset.toolset)}/tools/${encodeURIComponent(tool.dataset.tool)}/status`, { method: 'POST', body: { status: tool.dataset.toolStatus } });
    await loadMcp();
  }, `Tool ${tool.dataset.toolStatus}.`);
});
$('#tool-form').addEventListener('submit', async (event) => { event.preventDefault(); const form=event.currentTarget; const body=Object.fromEntries(new FormData(form)); const toolsetId=body.toolsetId; delete body.toolsetId; await action(async()=>{await authJson(`/v1/control/mcp/toolsets/${encodeURIComponent(toolsetId)}/tools`,{method:'POST',body});form.reset();updateToolForm();updateToolPreview();closeDrawers();await loadMcp();},'Tool added to toolset.',form); });

$('#query-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const body = { name:data.get('name'),objectName:data.get('objectName'),slug:data.get('slug'),description:data.get('description'),selectedFields:data.getAll('selectedField'),filters:readQueryFilters(),sort:{field:data.get('sortField'),direction:data.get('sortDirection')},maxRows:Number(data.get('maxRows')) };
  await action(async () => { await authJson('/v1/control/named-queries', { method: 'POST', body }); form.reset(); $('#query-filters').innerHTML=''; updateQueryObjectType(); addQueryFilter(); updateQueryPreview(); closeDrawers(); await loadQueries(); }, 'Named query endpoint created.', form);
});
$('#query-list').addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-query-status]');
  if (toggle) return action(async () => {
    await authJson(`/v1/control/named-queries/${encodeURIComponent(toggle.dataset.query)}/status`, { method: 'POST', body: { status: toggle.dataset.queryStatus } });
    await loadQueries();
  }, `Named query ${toggle.dataset.queryStatus}.`);
  const button = event.target.closest('[data-test-query]'); if (!button) return;
  sessionStorage.setItem('fortress-explorer-path', `/queries/${button.dataset.testQuery}`); location.href = '/#explorer';
});

$('#webhook-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
  const body = { url: data.get('url'), eventTypes: data.getAll('eventTypes') };
  await action(async () => {
    const webhook = await authJson('/v1/control/webhooks', { method: 'POST', body });
    reveal('#webhook-reveal', 'Webhook created', webhook.secret, 'Copy this signing secret now -- it verifies the X-Fortress-Signature header on every delivery and is not shown again.');
    form.reset(); closeDrawers(); await loadWebhooks();
  }, 'Webhook created.', form);
});
$('#webhook-list').addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-webhook-status]');
  if (toggle) return action(async () => {
    await authJson(`/v1/control/webhooks/${encodeURIComponent(toggle.dataset.webhook)}/status`, { method: 'POST', body: { status: toggle.dataset.webhookStatus } });
    await loadWebhooks();
  }, `Webhook ${toggle.dataset.webhookStatus}.`);
  const deliveries = event.target.closest('[data-view-deliveries]'); if (!deliveries) return;
  openDrawer('webhook-deliveries-drawer');
  await loadWebhookDeliveries(deliveries.dataset.viewDeliveries);
});
$('#webhook-deliveries-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-redeliver]'); if (!button) return;
  await action(async () => {
    await authJson(`/v1/control/webhooks/deliveries/${encodeURIComponent(button.dataset.redeliver)}/redeliver`, { method: 'POST' });
    await loadWebhookDeliveries(button.dataset.subscription);
    await loadWebhooks();
  }, 'Redelivered.');
});
async function loadWebhookDeliveries(subscriptionId) {
  await withListState('#webhook-deliveries-list', async () => {
    const result = await authJson(`/v1/control/webhooks/${encodeURIComponent(subscriptionId)}/deliveries`);
    const deliveries = result.data || [];
    $('#webhook-deliveries-list').innerHTML = deliveries.length ? deliveries.map((delivery) => `<div class="delivery-row"><span class="delivery-meta"><strong>${esc(delivery.eventType)}</strong><small>${formatDateTime(delivery.attemptedAt)} on ${formatDate(delivery.attemptedAt)}${delivery.responseStatus ? ` &middot; HTTP ${delivery.responseStatus}` : ''}${delivery.responseSnippet ? ` &middot; ${esc(delivery.responseSnippet.slice(0, 80))}` : ''}</small></span><span class="status ${delivery.status === 'success' ? '' : 'revoked'}">${esc(delivery.status)}</span>${delivery.status === 'failed' ? `<button class="button compact" data-redeliver="${esc(delivery.id)}" data-subscription="${esc(subscriptionId)}">Redeliver</button>` : '<span></span>'}</div>`).join('') : '<p class="empty-row">No deliveries yet.</p>';
  });
}

async function refreshSession() {
  try { const session = await authJson('/api/auth/get-session'); state.user = session?.user || null; } catch { state.user = null; }
  setSessionView(Boolean(state.user));
  if (!state.user) return;
  const initials = getInitials(state.user.name || state.user.email);
  $('[data-profile-placeholder]')?.remove();
  $$('[data-profile-initials], [data-sidebar-initials]').forEach((node) => { node.textContent = initials; });
  $('[data-profile-name]').textContent = state.user.name || 'Developer'; $('[data-profile-email]').textContent = state.user.email;
  $('[data-sidebar-name]').textContent = state.user.name || 'Developer'; setView(location.hash.slice(1) || 'overview');
  const resources = await Promise.allSettled([loadKeys(), loadApps(), loadDevices(), loadMcp(), loadQueries(), loadWebhooks(), loadSecurity(), loadUsage(), loadPlanRequest()]);
  const failed = resources.filter((result) => result.status === 'rejected');
  if (failed.length) notify(`${failed.length} console section${failed.length === 1 ? '' : 's'} could not be loaded. Use the Retry button in each affected section.`, true);
  if (sessionStorage.getItem('fortress-device-code')) location.href = '/device.html';
}

$('#passkey-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await action(async () => {
    if (!window.PublicKeyCredential) throw new Error('This browser does not support passkeys.');
    const name = new FormData(form).get('name');
    const options = await authJson(`/api/auth/passkey/generate-register-options?name=${encodeURIComponent(name)}`);
    const credential = await navigator.credentials.create({
      publicKey: decodeCreationOptions(options),
      signal: AbortSignal.timeout(PASSKEY_CEREMONY_TIMEOUT_MS),
    });
    if (!credential) throw new Error('Passkey setup was cancelled.');
    await authJson('/api/auth/passkey/verify-registration', {
      method: 'POST',
      body: { name, response: serializeCredential(credential) },
    });
    form.reset();
    await loadSecurity();
  }, 'Passkey added.', form);
});
$('#passkey-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-passkey]');
  if (!button) return;
  await action(async () => {
    await authJson('/api/auth/passkey/delete-passkey', { method: 'POST', body: { id: button.dataset.deletePasskey } });
    await loadSecurity();
  }, 'Passkey removed.');
});
$('#totp-enable-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await action(async () => {
    const result = await authJson('/api/auth/two-factor/enable', {
      method: 'POST',
      body: { password: new FormData(form).get('password'), method: 'totp', issuer: 'Fortress Platform' },
    });
    renderTotpSetup(result.totpURI, result.backupCodes || []);
    $('#totp-setup').hidden = false;
    $('#totp-confirm-form').hidden = false;
    form.reset();
  }, 'Scan the QR code (or enter the setup key manually), then confirm a code.', form);
});

function renderTotpSetup(totpURI, backupCodes) {
  const secret = extractTotpSecret(totpURI) || totpURI;
  const target = $('#totp-setup');
  const codesGrid = backupCodes.map((code) => `<code>${esc(code)}</code>`).join('');
  target.innerHTML = `<strong>Authenticator setup</strong><div class="totp-qr"></div><p>Scan with your authenticator app, or enter this key manually if it can't scan.</p>${copyField('Setup key', secret)}<div class="recovery-codes"><div class="credential-field-header"><span class="credential-label">Recovery codes</span><button class="button compact" type="button" data-copy-value="Recovery codes">Copy all</button></div><p class="hint">Each code signs you in once if you lose access to your authenticator app. Save them somewhere safe -- they will not be shown again.</p><div class="recovery-codes-grid">${codesGrid}</div></div>`;
  renderQrCode($('.totp-qr', target), totpURI);
  const copyValues = { 'Setup key': secret, 'Recovery codes': backupCodes.join('\n') };
  target.querySelectorAll('[data-copy-value]').forEach((button) => {
    const value = copyValues[button.dataset.copyValue];
    if (value === undefined) return;
    button.addEventListener('click', async () => { await navigator.clipboard.writeText(value); button.textContent = button.textContent === 'Copy all' ? 'Copied all' : 'Copied'; setTimeout(() => { button.textContent = button.dataset.copyValue === 'Recovery codes' ? 'Copy all' : 'Copy'; }, 1500); });
  });
}

function extractTotpSecret(totpURI) {
  const match = String(totpURI).match(/[?&]secret=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function renderQrCode(container, text) {
  if (!container) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    // Standard QR quiet zone is 4 modules on every side -- without it, stricter scanners (Microsoft
    // Authenticator in particular) can fail to locate the finder patterns and refuse to scan at all,
    // even though the code itself decodes fine. A fixed CSS padding on the container doesn't scale
    // with the module count, so the margin has to be baked into the SVG's own coordinate system.
    const margin = 4;
    const size = count + margin * 2;
    const cells = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) cells.push(`<rect x="${col + margin}" y="${row + margin}" width="1" height="1"/>`);
      }
    }
    container.innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Authenticator app QR code"><rect class="qr-bg" width="${size}" height="${size}"/><g class="qr-modules">${cells.join('')}</g></svg>`;
  } catch {
    container.innerHTML = '<p class="empty-row">The QR code could not be generated. Use the setup key below.</p>';
  }
}
$('#totp-confirm-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await action(async () => {
    await authJson('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: { code: new FormData(form).get('code'), trustDevice: true },
    });
    form.reset();
    form.hidden = true;
    $('#totp-setup').hidden = true;
    await refreshSession();
  }, 'Two-factor authentication enabled.', form);
});

async function loadSecurity() {
  await withListState('#passkey-list', async () => {
    const result = await authJson('/api/auth/passkey/list-user-passkeys');
    state.passkeys = Array.isArray(result) ? result : [];
    $('#security-metrics').innerHTML = `<div><span>Two-factor</span><strong>${state.user?.twoFactorEnabled ? 'Enabled' : 'Not enabled'}</strong></div><div><span>Passkeys</span><strong>${state.passkeys.length}</strong></div>`;
    render('#passkey-list', state.passkeys, (passkeyItem) => `<div class="security-row"><span><strong>${esc(passkeyItem.name || 'Passkey')}</strong><small>${formatDate(passkeyItem.createdAt)} &middot; ${passkeyItem.backedUp ? 'Synced' : 'This authenticator'}</small></span><button class="button compact" data-delete-passkey="${esc(passkeyItem.id)}">Remove</button></div>`);
    $('#totp-enable-form').hidden = Boolean(state.user?.twoFactorEnabled);
  });
}

async function loadKeys() {
  await withListState('#api-key-list', async () => {
    const result = await authJson('/api/auth/api-key/list'); state.keys = Array.isArray(result) ? result : result.apiKeys || [];
    reconcileBrowserKeys(state.keys);
    $('#metric-keys').textContent = state.keys.length;
    render('#api-key-list', state.keys, (key) => `<div class="resource-row"><span class="row-title"><strong>${esc(key.name || 'Unnamed key')}</strong><small>${formatDate(key.createdAt)}</small></span><code>${esc(key.start || key.prefix || '••••••')}...</code><span>${key.expiresAt ? formatDate(key.expiresAt) : 'Never'}</span><span class="status">Active</span><button class="button compact" data-revoke-key="${esc(key.id)}">Revoke</button></div>`);
  });
}
async function loadApps() {
  await withListState('#oauth-list', async () => {
    const result = await authJson('/api/auth/oauth2/get-clients'); state.apps = Array.isArray(result) ? result : result?.clients || [];
    $('#metric-apps').textContent = state.apps.length; updateAppSelects();
    render('#oauth-list', state.apps, (app) => { const id = app.client_id || app.clientId; const redirects = app.redirect_uris || app.redirectUris || []; const method = app.token_endpoint_auth_method || app.tokenEndpointAuthMethod || (app.public ? 'none' : 'client secret'); const disabled = Number(app.disabled ?? 0) === 1; return `<div class="resource-row apps-grid"><span class="row-title"><strong>${esc(app.client_name || app.name || 'Connected app')}</strong><small>${disabled ? 'Disabled' : formatDate(app.created_at || app.createdAt)}</small></span><code>${esc(id)}</code><span>${esc(methodLabel(method))}</span><span class="callback-cell" title="${esc(arrayValue(redirects).join('\n'))}">${esc(displayRedirect(redirects))}</span><span class="row-actions"><button class="button compact" data-app-status="${disabled ? 'active' : 'disabled'}" data-app="${esc(id)}">${disabled ? 'Enable' : 'Disable'}</button><button class="button compact" data-delete-app="${esc(id)}">Delete</button></span></div>`; });
  });
}
async function loadDevices() {
  await withListState('#device-list', async () => {
    const result = await authJson('/v1/control/devices'); state.devices = result.data || []; $('#metric-devices').textContent = state.devices.length;
    render('#device-list', state.devices, (device) => `<div class="resource-row devices-grid"><span class="row-title"><strong>${esc(device.name)}</strong><small>${formatDate(device.createdAt)}</small></span><span>${esc(device.deviceType)}</span><span>${esc(methodLabel(device.authMethod))}</span><code>${esc(device.oauthClientId)}</code>${device.status === 'active' ? `<button class="button compact" data-revoke-device="${esc(device.id)}">Revoke</button>` : '<span class="status revoked">Revoked</span>'}</div>`);
  });
}
async function loadUsage() {
  await withListState('#usage-card', async () => {
    const result = await authJson('/v1/control/usage');
    state.usage = result.data || null;
    renderUsage();
  });
}
function renderUsage() {
  const usage = state.usage;
  const card = $('#usage-card');
  if (!card) return;
  if (!usage) { card.innerHTML = '<p class="empty-row">Usage is not available right now.</p>'; return; }
  $('#usage-plan').textContent = `${usage.planCode} plan`;
  const rows = [
    { label: 'Per minute', used: usage.usage.perMinute, limit: usage.limit.perMinute, resetAt: usage.windowResetAt.minute },
    { label: 'Per day', used: usage.usage.perDay, limit: usage.limit.perDay, resetAt: usage.windowResetAt.day },
  ];
  card.innerHTML = rows.map((row) => {
    const ratio = row.limit > 0 ? row.used / row.limit : 0;
    const fillClass = ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'warn' : '';
    const width = Math.min(100, Math.round(ratio * 100));
    return `<div class="usage-row"><div class="usage-row-head"><span>${esc(row.label)}</span><strong>${row.used.toLocaleString()} / ${row.limit.toLocaleString()}</strong></div><div class="usage-bar-track"><div class="usage-bar-fill ${fillClass}" style="width:${width}%"></div></div><small>Resets ${formatDateTime(row.resetAt)}</small></div>`;
  }).join('');
  renderPlanRequest();
}
async function loadPlanRequest() {
  const [plansResult, requestsResult] = await Promise.all([authJson('/v1/control/plans'), authJson('/v1/control/access-requests')]);
  state.plans = plansResult.data || [];
  state.planRequests = requestsResult.data || [];
  renderPlanRequest();
}
function renderPlanRequest() {
  const select = $('#plan-select');
  if (!select || !state.plans) return;
  const currentPlan = state.usage?.planCode;
  const pending = (state.planRequests || []).find((request) => request.status === 'pending');
  select.innerHTML = state.plans
    .filter((plan) => plan.planCode !== currentPlan)
    .map((plan) => `<option value="${esc(plan.planCode)}">${esc(plan.planCode)} (${plan.requestsPerDay.toLocaleString()}/day)</option>`)
    .join('');
  $('#plan-request-form').hidden = Boolean(pending) || select.options.length === 0;
  const history = (state.planRequests || []).slice(0, 3);
  $('#plan-request-status').innerHTML = pending
    ? `<p class="plan-request-pending">Requesting <strong>${esc(pending.requestedValue)}</strong> &middot; pending review.</p>`
    : history.length
      ? `<details class="plan-request-history"><summary>Past requests</summary>${history.map((request) => `<p><strong>${esc(request.requestedValue)}</strong> &middot; ${esc(request.status)}${request.reviewNotes ? ` (${esc(request.reviewNotes)})` : ''}</p>`).join('')}</details>`
      : '';
}
$('#plan-request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await action(async () => {
    const values = new FormData(form);
    const result = await authJson('/v1/control/access-requests', {
      method: 'POST',
      body: { requestType: 'plan_upgrade', requestedValue: values.get('requestedValue'), reason: values.get('reason') },
    });
    state.planRequests = [result.data, ...(state.planRequests || [])];
    form.reset();
    renderPlanRequest();
  }, 'Plan upgrade requested.', form);
});
async function loadMcp() {
  await withListState('#mcp-list', async () => {
    const [result,catalog] = await Promise.all([authJson('/v1/control/mcp/toolsets'),authJson('/v1/control/mcp/catalog')]); state.mcp = result.data || []; state.standardTools=catalog.data||[]; $('#metric-mcp').textContent = state.mcp.length; updateStandardToolSelect();
    render('#mcp-list', state.mcp, (toolset) => `<section class="toolset-row"><header><span class="row-title"><strong>${esc(toolset.name)}</strong><small>${esc(toolset.description)} &middot; ${esc(toolset.status)}</small></span><span class="row-actions"><button class="button compact" data-toolset-status="${toolset.status === 'active' ? 'disabled' : 'active'}" data-toolset="${esc(toolset.id)}">${toolset.status === 'active' ? 'Disable' : 'Enable'}</button><button class="button compact" data-add-tool="${esc(toolset.id)}" ${toolset.status !== 'active' ? 'disabled' : ''}>Add tool</button></span></header><code>${mcpBase}?toolset=${esc(toolset.slug)}</code><div class="tool-chips">${toolset.tools.length?toolset.tools.map(tool=>`<span class="status">${esc(tool.name)} &middot; ${esc(tool.toolType)}${tool.approvalStatus!=='approved'?` &middot; ${esc(tool.approvalStatus)}`:''}<button class="chip-action" data-tool-status="${Number(tool.enabled) === 1 ? 'disabled' : 'active'}" data-tool="${esc(tool.id)}" data-toolset="${esc(toolset.id)}">${Number(tool.enabled) === 1 ? 'Disable' : 'Enable'}</button></span>`).join(''):'<small>No tools added.</small>'}</div></section>`);
  });
}
async function loadWebhooks() {
  await withListState('#webhook-list', async () => {
    const result = await authJson('/v1/control/webhooks'); state.webhooks = result.data || [];
    render('#webhook-list', state.webhooks, (webhook) => {
      const disabled = webhook.status !== 'active';
      const last = webhook.lastDelivery;
      return `<div class="resource-row webhooks-grid"><span class="row-title"><code>${esc(webhook.url)}</code><small>${formatDate(webhook.createdAt)}</small></span><span>${webhook.eventTypes.map((type) => esc(type)).join(', ')}</span><span>${last ? `<span class="status ${last.status === 'success' ? '' : 'revoked'}">${esc(last.status)}</span> ${formatDateTime(last.attemptedAt)}` : 'Never'}</span><span class="status ${disabled ? 'disabled' : ''}">${disabled ? 'Disabled' : 'Active'}</span><span class="row-actions"><button class="button compact" data-view-deliveries="${esc(webhook.id)}">Deliveries</button><button class="button compact" data-webhook-status="${disabled ? 'active' : 'disabled'}" data-webhook="${esc(webhook.id)}">${disabled ? 'Enable' : 'Disable'}</button></span></div>`;
    });
  });
}
async function loadQueries() {
  await withListState('#query-list', async () => {
    const result = await authJson('/v1/control/named-queries'); state.queries = result.data || []; updateQuerySelect();
    render('#query-list', state.queries, (query) => `<div class="resource-row query-grid"><span class="row-title"><strong>${esc(query.name)}</strong><small>${esc(query.objectName === 'hadith' ? 'Hadith' : 'Duas')} &middot; ${esc(query.description)}</small></span><span>${query.selectedFields?.length||0} fields &middot; ${query.filters?.length||0} filters</span><code>/queries/${esc(query.slug)}</code><span class="status">${esc(query.status)}</span><span class="row-actions"><button class="button compact" data-query-status="${query.status === 'active' ? 'disabled' : 'active'}" data-query="${esc(query.id)}">${query.status === 'active' ? 'Disable' : 'Enable'}</button><button class="button compact" data-test-query="${esc(query.slug)}" ${query.status !== 'active' ? 'disabled' : ''}>Test</button></span></div>`);
  });
}

function updateAppSelects() { const activeApps=state.apps.filter((app)=>Number(app.disabled??0)!==1); $$('[data-oauth-client-select]').forEach((select) => { select.innerHTML = activeApps.length ? activeApps.map((app) => `<option value="${esc(app.client_id || app.clientId)}">${esc(app.client_name || app.name || app.client_id)}</option>`).join('') : '<option value="">Create or enable a connected app first</option>'; }); }
function updateQuerySelect() { const activeQueries=state.queries.filter((query)=>query.status==='active'); $$('[data-named-query-select]').forEach((select) => { select.innerHTML = activeQueries.length ? activeQueries.map((query) => `<option value="${esc(query.id)}">${esc(query.name)}</option>`).join('') : '<option value="">Create or enable a named query first</option>'; }); }
function updateStandardToolSelect(){ $$('[data-standard-tool-select]').forEach(select=>{select.innerHTML=state.standardTools.map(tool=>`<option value="${esc(tool.name)}">${esc(tool.name)} - ${esc(tool.description)}</option>`).join('');}); }
function resetCallbacks() { $('#callback-list').innerHTML = '<div class="callback-row"><input name="redirect_uri" type="url" placeholder="https://app.example/callback"><button type="button" class="icon-button" data-remove-callback aria-label="Remove callback"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button></div>'; updateOAuthForm(); }
function rememberBrowserKey(key,remember) { if(!remember)return; const keys=readBrowserKeys().filter(item=>item.id!==key.id);keys.push({id:key.id,name:key.name||'API key',key:key.key});localStorage.setItem('fortress-browser-keys',JSON.stringify(keys));localStorage.setItem('fortress-explorer-key',key.key); }
function forgetBrowserKey(id) { localStorage.setItem('fortress-browser-keys',JSON.stringify(readBrowserKeys().filter(item=>item.id!==id))); }
function readBrowserKeys() { try{return JSON.parse(localStorage.getItem('fortress-browser-keys')||'[]');}catch{return [];} }
function reconcileBrowserKeys(serverKeys) {
  const now = Date.now();
  const activeIds = new Set(serverKeys.filter((key) => {
    const enabled = key.enabled !== false && Number(key.enabled ?? 1) === 1;
    const expiresAt = key.expiresAt ? new Date(key.expiresAt).getTime() : Number.POSITIVE_INFINITY;
    return enabled && (!Number.isFinite(expiresAt) || expiresAt > now);
  }).map((key) => key.id));
  const remembered = readBrowserKeys().filter((key) => activeIds.has(key.id));
  localStorage.setItem('fortress-browser-keys', JSON.stringify(remembered));
  const explorerKey = localStorage.getItem('fortress-explorer-key');
  if (explorerKey && !remembered.some((key) => key.key === explorerKey)) localStorage.removeItem('fortress-explorer-key');
}
function reveal(selector, title, secret, note) { const target = $(selector); target.innerHTML = `<strong>${esc(title)}</strong><button class="button compact" type="button" data-copy-secret>Copy</button><code>${esc(secret)}</code><small>${esc(note)}</small>`; target.hidden = false; $('[data-copy-secret]', target).addEventListener('click', async (event) => { await navigator.clipboard.writeText(secret); event.currentTarget.textContent = 'Copied'; }); }
function copyField(label, value) { return `<div class="credential-field"><span class="credential-label">${esc(label)}</span><code>${esc(value)}</code><button class="button compact" type="button" data-copy-value="${esc(label)}">Copy</button></div>`; }
function revealCredentials(selector, title, fields, note) {
  const target = $(selector);
  const rows = fields.filter((field) => field.value).map((field) => copyField(field.label, field.value)).join('');
  target.innerHTML = `<strong>${esc(title)}</strong><div class="credential-list">${rows}</div><small>${esc(note)}</small>`;
  target.hidden = false;
  target.querySelectorAll('[data-copy-value]').forEach((button) => {
    const field = fields.find((item) => item.label === button.dataset.copyValue);
    if (!field) return;
    button.addEventListener('click', async () => { await navigator.clipboard.writeText(field.value); button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1500); });
  });
}
function render(selector, items, renderer) { $(selector).innerHTML = items.length ? items.map(renderer).join('') : '<p class="empty-row">Nothing created yet.</p>'; }
function renderLoading(selector) { const node = $(selector); if (node) node.innerHTML = '<p class="empty-row loading">Loading&hellip;</p>'; }
function renderLoadError(selector, retry) {
  const node = $(selector);
  if (!node) return;
  node.innerHTML = '<p class="empty-row error">This section could not be loaded.<button type="button" class="button compact" data-retry-section>Retry</button></p>';
  $('[data-retry-section]', node).addEventListener('click', () => withListState(selector, retry), { once: true });
}
// Every console section fetches independently (Promise.allSettled in refreshSession), so one
// section failing must not leave it silently blank -- without this a slow/failed request left
// the table exactly as static console.html defined it (nothing at all), indistinguishable from
// "still loading" or "genuinely empty", with only a 5s toast as any signal.
async function withListState(selector, loader) {
  renderLoading(selector);
  try {
    await loader();
  } catch (error) {
    renderLoadError(selector, loader);
    throw error;
  }
}
async function action(work, success, form) { setFormBusy(form, true); try { await work(); notify(success); } catch (error) { notify(error.message, true); } finally { setFormBusy(form, false); } }
function notify(message, error = false) { const node = $('#console-message'); node.textContent = message; node.setAttribute('role', error ? 'alert' : 'status'); node.style.borderLeftColor = error ? 'var(--bad)' : 'var(--brand)'; node.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { node.hidden = true; }, 5000); }
async function authJson(path, options = {}) {
  const response = await authFetch(path, options);
  const text = response.status === 204 ? '' : await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new Error(`The platform returned an unreadable response (${response.status}). Request ID: ${response.headers.get('X-Request-ID') || 'unavailable'}.`); }
  }
  if (!response.ok) {
    if (response.status === 401 && !path.includes('/sign-in/')) setSessionView(false);
    const message = data?.message || data?.error_description || data?.error?.message || `Request failed (${response.status}).`;
    const requestId = response.headers.get('X-Request-ID');
    throw new Error(requestId ? `${message} Request ID: ${requestId}.` : message);
  }
  return data;
}
async function authFetch(path, options = {}) {
  const headers = new Headers(options.headers || {}); let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') { headers.set('Content-Type','application/json'); body = JSON.stringify(body); }
  headers.set('X-Request-ID', crypto.randomUUID());
  const method = String(options.method || 'GET').toUpperCase();
  for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt += 1) {
    try { return await fetch(`${authBase}${path}`, { ...options, headers, body, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }); }
    catch (error) {
      if (attempt === 0 && method === 'GET') continue;
      if (error?.name === 'TimeoutError') throw new Error('The platform took too long to respond. Please try again.');
      throw new Error('The platform could not be reached. Check your connection and try again.');
    }
  }
}
function clearAuthenticatedState() {
  state.user = null;
  for (const key of ['keys', 'apps', 'devices', 'mcp', 'queries', 'standardTools', 'passkeys']) state[key] = [];
  for (const selector of ['#api-key-list', '#oauth-list', '#device-list', '#mcp-list', '#query-list']) $(selector).replaceChildren();
}
function setSessionView(signedIn) {
  $('#signed-out').hidden = signedIn;
  $('#signed-in').hidden = !signedIn;
  $('[data-console-menu]').hidden = !signedIn;
  $('[data-auth-only]').hidden = !signedIn;
  if (!signedIn) {
    closeProfile();
    clearAuthenticatedState();
    resetAuthPanels();
  }
}
function resetAuthPanels() {
  $('#two-factor-form').hidden = true;
  $$('[data-auth-panel]').forEach((panel) => { panel.hidden = panel.dataset.authPanel !== 'sign-in'; });
  $$('[data-auth-tab]').forEach((tab) => {
    const selected = tab.dataset.authTab === 'sign-in';
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
}
function decodeCreationOptions(options) {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    user: { ...options.user, id: fromBase64Url(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({ ...item, id: fromBase64Url(item.id) })),
  };
}
function decodeRequestOptions(options) {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: fromBase64Url(item.id) })),
  };
}
function serializeCredential(credential) {
  const response = {
    clientDataJSON: toBase64Url(credential.response.clientDataJSON),
  };
  if ('attestationObject' in credential.response) {
    response.attestationObject = toBase64Url(credential.response.attestationObject);
    if (credential.response.getTransports) response.transports = credential.response.getTransports();
  } else {
    response.authenticatorData = toBase64Url(credential.response.authenticatorData);
    response.signature = toBase64Url(credential.response.signature);
    response.userHandle = credential.response.userHandle ? toBase64Url(credential.response.userHandle) : null;
  }
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response,
  };
}
function fromBase64Url(value) {
  const base64 = String(value).replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(String(value).length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).buffer;
}
function toBase64Url(value) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function friendlyCredentialError(error) {
  if (error?.name === 'NotAllowedError') return 'Passkey use was cancelled or timed out.';
  if (error?.name === 'InvalidStateError') return 'That passkey is already registered.';
  if (error?.name === 'TimeoutError') return `No response after ${PASSKEY_CEREMONY_TIMEOUT_MS / 1000} seconds. Your device or browser may not have shown the passkey prompt -- try again.`;
  if (error?.name === 'AbortError') return 'Passkey request was cancelled.';
  return error?.message || 'The passkey operation could not be completed.';
}
function setFormBusy(form, busy) { if (!form) return; form.setAttribute('aria-busy', String(busy)); $$('button[type="submit"]', form).forEach((button) => { button.disabled = busy; }); }
function firstFocusable(root) { return $('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]', root); }
function trapFocus(event, root) { const items = $$('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]', root).filter((item) => item.offsetParent !== null); if (!items.length) return; const first = items[0]; const last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]); }
function getInitials(value) { return String(value).split(/\s+/).map((part) => part[0]).join('').slice(0,2).toUpperCase(); }
function formatDate(value) { if (!value) return 'Unknown'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(); }
function formatDateTime(value) { if (!value) return 'soon'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'soon' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function methodLabel(value) { return String(value || '').replaceAll('_',' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function displayRedirect(value) { const first=arrayValue(value)[0]; return first?.includes('localhost.invalid/fortress-machine-client') ? 'Not required' : first || 'None'; }
function arrayValue(value) { if (Array.isArray(value)) return value; try { return JSON.parse(value || '[]'); } catch { return []; } }

addQueryFilter(); updateOAuthForm(); updateToolForm(); updateQueryPreview(); updateMcpPreview(); updateToolPreview(); refreshSession();
