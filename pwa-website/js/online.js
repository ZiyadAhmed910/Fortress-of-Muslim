export function apiBaseUrl() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.startsWith('test.')
    ? 'https://api-test.fortressofmuslim.org'
    : 'https://api.fortressofmuslim.org';
}

export async function apiRequest(path, options = {}) {
  if (!navigator.onLine) throw new Error('This section needs an internet connection.');
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: options.signal || AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(body?.error?.message || `Fortress API returned ${response.status}.`);
  return body;
}
