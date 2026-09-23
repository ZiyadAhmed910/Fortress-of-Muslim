import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Runs the real tools/stamp_version.py on a copy of the app and checks what it produced.
//
// Every other test reads the unstamped source, where every link says ?v=build-dev and looks fine.
// 0.47.3 shipped a stamp rule whose replacement had lost its back-reference, so every preload and
// the entry script became src="?v=build-<sha>" -- a page that loads no code at all -- and nothing
// failed until a live smoke test did. This is the check that would have caught it.

const ROOT = process.cwd();
const BUILD = 'build-0123456789';
const work = mkdtempSync(join(tmpdir(), 'fortress-stamp-'));
for (const entry of ['index.html', 'art-preview.html', 'styles.css', 'sw.js', 'manifest.json', 'js', 'tools/stamp_version.py']) {
  if (existsSync(resolve(ROOT, entry))) cpSync(resolve(ROOT, entry), join(work, entry), { recursive: true });
}
const python = process.platform === 'win32' ? 'python' : 'python3';
execFileSync(python, [join(work, 'tools', 'stamp_version.py')], {
  cwd: work,
  env: { ...process.env, APP_BUILD_VERSION: BUILD, APP_DISPLAY_VERSION: '1.999' },
  stdio: 'pipe',
});
const html = readFileSync(join(work, 'index.html'), 'utf8');
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('the stamped build', () => {
  it('still names a real file in every script, stylesheet and preload link', () => {
    const links = [...html.matchAll(/(?:src|href)="([^"]*\?v=[^"]*)"/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(40);
    for (const link of links) {
      const [path, version] = link.split('?v=');
      expect(version, link).toBe(BUILD);
      expect(path, link).toMatch(/^[a-z]/);
      expect(existsSync(resolve(ROOT, path)), `${link} names no file`).toBe(true);
    }
  });

  it('loads the app from js/app.js', () => {
    expect(html).toContain(`<script type="module" src="js/app.js?v=${BUILD}"></script>`);
  });

  it('stamps imports the same way, so a preload and its import are one fetch', () => {
    const app = readFileSync(join(work, 'js', 'app.js'), 'utf8');
    expect(app).toContain(`from './state.js?v=${BUILD}'`);
    expect(html).toContain(`<link rel="modulepreload" href="js/state.js?v=${BUILD}">`);
    const styles = readFileSync(join(work, 'styles.css'), 'utf8');
    expect(styles).toContain(`css/base.css?v=${BUILD}`);
    expect(html).toContain(`<link rel="preload" as="style" href="css/base.css?v=${BUILD}">`);
  });

  it('stamps the service worker with the same build', () => {
    expect(readFileSync(join(work, 'sw.js'), 'utf8')).toContain(`const APP_VERSION = '${BUILD}';`);
  });
});
