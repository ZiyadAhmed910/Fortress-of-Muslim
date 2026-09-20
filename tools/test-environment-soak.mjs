const rounds = Math.min(20, Math.max(2, Number(process.env.SOAK_ROUNDS) || 5));
const pauseMs = Math.max(250, Number(process.env.SOAK_PAUSE_MS) || 2_000);
const checks = [
  ['PWA', 'https://test.fortressofmuslim.org/', 'text'],
  ['API health', 'https://api-test.fortressofmuslim.org/health', 'json'],
  ['API database', 'https://api-test.fortressofmuslim.org/health/database', 'json'],
  ['Ask readiness', 'https://api-test.fortressofmuslim.org/v1/ask/status', 'json'],
  ['Auth health', 'https://auth-test.fortressofmuslim.org/health', 'json'],
  ['MCP health', 'https://mcp-test.fortressofmuslim.org/health', 'json'],
  ['Developers', 'https://developers-test.fortressofmuslim.org/', 'text'],
  ['Admin', 'https://admin-test.fortressofmuslim.org/', 'text'],
  ['Status', 'https://status-test.fortressofmuslim.org/', 'text'],
];
const timings = new Map(checks.map(([name]) => [name, []]));

for (let round = 1; round <= rounds; round += 1) {
  for (const [name, url, type] of checks) {
    const started = performance.now();
    const response = await fetch(url, {
      headers: { 'X-Request-ID': `soak-${round}-${name.toLowerCase().replaceAll(' ', '-')}` },
      signal: AbortSignal.timeout(12_000),
    });
    const duration = performance.now() - started;
    if (!response.ok) throw new Error(`${name} returned HTTP ${response.status} in round ${round}.`);
    if (type === 'json') await response.json();
    else if (!(await response.text()).includes(name === 'PWA' ? 'Fortress of Muslim' : 'Fortress Platform')) {
      throw new Error(`${name} returned an unexpected document in round ${round}.`);
    }
    timings.get(name).push(duration);
  }
  if (round < rounds) await new Promise((resolve) => setTimeout(resolve, pauseMs));
}

for (const [name, values] of timings) {
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  const maximum = Math.max(...values);
  console.log(`${name}: ${values.length}/${rounds} OK, average ${average.toFixed(0)}ms, max ${maximum.toFixed(0)}ms`);
}
console.log(`Test environment passed ${rounds} soak rounds across ${checks.length} surfaces.`);
