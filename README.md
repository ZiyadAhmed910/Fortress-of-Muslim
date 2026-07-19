# Fortress Platform

Fortress Platform is an open-source Islamic data and agent platform. Fortress of Muslim, its offline-first dua reader, is the first reference application and remains available without login, ads, or tracking requirements.

The platform is being developed as a monorepo. The existing static PWA continues to deploy from `pwa-website/`, while independently deployable services and shared packages live under `apps/` and `packages/`.

## Why This Exists

Many dua apps are either heavy, unavailable, cluttered, or tied to platform stores. This project aims to be:

- Simple enough to run from static hosting.
- Fast enough for older phones and slow connections.
- Offline-friendly after the first load.
- Accessible without accounts, tracking, or ads.
- Easy for contributors to improve as the dua data becomes cleaner and richer.

The long-term plan is to support a larger curated library with 300-400 duas, references, ruqyah sections, mood-based discovery, and import/export for personal settings.

## App Features

- Offline-first PWA with manifest and service worker.
- Responsive mobile-first interface.
- Simple UI by default.
- Optional advanced graphical UI.
- Home list with category pills.
- Advanced home cards for all duas, morning, evening, sleep, salah, travel, favourites, moods, and ruqyah.
- Advanced bottom navigation with Home, Favourites, Morning, Evening, Moods, and Ruqyah.
- Search across titles, dua text, Arabic/transliteration/translation content, derived categories, moods, and tags.
- Highlighted title matches in search results.
- Favourites saved locally in the browser.
- Favourites-only view.
- Detail reader with part navigation.
- Swipe support in the reader.
- Copy and share full dua text.
- Zoom in/out reading controls.
- Dark mode.
- Larger Arabic text option.
- Settings backup export/import for favourites and settings.
- Lightweight loading skeleton.
- Lazy list rendering with Load more.
- Lazy-loaded advanced card images.
- Version display in Settings.
- Install prompt and update banner support.

## Project Structure

```text
.
├── apps/
│   ├── api/              Cloudflare Worker public API
│   ├── auth/             Identity, credentials, OAuth and control plane
│   ├── developers/       Developer documentation and API explorer
│   └── status/           Live service status dashboard
├── packages/
│   ├── contracts/        Shared runtime schemas and TypeScript types
│   └── portal-ui/        Shared portal design system and build tooling
├── android-app/
│   └── README.md
├── docs/
│   ├── deployment.md
│   └── platform-architecture.md
├── pwa-website/
│   ├── assets/
│   ├── css/
│   ├── data/
│   ├── icons/
│   ├── js/
│   ├── tools/
│   ├── index.html
│   ├── manifest.json
│   ├── serve.py
│   ├── styles.css
│   └── sw.js
└── Fortress_of_Muslim.docx
```

## Platform Development

Install dependencies and verify every workspace:

```powershell
npm install
npm run check
```

Run the Cloudflare API locally:

```powershell
npm run dev:api
```

Run either static platform portal locally:

```powershell
npm run dev:developers
npm run dev:status
```

Current hosted test API:

```text
https://api-test.fortressofmuslim.org
```

Useful verification endpoints:

```text
/health
/v1
/v1/datasets/current
/v1/duas?limit=2
/v1/duas/search?q=protection
/v1/duas/random
/v1/duas/dua.hisn.001
/v1/duas/dua.hisn.001/parts
/v1/duas/dua.hisn.001/parts/1
/v1/queries/{named-query-id}
```

Canonical IDs and legacy IDs are both accepted by detail and part routes. List and search responses return lightweight summaries; detail and random routes return the complete ordered content record.

Content endpoints require a Fortress API key in `X-Fortress-API-Key` or an OAuth 2.1 bearer token. Create beta credentials in the Developer Portal. The API root, `/health`, and `/v1` discovery route remain public.

The API stores published content in Cloudflare D1. Generate and verify the deterministic migration from the current PWA dataset with:

