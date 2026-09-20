const authBase = location.hostname.startsWith('developers-test.')
  ? 'https://auth-test.fortressofmuslim.org'
  : location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8788'
    : 'https://auth.fortressofmuslim.org';

const query = new URLSearchParams(location.search);
const signedQuery = query.toString();
const scopeLabels = {
  openid: 'Confirm your Fortress identity',
  profile: 'Read your basic developer profile',
  email: 'Read your email address',
  offline_access: 'Remain connected after the access token expires',
  'content:read': 'Read published dua content',
  'content:search': 'Search published dua content',
  'dataset:read': 'Read dataset and verification metadata',
  'mcp:connect': 'Use Fortress MCP tools',
  'mcp:manage': 'Manage your custom MCP toolsets',
};

const login = document.querySelector('#oauth-login');
const consent = document.querySelector('#oauth-consent');
const message = document.querySelector('#oauth-message');
document.querySelector('#oauth-client').textContent = query.get('client_id') ? `Client ${query.get('client_id')}` : '';
let clientLabel = 'this application';

login.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Signing in...';
  const body = Object.fromEntries(new FormData(login));
  try {
    await authJson('/api/auth/sign-in/email', body);
    resumeAuthorization();
  } catch (error) {
    message.textContent = error.message;
  }
});

document.querySelector('#oauth-allow').addEventListener('click', () => submitConsent(true));
document.querySelector('#oauth-deny').addEventListener('click', () => submitConsent(false));

async function initialize() {
  if (!signedQuery || !query.get('client_id')) return fail('This authorization request is incomplete. Return to the application and try connecting again.');
  try {
    const nameResponse = await fetch(`${authBase}/v1/oauth/client-name?client_id=${encodeURIComponent(query.get('client_id'))}`);
    const nameData = nameResponse.ok ? await nameResponse.json() : null;
    if (nameData?.data?.name) clientLabel = nameData.data.name;
  } catch {
    // Falls back to the generic "this application" label -- not knowing the name yet isn't fatal.
  }
  try {
    const response = await fetch(`${authBase}/api/auth/get-session`, { credentials: 'include' });
    const session = response.ok ? await response.json() : null;
    if (!session?.user) {
      document.querySelector('#oauth-title').textContent = 'Sign in to Fortress';
      document.querySelector('#oauth-summary').textContent = `Continue securely to review the access requested by ${clientLabel}.`;
      login.hidden = false;
      return;
    }
    document.querySelector('#oauth-summary').textContent = `${session.user.email} is authorizing an external application.`;
    const scopes = (query.get('scope') || '').split(/\s+/).filter(Boolean);
    document.querySelector('#oauth-scopes').innerHTML = scopes.map((scope) => `<li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>${escapeHtml(scopeLabels[scope] || scope)}</span></li>`).join('');
    consent.hidden = false;
  } catch {
    fail('Fortress could not load your session. Please try again.');
  }
}

function resumeAuthorization() {
  location.assign(`${authBase}/api/auth/oauth2/authorize?${signedQuery}`);
}

async function submitConsent(accept) {
  message.textContent = accept ? `Authorizing ${clientLabel}...` : 'Denying access...';
  try {
    const result = await authJson('/api/auth/oauth2/consent', {
      accept,
      scope: query.get('scope') || undefined,
      oauth_query: signedQuery,
    });
    const redirect = result.redirect_uri || result.url;
    if (!redirect) throw new Error('The authorization server did not return a callback.');
    location.assign(redirect);
  } catch (error) {
    message.textContent = error.message;
  }
}

async function authJson(path, body) {
  const response = await fetch(`${authBase}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error_description || data.error?.message || 'Authorization failed.');
  return data;
}

function fail(text) {
  login.hidden = true;
  consent.hidden = true;
  message.textContent = text;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

initialize();
