# Release Readiness

Fortress Platform promotes `dev` to `main` only after the test environment proves the same release is healthy across the PWA, Workers, and portals.

## Current blocker: production Vectorize index is not migrated (as of 0.23.0)

`apps/api/src/rag.ts`'s `EMBEDDING_MODEL` is a single constant shared by both environments -- it
changed from `@cf/baai/bge-base-en-v1.5` (768-dim) to `@cf/baai/bge-m3` (1024-dim) in 0.23.0, and
the **test** Vectorize index was migrated to match (`fortress-rag-test-m3`, created fresh since
Vectorize indexes are dimension-locked at creation and can't be resized in place). **Production's
`fortress-rag-production` index is still 768-dim.** Promoting this code to `main`/production without
first migrating it will break every `POST /v1/ask` request in production (`VECTOR_INDEX.upsert`/
`.query` calls will fail on a dimension mismatch).

Before promoting past this point, either:
1. Create a new 1024-dim production index (`npx wrangler vectorize create fortress-rag-production-m3 --dimensions=1024 --metric=cosine` from `apps/api/`), point `wrangler.jsonc`'s `env.production.vectorize` binding at it, and let the deploy's indexing cron populate it from the production dataset before real traffic depends on it, or
2. Revert `EMBEDDING_MODEL` back to `bge-base-en-v1.5` for this promotion and ship the model upgrade separately once production's index is ready.

Remove this section once production's index is confirmed migrated and this is no longer a live risk.

## Required Checks

1. Run `npm run check`.
2. Run `npm run pwa:visual-check` on Windows with Microsoft Edge installed.
3. Push to `dev` and wait for CI, API/Auth/MCP deployment, portal deployment, and Bluehost PWA deployment.
4. Run `npm run soak:test`.
5. Confirm `/v1/ask/status` is ready or explicitly document why indexing is still in progress.
6. Review Admin audit history, verification workload, and service state.
7. Promote the tested commit to `main`; never rebuild from a different source state.

## PWA Gate

The static release check validates the manifest, install icons, service-worker precache paths, update protocol, accessible markup basics, and a 250 KB JavaScript/CSS shell budget.

The browser check covers:

- 390 by 844 mobile layout and 1440 by 900 desktop layout
- minimum 24 pixel interactive targets and accessible names
- horizontal overflow
- Dua, Hadith, and Ask mode isolation
- service-worker readiness and offline Dua reading
- a 250 KB decoded JavaScript/CSS shell budget

## Soak

`npm run soak:test` performs five rounds by default against nine test surfaces. Configure longer runs without changing code:

```powershell
$env:SOAK_ROUNDS=20
$env:SOAK_PAUSE_MS=5000
npm run soak:test
```

The soak is a bounded release signal, not production observability. Cloudflare analytics, audit history, and status checks remain the source for longer-term behavior.
