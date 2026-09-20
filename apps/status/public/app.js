const isTest = location.hostname.includes('-test.') || ['localhost', '127.0.0.1'].includes(location.hostname);
const environment = isTest ? 'test' : 'production';
const suffix = isTest ? '-test' : '';
const urls = {
  api: `https://api${suffix}.fortressofmuslim.org`,
  auth: `https://auth${suffix}.fortressofmuslim.org`,
  mcp: `https://mcp${suffix}.fortressofmuslim.org`,
  developers: `https://developers${suffix}.fortressofmuslim.org`,
  admin: `https://admin${suffix}.fortressofmuslim.org`,
  pwa: isTest ? 'https://test.fortressofmuslim.org' : 'https://fortressofmuslim.org',
};
const services = {
  api: { url: `${urls.api}/health`, mode: 'json', critical: true },
  database: { url: `${urls.api}/health/database`, mode: 'json', critical: true },
  rag: { url: `${urls.api}/v1/ask/status`, mode: 'json', critical: false, readiness: true },
  auth: { url: `${urls.auth}/health`, mode: 'json', critical: true },
  mcp: { url: `${urls.mcp}/health`, mode: 'json', critical: true },
  pwa: { url: `${urls.pwa}/`, mode: 'opaque', critical: false },
  developers: { url: `${urls.developers}/`, mode: 'text', critical: false },
  admin: { url: `${urls.admin}/`, mode: 'text', critical: false },
};

const historyKey = `fortress-status-check-history-v2-${environment}`;
const refreshButton = document.querySelector('#refresh-status');
let checking = false;

document.querySelector('#environment-name').textContent = isTest ? 'Test environment' : 'Production environment';
document.querySelector('#environment-badge').textContent = isTest ? 'Beta' : 'Production';
document.querySelector('#environment-description').textContent = isTest
  ? 'Live beta services deployed from the dev branch.'
  : 'Stable public services deployed from the main branch.';
document.querySelectorAll('[data-environment-link]').forEach((link) => { link.href = urls[link.dataset.environmentLink]; });

async function runChecks() {
  if (checking) return;
  checking = true;
  refreshButton.disabled = true;
  refreshButton.classList.add('loading');
  const results = await Promise.all(Object.entries(services).map(async ([id, service]) => [id, await checkService(service)]));
  const resultMap = Object.fromEntries(results);
  updateHistory(resultMap);
  renderServices(resultMap);
  renderOverall(resultMap);
  checking = false;
  refreshButton.disabled = false;
  refreshButton.classList.remove('loading');
}

async function checkService(service) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const started = performance.now();
  try {
    const options = service.mode === 'opaque'
      ? { mode: 'no-cors', cache: 'no-store', signal: controller.signal }
      : { cache: 'no-store', signal: controller.signal };
    const response = await fetch(`${service.url}${service.url.includes('?') ? '&' : '?'}statusCheck=${Date.now()}`, options);
    if (service.mode !== 'opaque' && !response.ok) throw new Error(`HTTP ${response.status}`);
    const data = service.mode === 'json' ? await response.json() : null;
    const latency = Math.round(performance.now() - started);
    const readinessFailed = service.readiness && data?.data?.status === 'failed';
    return { state: readinessFailed || latency > 2000 ? 'degraded' : 'ok', latency, data };
  } catch (error) {
    return { state: 'outage', latency: null, error: error instanceof Error ? error.message : 'Request failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function renderServices(results) {
  const history = readHistory();
  for (const [id, result] of Object.entries(results)) {
    const row = document.querySelector(`[data-service="${id}"]`);
    if (!row) continue;
    const state = row.querySelector('.service-state');
    const latency = row.querySelector('.latency');
    state.className = `service-state ${result.state === 'ok' ? '' : result.state}`;
    const readiness = id === 'rag' ? result.data?.data?.status : null;
    const label = readiness === 'empty' ? 'Awaiting publication'
      : readiness === 'pending' ? 'Index pending'
        : readiness === 'indexing' ? 'Indexing'
          : readiness === 'ready' ? 'Ready'
            : result.state === 'ok' ? 'Operational'
              : result.state === 'degraded' ? 'Degraded' : 'Unavailable';
    state.innerHTML = `<span class="dot"></span>${label}`;
    latency.textContent = result.latency === null ? '--' : `${result.latency} ms`;
    row.querySelector('.check-history').innerHTML = (history[id] || []).map((item, index, entries) => `<span class="history-bar ${item.state}" style="height:${Math.min(22, 7 + (index / Math.max(1, entries.length - 1)) * 10)}px" title="${item.state} at ${new Date(item.at).toLocaleTimeString()}"></span>`).join('');
  }
  const versions = ['api', 'database', 'auth', 'mcp'].map((id) => results[id]?.data?.version).filter(Boolean);
  const distinctVersions = [...new Set(versions)];
  document.querySelector('#platform-version').textContent = distinctVersions.length === 1 ? distinctVersions[0] : distinctVersions.length ? 'Mixed' : '--';
  document.querySelector('#version-detail').textContent = distinctVersions.length <= 1 ? 'Consistent' : distinctVersions.join(' / ');
}

function renderOverall(results) {
  const measured = Object.values(results);
  const critical = Object.entries(results).filter(([id]) => services[id].critical).map(([, result]) => result);
  const outages = critical.filter((result) => result.state === 'outage').length;
  const degraded = measured.filter((result) => result.state === 'degraded').length;
  const versions = ['api', 'database', 'auth', 'mcp'].map((id) => results[id]?.data?.version).filter(Boolean);
  const versionSkew = new Set(versions).size > 1;
  const operational = measured.filter((result) => result.state === 'ok').length;
  const latencies = measured.map((result) => result.latency).filter(Number.isFinite);
  const overall = document.querySelector('#overall-status');
  const state = outages ? 'outage' : degraded || versionSkew ? 'degraded' : 'ok';
  overall.className = `overall-status ${state === 'ok' ? '' : state}`;
  overall.querySelector('.overall-icon').innerHTML = state === 'ok'
    ? '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 17h.01"/></svg>';
  overall.querySelector('h2').textContent = state === 'ok' ? 'All measured systems operational' : state === 'degraded' ? versionSkew ? 'A platform deployment is still converging' : 'Some services are responding slowly' : 'A critical service is unavailable';
  overall.querySelector('p').textContent = state === 'ok' ? 'All live checks completed successfully.' : 'The status below reflects direct checks from this browser.';
  document.querySelector('#last-updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  document.querySelector('#operational-count').textContent = operational;
  document.querySelector('#degraded-count').textContent = degraded + measured.filter((result) => result.state === 'outage').length;
  document.querySelector('#average-latency').textContent = latencies.length ? `${Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)} ms` : '--';
}

function updateHistory(results) {
  const history = readHistory();
  for (const [id, result] of Object.entries(results)) history[id] = [...(history[id] || []), { state: result.state, at: Date.now() }].slice(-24);
  try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch { /* Status checks still work when storage is unavailable. */ }
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(historyKey)) || {}; } catch { return {}; }
}

refreshButton.addEventListener('click', runChecks);
runChecks();
setInterval(runChecks, 60000);
