# Canonical Editorial Architecture

## Public Trust Boundary

Fortress Platform exposes current editorial records through REST and API-backed MCP tools, including records that have not yet been verified. Every exposed record must include its `verificationStatus`, current `workflowState`, verifier identity and timestamp when present, and nullable publication timestamp.

Candidate preparation provenance remains outside the public repository and deployment artifacts. Candidates enter the platform in `pending_review`. Only verified, published revisions may enter PWA snapshots, RAG indexes, or grounded Ask responses.

## Record Lifecycle

```text
pending_review
-> assigned
-> in_review
-> approved
-> published
-> superseded
```

`changes_requested` returns a record to correction work. A correction creates a new immutable revision and restarts review. Previous revisions and decisions remain append-only history.

## Roles

- `admin`: full platform and editorial authority, including staff roles, service controls, publication, and rollback.
- `editor`: create and correct records, manage references and assignments, validate batches, and manage Reviewer access.
- `reviewer`: inspect candidates and verify a complete revision or request changes.
- `developer`: use the Developer Portal, API credentials, OAuth apps, MCP configurations, and developer tooling; no Admin Console access.

The identity table carries an explicit administrator flag. An active `admin` role and that flag are both required for platform management. Admins can manage every role. Editors can move users only between `reviewer` and `developer`; they cannot alter Admins, Editors, or themselves.

## Required Verification

One authorized Admin, Editor, or Reviewer verifies the complete immutable revision. The decision stores the verifier's user ID and timestamp. Verification also stamps every pending canonical reference attached to that revision. At least one non-rejected canonical reference is required.

A correction creates a new immutable revision, clears the prior verification stamp, and returns the record to `pending_review`.

## Publication

Editors group verified revisions into a publication batch and validate it against current workflow state, revision identity, one verification, and evidence requirements. An Admin approves and publishes the batch atomically, creating a canonical dataset version, publication history, current publication pointers, and search rows.

Every published dataset also receives a complete immutable `canonical_dataset_items` snapshot. A rollback never mutates or reactivates an old version. It creates a new audited dataset from a complete prior snapshot, rebuilds current publication pointers and canonical search rows atomically, and marks its vector index pending.

The automated editorial pilot uses separate synthetic Editor, Reviewer, and Admin identities to verify authorization and state transitions. It is a software rehearsal only and cannot substitute for qualified human editorial or scholarly judgment.

Canonical URLs use Fortress-owned sequential paths:

```text
/hisn/chapter1
/bukhari/book1/1
/muslim/book1/1
```

These paths are stable public identifiers. They do not expose preparation systems or third-party infrastructure.
