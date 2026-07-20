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

## Next Increments

1. Admin source, collection, citation, taxonomy, and translation management.
2. Staged import jobs with validation reports and resumable background events.
3. Atomic dataset publisher and rollback, followed by a versioned PWA snapshot manifest.
4. Exact-reference, metadata-filtered, and indexed full-text search.
5. First legally approved, independently verified canonical source import.
6. Hadith read APIs after a collection passes source and license review.
7. Edge rate controls, request/trace telemetry, queue monitoring, and deployment visibility.
8. Passkeys, MFA, granular content roles, and session management for Admin.

Semantic retrieval, embeddings, and generated answers remain intentionally later. They depend on verified canonical records and citation-complete evidence packs.
