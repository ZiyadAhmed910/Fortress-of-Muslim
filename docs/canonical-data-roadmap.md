# Canonical Data Roadmap

## Implemented Foundation

- Versioned datasets and normalized records, parts, and segments.
- Languages, translations, collections, books, and chapters.
- Dua and Hadith metadata extension tables.
- Categories, topics, tags, keywords, moods, and occasions through typed taxonomy terms.
- Record sources, source references, cross references, contributors, and provenance hashes.
- Append-only verification, correction, publication, and content-audit history.
- Search metadata ready for deterministic indexing.
- Anonymous public reading with authenticated owner-scoped named queries.
- Evidence endpoint: `GET /v1/duas/{id}/evidence`.
- Admin source registry with independent license and authenticity trust decisions.
- Admin record inspector for citations, taxonomy assignment, evidence eligibility, and review history.
- Evidence-gated reference and record verification with append-only audit events.
- Approved Sunnah corpus importer with immutable artifact hashes, source identities, import reports, and a complete local D1 rehearsal.
- Collection discovery and paginated Hadith list, indexed search, and detail APIs.
- Standard MCP tools for collection discovery and Hadith retrieval.

## Next Increments

1. Admin collection, translation, and correction workflows.
2. Staged import jobs with validation reports and resumable background events.
3. Atomic dataset publisher and rollback, followed by a versioned PWA snapshot manifest.
4. Exact-reference and metadata-filtered search beyond the implemented indexed text search.
5. Independent authenticity verification and editorial resolution of imported warnings.
6. Edge rate controls, request/trace telemetry, queue monitoring, and deployment visibility.
7. Passkeys, MFA, granular content roles, and session management for Admin.

Semantic retrieval, embeddings, and generated answers remain intentionally later. They depend on verified canonical records and citation-complete evidence packs.
