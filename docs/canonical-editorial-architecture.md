# Canonical Editorial Architecture

## Public Trust Boundary

Fortress Platform is the sole public canonical publisher. REST, MCP, RAG, PWA snapshots, canonical web routes, and developer documentation may expose only records present in `canonical_publications` with publication status `published`.

Candidate preparation happens outside the public repository and deployment artifacts. Candidates enter the platform without public visibility and begin in `pending_review`.

## Record Lifecycle

```text
pending_review
-> assigned
-> in_review
-> needs_second_review
-> needs_senior_approval
-> approved
-> published
-> superseded
```

`changes_requested` returns a record to correction work. A correction creates a new immutable revision and restarts review. Previous revisions and decisions remain append-only history.

## Roles

- `viewer`: read editorial state.
- `reviewer`: perform field checks and independent review.
- `senior_reviewer`: perform senior approval after two independent approvals.
- `editor`: assign work, add canonical references, and create correction revisions.
- `publisher`: validate, approve, and publish batches.
- `super_administrator`: manage editorial roles and perform all administrative actions.

An author cannot review or approve their own revision. A senior approver cannot be either independent reviewer.

## Required Verification

Each independent reviewer must record a decision for:

1. Arabic
2. Translation
3. Transliteration
4. Narrator
5. Collection
6. Book
7. Chapter
8. Number
9. References
10. Grades
11. Formatting
12. Completeness
13. Duplicate detection

Publication validation also requires at least one independently verified canonical reference on the exact revision being published.

## Publication

Editors group approved revisions into a publication batch. A batch is validated against current workflow state, revision identity, and evidence requirements. A publisher approves and publishes the batch atomically, creating a canonical dataset version, publication history, current publication pointers, and search rows.

Every published dataset also receives a complete immutable `canonical_dataset_items` snapshot. A rollback never mutates or reactivates an old version. It creates a new audited dataset from a complete prior snapshot, rebuilds current publication pointers and canonical search rows atomically, and marks its vector index pending.

The automated editorial pilot uses separate synthetic identities to verify authorization and state transitions. It is a software rehearsal only and cannot substitute for independent human editorial or scholarly review.

Canonical URLs use Fortress-owned sequential paths:

```text
/hisn/chapter1
/bukhari/book1/1
/muslim/book1/1
```

These paths are stable public identifiers. They do not expose preparation systems or third-party infrastructure.
