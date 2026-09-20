# Release Readiness

Fortress Platform promotes `dev` to `main` only after the test environment proves the same release is healthy across the PWA, Workers, and portals.

## Production has never been stood up (as of 0.39.0)

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

The hadith corpus is deliberately not in the repository. `.gitignore` keeps the source corpus and
generated import bundles local-only, `docs/canonical-editorial-architecture.md` says preparation
provenance stays "outside the public repository and deployment artifacts", and
`tools/verify-public-canonical-boundary.mjs` fails the build if an external record URL reaches a
tracked public file. This repository is public, so that boundary is doing real work.

That means production content cannot simply be added as another migration without reversing a
standing decision. Whatever mechanism is chosen has to keep the corpus out of the public repository
while still being reproducible by something other than one laptop.

## Required Checks

1. Run `npm run check`.
2. Run `npm run pwa:visual-check` on Windows with Microsoft Edge installed.
3. Push to `dev` and wait for CI, API/Auth/MCP deployment, portal deployment, and Bluehost PWA deployment.
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
