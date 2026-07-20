# Sunnah Data Ingestion and Publication Design

- Status: Proposed
- Publication status: Blocked pending source permission or an approved licensed replacement
- Scope: `sunnah-data-fast-do-not-deploy/`
- Last audited: 2026-07-20

## Purpose

This document defines how Fortress Platform can turn a large source corpus into
traceable, reviewable, versioned content without allowing unverified or
unlicensed material to leak into D1, the public API, MCP, the PWA, or deployment
artifacts.

It is an implementation design, not approval to import or publish the current
files.

## Non-Negotiable Rights Gate

The current folder was produced by scraping Sunnah.com. Sunnah.com's published
terms say that scraping and mass reproduction of complete books or collections
are not permitted. Its developer page instead directs consumers to its API and
states that an offline data dump may be requested.

- Terms: https://sunnah.com/about
- Developer/API route: https://sunnah.com/developers

Until Fortress has explicit written permission, an approved API arrangement,
an approved offline dump, or an independently licensed replacement source, the
current corpus is **restricted**.

Restricted means:

- Do not commit the folder or any text derived from it.
- Do not upload it to Cloudflare, Bluehost, GitHub Actions, object storage, or a
  backup shared with contributors.
- Do not import it into development or production D1.
- Do not return its text through REST, MCP, Admin, search, or generated PWA
  snapshots.
- Do not use it to replace the existing PWA data.
- Do not mark any record as verified or publishable.

The files may be used locally to test parser behavior and describe defects while
permission is being resolved. The first implementation change must add the
folder to `.gitignore` and add an automated forbidden-path deployment check.

## Audited Inventory

The local corpus contains 422 files and is approximately 124 MB.

| Collection | Canonical records | Raw book pages | Current parser strategy |
| --- | ---: | ---: | --- |
| Sahih al-Bukhari | 7,277 | 97 | Per-book pages |
| Sahih Muslim | 3,098 | 57 | Per-book pages |
| Jami at-Tirmidhi | 3,982 | 49 | Per-book pages |
| Hisn al-Muslim | 268 | 1 collection page | Single collection page |
| **Total** | **14,625** | **204** | Mixed |

The directory contains:

- `raw/`: downloaded HTML used as immutable local parser evidence.
- `metadata/`: retrieval URL, final URL, timestamp, response metadata, hash,
  and importer version.
- `manifests/`: collection-level counts and extraction strategy.
- `canonical/`: four JSONL parser outputs.

All 14,625 JSONL lines parse as JSON. Their canonical IDs are unique. The 203
per-book files checked against retrieval metadata all match their recorded
SHA-256 hashes.

This confirms download integrity only. It does not establish permission,
authenticity, translation ownership, parser correctness, or editorial quality.

## Observed Data Defects

| Area | Observation | Required treatment |
| --- | --- | --- |
| Verification | Every record is unverified | Preserve `pending`; require evidence review |
| Chapters | Every current canonical record has no chapter | Reparse chapter hierarchy from raw HTML |
| Transliteration | All Bukhari, Muslim, and Tirmidhi records lack it | Treat as unavailable, never generate or infer it |
| Hisn English | 73 records lack `englishTranslation` | Repair field boundaries from source-shaped content |
| Hisn boundaries | Those 73 records contain combined transliteration and English text | Quarantine until deterministic parsing and review pass |
| Hisn books | Book is absent | Model the collection structure explicitly; do not invent a book |
| Narrators | 843 Muslim and 38 Tirmidhi records lack narrator values | Preserve missing values and raise import issues |
| References | Extracted values begin with punctuation such as `:` | Normalize display punctuation while preserving raw value |
| Sahihayn grades | 20 apparent grades are parser false positives containing text fragments | Discard scraped grade fields for Bukhari and Muslim |
| Tirmidhi grades | Spellings and punctuation vary, with several invalid values | Store raw grade; normalize only through reviewed mappings |

The raw Hisn page exposes chapter number, English title, Arabic title, and
anchors. The missing hierarchy is therefore a parser defect, not missing source
data. The same principle applies to Hadith book and chapter headings: reparse
the existing local artifacts rather than making another network scrape.

## Domain Boundary

Hadith and dua are related but different content objects.

- Hisn al-Muslim is a candidate dua collection for the reader experience.
- Bukhari, Muslim, and Tirmidhi are candidate Hadith reference collections.
- A Hadith record must not automatically appear in the PWA's dua feed.
- A dua may cite one or more Hadith records through `source_references` or
  `cross_references` after both sides have been identified and reviewed.
