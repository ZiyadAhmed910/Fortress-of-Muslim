# ADR 0003: Evidence-Gated Verification

- Status: Accepted
- Date: 2026-07-20

## Context

A verification badge is a religious-content claim. The legacy dataset does not yet identify a publisher, edition, translator, license, or record-level citations.

## Decision

Admin may mark a record verified only when it has at least one verified reference tied to a source whose authenticity is trusted and whose reuse license is approved. Every status transition appends a verification record and content audit event in the content database.

Unknown provenance is represented explicitly. Missing evidence is never inferred from text or supplied by an AI model.

## Consequences

- Existing legacy records remain pending until source review and citation entry are complete.
- Admin source/reference management is required before editorial verification can finish.
- Verification history remains attached to content even if identity-system audit retention changes.

