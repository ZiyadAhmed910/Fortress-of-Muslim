import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// index.html preloads every stylesheet and module the first screen needs, so a first visit asks for
// them all at once rather than discovering them three round trips deep. A list like that goes stale
// quietly: a new module missing from it just loads late again, and a removed one is fetched for
// nothing. These keep it equal to what styles.css and js/app.js actually import.

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const HTML = read('index.html');

function reachableModules() {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file) || !existsSync(resolve(process.cwd(), 'js', file))) return;
    seen.add(file);
    const source = read(`js/${file}`).replace(/\/\/.*$/gm, '');
    for (const match of source.matchAll(/from\s+['"]\.\/([\w.-]+\.js)/g)) walk(match[1]);
  };
  walk('app.js');
  seen.delete('app.js');
  return [...seen].sort();
}

describe('first-visit preloads', () => {
  it('preload exactly the modules app.js pulls in', () => {
    const preloaded = [...HTML.matchAll(/<link rel="modulepreload" href="js\/([\w.-]+\.js)\?v=[^"]+">/g)].map((m) => m[1]).sort();
    expect(preloaded).toEqual(reachableModules());
  });

  it('preload exactly the stylesheets styles.css imports', () => {
    const imported = [...read('styles.css').matchAll(/@import url\("(css\/[\w.-]+\.css)\?v=/g)].map((m) => m[1]).sort();
    const preloaded = [...HTML.matchAll(/<link rel="preload" as="style" href="(css\/[\w.-]+\.css)\?v=[^"]+">/g)].map((m) => m[1]).sort();
    expect(preloaded).toEqual(imported);
  });

  it('are stamped by the build, so a preload and its import are the same URL', () => {
    // A preload for ?v=build-dev and an import of ?v=build-<sha> would be two fetches, not one.
    const stamp = read('tools/stamp_version.py');
    expect(stamp).toContain('((?:js|css)/[A-Za-z0-9._\\-]+\\.(?:js|css))\\?v=');
    const versions = new Set([...HTML.matchAll(/(?:js|css)\/[\w.-]+\.(?:js|css)\?v=([^"']+)/g)].map((m) => m[1]));
    expect(versions.size).toBe(1);
  });
});
