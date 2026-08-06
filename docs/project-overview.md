# Fortress Platform — Project Overview

This is the "what is this, why does it exist, what does it actually do right now" reference.
Update it when functionality changes meaningfully. Keep it verified against code, the same way
`CLAUDE.md` asks for everything else — this file is not a place for aspiration or marketing copy.

## Mission

Fortress Platform is an open-source Islamic data and agent platform. It exists because most dua
apps are heavy, ad-laden, tied to app stores, or hostile to offline use. The platform commits to:
free, ad-free, tracking-free, offline-capable core content, with genuine editorial verification
behind anything presented as authoritative, and an open API/agent surface so the data isn't locked
inside one app.

Two commitments shape every other decision in this codebase:

1. **Religious content is never silently overwritten.** Publishing creates an auditable, immutable
   revision. A record cannot become "verified" without a verified reference from a trusted,
   legally-approved source, stamped with the verifier's real identity and a timestamp.
2. **AI retrieves and cites; it never originates a religious claim.** The Ask assistant only
   answers from numbered, published, verified sources and must cite every paragraph or explicitly
   say the evidence is insufficient.

## Current version

`0.21.0` (`packages/contracts/src/index.ts` → `PLATFORM_VERSION`, mirrored in every workspace
`package.json`). See `README.md` → `## Platform Releases` for the full version history — it is
the closest thing this repo has to a changelog and should be treated as one.

## Live environments — this is not a sandbox

| Branch | Deploys to | Databases |
| --- | --- | --- |
| `dev` (push) | `test.fortressofmuslim.org`, `api-test`, `auth-test`, `admin-test`, `developers-test`, `mcp-test`, `status-test` | `fortress-identity-test`, `fortress-platform-test` (Cloudflare D1) |
| `main` (push) | production equivalents of the above | `fortress-identity-production`, `fortress-platform-production` |