- Hadith read/search APIs should be introduced only after a collection passes
  rights, source, parser, and editorial gates.

This prevents the product taxonomy from treating every narration as a dua and
keeps app search focused while preserving a path to a larger research library.

## Data Layers

The pipeline has five explicit layers. Data moves forward only through a
validated transition.

### 1. Acquisition

An acquisition record describes the provider, edition, translator, URL or API,
retrieval method, permission evidence, license, and expected collections.

States:

- `proposed`
- `rights_review`
- `approved`
- `restricted`
- `rejected`

The current Sunnah.com scrape is `restricted`.

### 2. Source Artifacts

Immutable byte-for-byte inputs with:

- artifact ID
- acquisition ID
- source URL or API request identity
- retrieval timestamp
- media type and byte size
- SHA-256 hash
- importer version
- local locator

Source artifacts are evidence, not application records. Restricted artifact
bytes must remain local and outside repository and deployment contexts.

### 3. Parsed Source Records

A lossless, source-shaped representation. It preserves raw fields exactly,
including source numbering, title, Arabic, translation, narrator, raw grade,
references, hierarchy anchors, and the artifact/hash that produced the record.

No editorial cleanup, generated text, or semantic classification occurs here.

### 4. Candidate Canonical Records

Normalized Fortress records with stable identities, typed segments, collection
placement, structured numbering, source references, parser issues, and pending
verification. Candidate records are visible only to authorized Admin workflows.

### 5. Published Dataset

An immutable, validated dataset version activated by one atomic publication
event. API and MCP read the active version. A compact, versioned PWA snapshot is
generated from the same version.

Restricted acquisitions can never enter this layer.

## Identity Model

Source identity and Fortress identity must remain separate.

Example identities:

```text
source-record.sunnah.hisn.1
source-record.sunnah.bukhari.1
dua.hisn.001
hadith.bukhari.000001
```

- A source-record ID identifies the provider's representation.
- A Fortress record ID identifies the logical content inside this platform.
- A source revision links one source-record ID to an artifact and parser run.
- A dataset version links a specific canonical revision into a publication.
- Legacy PWA IDs remain aliases, not primary source identifiers.

Numbering must be queryable rather than hidden only in opaque JSON. Preserve
all applicable schemes, including provider display number, collection number,
in-book number, English/Arabic edition numbering, and legacy Fortress number.
Never collapse conflicting source schemes into one supposedly universal number.

## Importer Version 3

Importer v3 must be an offline, deterministic parser. Its input is an approved
artifact set; it must not fetch network pages.

Responsibilities:

1. Validate every artifact against its manifest and SHA-256 hash.
2. Parse collection, book, chapter, and record boundaries with explicit DOM
   selectors.
3. Preserve raw source text before normalization.
4. Extract Arabic, English, transliteration, narrator, references, numbering,
   and grading into separate fields.
5. Associate every record with its source artifact and hierarchy anchor.
6. Emit parsed JSONL, candidate JSONL, and a machine-readable validation report.
7. Produce byte-identical output for byte-identical inputs and importer version.
8. Perform no AI rewriting, translation, transliteration, grading, citation
   inference, or category assignment.

Collection-specific parser rules belong in separate modules sharing a common
contract. A failure in one collection must not weaken validation for another.

## Schema Additions Proposed

The existing canonical schema already provides datasets, records, segments,
collections, books, chapters, placements, references, taxonomy, verification,
correction history, and publication history. It should be extended, not
replaced, with:

- `source_acquisitions`: provider, rights state, permission evidence, and review.
- `source_artifacts`: immutable source hashes and retrieval metadata.
- `import_runs`: importer version, input set, output hash, state, and counts.
- `import_issues`: record/field-level errors, severity, evidence, and resolution.
- `source_record_identities`: provider-qualified stable source IDs.
- `source_record_revisions`: artifact-bound raw and parsed revisions.
- `record_numberings`: typed numbering schemes and values.
- `hadith_grades`: raw value, normalized value, authority, source, and review
  state.

Exact DDL should be proposed in a separate schema change after this design is
accepted. Candidate tables must not reuse public-read views, and importer jobs
must not switch the active dataset.

## Validation Gates

An import is rejected unless all applicable gates pass:

