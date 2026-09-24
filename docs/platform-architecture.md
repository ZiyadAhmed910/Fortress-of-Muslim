# Fortress Platform Architecture

## Product Boundary

Fortress Platform is an open-source Islamic data and agent platform. The existing PWA is the first reference client, not the platform boundary.

The repository is a monorepo so applications share contracts and domain logic while remaining independently deployable.

## Platform Applications

| Application | Host | Responsibility |
| --- | --- | --- |
| PWA | `fortressofmuslim.org` (`www` redirects) | Offline-first reader and reference client |
| Test PWA | `test.fortressofmuslim.org` | Beta PWA releases |
| Public API | `api.fortressofmuslim.org` | Versioned data and platform API |
| MCP | `mcp.fortressofmuslim.org` | Agent-compatible tools and resources |
| Developer Portal | `developers.fortressofmuslim.org` | Apps, credentials, OAuth, testing, usage and documentation |
| Authorization | `auth.fortressofmuslim.org` | OAuth and OpenID Connect endpoints |
| Admin | `admin.fortressofmuslim.org` | Content and platform control plane |
| Media | `media.fortressofmuslim.org` | Self-hosted audio from R2, with play and download counts |
| Status | `status.fortressofmuslim.org` | Independent service status |

Every application runs on Cloudflare. The PWA moved from Bluehost to Workers static assets on
2026-09-23 (`pwa-website/wrangler.jsonc`, `pwa-website/edge/worker.js`); Bluehost still receives
each build as a standby and hosts the domain's email. Each test service has a `-test` host
(`api-test`, `media-test`, ...). A Help application was once planned here and never built.

## Repository Direction

```text
apps/
  api/              Cloudflare Worker API
  auth/             Identity, API keys, organizations, OAuth 2.1 and control-plane storage
  developers/       Developer documentation, credentials and authenticated API explorer
  status/           Static service health dashboard
  admin/            Administrative control plane
  mcp/              MCP gateway
  media/            Media Worker: serves audio from R2 and counts plays and downloads
packages/
  contracts/        Shared API schemas and types
  portal-ui/        Shared static portal design system and build pipeline
pwa-website/        The flagship offline-first PWA
  edge/             The Worker in front of its files on Cloudflare: app routes, per-page HTML, headers
```

## Environment Model

The `dev` branch deploys test services. The `main` branch deploys production services. Test and production must use separate databases, buckets, queues, credentials and Worker names.

The API reads published content from separate Cloudflare D1 databases in test and production. A repository boundary keeps route handlers and public contracts independent of the storage implementation. All initial candidates are unpublished and pending human verification; public services read only through canonical publication pointers.

Identity and platform ownership use separate `fortress-identity-test` and `fortress-identity-production` D1 databases. Better Auth owns users, sessions, organizations, hashed API keys, OAuth clients, JWKS, consent and tokens. Fortress-owned control tables add plans, approval requests, usage events, audit events and MCP registration drafts. Content and identity stores are intentionally separate.

Published content reads (`/v1/duas`, `/v1/hadith`, `/v1/ask`, ...) are anonymous, and anonymous requests are never rate limited. A scoped Fortress API key or OAuth 2.1 bearer token is required for developer-owned capabilities such as named queries (`/v1/queries/*`), and a request that presents one is metered against its plan's limits. The API Worker verifies credentials through a Cloudflare Service Binding to the Auth Worker; identity tables are never queried directly by the public API. Health and discovery endpoints remain public.

API keys are displayed once and stored hashed. Connected apps support public PKCE clients and confidential server clients. OAuth access tokens are audience-bound to the API or MCP resource, and the resource server validates the requested scope.

## Content Storage

Content is served from the canonical model:

| Table / view | Purpose |
| --- | --- |
| `canonical_records` | Stable identity of each dua, hadith or ayah (`dua.hisn.074`), pointing at its current revision |
| `content_revisions`, `revision_parts`, `revision_segments` | Immutable revisions and their ordered parts and Arabic, transliteration, translation and commentary text |
| `canonical_publications`, `canonical_dataset_versions` | What is published, in which dataset version |
| `editorial_record_state`, `review_decisions` | Workflow and verification state, and its history |
| `api_current_content`, `api_published_content`, `api_ask_content` | The views the API reads: current, published-and-verified, and published (for Ask) |

The original four tables (`dataset_versions`, `content_records`, `content_parts`, `content_segments`, migration 0001) are still present as the identity backbone the canonical tables reference, but they are no longer read to serve content; see `docs/project-overview.md` -> "Legacy tables still present".

Canonical IDs are stable and readable, for example `dua.hisn.001`. A dua record is one of Hisn al-Muslim's 268 readings; the app's `/hisn/chapter<n>` pages are its 132 chapters. A dua's link names the chapter that holds the reading -- from `record_placements`, else from `apps/api/src/lib/hisn-chapters.ts` (generated from the app's own chapters) -- never its reading number. Test and production hold the same 268 reading-level records since 2026-09-24; before that, production still pointed 135 of them at older chapter-level revisions, which is why this fix was first rolled back (README 0.49.2, 0.49.4, 0.50.1). Legacy IDs remain queryable for backward compatibility.

The current JSON is a publishing input, not a runtime API database. The migration generator hashes the complete source and produces repeatable SQL. Database migrations run before each Worker deployment, so a Worker is never released against a missing schema.

Editorial publishing goes through the editorial plane (`apps/auth/src/editorial-plane.ts`): records are reviewed, grouped into publication batches (`publication_batches`, `publication_batch_items`) that are validated and approved before they publish, and a dataset can be rolled back. Religious content must retain source provenance and verification status throughout that process.

Canonical metadata extends those core tables with languages, translations, collections, books, chapters, dua and Hadith metadata, typed taxonomy, source references, cross references, contributors, deterministic search metadata, and append-only verification, correction, publication, and content-audit history.

The original user-provided DOCX import (2026-07-18, 135 records) was registered as an unreviewed source with unknown licensing. Hisn al-Muslim has since been verified and published as its own dataset (migrations 0013 and 0018: 268 readings with their reading roles), and the hadith corpus was published unverified by design (0022) -- Ask states each source's verification status rather than requiring it. A record still cannot become verified without a verified reference from a trusted, approved source.

Core published read routes are anonymous. Developer-owned named queries and management capabilities remain credentialed. API responses resolve the active dataset dynamically and expose its identifier in metadata and the `X-Fortress-Dataset-Version` header.

## Architectural Rules

1. Public contracts are versioned and independent from internal code organization.
2. Religious content is never silently overwritten; publication creates an auditable dataset version.
3. API and MCP consumers use shared domain services rather than direct database access.
4. Rate enforcement, exact quota accounting and analytics are separate responsibilities.
5. Test and production infrastructure never share mutable state.
6. The hosted platform may meter compute while source data remains open and exportable.
7. A record cannot become verified without verified evidence from a trusted, legally approved source.
8. AI may retrieve and summarize evidence, but it never creates canonical religious claims.
