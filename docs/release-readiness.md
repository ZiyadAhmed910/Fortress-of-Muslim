# Release Readiness

Fortress Platform promotes `dev` to `main` only after the test environment proves the same release is healthy across the PWA, Workers, and portals.

## Production status (checked 2026-09-23)

Production is live: api, auth and mcp report `environment: production` at 0.43.0, `/v1/ask/status`
is `ready` over 14,357 hadith and 268 duas, and the admin, developers and status portals answer.
The PWA at the apex is served from Bluehost; its move to Cloudflare is in `docs/deployment.md` ->
"PWA hosting". `media.fortressofmuslim.org` (dua recitation) is provisioned once, from an
authenticated session, before the first release that ships it (`npx wrangler deploy --env production`
in `apps/media`).

The section below is kept as the record of how production was first built out.

## First build-out (as of 0.39.0)

The first promotion to `main` is not a promotion. It is a first-time build-out, and the checklist
below assumes an environment that already exists. What is actually true of production today:

- **Workers**: none. `wrangler deployments list --env production` reports "This Worker does not
  exist on your account" for api, auth and mcp, and all six production subdomains fail to resolve.
  Because the Workers do not exist, neither do their secrets -- `BETTER_AUTH_SECRET` and
  `INDEXING_SECRET` have to be set after the first deploy creates them, not before.
- **D1**: both production databases are empty (12 KB each; test is 261 MB). `identity` being empty
  also means there is no admin to bootstrap the admin plane with.
- **Vectorize**: resolved in 0.39.0. `fortress-rag-production-m3` now exists at 1024 dimensions to
  match `@cf/baai/bge-m3`, and `apps/api/wrangler.jsonc`'s production binding points at it. The old
  768-dim `fortress-rag-production` is left in place until the new one is populated and proven.
  Neither index has metadata indexes, which is worth knowing: Vectorize `filter` clauses are
  therefore inert, and `enforceScope()` in `rag.ts` is what actually holds the Ask source scope.
- **PWA**: the apex serves the original upload -- version 1.00, assets unstamped. `main`'s last four
  commits are empty "Retry production deployment" triggers, so merging `dev` into `main` reverts
  nothing.
- **Content**: this is the open one. Applying all 28 migrations to an empty database yields 135 duas
  and 6,236 ayahs, and **no hadith at all**. The 14,357 hadith in test came from
  `sunnah-data-fast-do-not-deploy/`, which is gitignored and local to one machine. A production
  deploy today would therefore produce an empty Hadith Library and an Ask with 135 duas behind it.
  See "Content provisioning" below.

## Content provisioning

The hadith corpus is deliberately not in this repository. `.gitignore` keeps the source corpus and
any generated import bundle local-only, `docs/canonical-editorial-architecture.md` says preparation
provenance stays "outside the public repository and deployment artifacts", and
`tools/verify-public-canonical-boundary.mjs` fails the build if an external record URL reaches a
tracked public file. This repository is public, so that boundary is doing real work and the corpus
cannot simply become migration 0029.

What is committed instead is the recipe:

```powershell
node apps/api/tools/build-content-bundle.mjs
node apps/api/tools/verify-content-bundle.mjs .fortress-import/content-bundle-<digest>.sql
npx wrangler d1 execute fortress-platform-production --remote --file=.fortress-import/content-bundle-<digest>.sql
```

The bundle lands in `.fortress-import/`, which is gitignored. **Never commit it.** It is about
140 MB and 325,000 statements, and it carries the approved source corpus.

Applying it is only safe because of three things that are not obvious, each of which broke a
draft of this before being understood:

1. **`INSERT OR IGNORE`, never `OR REPLACE`.** REPLACE deletes the conflicting row first, and rows
   the migrations created are already referenced by other rows the migrations created -- deleting a
   `dataset_versions` row that `content_records` point at fails the foreign key. Rows a migration
   established keep the migration's version; the bundle supplies only what migrations do not carry.
2. **The active-dataset slot is reconciled explicitly.** `idx_dataset_active` is a partial unique
   index permitting exactly one active dataset. The migrations make the legacy Hisn dataset active,
   while a populated environment has it deprecated and the approved dataset active instead. Under
   `OR IGNORE` the bundle's active row was silently dropped, and every hadith then failed its
   foreign key to a dataset that never landed. The bundle now frees the slot first and sets the real
   statuses at the end.
3. **No enclosing transaction is relied on.** `wrangler d1 execute --file` applies a file this size
   in chunks, so a `BEGIN` in the first chunk does not hold over the rest, and `PRAGMA
   defer_foreign_keys` -- which only lasts to the end of a transaction -- would buy nothing exactly
   when the file is large enough to need it. The statements satisfy their constraints as they go.

`verify-content-bundle.mjs` is what establishes that a given bundle is sound: it applies every
migration to an empty database, applies the bundle on top with foreign keys **on** and no
transaction, and compares every table against the source environment. A bundle that passes has been
applied in full under the conditions production will apply it in. Run it before every provisioning.

### Why this stays manual

Migrations run on every deploy; the bundle is applied once, when an environment is first stood up,
and again only when the corpus itself changes. That is not a per-deploy step, so it does not need
per-deploy machinery, and wiring private object storage into the production workflow to automate a
once-in-a-long-while action would add a service dependency the platform does not otherwise have.

The real risk is not that applying it is manual -- it is that the corpus lives in one place. Keep
`sunnah-data-fast-do-not-deploy/` backed up somewhere durable, the way `.fortress-backups/` already
holds database snapshots. A generated bundle can always be rebuilt from an environment that has the
corpus, and `build-content-bundle.mjs --from=fortress-platform-production` will do exactly that once
production is populated -- so after the first provisioning, production is itself a second copy.

## Required Checks

1. Run `npm run check`.
2. Run `npm run pwa:visual-check` on Windows with Microsoft Edge installed.
3. Push to `dev` and wait for CI, API/Auth/Media/MCP deployment, portal deployment, and the PWA
   deployment (Cloudflare, plus the Bluehost standby).
4. Run `npm run soak:test`.
5. Confirm `/v1/ask/status` is ready or explicitly document why indexing is still in progress.
6. Review Admin audit history, verification workload, and service state.
7. Promote the tested commit to `main`; never rebuild from a different source state.

## PWA Gate

The static release check validates the manifest, install icons, service-worker precache paths, update protocol, accessible markup basics, and a 300 KB JavaScript/CSS shell budget.

The browser check covers:

- 390 by 844 mobile layout and 1440 by 900 desktop layout
- minimum 24 pixel interactive targets and accessible names
- horizontal overflow
- Dua, Hadith, and Ask mode isolation
- service-worker readiness and offline Dua reading
- a 500 KB decoded JavaScript/CSS shell budget, raised from 300 KB in 0.28.0 when thematic Quran
  search crossed it by 592 bytes -- which was the escalation agreed the last time it was reached
  (250 KB to 300 KB in 0.24.0). The step after this one is a deploy-time minification pass, not a
  further raise. The budget counts raw bytes of `js/`, `css/` and `styles.css` only: it does not
  see `data/duas.json`, precached on install and costing about as much again, and it taxes the
  explanatory comments this repo deliberately writes, which compress harder than code does

## Soak

`npm run soak:test` performs five rounds by default against nine test surfaces. Configure longer runs without changing code:

```powershell
$env:SOAK_ROUNDS=20
$env:SOAK_PAUSE_MS=5000
npm run soak:test
```

The soak is a bounded release signal, not production observability. Cloudflare analytics, audit history, and status checks remain the source for longer-term behavior.
