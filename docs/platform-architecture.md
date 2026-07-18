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
  admin/            Future administrative control plane
  developers/       Future developer control plane
  help/             Future support portal
  mcp/              Future MCP server
packages/
  contracts/        Shared API schemas and types
pwa-website/        Existing static PWA, retained during migration
```

## Environment Model

The `dev` branch deploys test services. The `main` branch deploys production services. Test and production must use separate databases, buckets, queues, credentials and Worker names.

The initial API reads the existing PWA dataset through a repository adapter. All imported records are explicitly marked as pending verification. The adapter will later be replaced by the canonical publishing pipeline and D1 without changing route handlers or public contracts.

## Architectural Rules

1. Public contracts are versioned and independent from internal code organization.
2. Religious content is never silently overwritten; publication creates an auditable dataset version.
3. API and MCP consumers use shared domain services rather than direct database access.
4. Rate enforcement, exact quota accounting and analytics are separate responsibilities.
5. Test and production infrastructure never share mutable state.
6. The hosted platform may meter compute while source data remains open and exportable.
