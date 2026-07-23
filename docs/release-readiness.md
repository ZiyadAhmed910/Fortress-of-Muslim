# Release Readiness

Fortress Platform promotes `dev` to `main` only after the test environment proves the same release is healthy across the PWA, Workers, and portals.

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
