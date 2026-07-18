import { access, readFile } from 'node:fs/promises';

const repositoryRoot = new URL('../../../', import.meta.url);
for (const portal of ['developers', 'status']) {
  const output = new URL(`apps/${portal}/dist/`, repositoryRoot);
  for (const path of ['index.html', 'app.js', 'styles.css', 'assets/portal.css', 'assets/portal.js', 'assets/fortress-mark.svg']) {
    await access(new URL(path, output));
  }
  const html = await readFile(new URL('index.html', output), 'utf8');
  if (!html.includes('Fortress Platform')) throw new Error(`${portal} is missing the platform brand.`);
  if (portal === 'developers') {
    for (const path of ['console.html', 'console.js', 'console.css', 'device.html', 'device.js']) await access(new URL(path, output));
  }
}
console.log('Verified developer and status portal builds.');
