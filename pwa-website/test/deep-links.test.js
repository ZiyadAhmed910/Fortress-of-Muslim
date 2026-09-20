import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The app is served from paths several levels deep -- /quran/2/255, /tirmidhi/book1/1 -- by a
// rewrite that hands those URLs the same index.html the root gets. Every asset in that file is
// referenced relatively, so without a base URL the browser resolves them against the directory it
// thinks it is in: a reader opening /tirmidhi/book1/1 asked for /tirmidhi/book1/styles.css and
// /tirmidhi/book1/js/app.js, got 404s for both, and was shown an unstyled skeleton with no
// JavaScript at all. Every deep link on the site did this, including the 247 the sitemap advertises.
//
// One <base href="/"> fixes it, which makes that tag load-bearing and very easy to delete by
// accident, since nothing on the homepage changes when it goes. Hence this.
const HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const HTACCESS = readFileSync(resolve(process.cwd(), '.htaccess'), 'utf8');

describe('serving the app from a deep link', () => {
  it('declares a root base URL', () => {
    expect(HTML).toMatch(/<base\s+href="\/"\s*>/);
  });

  it('declares it before anything relative is referenced', () => {
    // A base tag only governs what comes after it, so an asset above it resolves the old, broken way.
    const base = HTML.search(/<base\s+href="\/"/);
    const firstRelative = HTML.search(/(?:src|href)="(?!https?:|\/|#|data:|mailto:)[^"]+"/);
    expect(base).toBeGreaterThan(-1);
    expect(firstRelative, 'a relative URL appears before <base>').toBeGreaterThan(base);
  });

  it('rewrites the three URL shapes the app owns', () => {
    for (const shape of [
      /RewriteRule \^quran\\?\//,
      /RewriteRule \^hisn\\?\/chapter/,
      /RewriteRule \^\[a-z0-9-\]\+\\?\/book/,
    ]) {
      expect(HTACCESS).toMatch(shape);
    }
  });

  it('does not rewrite everything else', () => {
    // The catch-all this replaced answered 200 with the app shell for any URL ever guessed at,
    // which tells a crawler that every invented path is a real page.
    expect(HTACCESS).not.toMatch(/^RewriteRule \^ index\.html/m);
  });

  it('keeps the routes the rewrite serves and the ones the app parses in step', () => {
    // If these drift, a URL either 404s at the server while the app could have handled it, or
    // reaches the app as a route it does not recognise and silently shows the home screen.
    const routes = readFileSync(resolve(process.cwd(), 'js/routes.js'), 'utf8');
    expect(routes).toMatch(/\^\\\/quran\\\//);
    expect(routes).toMatch(/\^\\\/hisn\\\/chapter/);
    expect(routes).toMatch(/book/);
  });
});
