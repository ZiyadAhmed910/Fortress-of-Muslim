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
// Sources the platform uses under agreements that forbid naming them. They are listed here only as
// SHA-256 hashes of their lowercased names, because a check that spelled out the names it forbids
// would publish exactly what it exists to keep out of this public repository. Each tracked public
// file is tokenised into words, and every run of one to three consecutive words is hashed and
// compared. Adding a term: hash its lowercased, space-separated form and add the digest -- never the
// term itself, not even in a comment or a commit message.
const CONFIDENTIAL_TERM_HASHES = new Set([
  '742dcb49e852f3472f2d18da6f27acbfaeb963827fef7f601baacc03ee630999',
  '9a6637c8b69d94c1656807b030765eedc3742ed43501fa03e1a1def211b68ce1',
  '5732e92e70207a829445faac4427c76283c8940673d5850758cc01f4c0f12f96',
  'd5770819739940316d06f06fb4ecf7d868d93471a5c31bdd4c3f06536973b39e',
  '9379283a6c3b3a4861485c2d78c969b9e4c3c12b0ae203fc2352b93b8c473a3a',
  '2ec8a707034df888ab5975b2c1d7337d967bbaa23948dd6c83f01603c440ab3b',
]);
const CONFIDENTIAL_TERM_LENGTHS = new Set([6, 7, 9, 10, 14, 22]);
const { createHash } = await import('node:crypto');
const hashTerm = (value) => createHash('sha256').update(value).digest('hex');
// Every tracked file, not only the public prefixes above: a name disclosed in a test, a workflow or
// a stray note is disclosed all the same once the repository is public.
const everyTracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const path of everyTracked) {
  if (/\.(png|jpe?g|webp|gif|ico|mp3|zip|woff2?)$/i.test(path)) continue;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  const words = content.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (let index = 0; index < words.length; index += 1) {
    for (let length = 1; length <= 3 && index + length <= words.length; length += 1) {
      const phrase = words.slice(index, index + length).join(' ');
      // Hash only phrases as long as some protected term: that skips almost every candidate, and
      // the lengths say nothing about what the terms are.
      if (CONFIDENTIAL_TERM_LENGTHS.has(phrase.length) && CONFIDENTIAL_TERM_HASHES.has(hashTerm(phrase))) {
        violations.push(`${path}: names a source covered by a confidentiality agreement`);
        index = words.length; // one report per file is enough
        break;
      }
    }
  }
}

if (violations.length) {
  console.error('Public canonical boundary violations found:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log('Public canonical boundary verified. No preparation identities or external record URLs are exposed.');
