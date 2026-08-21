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
/v1/collections?type=hadith
/v1/hadith?collection=bukhari&limit=2
/v1/hadith/search?q=intentions&collection=bukhari
/v1/hadith/hadith.bukhari.1
/v1/hadith/resolve?collection=bukhari&book=1&number=1
/v1/ask
/v1/queries/{named-query-id}
```

Canonical IDs and retained Fortress legacy dua IDs are accepted by detail and part routes. List, search, detail, part, random, and evidence routes expose the current editorial revision, including unverified candidates. Every response carries `verificationStatus`, `workflowState`, `verifiedBy`, `verifiedAt`, and nullable `publishedAt` fields so consumers can make an explicit trust decision.

The PWA snapshot contains only published canonical Fortress of Muslim chapters. Candidate records under editorial review are never included. Hadith browse/search and the source-grounded assistant are API-based and are not stored for offline use.

Current editorial records and browse, search, detail, part, random, and evidence endpoints are public without login. Developer-owned named queries and management capabilities require a Fortress API key or OAuth 2.1 bearer token.

The API stores candidates, immutable revisions, editorial decisions, and published records in Cloudflare D1. Verify the public migration and governance invariants with:

```powershell
npm run db:verify --workspace @fortress/api
npm run editorial:verify --workspace @fortress/api
```

The public REST API and API-backed MCP tools expose current records through `api_current_content`, including unverified material with an explicit editorial status. The public statuses are intentionally small: `pending_review`, `verified`, and `changes_requested`. RAG remains restricted to verified records in `canonical_publications`, while the 132-chapter Hisn library is bundled locally with the PWA for reliable offline reading.

Build the PWA's offline dua snapshot from the published API boundary:

```powershell
npm run pwa:data:build
```

Vector indexing is idempotent, resumable, and restricted to the current published canonical dataset. The API Worker checks for pending batches every minute; the command remains available for supervised recovery:

```powershell
node apps/api/tools/index-rag.mjs test --cursor=10050
```

The test API uses the `dev` branch and the production API uses `main`. Cloudflare deployment remains disabled until the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is set to `true` and the required account secrets are configured. Setup is documented in `docs/cloudflare-setup.md`.

Every platform release must:

1. Update the platform release notes in this README.
2. Pass `npm run check` and the Cloudflare Worker bundle check.
3. Deploy to the test environment from `dev`.
4. Be verified through its live health and version endpoints.
5. Deploy to production from `main` only after test verification.

## Platform Releases

### 0.23.2

- **Fixed the Developer Portal's Sign out button staying visible while logged out**: the profile
  dropdown's `[hidden]` attribute was being set correctly by `app.js`, but `styles.css`'s
  `.profile-dropdown button { display: block; }` rule had equal specificity to the browser's
  default `[hidden]` behavior and won on source order, so the button rendered anyway despite being
  logically hidden. Added an explicit `.profile-dropdown [hidden] { display: none; }` override in
  both `styles.css` and `console.css` (the latter as a defensive fix; its own sign-out button
  turned out to already be correctly hidden via its ancestor). Verified live that only "Sign out"
  was affected -- the other profile menu links are meant to stay visible when logged out.

### 0.23.1

- **Fixed TOTP QR code unscannable by Microsoft Authenticator**: the Developer Portal's
  authenticator-app QR renderer (`apps/developers/public/console.js`) drew modules edge-to-edge
  in the SVG with no quiet zone, relying only on a fixed CSS padding that didn't scale with the
  QR's module count. Google Authenticator tolerates the missing margin; Microsoft Authenticator's
  scanner does not, and would fail to locate the finder patterns. The 4-module quiet zone required
  by the QR spec is now baked into the SVG's own coordinate system.

### 0.23.0

Search/RAG quality and PWA discovery, closing out the rest of the post-0.20 search roadmap:

- **Arabic search normalization**: SQLite FTS5's `remove_diacritics 2` tokenizer (already set on
  `canonical_search_fts`) does not strip Arabic tashkeel or fold alef-hamza variants (أ إ آ ٱ) --
  verified empirically against the real schema before fixing it. Both the index-population side
  (`apps/auth`, every `canonical_search_fts` write path) and the query side (`apps/api`,
  `toFtsQuery`/`toRagFtsQuery`) now normalize identically, so a diacritic or alef-form mismatch
  alone no longer causes a silent zero-result search.
- **Exact-reference search for Ask**: a question that's essentially just a reference on its own
  (`"Bukhari 52"`) resolves directly against the matching record instead of running the full
  embedding/lexical/synonym-expansion retrieval pipeline -- collections are editor-created with no
  fixed enum, so the hint is fuzzy-matched in JS against the real hadith collections. Falls through
  to normal retrieval when the hint doesn't resolve.
- **Metadata-filtered retrieval for Ask**: `POST /v1/ask` accepts an optional `filters` object
  (`contentType`: `dua`/`hadith`, `collection`: slug) threaded through vector retrieval (Vectorize's
  native metadata filter), lexical FTS retrieval, and the unverified-content fallback. The PWA Ask
  UI got a content-type select wired to it.
- **PWA category/mood discovery**: category and mood filter chips now show a live count of matching
  duas, and the mood panel shows a short description of the selected feeling, computed from the
  existing per-entry categories/moods with no new taxonomy to maintain.
- **Embedding model upgrade (test environment only)**: Ask's semantic retrieval moves from
  `@cf/baai/bge-base-en-v1.5` (768-dim, English-only) to `@cf/baai/bge-m3` (1024-dim, multilingual,
  8192-token context) -- directly targets mixed Arabic/English/transliteration questions ("siwak"
  vs. "miswak"). Vectorize indexes are dimension-locked at creation, so this required a new index
  (`fortress-rag-test-m3`) rather than an in-place resize; the old `fortress-rag-test` index is left
  allocated but unused. **Production's index is not yet migrated** -- see
  `docs/release-readiness.md`'s current blocker before promoting this to `main`.

### 0.22.0

Editorial and Ask/AI improvements, from a working session focused on closing gaps a real user hit
while using the platform:

- **Field-level verification linked to overall approval**: approving a whole record (single,
  bulk, or Hadith book verification) now fills in a `verified` `field_reviews` row for every
  reviewable field (arabic, translation, narrator, grading, ...) not already reviewed by that
  same reviewer -- an individually-reviewed field's own decision is never overwritten. Field-level
  data stays admin/editorial-only; the public API only ever exposes overall verification status.
- **Taxonomy term assignment**: `record_taxonomy` had been read-only since it was created --
  terms could be made and counted, but nothing could ever be assigned to a record. Seeded the same
  mood/occasion vocabulary the offline PWA already uses, added keyword-derived suggestions (an
  editor must still confirm before anything is assigned), and a checklist in the Admin Console
  record dialog to do it.
- **Smarter Ask retrieval**: a curated Islamic-terminology synonym dictionary (siwak/miswak, wudu/
  wudhu, ...), an LLM query-expansion step before retrieval (2 alternate phrasings per question,
  merged in), and a supplementary unverified-content fallback for when verified results come up
  thin -- clearly labeled as not verified in both the generated answer and the sources list, never
  presented with the same confidence as verified material. Deliberately deferred: swapping the
  embedding model for a stronger multilingual one, since the only meaningfully better Workers AI
  options use a different vector dimension than the existing Vectorize index, which would require
  recreating real Cloudflare infrastructure rather than a code change.
- **Ask now submits on Ctrl+Enter or Alt+Enter**, not just the button click, with a visible hint.

### 0.21.0

Developer experience and Admin Console improvements, from a full-codebase review that looked for
built-but-broken and built-but-unreachable functionality alongside genuinely new capability:

- **Developer usage/quota dashboard**: `GET /v1/control/usage` (a non-incrementing peek at the
  same plan limits and rate-limit counters `checkRateLimit` enforces) rendered as a usage card on
  the Developer Console overview, so a developer can see how close they are to their per-minute/
  per-day limit instead of only discovering it from a `429`.
- **Inline validation and live preview for the named-query and MCP toolset/tool builders**: each
  drawer now shows the resulting endpoint/connection URL or tool call name as you type, and the
  filter-value field enforces the same parameter-name pattern the server does, so a mistake surfaces
  before submit instead of after a round-trip failure. Also fixed the MCP connection URL (managed
  endpoint banner and every custom toolset's URL) to derive from environment like the API base URL
  already does, instead of being hardcoded to `mcp-test.fortressofmuslim.org` in all environments.
- **Loading/empty/error states across the Developer Console**: every section fetches independently:
  previously a failed fetch left that section exactly as blank as the static HTML defined it,
  indistinguishable from "still loading" or "genuinely empty," with only one aggregate toast as any
  signal. Each section now shows its own loading spinner while in flight and, on failure, an inline
  error with a scoped Retry button.
- **Admin Console health-first overview banner**: previously only rendered when there were active
  alerts and showed just a count. Now always renders: a positive "All systems normal" state when
  clear, or a severity breakdown plus the top 3 unresolved alert messages inline when not, so an
  admin can see what's wrong without leaving Overview.
- **JS/Python SDK examples** for OAuth client-credentials, named queries, and MCP tool calls in the
  API docs, reusing the existing curl/JavaScript/Python tab component that was previously used only
  for the single basic quickstart request.
- **Webhooks for `record.published` and `record.verified`**: developer-registered, HMAC-signed
  (`X-Fortress-Signature: sha256=...`), best-effort delivery (no Cloudflare Queues/cron, no new
  billed infrastructure) fired from all four publish/verify paths in `editorial-plane.ts`. A failed
  delivery is not retried automatically; the Developer Console's new Webhooks section shows a
  per-subscription delivery log with a manual Redeliver action.

### 0.20.0

0.20 Operations: production reliability and safety, deliberately shipped as one release with no new
user-facing feature surface, per the release goal of proving the platform can be operated safely
before growing it further. All eight items closed:

- Ran and logged a real D1 backup + Time Travel restore drill against the test environment (not a
  dry run): backed up both databases, created a throwaway marker, restored it away with Time Travel,
  and confirmed the platform stayed healthy across all 9 monitored surfaces. See `docs/incident-response.md`
  Drill Log.
- Automated FTS index rebuild after disaster recovery (`tools/rebuild-fts.ps1`), reusing the exact
  SQL the application already runs during Hadith book verification rather than a new implementation.
  The first live run found and corrected a real 1-row drift between the search index and current
  editorial state.
- Added scheduled, genuinely encrypted D1 backups to Cloudflare R2 with a 30-day retention rule
  (`.github/workflows/scheduled-backup.yml`, `tools/lib/backup-crypto.ps1`). `backup-d1.ps1` previously
  wrote plain SQL while being documented as "encrypted-at-rest" -- that was never true; it now
  actually encrypts (streamed AES-256-CBC + HMAC-SHA256, verified against the full 150MB+ content
  export after an in-memory first attempt failed with an out-of-memory error on that exact file).
- Added operational alerts to the Admin Console (service down/maintenance, elevated error rates,
  indexing failures, unusual API usage), evaluated fresh on every view and surfaced as a dedicated
  Alerts page plus an Overview banner -- Admin-Console-only by explicit choice, no external paging.
- Added enforceable, admin-configurable per-plan API rate limits (basic/premium/enterprise), replacing
  telemetry-only visibility with real enforcement on every credentialed request; anonymous public
  reads remain unlimited by design.
- Made two-factor authentication mandatory for the Admin role (Editor/Reviewer remain optional),
  with a clear in-console enrollment prompt instead of a broken console, and documented the account
  recovery procedure for a full MFA lockout.
- Added incident acknowledgement (acknowledge/resolve) on top of the same alerts table, so an alert
  and an incident are one system at different points in its lifecycle rather than two.
- Confirmed release-readiness tooling (`npm run check`, soak test, smoke tests) is ready for the
  promotion gate.

Every item above was verified against live Cloudflare test infrastructure during development, not
just against local mocks -- several of the fixes described (the FTS drift, the backup memory issue)
were found by that verification, not anticipated in advance.

### 0.19.1

- Fixed developer-created "record query" named queries (Developer Portal and the equivalent MCP tool
  path) reading from the retired `content_records`/`dataset_versions` tables instead of the current
  canonical editorial schema. They were silently frozen on the original unverified 2026-07-18 DOCX
  import (135 records) and could never reflect anything published since; every other read path
  already used the canonical schema. Rewired to `api_current_content`/`canonical_records`/`content_revisions`,
  the same join every other content route uses. Verified against the real migrated schema, not just
  the existing mocked unit test.
- Ran a real D1 backup and D1 Time Travel restore drill against the test environment end to end
  (see `docs/incident-response.md` Drill Log) rather than relying on the scripts being untested.

### 0.19.0

- Fixed Developer and Admin sign-out so sessions end cleanly and authenticated controls disappear immediately.
- Added browser-level regression checks for signed-out UI state.
- Added TOTP two-factor authentication and WebAuthn passkey enrollment and sign-in.
- Added a 12-hour absolute Admin session lifetime, active-session inventory, and audited session revocation.
- Added sampled API request telemetry with 30-day retention, latency/error/rate-limit summaries, and API-key usage metrics.
- Added a focused Admin Operations Monitor for traffic, editorial and access queues, and live API/Auth/MCP deployment probes.
- Split Admin user management into searchable Team Access and Developer Accounts views.
- Added user-level active-session inspection and revocation.
- Added D1 backup and guarded restore scripts with checksums, mandatory pre-restore backups, and explicit production approval.
- Added the incident response, rollback, credential-compromise, and recovery runbook in `docs/incident-response.md`.

### 0.18.0

- Replaced the multi-review workflow with one complete verification by an authorized Admin, Editor, or Reviewer.
- Added permanent verifier identity and timestamp stamps to editorial record state and evidence.
- Added a unified Admin, Editor, Reviewer, and Developer hierarchy with an explicit administrator flag.
- Restricted platform management to Admins, while Editors can manage Reviewer access and editorial work.
- Seeded `ziyadahmed910@gmail.com` as the protected default Admin and added self-healing bootstrap on sign-in.
- Exposed current verified and unverified records through REST and API-backed MCP tools with explicit verification and workflow fields.
- Kept PWA snapshots and RAG retrieval restricted to verified, published revisions.
- Added public-read indexes and direct content-type counts to reduce cold list latency as the library grows.
- Restored the verified 132-chapter Hisn offline snapshot and prevented API publication state from emptying local PWA data.
- Simplified visible editorial statuses to Pending Review, Verified, and Change Requested; publication batching is no longer part of the normal Admin Console flow.
- Verified and published all 268 individual Hisn readings while leaving Hadith collections pending review.
- Added Admin authoring for new Dua and Hadith records with ordered parts, metadata, and a required canonical reference.
- Added one-action Hadith book verification that stamps every record, publishes a complete mixed-corpus snapshot, and queues it for RAG indexing.
- Added resumable scheduled indexing for verified Hadith and Duas, with per-content-type readiness counts.
- Unified identity and editorial events in the Admin audit history and protected the default and final active administrator.
- Replaced positional lexical RAG scores with query-aware title and body relevance, then removed evidence that falls materially below the strongest match.
- Normalized known legacy typography corruption in generated-answer context without changing canonical source records.
- Required every generated-answer paragraph to carry a valid citation and prohibited inferred Quran or Hadith attribution.
- Added an Admin RAG monitor with corpus-specific vector readiness, indexing progress, and failure diagnostics.
- Added role-scoped editorial assignments with audited completion and cancellation controls.
- Added selected-record bulk verification and change requests with bounded per-record outcomes.
- Added a reviewer workload dashboard covering open work, pending records, completed assignments, and recent decisions.
- Expanded correction revisions to include Hadith display number, narrator, grade, and grading authority.
- Added reversible lifecycle controls for OAuth apps, named queries, MCP toolsets, and individual custom tools.
- Revoked outstanding OAuth access and refresh tokens whenever a connected app is disabled.
- Reconciled browser-remembered API keys with the authoritative server key list.
- Added PWA cache-manifest, install metadata, accessibility, and shell-size checks to CI.
- Added automated mobile target-size, overflow, online-mode, offline-cache, and update-flow browser checks.
- Added a repeatable multi-surface test soak command for release promotion.

### 0.17.0

- Repaired Ask with canonical-dataset preflight, hybrid vector and lexical retrieval, deterministic cited fallback, citation validation, and public index-readiness reporting.
- Corrected vector indexing to embed the exact immutable revisions selected by `canonical_publications`.
- Added per-dataset RAG index state and status monitoring at `GET /v1/ask/status`.
- Hardened editorial work with reviewer assignment enforcement, queue pagination, operational lookups, revision comparison, duplicate suggestions, and partial immutable field-review progress.
- Added detailed publication validation reports, editable draft batches, complete immutable dataset snapshots, and audited atomic rollback.
- Added an automated editorial pilot covering separate editor, reviewer, senior reviewer, and publisher identities from assignment through publication and rollback.

### 0.16.0

- Established Fortress Platform as the sole public canonical publication boundary.
- Added immutable content revisions, 13-field reviews, two independent reviewer approvals, separate senior approval, disagreement tracking, scoped assignments, and atomic publication batches.
- Added editorial roles for viewer, reviewer, senior reviewer, editor, publisher, and super administrator.
- Rebuilt the Admin Console around queue, review, correction, evidence verification, batch publication, and role-management workflows.
- Restricted REST, MCP, RAG, and PWA data to explicitly published canonical revisions.
- Added sequential Fortress URLs such as `/bukhari/book1/1` and an exact API resolver for those routes.
- Replaced the local data builder with a published-API snapshot builder and moved candidate-preparation tooling outside the public repository.

### 0.15.0

- Replaced the legacy PWA export with a validated local corpus of 132 Fortress chapters and all 268 ordered recitations while preserving stable favourite IDs.
- Added explicit category, mood, and tag metadata to the local PWA artifact and strict reproducible build checks.
- Added an online PWA Hadith browser with collection filtering, full-text search, pagination, and source-linked details.
- Added a rate-limited, source-grounded Ask API and PWA interface using Workers AI and Cloudflare Vectorize.
- Added the `ask_fortress` standard MCP tool, resumable vector indexing, D1 usage accounting, and OpenAPI coverage.
- Kept raw source artifacts out of Git and kept Hadith and AI responses outside the PWA offline cache.

### 0.14.0

- Added the initial Hadith hierarchy, numbering, grading, search, API, and MCP capabilities.
- This release's pre-canonical data flow is superseded by the 0.16.0 editorial and publication architecture.

### 0.13.0

- Added cross-site mutation protection and a 64 KB request-body ceiling for session-authenticated Admin and Developer Console operations.
- Prevented Auth responses from being cached or framed and added a restrictive Content Security Policy to every Cloudflare portal.
- Made Developer Console requests time out cleanly, retry safe reads once, include request IDs, recover from partial loading failures, and return to sign-in when a session expires.
- Improved tabs, profile menus, drawers, focus restoration, keyboard navigation, live error announcements, submit locking, and corrupted dynamic labels in the Developer Console.
- Added production dependency auditing, bounded workflow runtimes, and post-deployment smoke tests for Workers, portals, and both PWA environments.

### 0.12.0

- Standardized request IDs, platform-version headers, server timing, baseline security headers, and privacy-conscious structured request logs across API, Auth, and MCP Workers.
- Added the shared platform version to Auth health and database health responses.
- Rebuilt the Status portal to detect test or production automatically and check API, D1 access, Auth, MCP, PWA, Developer Portal, and Admin Console.
- Added platform-version skew detection and separate browser-local status histories for test and production.
- Hardened Cloudflare static portals with `_headers` rules and extended CI verification for operational checks and security configuration.

### 0.11.0

- Added the first content-governance console, controlled taxonomy, review history, correction history, and content audit events.
- These direct-editing controls are superseded by the immutable editorial workflow introduced in 0.16.0.

### 0.10.0

- Added the canonical knowledge schema for provenance, collections, books, chapters, languages, translations, dua and Hadith metadata, taxonomy, references, contributors, and search metadata.
- Added append-only verification, correction, publication, and content-audit history.
- Added `GET /v1/duas/{id}/evidence` so clients can inspect source and editorial evidence without inferred or fabricated citations.
- Added the read-only MCP tool `get_dua_evidence` for authenticity, attribution, and citation checks.
- Opened core published read routes for anonymous access while keeping owner-scoped named queries authenticated.
- Added the first evidence gate and documented canonical publishing and public access decisions in ADRs.

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

The Admin Console is a separate static portal backed by authenticated `/v1/admin/*` control-plane routes on the Auth Worker. Administrator authorization is stored in D1 and is never inferred from an email address or browser state. Its Knowledge workspace manages source provenance, citation status, controlled taxonomy, evidence eligibility, and append-only editorial history.

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

Canonical data decisions and staged work are documented in:

- `docs/canonical-data-roadmap.md`
- `docs/canonical-editorial-architecture.md`
- `docs/incident-response.md`
- `docs/release-readiness.md`
- `docs/adr/0001-canonical-knowledge-and-snapshots.md`
- `docs/adr/0002-public-read-api.md`
- `docs/adr/0003-evidence-gated-verification.md`
- `docs/adr/0004-operational-response-contract.md`
- `docs/adr/0005-browser-and-deployment-hardening.md`

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

### 1.017

- The "Reload app" recovery now lands on a one-time `?reset=<timestamp>` URL. Reloading the same URL could still be answered from a cache, so a device that reached the fallback could bounce straight back to it; a URL that has never been requested cannot match any cache entry, in CacheStorage or the browser HTTP cache. The marker is stripped from the address bar once the app is up.
- The fallback now explains itself: an expandable "What went wrong?" panel reports the build the device is actually running, whether it is installed or in a browser, online state, service worker and cache status, and the underlying script errors, with a Copy details button.
- Fixed an unhandled rejection from the background location refresh. It is best-effort polish on top of coordinates already on screen, but a rejection there was visible to the startup watchdog as a failed boot.

### 1.016

- Fixed the app getting stuck on "This app didn't finish loading properly", where tapping Reload looped straight back to the same screen. Only the `js/app.js` entry point was cache-busted; every module it imports was not, and the host serves `/js/` with a 4-hour `max-age` that overrode our `.htaccess` no-cache rule. After a deploy the browser paired a fresh `app.js` with hours-stale modules, so startup threw. Clearing the service worker and its caches (what Reload did) never touched the browser HTTP cache holding those modules, so every reload reproduced it until the cache expired. Every module import is now build-stamped, so a stale module can no longer be paired with a new one.
- The service worker now fetches with `cache: 'reload'` during install, so a stale HTTP-cached file can never be baked into a fresh worker cache and outlive the entry that produced it.
- A failed decorative card image no longer fails the whole service worker install, which previously could strand everyone on the old version.
- The startup watchdog now waits for the app shell rather than the dua data, so a slow connection is no longer mistaken for a broken app.

### 1.015

- Reworked Settings from one long scrolling list into a category list that drills into a subscreen per category (Appearance, Prayer & Qibla, Reminders, Customize Layout, Data, About), with a back button, instead of everything shown at once.
- The Prayer & Qibla settings category now disappears entirely from Settings when both those tabs are disabled via Customize Layout, instead of staying visible with nothing to apply to.
- Morning/Evening adhkar rows now fully hide (not just dim) when the Reminders master toggle is off.
- Added a bootstrap-level fallback that detects when the app fails to finish loading (e.g. right after a broken deploy) and offers a "Reload app" button that clears the service worker and caches for a clean retry -- previously a broken update could leave the app stuck with no way to recover.

### 1.014

- Split the combined Prayer screen into independent Prayer Times and Qibla tabs, sharing the same resolved location.
- Reorganized Settings into categorized sections (Appearance, Prayer & Qibla, Reminders, Customize Layout, Data, About) with a clear dimmed/disabled visual state for toggled-off rows.
- Added a Customize Layout section in Settings letting you enable/disable Hadith, Ask, Prayer Times, Qibla, and Tasbih individually, and choose whether each shows in Simple UI, Advanced UI, or both; Duas always stays available.
- Extended backup export/import and the offline cache manifest to cover the new layout configuration.
- Fixed the live Qibla compass using a non-north-referenced heading on many Android/Chrome devices, causing an inaccurate direction.
- Fixed the Qibla card being hidden in Simple UI; it now always shows there, while the full prayer times list is governed by the new layout config.

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