1. Rights status is `approved` for the intended use and distribution channels.
2. Every artifact exists and matches its expected hash.
3. Every JSONL line satisfies the versioned parser contract.
4. Manifest, parsed, and candidate counts agree.
5. Source identities and canonical identities are unique.
6. Every record has valid collection placement and source provenance.
7. Book and chapter coverage is complete wherever the source provides it.
8. Required Arabic and available source translations are non-empty.
9. The 73 Hisn field-boundary failures are resolved and reviewed.
10. References have structured locators and no parser punctuation artifacts.
11. Grades use reviewed mappings; unknown values remain raw and unresolved.
12. No Sahihayn grade is inferred from a page fragment.
13. A deterministic rerun produces the same output hashes.
14. Editorial sampling and source comparison pass.
15. Verification complies with ADR 0003; missing evidence is never inferred.

Warnings can be accepted only through an audited Admin decision. Errors block
publication.

## Admin Workflow

The future Admin import workspace should expose:

- acquisition and rights review
- artifact inventory and hash verification
- import-run progress and deterministic output hashes
- collection/book/chapter trees
- side-by-side raw, parsed, and canonical field comparison
- unresolved field-boundary, narrator, reference, and grade issue queues
- identity and numbering conflicts
- source-reference linking between duas and Hadith
- editorial verification and correction history
- validation summary, publication approval, and rollback

The UI must never offer Publish while rights are restricted or blocking issues
remain.

## Publication and Delivery

Publication follows this sequence:

```text
approved acquisition
  -> immutable artifacts
  -> deterministic parse
  -> candidate import
  -> validation and editorial review
  -> immutable dataset version
  -> atomic activation
  -> API/MCP reads and PWA snapshot
```

- D1 receives normalized candidate rows in controlled batches.
- Candidate import occurs under a new dataset version.
- Activation changes one active-version pointer only after validation succeeds.
- The previous active version remains available for rollback.
- API list/search routes stay paginated and never load the full corpus into
  Worker memory.
- MCP delegates to the API and does not carry a second copy of content.
- The PWA receives only its selected, compact dua snapshot and manifest. Raw
  HTML and the full Hadith corpus are never bundled into the PWA.
- Search indexes are generated from publishable canonical fields only.

## Delivery Phases

### Phase 0: Quarantine and permission

- Ignore the local source folder in Git.
- Add CI/deployment forbidden-path checks.
- Register the source as restricted.
- Request written permission, API access, or an approved offline dump.
- Identify independently licensed editions as fallback sources.

### Phase 1: Contracts and audit tooling

- Define versioned acquisition, artifact, parsed-record, candidate-record, and
  validation-report schemas.
- Add a local audit command that reports counts and hashes without emitting
  copyrighted text.
- Add fixture-sized synthetic HTML for parser tests.

### Phase 2: Importer v3

- Implement collection-specific offline parsers.
- Recover collection/book/chapter hierarchy.
- Correct Hisn field boundaries.
- Preserve raw grades and references while producing review issues.
- Prove deterministic output with fixtures and approved artifacts.

Work may proceed locally against synthetic fixtures before rights approval.
Running it over restricted source material must remain local.

### Phase 3: Candidate storage

- Add reviewed schema migrations.
- Add resumable import runs and issue tracking.
- Build the Admin import and comparison workflow.
- Import only after the acquisition rights state is approved.

### Phase 4: Editorial verification

- Verify source editions, translators, numbering, references, and grades.
- Curate Hisn into app-facing dua records.
- Link Hadith evidence without merging the two content types.

### Phase 5: Publication

- Publish the first approved immutable dataset.
- Expose versioned API and MCP reads.
- Generate and verify the compact PWA snapshot.
- Exercise rollback and provenance reconstruction.

### Phase 6: Hadith library

- Add dedicated Hadith browse, reference, and search contracts.
- Keep these APIs separate from app-facing dua discovery.
- Add indexing only after performance and rights review.

## Definition of Done

This initiative is complete only when:

- Fortress can prove permission and provenance for every published source.
- An import is reproducible from approved artifact hashes.
- Every published field traces to source evidence or an audited correction.
- Candidate and published states cannot be confused in API, MCP, Admin, or PWA.
- Hisn hierarchy and field boundaries pass automated and manual review.
- Hadith grades and numbering retain source and authority context.
- Dataset activation and rollback are atomic and tested.
- No restricted artifact or derived corpus text exists in Git or deployment
  outputs.

## Immediate Decision

Do not import the current corpus. Preserve it locally while requesting an
approved data channel. The next engineering work should be Phase 0 safeguards
and Phase 1 contracts using synthetic fixtures; schema and runtime changes wait
until this design is accepted.
