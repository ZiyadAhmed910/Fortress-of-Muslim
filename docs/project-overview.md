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

`0.19.1` (`packages/contracts/src/index.ts` → `PLATFORM_VERSION`, mirrored in every workspace
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
3. **Scheduled encrypted backups + retention** — not started. `backup-d1.ps1` is manual-only; no
   cron trigger references it anywhere.
4. **Alerts for downtime/errors/queue failures/unusual API usage** — done (2026-08-06), scoped to
   Admin Console surfacing only (no external paging channel, by explicit choice). New `operational_alerts`
   table (`apps/auth/migrations/0009_operational_alerts.sql`) and `GET /v1/admin/alerts` evaluate four
   conditions fresh on every view (service down/maintenance, 24h 5xx error rate >=5%/20%, RAG indexing
   failures, routes with >=50 rate-limited responses in 24h), upsert findings so they persist as
   history, and auto-resolve anything that stops triggering. Surfaced as a dedicated Admin Console
   "Alerts" view plus a banner on the Overview page. Schema and the full insert/auto-resolve lifecycle
   verified live against the test identity DB, not just the in-memory migration check. Shares its table
   with item 7 (incident acknowledgement) by design — no reason to model the same lifecycle twice.
5. **Enforceable per-key/per-plan rate limits** — mostly not started. `usage_events` telemetry
   exists platform-wide; real enforcement exists only for `/v1/ask` (20/day per IP). No plan-limit
   table, nothing reads `developer_profiles.plan_code` to gate requests.
6. **Admin MFA enforcement + recovery codes + account recovery procedure** — infrastructure exists
   (TOTP, passkeys, backup codes all wired via Better Auth) but nothing requires an Admin/Editor to
   have MFA enabled before granting access — it's opt-in today. No documented recovery procedure.
7. **Incident timeline + acknowledgement workflow** — not started. The audit log records privileged
   actions but isn't an incident-tracking workflow with states.
8. **Soak, then promote the exact verified commit to production** — tooling and process are solid
   and documented (`docs/release-readiness.md`, `tools/test-environment-soak.mjs`); this is the
   gate everything else feeds into.

### After 0.20 (from `docs/canonical-data-roadmap.md`, roughly matching the user's longer roadmap)
- **0.21 Admin/Editorial**: step-by-step record editor, Arabic/transliteration preview+validation,
  better verification workload tooling, editorial analytics, audit export, review notifications.
- **0.22 Search/RAG**: better Arabic normalization/stemming, exact-reference search, metadata-
  filtered retrieval, a permanent eval dataset, quality/cost dashboards, stricter refusal behavior,
  automatic vector reindex/recovery.
- **0.23 Developer Platform**: usage/quota dashboards, real plan management, access-request
  approval workflow, OAuth hardening, better named-query/MCP builders, SDK examples, webhooks.
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