```powershell
npm run db:generate --workspace @fortress/api
npm run db:verify --workspace @fortress/api
```

The generated migration preserves the source text exactly and must not be edited manually. Editorial corrections belong in the source dataset or the future Admin publishing workflow.

The test API uses the `dev` branch and the production API uses `main`. Cloudflare deployment remains disabled until the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is set to `true` and the required account secrets are configured. Setup is documented in `docs/cloudflare-setup.md`.

Every platform release must:

1. Update the platform release notes in this README.
2. Pass `npm run check` and the Cloudflare Worker bundle check.
3. Deploy to the test environment from `dev`.
4. Be verified through its live health and version endpoints.
5. Deploy to production from `main` only after test verification.

## Platform Releases

### 0.9.0

- Added `find_dua`, a one-call MCP tool that fuzzy-matches natural-language and misspelled titles.
- Title lookup now returns complete dua records immediately, avoiding the previous search-summary and ID-detail round trip.
- Added focused ranking tests and MCP instructions that distinguish fast title lookup from broad full-text search.

### 0.8.1

- Fixed the interactive OAuth authorization-code flow used by ChatGPT and other MCP clients.
- Added a dedicated Fortress login and consent screen that preserves and resumes signed OAuth requests.
- Interactive connected apps now include refresh-token access, and MCP tools advertise read-only safety metadata.

### 0.8.0

- Replaced separate custom MCP server drafts with one managed Fortress MCP runtime and user-owned custom toolsets.
- Added standard MCP tools for searching, listing, retrieving, and selecting duas plus dataset metadata.
- Added custom tools backed by standard tools, named-query APIs, or review-gated external HTTPS APIs.
- Rebuilt named queries as declarative record queries with selected fields, allowlisted filters, endpoint parameters, sorting, and enforced row limits.
- Connected OAuth client credentials to their owning developer so permissioned apps can execute owner-scoped named queries and MCP toolsets.
- Made OAuth callbacks conditional on interactive flows and kept PKCE as the default for browser, mobile, and AI clients.
- Added optional browser persistence for one-time API-key secrets so API Explorer can reuse a key after reopening the portal.
- Improved account-creation validation and simplified the Developer Console language around devices, apps, tools, and credentials.

### 0.7.0

- Added a dedicated `admin.fortressofmuslim.org` console with server-side administrator roles.
- Added global search across users, credentials, OAuth clients, devices, MCP registrations, named queries, and content records.
- Added account suspension, credential/resource state controls, content verification controls, and a privileged audit trail.
- Added enforceable API maintenance and disabled states while preserving health endpoints for recovery.
- Added test and production deployment definitions for the Admin Console; production remains protected by the existing GitHub environment gate.

### 0.6.0

- Separated developer identity and credential management from the API documentation into a dedicated Developer Console.
- Added a profile icon and account dropdown with direct access to API keys, connected apps, and MCP management.
- Added multiple API keys with optional expiration, one-time secret display, browser-session Explorer selection, and owner-checked revocation.
- Expanded connected apps with multiple callback URLs, public PKCE, confidential, client credentials, and private-key JWT client profiles.
- Added OAuth 2.0 Device Authorization for limited-input devices plus a device inventory for IoT, CLI, gateway, and service identities.
- Distinguished the official Fortress-managed MCP server from custom OpenAPI-backed and named-query-backed MCP drafts.
- Added safe named queries that compile allowlisted list, search, and record operations into owner-scoped API endpoints without accepting raw SQL.
- Added an executable `/v1/queries/{id}` route, API Explorer handoff, OpenAPI documentation, schema checks, and API contract coverage.

### 0.5.0

