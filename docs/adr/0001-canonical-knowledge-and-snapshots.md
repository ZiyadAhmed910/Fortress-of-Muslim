# ADR 0001: Canonical Knowledge and Published Snapshots

- Status: Accepted
- Date: 2026-07-20

## Context

Fortress serves the same religious content through a PWA, REST API, MCP, and future clients. Editing separate JSON and database copies would allow silent drift and make citations irreproducible.

## Decision

The normalized content database is the editorial source of truth. Every record belongs to an immutable dataset version and retains source, verification, correction, and publication history.

The offline PWA does not read editable tables. A publishing job will validate a candidate dataset, atomically activate its version, and generate a versioned static snapshot plus manifest. API and MCP responses identify the active dataset version.

The PWA JSON is generated only from published canonical records. Candidate records remain unavailable to readers until the Admin editorial and publishing workflow approves them.

## Consequences

- Content corrections create a new dataset and history entry; generated artifacts are never edited manually.
- PWA, API, MCP, and future clients can reproduce the exact content version used for an answer.
- Publication tooling and Admin CRUD must enforce schema, provenance, and verification gates.
