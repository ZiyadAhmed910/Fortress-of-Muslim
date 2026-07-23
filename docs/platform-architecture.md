# Fortress Platform Architecture

## Product Boundary

Fortress Platform is an open-source Islamic data and agent platform. The existing PWA is the first reference client, not the platform boundary.

The repository is a monorepo so applications share contracts and domain logic while remaining independently deployable.

## Platform Applications

| Application | Host | Responsibility |
| --- | --- | --- |
| PWA | `fortressofmuslim.org` | Offline-first reader and reference client |
| Test PWA | `test.fortressofmuslim.org` | Beta PWA releases |
| Public API | `api.fortressofmuslim.org` | Versioned data and platform API |
| MCP | `mcp.fortressofmuslim.org` | Agent-compatible tools and resources |
| Developer Portal | `developers.fortressofmuslim.org` | Apps, credentials, OAuth, testing, usage and documentation |
| Authorization | `auth.fortressofmuslim.org` | OAuth and OpenID Connect endpoints |
| Admin | `admin.fortressofmuslim.org` | Content and platform control plane |
| Help | `help.fortressofmuslim.org` | Support and content corrections |
| Status | `status.fortressofmuslim.org` | Independent service status |

## Repository Direction

```text
apps/
  api/              Cloudflare Worker API
  auth/             Identity, API keys, organizations, OAuth 2.1 and control-plane storage
  developers/       Developer documentation, credentials and authenticated API explorer
  status/           Static service health dashboard
  admin/            Future administrative control plane
  help/             Future support portal
  mcp/              Future MCP server
packages/
  contracts/        Shared API schemas and types
  portal-ui/        Shared static portal design system and build pipeline
pwa-website/        Existing static PWA, retained during migration
```

## Environment Model

The `dev` branch deploys test services. The `main` branch deploys production services. Test and production must use separate databases, buckets, queues, credentials and Worker names.

The API reads published content from separate Cloudflare D1 databases in test and production. A repository boundary keeps route handlers and public contracts independent of the storage implementation. All initial candidates are unpublished and pending human verification; public services read only through canonical publication pointers.

Identity and platform ownership use separate `fortress-identity-test` and `fortress-identity-production` D1 databases. Better Auth owns users, sessions, organizations, hashed API keys, OAuth clients, JWKS, consent and tokens. Fortress-owned control tables add plans, approval requests, usage events, audit events and MCP registration drafts. Content and identity stores are intentionally separate.

Content routes require either a scoped Fortress API key or OAuth 2.1 bearer token. The API Worker verifies credentials through a Cloudflare Service Binding to the Auth Worker; identity tables are never queried directly by the public API. Health and discovery endpoints remain public.

API keys are displayed once and stored hashed. Connected apps support public PKCE clients and confidential server clients. OAuth access tokens are audience-bound to the API or MCP resource, and the resource server validates the requested scope.

## Content Storage

The normalized D1 model keeps the four core content levels:

| Table | Purpose |
| --- | --- |
| `dataset_versions` | Immutable publication metadata, provenance hash, and verification state |
| `content_records` | Stable dua or hadith identity, ordering, title, and lifecycle state |
| `content_parts` | Ordered reading/swipe units within a record |
| `content_segments` | Ordered Arabic, transliteration, translation, and commentary text |

Canonical IDs are stable and readable, for example `dua.hisn.001`. Part and segment IDs extend that identity deterministically. Legacy IDs remain queryable for backward compatibility.

The current JSON is a publishing input, not a runtime API database. The migration generator hashes the complete source and produces repeatable SQL. Database migrations run before each Worker deployment, so a Worker is never released against a missing schema.

Future Admin publishing should create a new dataset version, validate it, and atomically activate it. Religious content must retain source provenance and verification status throughout that process.

Canonical metadata extends those core tables with languages, translations, collections, books, chapters, dua and Hadith metadata, typed taxonomy, source references, cross references, contributors, deterministic search metadata, and append-only verification, correction, publication, and content-audit history.

The current user-provided DOCX import is registered honestly as an unreviewed source with unknown licensing. It cannot satisfy the verification gate until an editor attaches a verified record reference from a trusted, approved source.

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