- Added a dedicated Cloudflare Auth Worker backed by separate test and production identity D1 databases.
- Added developer accounts, sessions, organizations, hashed one-time-reveal API keys, and scoped key verification.
- Added an OAuth 2.1 authorization server with PKCE, client credentials, JWKS, consent, audience binding, and connected-app management.
- Protected content APIs through an internal Auth Worker service binding while keeping health and discovery public.
- Added a narrow public database-health probe so the Status Portal can verify D1 without holding a content credential.
- Added plans, access requests, usage, audit, and user-defined MCP registration foundations to the control-plane schema.
- Upgraded the Developer Portal with sign-up/sign-in, API-key management, connected apps, MCP drafts, and an authenticated API Explorer.
- Updated quickstarts and OpenAPI security schemes so documentation examples use the same working authentication contract.
- Added deployment ordering, migration checks, dependency auditing, and Auth Worker configuration documentation.

### 0.4.0

- Added a responsive Developer Portal with Salesforce-style documentation navigation.
- Documented environments, authentication direction, content concepts, errors, and every public v1 endpoint.
- Added searchable documentation, language quickstart tabs, copy actions, and downloadable OpenAPI.
- Added a live API Explorer with environment selection, response timing, and formatted JSON.
- Added a responsive Status Portal with real API, database, PWA, and developer portal probes.
- Added measured latency, API version reporting, manual refresh, and local recent-check history.
- Clearly separated live beta services from production services awaiting promotion.
- Added a shared lightweight portal design system with accessible light and dark themes.
- Added independent Cloudflare Worker deployments for test and production portal domains.
- Added automated portal builds and verification to CI.

### 0.3.0

- Added full-text-like D1 search across dua titles, Arabic, transliteration, translations, and commentary.
- Added a random complete-dua endpoint with cache prevention.
- Added ordered part collection and single-part endpoints for swipe-based readers.
- Added structured validation and errors for search parameters and part positions.
- Preserved canonical and legacy ID lookup across all record routes.
- Expanded automated API coverage from five to nine endpoint tests.
- Expanded the OpenAPI specification with parameters and reusable response schemas.

### 0.2.0

- Added separate Cloudflare D1 content stores for test and production.
- Added a normalized, versioned schema for datasets, content records, ordered parts, and typed text segments.
- Assigned stable canonical IDs such as `dua.hisn.001` while retaining legacy IDs for compatibility.
- Added a deterministic JSON-to-D1 migration generator with SHA-256 source provenance.
- Imported 135 duas as 320 parts and 1,105 Arabic, transliteration, translation, and commentary segments.
- Added migration integrity checks for record counts, relationships, and canonical identity.
- Replaced the API's bundled JSON access with a D1 repository without changing the public dua response format.
- Added automatic D1 migrations before Worker deployment.

### 0.1.1

- Activated Cloudflare DNS while retaining Bluehost as the PWA, email, FTP, and cPanel origin.
- Added infrastructure-as-code custom domains for test and production API environments.
- Connected the test API to `api-test.fortressofmuslim.org`.
- Retained the `workers.dev` address as a diagnostic origin rather than the public platform hostname.

### 0.1.0

- Established the Fortress Platform monorepo alongside the existing PWA.
- Added shared TypeScript and runtime API contracts.
- Added the first Cloudflare Worker API with health, dataset, paginated dua, and canonical-ID endpoints.
- Added an OpenAPI 3.0 specification.
- Added test and production Worker environments.
- Added automated GitHub CI and Cloudflare deployment workflows.
- Deployed and verified the first hosted test API on Cloudflare Workers.
- Marked the current Word-derived content as a legacy import pending canonical editorial verification.

## Local Development

### Admin Console

The Admin Console is a separate static portal backed by authenticated `/v1/admin/*` control-plane routes on the Auth Worker. Administrator authorization is stored in D1 and is never inferred from an email address or browser state.

```bash
npm run dev:admin
```

Bootstrap the first administrator only after that person has created a normal developer account. Look up the user's canonical ID, then insert it into `platform_admins` with `super_admin` role using Wrangler. Never hard-code a privileged email or user ID in source. Additional administrators should be granted through an audited admin workflow.

