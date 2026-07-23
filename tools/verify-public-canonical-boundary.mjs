import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const publicPrefixes = [
  'apps/api/src/',
  'apps/api/openapi.yaml',
  'apps/admin/public/',
  'apps/developers/',
  'apps/mcp/',
  'packages/contracts/',
  'pwa-website/',
  'docs/',
  'README.md',
];
const forbidden = [
  { pattern: /\bsunnah\.com\b/i, label: 'external record URL' },
  { pattern: /\bproviderId\b|\bprovider_id\b/, label: 'provider identity field' },
  { pattern: /\bsourceUrl\b|\bsource_url\b/, label: 'preparation URL field' },
  { pattern: /\bdatasetSources\b|\bimportLocator\b/, label: 'preparation metadata field' },
];
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((path) => path.replaceAll('\\', '/'))
  .filter((path) => publicPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)));

const violations = [];
for (const path of tracked) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) violations.push(`${path}: ${rule.label}`);
  }
}
if (violations.length) {
  console.error('Public canonical boundary violations found:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log('Public canonical boundary verified. No preparation identities or external record URLs are exposed.');
