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
  developers/       Static developer documentation and live API explorer
  status/           Static service health dashboard
  admin/            Future administrative control plane
  developers/       Future developer control plane
  help/             Future support portal
  mcp/              Future MCP server
packages/
  contracts/        Shared API schemas and types
  portal-ui/        Shared static portal design system and build pipeline
pwa-website/        Existing static PWA, retained during migration
```

## Environment Model

The `dev` branch deploys test services. The `main` branch deploys production services. Test and production must use separate databases, buckets, queues, credentials and Worker names.

The API reads published content from separate Cloudflare D1 databases in test and production. A repository boundary keeps route handlers and public contracts independent of the storage implementation. All initial imported records are explicitly marked as pending verification.

## Content Storage

The normalized D1 model has four levels:

| Table | Purpose |
| --- | --- |
| `dataset_versions` | Immutable publication metadata, provenance hash, and verification state |
| `content_records` | Stable dua or hadith identity, ordering, title, and lifecycle state |
| `content_parts` | Ordered reading/swipe units within a record |
| `content_segments` | Ordered Arabic, transliteration, translation, and commentary text |

Canonical IDs are stable and readable, for example `dua.hisn.001`. Part and segment IDs extend that identity deterministically. Legacy IDs remain queryable for backward compatibility.

The current JSON is a publishing input, not a runtime API database. The migration generator hashes the complete source and produces repeatable SQL. Database migrations run before each Worker deployment, so a Worker is never released against a missing schema.

Future Admin publishing should create a new dataset version, validate it, and atomically activate it. Religious content must retain source provenance and verification status throughout that process.

## Architectural Rules

1. Public contracts are versioned and independent from internal code organization.
2. Religious content is never silently overwritten; publication creates an auditable dataset version.
3. API and MCP consumers use shared domain services rather than direct database access.
4. Rate enforcement, exact quota accounting and analytics are separate responsibilities.
5. Test and production infrastructure never share mutable state.
6. The hosted platform may meter compute while source data remains open and exportable.
