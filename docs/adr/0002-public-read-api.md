# ADR 0002: Anonymous Public Reading

- Status: Accepted
- Date: 2026-07-20

## Context

Normal readers must be able to browse, search, and read religious content without creating an account. Requiring developer credentials for core read routes contradicts the PWA and open-data product boundary.

## Decision

Published dataset, dua list, search, random, detail, part, and evidence routes are anonymous. Owner-scoped named queries remain authenticated. OAuth, API keys, plans, and limits apply to developer-specific capabilities and future elevated quotas rather than ordinary reading.

## Consequences

- Public routes require platform-level abuse protection and anonymous rate policies at the edge.
- Authentication failures cannot block ordinary content access.
- OpenAPI declares security per protected operation instead of globally.

