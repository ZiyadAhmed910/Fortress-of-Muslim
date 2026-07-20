# Source Acquisition Policy

## Rule

Fortress imports religious content only after both authenticity and reuse rights are documented. Popularity, availability on a website, or presence in a public Git repository is not evidence of either.

## Required Source Record

Every candidate must record:

- Work, collection, publisher, edition, publication year, and language.
- Stable publisher or repository URL and downloaded artifact hash.
- Translator and grading authority where applicable.
- Explicit license, terms URL, and allowed redistribution/derivative uses.
- Machine-readable format, completeness, numbering scheme, and update policy.
- Authenticity reviewer, review method, review date, and outcome.
- Mapping notes from source identifiers to Fortress canonical identifiers.

## Review States

1. `unreviewed` / `unknown`: may be retained as a clearly labelled legacy import, but cannot verify records.
2. `trusted` / `reviewing`: authenticity is accepted while legal reuse is still under review; no public canonical import.
3. `trusted` / `approved`: eligible for record references and canonical publishing.
4. `rejected` or `restricted`: never included in an open published snapshot.

## Candidate Register

The named collections in the product vision are research candidates, not approved sources. Each requires a separate source record and evidence review before ingestion. Do not copy data from Sunnah.com, Quran repositories, publishers, digital libraries, or third-party datasets until their current terms explicitly permit the intended open-source redistribution.

## Import Evidence

Raw downloaded artifacts are immutable. Store their SHA-256 hash, retrieval date, and source URL. Parsers produce a validation report before normalization. A failed or incomplete import never replaces an active dataset.

