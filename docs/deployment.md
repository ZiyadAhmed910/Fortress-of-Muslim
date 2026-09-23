# Deployment Workflow

The PWA (`pwa-website/`) is a static site. It is moving from Bluehost to Cloudflare (Workers
static assets); see "PWA hosting" below for where each environment is served from today and how
the move is made and undone.

## Branch model

- `feature/name-of-feature` or `Feature/name-of-feature`
  - Normal feature work.
  - A push to this branch creates a pull request into `dev`.
  - The workflow auto-merges the PR into `dev`.

- `dev`
  - Test branch.
  - Every push deploys `pwa-website/` to Cloudflare (`fortress-pwa-test`) and, as a standby, to the
    Bluehost test folder.
  - Target: `https://test.fortressofmuslim.org/`

- `main`
  - Production branch.
  - Every push deploys `pwa-website/` to Cloudflare (`fortress-pwa-production`) and to the
    production Bluehost folder.

## Required GitHub secrets

Add these in GitHub:

`Settings -> Secrets and variables -> Actions -> New repository secret`

Required for test deployment:

- `BLUEHOST_FTP_SERVER`
  - Example: `ftp.fortressofmuslim.org`

- `BLUEHOST_FTP_USERNAME`
  - FTP username from Bluehost.

- `BLUEHOST_FTP_PASSWORD`
  - FTP password from Bluehost.

- `BLUEHOST_TEST_DIR`
  - FTP destination folder for test site.
  - Example: `/public_html/test/`
  - The exact value depends on the Bluehost domain/subdomain configuration.

- `BLUEHOST_PROD_DIR`
  - FTP destination folder for production site.
  - Example: `/public_html/`

## Deployment source

Only the contents of `pwa-website/` are deployed. `tools/stamp_version.py` stamps the build first;
`tools/build-dist.mjs` then copies what the site publishes into `pwa-website/dist` for Cloudflare.
The Bluehost FTP upload excludes the same files by pattern.

Excluded from deploy:

- local server helper `serve.py`
- extraction tools under `tools/`, and tests under `test/`
- visualization prototype files
- README/dev-only files (`package.json`, `vitest.config.js`)
- the Cloudflare hosting files themselves (`edge/`, `dist/`, `wrangler*.jsonc`)

## PWA hosting: Cloudflare, with Bluehost as standby

| Environment | Served from | Cloudflare Worker | Bluehost copy |
| --- | --- | --- | --- |
| test (`test.fortressofmuslim.org`) | **Cloudflare** since 2026-09-23 | `fortress-pwa-test` | kept up to date on every push |
| production (`fortressofmuslim.org`) | Bluehost | `fortress-pwa-production` | kept up to date on every push |

Why: Bluehost answered small files in 0.3-10 s on 2026-09-23, and every first visit after a release
waited on it file by file. Cloudflare serves the files from its own storage at the edge, with no
origin behind it. Bluehost keeps the email, FTP and cPanel it has always hosted -- only the website
records move.

How it is served (`pwa-website/wrangler.jsonc`): the files in `dist/` are static assets, and
`pwa-website/edge/worker.js` runs in front of them to do what `.htaccess` did on Bluehost -- the
three app URL shapes (`/quran/<s>/<a>`, `/hisn/chapter<n>`, `/<collection>/book<b>/<n>`) and `/`
answer with `index.html`, anything else unknown is a real 404, and it sets the cache headers the
update model depends on (`sw.js` never cached, `?v=build-<sha>` files immutable for a year,
everything else revalidated). `html_handling` is `none` so `/reset.html` stays `/reset.html`.
`pwa-website/test/edge-worker.test.js` pins all of it.

Every push also deploys to the environment's `workers.dev` address, e.g.
`https://fortress-pwa-test.<account>.workers.dev`, which the deploy smoke-tests. The app treats the
`fortress-pwa-test.` preview as test (test API, test media host) via `isTestHost()` in `js/utils.js`.

### Moving a domain to Cloudflare (once per environment)

Test first; production only after test has been used on real devices.

1. In Cloudflare -> the `fortressofmuslim.org` zone -> DNS -> Records, note the existing record for
   the host (`test` for test, `fortressofmuslim.org` for production): its type, content and proxy
   status. This is the rollback. Do not touch MX, TXT/SPF/DKIM, `mail`, `ftp`, `cpanel` or `webmail`.
   Test, for the record, was `A  test  162.214.80.52  DNS only` (Bluehost). `www.test` was left on
   Bluehost; nothing links to it.
2. Delete that one record. The site is unreachable from here until step 3 completes.
3. Attach the domain to the Worker. Either in the dashboard -- Workers & Pages -> `fortress-pwa-test`
   -> Settings -> Domains & Routes -> Add -> Custom domain -> `test`, enabled for "Production"
   (Cloudflare's word for the Worker's live version, not our production environment) -- which is
   how test was moved; or from an authenticated session with the full config (PowerShell, one line at
   a time):

   ```powershell
   cd "C:\Users\ZIYAD\Downloads\Fortress of Muslim\pwa-website"
   python tools/stamp_version.py
   node tools/build-dist.mjs
   npx wrangler deploy --env test
   ```

   (`--env production` for production.) Wrangler creates the DNS record and certificate.
4. Check `https://test.fortressofmuslim.org/` returns the app and
   `https://test.fortressofmuslim.org/no-such-page` returns 404. From then on GitHub deploys keep
   it current through `wrangler.ci.jsonc`.
5. Discard the local stamping changes (`git checkout -- pwa-website`); CI stamps its own build.

### Moving back to Bluehost (rollback)

1. Cloudflare -> Workers & Pages -> `fortress-pwa-test` -> Settings -> Domains & Routes -> remove
   `test.fortressofmuslim.org`.
2. DNS -> Records -> add back the record noted in step 1 above, proxied as it was.

Bluehost has been receiving every build all along, so it serves the same version immediately.

## Automated safeguards

Every platform check runs the complete typecheck and test suite plus `npm audit --omit=dev --audit-level=high`. Deployment jobs have bounded runtimes so a stalled provider cannot leave a workflow running indefinitely.

After deployment, GitHub Actions verifies the live environment:

- API, Auth, and MCP health responses must report `ok` and the exact repository platform version.
- Developer, Status, and Admin portals must return the Fortress brand and deployed Content Security Policy.
- The PWA on Cloudflare (its `workers.dev` address) must answer `/` and a deep link with the app
  shell, serve `sw.js`, and return 404 for an unknown page and for `package.json`.
- Bluehost test and production PWA origins must return a successful HTTP response.

The smoke checks retry briefly because Cloudflare and Bluehost can take a few seconds to converge. A failed smoke check fails the deployment workflow and must be investigated before promotion.

Run the same platform checks manually with:

```powershell
npm run smoke:test:services
npm run smoke:test:portals
npm run smoke:production:services
npm run smoke:production:portals
```

## Promoting dev to production

When test is good:

```powershell
git checkout main
git merge dev
git push origin main
```

That push deploys production.

## Feature branch naming

Use:

```text
feature/name-of-feature
```

Examples:

```text
feature/mood-tags
feature/ruqyah-category
feature/export-favourites
```
