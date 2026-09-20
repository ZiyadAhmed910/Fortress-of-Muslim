import { execFileSync } from 'node:child_process';

const forbiddenPrefixes = [
  'sunnah-data-fast-do-not-deploy/',
  '.fortress-import/',
  'private-acquisition-do-not-commit/',
];

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((path) => path.replaceAll('\\', '/'));

const violations = tracked.filter((path) => forbiddenPrefixes.some((prefix) => path.startsWith(prefix)));
if (violations.length > 0) {
  console.error('Restricted source data or generated imports are tracked by Git:');
  for (const path of violations) console.error(`- ${path}`);
  process.exit(1);
}

console.log('Local data boundary verified. No restricted candidate material is tracked.');