Both run on a real Cloudflare account and real Bluehost hosting (the PWA's static origin).
See `CLAUDE.md` section 1 before pushing or running anything against Cloudflare.

## System map

A Cloudflare Workers monorepo. Independently deployable apps share two packages.

```text
apps/
  api/          Public content API (Hono, D1) — duas, Hadith, search, Ask/RAG, named-query execution
  auth/         Identity Worker — Better Auth (sessions, API keys, OAuth 2.1, passkeys, TOTP),
                plus Fortress-owned control plane (plans, roles, audit, usage, MCP registration),
                the Admin plane, and the Editorial plane
  admin/        Static Admin Console frontend (talks to auth Worker's /v1/admin/*)
  developers/   Static Developer Portal frontend (API docs, keys, OAuth apps, named queries, MCP toolsets)
  mcp/          MCP (Model Context Protocol) gateway Worker — OAuth-protected agent tool execution
  status/       Static status dashboard — client-side probes of every service
packages/
  contracts/    Shared Zod schemas, TypeScript types, PLATFORM_VERSION
  portal-ui/    Shared design system + static build pipeline for admin/developers/status
pwa-website/    The original static PWA — offline dua reader, online Hadith browser, Ask UI
android-app/    Not started — README stub only, planned after PWA/API contracts stabilize
```

`docs/platform-architecture.md` still labels Admin, Help, and MCP as "Future" — that's stale.
Admin and MCP are live; Help does not exist yet (it's real future work, tracked below).

## What each app actually does today

### `apps/api` — Public Content API
Anonymous, unauthenticated reads for: dua list/search/detail/parts/random/evidence, Hadith
list/search/detail/canonical-path-resolve, collections, current dataset metadata. All of it reads
through `api_current_content` (current editorial state, including unverified candidates, always
labeled with `verificationStatus`/`workflowState`) or `api_published_content` (verified + published
only, used by RAG). `POST /v1/ask` is the source-grounded assistant: hybrid vector (Cloudflare
Vectorize) + lexical (D1 FTS5) retrieval, 20 requests/day per client IP (hashed, D1-backed counter),
citation-validated generated answers with a deterministic non-generated fallback when citations
don't check out. `GET /v1/queries/:id` executes developer-owned named queries — the only
credentialed route family on this Worker (Fortress API key or OAuth bearer token required).

### `apps/auth` — Identity, Control Plane, Admin Plane, Editorial Plane
One Worker, several responsibilities:
- **Better Auth**: email/password, sessions (7-day, httpOnly/secure/SameSite=Lax cookies), TOTP
  two-factor, WebAuthn passkeys, hashed API keys, OAuth 2.1 authorization server (PKCE, device
  authorization flow, JWKS, audience-bound tokens for the API and MCP resources).
- **Developer control plane** (`/v1/control/*`, session-cookie gated): profile, MCP server
  registration, device inventory, named-query CRUD, MCP toolset/catalog management.
- **Admin plane** (`/v1/admin/*`, requires an active `admin`/`editor`/`reviewer` role + a 12-hour
  absolute session cap): platform overview, operations monitor, global search, user/role
  management, resource lifecycle (API keys, OAuth clients, devices, MCP servers/tools, named
  queries), service maintenance toggles, taxonomy, audit log.
- **Editorial plane** (`/v1/admin/editorial/*`, nested under the admin plane): the actual
  verification workflow — queue, record creation, bulk decisions, book-level Hadith verification,
  reviewer assignments, publication batches, role grants, dataset/rollback management, RAG index
  monitoring, workload analytics.

### `apps/admin` — Admin Console (static frontend)
Team access / role editing, developer account suspension, editorial verification workload and
queue, RAG/vector index monitor, operations monitor (traffic, queues, routes, deployment probes —
on-demand, not push alerting), audit log, admin session inventory + MFA/passkey management link,
service maintenance controls. Consistently escapes user-controlled data via a shared `esc()`
helper before DOM insertion (checked during the 2026-08-06 review).

### `apps/developers` — Developer Portal (static frontend)
Sign-up/sign-in, API key management (one-time reveal), connected OAuth apps (PKCE, confidential,
device flow), named-query builder, custom MCP toolset builder, device inventory, API Explorer,
documentation.

### `apps/mcp` — MCP Gateway
`POST /mcp` JSON-RPC 2.0 endpoint, OAuth-protected (`mcp:connect` scope, audience-bound token).
Exposes standard tools (`find_dua`, `search_duas`, `get_dua`, `get_dua_evidence`, `list_duas`,
`random_dua`, `list_collections`, `list_hadith`, `search_hadith`, `get_hadith`, `ask_fortress`,
`current_dataset`) plus user-defined named-query-backed and review-gated external-HTTPS-backed
tools. External tool calls are restricted to HTTPS, block obvious private/loopback hosts, cap
response size at 1MB, and time out at 10s — note this is a string-based host check, not a DNS
resolution check, so it doesn't fully close a DNS-rebinding SSRF path; the mitigating control is
that external tools require review/approval before they're callable.

### `apps/status` — Status Portal
Client-side, on-page-load probes of every service (API, D1, Ask readiness, Auth, MCP, PWA,
Developer Portal, Admin Console). This is a passive dashboard, not an alerting system — nothing
pages anyone when a probe fails. Closing that gap is 0.20 Operations work (see below).

### `pwa-website` — The PWA (fortressofmuslim.org)
The original, still-primary user-facing product. Offline-first: 132 Hisn al-Muslim chapters / 268
individual readings bundled locally (`pwa-website/data/`), installable, works after first load.
Online-only features (Hadith browser, Ask) are explicitly isolated from the offline Dua mode and
never enter the offline cache. Simple and advanced UI modes, category/mood browsing (moods/Ruqyah
UI exists; the underlying verified content for them does not yet — see Goals), search with title
highlighting, favourites, swipe reader, dark mode, settings export/import. Has its own independent
version scheme (`1.0XX`, git-commit-count derived) separate from `PLATFORM_VERSION`.

### `android-app`
Not started. Planned after the PWA and API contracts stabilize.

## Content & editorial model

```text
canonical_records (stable identity, e.g. dua.hisn.001)
  -> content_revisions (immutable; a correction creates a new one, never mutates)
    -> revision_parts -> revision_segments (arabic / transliteration / translation / comment)
  -> editorial_record_state (current workflow_state + verification_status)
  -> canonical_publications (which revision is live, joined into canonical_dataset_versions)
```

Public workflow states are intentionally small: `pending_review`, `verified`, `changes_requested`.
Every record exposed via API/MCP carries its verification status, workflow state, verifier identity
and timestamp when present, and a nullable `publishedAt` — consumers make their own trust decision
rather than the platform silently hiding unverified content. Only verified + published revisions
ever reach RAG (`canonical_publications`) or the PWA offline snapshot.

Roles: `admin` (full authority), `editor` (create/correct records, manage references/assignments,
manage `reviewer` access only), `reviewer` (verify or request changes), `developer` (Developer
Portal only, no Admin Console). One verification is sufficient (single-reviewer model, not the old
multi-review flow) but must come from an authorized identity, stamped and auditable.

**Legacy tables still present, mostly retired:** `content_records` / `dataset_versions` /
`content_parts` (from `apps/api/migrations/0001_content_schema.sql`) still exist and are still the
identity backbone that `canonical_records`/`content_revisions` foreign-key into for manually-created
editorial records — they were not fully retired, just superseded as the *query* source of truth.
`dataset_versions.publication_status = 'active'` matches exactly one permanent row (the original
unverified 2026-07-18 DOCX import, 135 records) — this caused a real bug (named queries reading
stale data, fixed in `0.19.1`; see README). If you touch anything referencing these table names
directly, check whether it should be reading `api_current_content` / `canonical_*` instead.

## Known documentation gaps (as of 0.19.1)

- `docs/platform-architecture.md` labels Admin/Help/MCP as "Future" — Admin and MCP are live.
- `README.md`'s Admin Console dev section says "Never hard-code a privileged email or user ID in
  source" — `apps/auth/src/admin-plane.ts`'s `bootstrapDefaultAdmin` does exactly that (hardcodes
  the repo owner's email as a break-glass admin bootstrap). This is a deliberate, working mechanism
  for a single-owner project, not an oversight, but the README line is stale/contradictory and
  should eventually be reconciled with reality.
- `docs/canonical-data-roadmap.md`'s "Platform Increments" list is effectively the source the 0.20
  Operations plan below was validated against — the two should be read together.

## Known implementation gaps (full code read-through, 2026-08-06)

Found by reading essentially the entire codebase end to end (`editorial-plane.ts` in full, the
entire Developer Portal frontend, the entire PWA, the Status portal, the remaining `admin-plane.ts`
handlers) rather than sampling. Ranked by how directly they block a feature the platform claims to
support, not by severity.

1. **Taxonomy term assignment does not exist.** Admins can create taxonomy terms — including
   `mood` and `occasion` types, via `POST /v1/admin/taxonomy` (`apps/auth/src/admin-plane.ts`) — and
   the system can count and display which records use a term. But there is no code path anywhere
   that inserts into `record_taxonomy` (confirmed by grepping the entire `apps/api` and `apps/auth`
   source: the table is only ever read, never written). There is no "attach this mood/category to
   this record" action in the Admin Console UI either. This is the missing middle step of the
   feature — creation and display exist, assignment doesn't — and it's why the roadmap's "moods,
   Ruqyah" goal has no real editorial path today: there's no way to mark a record with a verified
   mood even if an editor wanted to.
2. ~~**TOTP setup showed no QR code, just a raw `otpauth://` URI as text.**~~ Fixed 2026-08-06:
   `apps/developers/public/console.js` rendered `result.totpURI` as plain text in a `<code>` tag --
   almost no authenticator app accepts pasting a full URI, they expect a QR scan. Found by the user
   actually trying to use it, not by this read-through (a miss worth naming: reading the line and
   confirming it "renders something" isn't the same as confirming the UX is actually usable). Fixed
   by vendoring `qrcode-generator` (Kazuhiko Arase, MIT) as static files in
   `packages/portal-ui/assets/` -- rendered fully client-side as inline SVG, never sent anywhere,
   since the URI contains the actual TOTP secret and the portal's CSP (`script-src 'self'`) wouldn't
   have allowed an external QR API regardless. Also extracts just the base32 secret for a manual-entry
   fallback. Verified structurally (not just "didn't throw"): the rendered module grid's finder
   patterns at all three required corners exactly match the canonical QR pattern
   (`1111111/1000001/1011101/1011101/1011101/1000001/1111111`), which is strong evidence a real
   scanner would read it correctly.
3. ~~**Passkey buttons could hang forever with zero feedback.**~~ Fixed 2026-08-06: reported by the
   user as "click it, nothing happens, UI stuck" while actually using it. Every `fetch()` call in
   `console.js` uses `AbortSignal.timeout(...)` -- a consistent, deliberate pattern throughout the
   file -- except the two `navigator.credentials.get()`/`.create()` calls for passkey sign-in and
   registration, which had no timeout at all. If the browser/OS fails to show the WebAuthn prompt
   (common with cross-device/phone-QR passkey flows), that `await` never resolves or rejects, so the
   button stays disabled indefinitely with no error and no way to retry -- indistinguishable from
   "the click didn't register." Fixed with an explicit 60s `AbortSignal.timeout` on both calls (much
   longer than the 12s used for network requests, since a WebAuthn ceremony waits on a human, not a
   server) plus explicit `TimeoutError`/`AbortError` handling in `friendlyCredentialError` instead of
   falling through to a generic browser string. Verified the mechanism itself, not just the code
   shape: forced `AbortSignal.timeout(500)` against a real `navigator.credentials.get()` call in a
   live browser and confirmed it rejects with `error.name === 'TimeoutError'` after the timeout --
   the exact condition the new error handling checks for.
4. **Named Queries can only target Duas, never Hadith.** `parseRecordQuery`
   (`apps/auth/src/index.ts:657`) hardcodes `objectName: 'duas' as const` on every named query it
   creates — there's no way to get a Hadith-backed named query even via a direct API call, let alone
   through the Developer Portal UI, which doesn't offer the choice either. Hadith is a first-class
   content type everywhere else (REST API, MCP tools, editorial workflow) except here.
5. **The OAuth consent screen hardcodes "ChatGPT."** `apps/developers/public/oauth.js` shows
   "ChatGPT" in its UI copy ("authorizing ChatGPT," "Denying access," "Return to ChatGPT...")
   regardless of which client is actually connecting. The backend already has the real client name
   available (`oauthClient.name`); the consent page just doesn't use it. Cosmetic today because
   ChatGPT is presumably the only client exercised so far, but wrong for any other Connected App.
6. **Minor: inconsistent SQL parameterization in `editorial-plane.ts`.** Three spots (`decideBook`
   x2, `rollbackDataset`) interpolate a value via a `sqlLiteral()` escaping helper instead of the
   `.bind()` parameterization used everywhere else in the file. Not currently exploitable — in all
   three cases the interpolated value is system-generated or already fetched from a parameterized
   lookup, not raw user input — but it's a style inconsistency worth cleaning up for defense in
   depth rather than relying on "it happens to be safe today."

**Explicitly checked and confirmed correct, so it doesn't need re-litigating:** Admin/Editor/
Reviewer role gating including the developer-login-restriction question (`apps/auth/src/admin-plane.ts`
rejects `role === 'developer'` server-side on every `/v1/admin/*` route); the mandatory-MFA gate;
the IoT device-authorization login round-trip (`device.js` save-and-resume via `sessionStorage`);
FTS index sync across all three publish paths (book verification, batch publish, rollback all
correctly update `canonical_search_fts`); PWA offline/online mode isolation and service worker
caching/update behavior; the browser-persisted API key convenience feature (correctly reconciled
against server state on every load, not a stale-data risk).

## Goals — what's next

### 0.20 Operations (current priority, validated against code on 2026-08-06)
Reliability and safety, not new features, before anything else ships. Status of each item:

1. **D1 backup + Time Travel restore drill** — done and logged (`docs/incident-response.md` Drill
   Log, 2026-08-06). Only the content DB and the Time Travel path were exercised; identity-DB
   restore and the disaster-recovery SQL-export-rebuild path are still unverified in practice.
2. **Automate FTS rebuild after disaster recovery** — done (`tools/rebuild-fts.ps1`, 2026-08-06).
   Reuses the exact rebuild SQL the application already runs during Hadith book verification
   (`editorial-plane.ts`) rather than reinventing it, creates the FTS5 virtual table if missing,
   and verifies the resulting row count against `editorial_record_state` before declaring success.
   Live-run against test: it found and corrected a real 1-row drift between `canonical_search_fts`
   (268 rows) and current editorial state (269 rows) — a record verified individually since the
   last dataset publish wasn't in the search index. Root cause not yet identified; the bulk-decision
   path correctly delegates to the same single-record path that does sync FTS, so the gap is
   elsewhere (`createRecord` or a correction flow are the likely candidates) — worth a dedicated look.
3. **Scheduled encrypted backups + retention** — done (2026-08-06). `backup-d1.ps1` now actually
   encrypts (it previously wrote plain SQL despite `docs/incident-response.md` calling it
   "encrypted-at-rest" -- fixed honestly rather than left as a false claim): AES-256-CBC + a
   separate HMAC-SHA256 integrity tag, fully streamed (`tools/lib/backup-crypto.ps1`) so it
   handles the 150MB+ content export without loading it into memory -- the first, in-memory
   version of this hit an `OutOfMemoryException` against the real export during live verification
   and had to be rewritten. New `.github/workflows/scheduled-backup.yml` runs it daily for both
   environments and uploads to a new `fortress-platform-backups` R2 bucket with a 30-day lifecycle
   retention rule, gated behind the same `CLOUDFLARE_DEPLOY_ENABLED` switch every other deployment
   job uses. New `tools/decrypt-backup.ps1` companion script verifies the integrity tag before
   writing any plaintext.
   Verified live end-to-end against test: real encrypted backup of both databases, confirmed no
   plaintext SQL was left on disk, decrypted the result back, and confirmed a byte-for-byte SHA-256
   match against the original 150MB export.
   **Manual setup required before this actually runs** (documented in `docs/cloudflare-setup.md`
   step 9, not done automatically): create the R2 bucket, add R2 permission to the existing
   deployment token, set its lifecycle rule, generate a key, and add it as the `FORTRESS_BACKUP_KEY`
   GitHub secret. This follows the same pattern every other piece of Cloudflare account setup in
   this repo already uses (manual, operator-performed, documented) rather than provisioning new
   billed cloud infrastructure unilaterally.
4. **Alerts for downtime/errors/queue failures/unusual API usage** — done (2026-08-06), scoped to
   Admin Console surfacing only (no external paging channel, by explicit choice). New `operational_alerts`
   table (`apps/auth/migrations/0009_operational_alerts.sql`) and `GET /v1/admin/alerts` evaluate four
   conditions fresh on every view (service down/maintenance, 24h 5xx error rate >=5%/20%, RAG indexing
   failures, routes with >=50 rate-limited responses in 24h), upsert findings so they persist as
   history, and auto-resolve anything that stops triggering. Surfaced as a dedicated Admin Console
   "Alerts" view plus a banner on the Overview page. Schema and the full insert/auto-resolve lifecycle
   verified live against the test identity DB, not just the in-memory migration check. Shares its table
   with item 7 (incident acknowledgement) by design — no reason to model the same lifecycle twice.
5. **Enforceable per-key/per-plan rate limits** — done (2026-08-06). New `plan_limits` (admin-
   configurable via Admin Console -> Rate limits: basic 100/min+5,000/day, premium 500/min+50,000/day,
   enterprise 2,000/min+200,000/day) and `rate_limit_counters` tables (`apps/auth/migrations/0010`),
   enforced by a new `checkRateLimit` AUTH RPC using the same atomic UPSERT+RETURNING pattern already
   proven by `/v1/ask`'s daily limiter, called from a new `apps/api` middleware on every `/v1/*`
   request that carries a credential. Anonymous public reads are untouched by design (unlimited, as
   the architecture already intends). Returns `X-RateLimit-*` headers and a `429` with `Retry-After`
   when exceeded. `/v1/ask`'s existing IP-based 20/day limiter is separate and untouched -- it serves
   a different purpose (anonymous AI-cost throttling) than per-developer plan enforcement. Verified:
   atomic counter and admin-update SQL exercised directly against live test D1, plus new automated
   tests covering allowed/anonymous/blocked paths (was previously silently masked by fail-open
   behavior against an incomplete test mock -- fixed alongside this).
6. **Admin MFA enforcement + recovery codes + account recovery procedure** — done (2026-08-06).
   `requiresMfaEnrollment` (`apps/auth/src/admin-plane.ts`, unit-tested in
   `apps/auth/test/admin-mfa-gate.test.ts`) blocks every `/v1/admin/*` route for an Admin-role user
   without TOTP enabled, except their own `GET /v1/admin/session` so the Admin Console can show a
   clear "enable two-factor authentication" panel with a direct link instead of a broken console.
   Editor/Reviewer stay optional, per explicit decision. Account recovery documented in
   `docs/incident-response.md` (backup-code path is self-service; full lockout requires direct D1
   access, documented with exact commands).
   **Operationally important:** as of this review, the live test environment's actual owner account
   (`ziyadahmed910@gmail.com`) does **not** have MFA enabled, so deploying this would lock the owner
   out of their own Admin Console until they enable it via the Developer Portal first. Not fixed
   automatically — this needs the account holder to actually do it.
7. **Incident timeline + acknowledgement workflow** — done (2026-08-06). `POST /v1/admin/alerts/:id/acknowledge`
   and `.../resolve` on the same `operational_alerts` table item 4 built (an "incident" is an alert
   at a different point in its lifecycle, not a second system). Acknowledging only applies from
   `active` and leaves an acknowledged-but-still-triggering alert alone on the next evaluation
   (avoids repeat notifications for something already being worked); resolving applies from `active`
   or `acknowledged` and will be correctly reopened to `active` by the next evaluation if the
   underlying condition is still actually happening. Both actions are audited. Admin Console
   Alerts view got per-row Acknowledge/Resolve buttons. Verified live against test: the full
   active -> acknowledged -> (blocked re-acknowledge) -> resolved lifecycle, including the D1
   foreign-key constraint on `acknowledged_by` correctly rejecting a bad user id during
   verification (a testing artifact, not an application bug -- real calls always bind a real
   session user id).
8. **Soak, then promote the exact verified commit to production** — tooling and process are solid
   and documented (`docs/release-readiness.md`, `tools/test-environment-soak.mjs`); this is the
   gate everything else feeds into.

### After 0.20 (from `docs/canonical-data-roadmap.md`, roughly matching the user's longer roadmap)
- **0.21 Admin/Editorial**: step-by-step record editor, Arabic/transliteration preview+validation,
  better verification workload tooling, editorial analytics, audit export, review notifications.
- **0.22 Search/RAG**: better Arabic normalization/stemming, exact-reference search, metadata-
  filtered retrieval, a permanent eval dataset, quality/cost dashboards, stricter refusal behavior,
  automatic vector reindex/recovery.
- **0.23 Developer Platform**: real plan management, access-request approval workflow, OAuth
  hardening. Usage/quota dashboards, better named-query/MCP builders (inline validation + live
  preview), SDK examples, and webhooks shipped early in 0.21.0 (2026-08-06) alongside a broader
  Developer Portal/Admin Console UX pass — see `README.md` 0.21.0 release notes.
- **0.24 User-Facing**: the Help Portal (doesn't exist yet), moods/Ruqyah/anxiety/gratitude content
  — **only after verified data backs them**, better PWA category discovery, real-device testing,
  native Android app.

Human-reviewed content expansion (more duas, Hadith collections, moods, Ruqyah) is explicitly
gated on qualified editorial review — it is not a data-import problem, it's a "find qualified
Editors and Reviewers" problem (`docs/canonical-data-roadmap.md` → Editorial Operations).

## Where to look for more detail

- `docs/codebase-map/README.md` — generated navigational index (files/exports/routes/schema
  reverse-index); regenerate with `npm run map:build`. Start here to find *where* something lives
  before grepping the repo by hand; it's not a substitute for reading the file itself.
- `README.md` — features, full version history, local dev commands, contributing guide.
- `docs/platform-architecture.md` — system boundaries and architectural rules (verify against code).
- `docs/canonical-editorial-architecture.md` — record lifecycle, roles, publication mechanics.
- `docs/canonical-data-roadmap.md` — the original source for the 0.20+ roadmap.
- `docs/incident-response.md` — runbook + drill log.
- `docs/release-readiness.md` — the promote-to-production checklist.
- `docs/deployment.md`, `docs/cloudflare-setup.md` — CI/CD and Cloudflare account mechanics.
- `docs/adr/*.md` — why past architectural decisions were made.
- `CLAUDE.md` — how to work in this repo (git workflow, versioning, read-before-you-act).
