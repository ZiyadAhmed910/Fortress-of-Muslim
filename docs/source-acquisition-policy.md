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

The named collections in the product vision remain research candidates until each has a source record and evidence review. A corpus may be ingested only when its acquisition record is marked `approved` and the private permission evidence is retained outside Git. Approval for one acquisition does not grant approval for another source, edition, translation, or later snapshot.

The current Sunnah corpus acquisition is approved for Fortress D1 storage and delivery through the API, MCP, and PWA. Its raw artifacts, generated import SQL, and private permission evidence must remain outside Git and public deployment bundles.

## Import Evidence

Raw downloaded artifacts are immutable. Store their SHA-256 hash, retrieval date, and source URL. Parsers produce a validation report before normalization. A failed or incomplete import never replaces an active dataset.