Service Control currently enforces maintenance and disabled states for the Content API. Auth and Admin are recovery services and cannot be disabled from the console. The Bluehost PWA and static portals are displayed as monitoring-only until traffic is moved behind an enforceable Cloudflare Worker gateway.

Run the PWA from the `pwa-website` folder:

```powershell
cd pwa-website
python serve.py
```

Then open:

```text
http://127.0.0.1:8080/
```

Do not rely on opening `index.html` directly for PWA testing. Service workers require HTTPS or localhost.

## Data Model Direction

The PWA currently loads its static source from:

```text
pwa-website/data/duas.json
```

The public API imports that source into Cloudflare D1 as a versioned dataset. Each dua receives a canonical ID, ordered parts, and ordered typed segments. The original `uid` remains available as `legacyId`. All initial records are marked `pending` until canonical editorial review.

Current API storage:

```text
dataset_versions -> content_records -> content_parts -> content_segments
```

This normalized structure supports precise updates, references, categories, moods, tags, and additional content types without placing every dua into Worker memory.

Future data should support:

- stable `uid`
- title
- ordered parts
- Arabic
- transliteration
- translation
- comments
- references
- categories
- moods
- tags
- source notes

## Deployment

The repository uses two main branches:

- `dev` deploys to the Bluehost test site.
- `main` deploys to production.

Feature branches should use:

```text
feature/name-of-feature
```

The intended workflow is:

```text
feature branch -> PR -> merge to dev -> test deploy -> promote to main -> production deploy
```

Deployment details and required GitHub secrets are documented in:

```text
docs/deployment.md
```

## Contributing

Contributions are welcome. Helpful areas include:

- improving UI and accessibility
- cleaning dua text
- adding references
- improving search
- improving metadata categories/tags/moods
- reducing memory usage
- testing PWA install/update behavior on Android and iOS
- preparing the future Android app

Before submitting work:

1. Create a feature branch from `dev`.
2. Keep changes focused.
3. Test locally with `python serve.py`.
4. Make sure the PWA version/cache is bumped when changing deployed JS/CSS.
5. Avoid editing generated dua data unless the change is intentional and reviewed.

## Versioning

The visible app version is stamped from Git history during deployment:

```text
pwa-website/tools/stamp_version.py
```

Current approach:

- releases use a sequential three-digit patch style: `1.001`, `1.002`, `1.013`, etc.
- the sequence is derived from the Git commit count.
- major redesign or breaking data changes: `2.0`

The service worker build/cache version is stamped from the current commit SHA. The deploy workflows run the stamping script automatically before uploading to Bluehost.

## Release Notes

### 1.013

- Fixed simple-home category pills so they open the same category/list flow as advanced cards.
- Fixed old UI category pills so filtered content actually changes.
- Simplified Settings backup actions back to compact buttons.
- Replaced Moods and Ruqyah placeholder cards with generated bitmap cards.
- Replaced the app icon/favicon with a cleaner moon-and-star mark.
- Added automatic deployment version stamping.

### 1.012

- Improved Settings backup layout with separate Export and Import rows.
- Added this open-source README.

### 1.011

- Restored Morning and Evening to the advanced bottom navigation.
- Added Moods and Ruqyah as additional bottom navigation items.
- Replaced text placeholders with SVG icons.
- Added Moods and Ruqyah cards to the advanced home.

### 1.010

- Added runtime category, mood, tag, and ruqyah filtering.
- Added smarter search across text and metadata.
- Added title highlighting for search matches.
- Added settings export/import for favourites and settings.
- Added loading skeleton rows.
- Added lazy list rendering with Load more.
- Lazy-loaded advanced UI images.

### 1.00

- Added visible app version in Settings.
- Established dev/test and main/production deployment flow.

## License

License is not finalized yet. Before broad public contribution, add a clear open-source license file.
