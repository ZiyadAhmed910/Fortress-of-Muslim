import { readFile } from 'node:fs/promises';

const environment = process.argv[2];
const target = process.argv[3];
if (!['test', 'production'].includes(environment) || !['services', 'portals'].includes(target)) {
  throw new Error('Usage: node tools/deployment-smoke.mjs <test|production> <services|portals>');
}

const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const suffix = environment === 'test' ? '-test' : '';
const checks = target === 'services' ? [
  { name: 'API', url: `https://api${suffix}.fortressofmuslim.org/health`, json: true },
  { name: 'Auth', url: `https://auth${suffix}.fortressofmuslim.org/health`, json: true },
  { name: 'MCP', url: `https://mcp${suffix}.fortressofmuslim.org/health`, json: true },
] : [
  { name: 'Developer Portal', url: `https://developers${suffix}.fortressofmuslim.org/` },
  { name: 'Status Portal', url: `https://status${suffix}.fortressofmuslim.org/` },
  { name: 'Admin Console', url: `https://admin${suffix}.fortressofmuslim.org/` },
];

for (const check of checks) await verify(check);
console.log(`Verified ${target} in ${environment} on Fortress Platform ${version}.`);

async function verify(check) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(check.url, {
        headers: { 'X-Request-ID': `deploy-${environment}-${target}-${attempt}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (check.json) {
        const body = await response.json();
        if (body.status !== 'ok') throw new Error(`health status was ${body.status ?? 'missing'}`);
        if (body.version !== version) throw new Error(`version ${body.version ?? 'missing'} did not match ${version}`);
        if (response.headers.get('X-Fortress-Platform-Version') !== version) throw new Error('platform version header did not match');
      } else {
        const html = await response.text();
        if (!html.includes('Fortress Platform')) throw new Error('platform brand was missing');
        if (!response.headers.get('Content-Security-Policy')?.includes("default-src 'self'")) throw new Error('content security policy was missing');
      }
      console.log(`OK ${check.name}: ${check.url}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
  throw new Error(`${check.name} smoke test failed: ${lastError instanceof Error ? lastError.message : lastError}`);
}
