# Canonical Editorial Architecture

## Public Trust Boundary

Fortress Platform exposes current editorial records through REST and API-backed MCP tools, including records that have not yet been verified. The public workflow has only `pending_review`, `verified`, and `changes_requested`. Every exposed record includes its verification status, current workflow status, verifier identity and timestamp when present, and nullable publication timestamp.

Candidate preparation provenance remains outside the public repository and deployment artifacts. Candidates enter the platform in `pending_review`. Only verified, published revisions may enter PWA snapshots, RAG indexes, or grounded Ask responses.

## Record Lifecycle

```text
pending_review
-> verified

pending_review
-> changes_requested
-> pending_review
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

Individual records can be verified without immediately becoming an Ask source. For Hadith, an authorized Admin, Editor, or Reviewer verifies a complete book after checking its source, numbering, text, grading, and references. The book action stamps each current revision, publishes a complete mixed Dua and Hadith dataset snapshot, updates canonical search rows, and marks the new vector namespace pending.

Every published dataset also receives a complete immutable `canonical_dataset_items` snapshot. A rollback never mutates or reactivates an old version. It creates a new audited dataset from a complete prior snapshot, rebuilds current publication pointers and canonical search rows atomically, and marks its vector index pending.

The API Worker incrementally indexes the pending active dataset through a Cron Trigger. Vector metadata retains content type, collection, canonical record ID, and dataset namespace. Unverified records never enter this namespace and cannot ground Ask responses.

## Reading Roles

A dua record has a role (`canonical_reading_roles`, served as `readingRole`): `supplication` is words to recite; `framed` is a narration or instruction containing words to recite, whose narration is a `comment` segment; `instruction` says what to do with no fixed words; `virtue` describes a merit with nothing to recite. Instruction and virtue records have no transliteration segment, because there is nothing to transliterate. A dua without a row reads as `supplication`. Migration `0018` assigned all 268 Hisn readings; roles are not yet editable in the Admin Console.

## Search Aliases

`canonical_search_aliases` holds, per chapter, the everyday words people type when the book uses a different one: "toilet" for the bathroom readings, "wudu" for ablution, "qurbani" for the sacrifice. They are appended to the lexical index and to the text each record is embedded from, and are never displayed, never part of a revision, and never religious text — a reader sees only what the source says. The reviewed source is `apps/api/data/search-aliases.json`; changing it means regenerating migration `0020` and re-embedding the corpus, because the vectors are built from text that includes them.

## Withdrawal

Revisions, parts and segments cannot be deleted. To take a record out of public service, insert a row into `canonical_withdrawals` with a reason: both public views, lexical search, Ask and record counts exclude it, and its history stays intact. Deleting the row restores it. No record is currently withdrawn.

The automated editorial pilot uses separate synthetic Editor, Reviewer, and Admin identities to verify authorization and state transitions. It is a software rehearsal only and cannot substitute for qualified human editorial or scholarly judgment.

Canonical URLs use Fortress-owned sequential paths:

```text
/hisn/chapter1
/bukhari/book1/1
/muslim/book1/1
```

These paths are stable public identifiers. They do not expose preparation systems or third-party infrastructure.
