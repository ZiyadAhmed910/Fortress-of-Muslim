-- Withdrawing a canonical record: how content stops being served without being destroyed.
--
-- Revisions, parts and segments are protected by BEFORE DELETE triggers that RAISE(ABORT) -- the
-- schema deliberately makes published religious content undeletable, and that guarantee is worth
-- more than the convenience of a DELETE. Withdrawal is therefore a state a record is put into,
-- recorded with a reason, leaving the revision history intact and auditable.
--
-- The views below are the single choke point for public reads, so excluding withdrawn records here
-- removes them from list, search, get, and the Ask vector path (which hydrates matches through
-- api_published_content and so drops anything the view no longer returns). The three queries that
-- read around the views -- the RAG indexer, the FTS search join, and the record count -- carry the
-- same exclusion in code.

PRAGMA foreign_keys = ON;

CREATE TABLE canonical_withdrawals (
  canonical_id TEXT PRIMARY KEY REFERENCES canonical_records(canonical_id),
  reason TEXT NOT NULL,
  withdrawn_by_external_id TEXT,
  withdrawn_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_canonical_withdrawals_withdrawn_at ON canonical_withdrawals(withdrawn_at);

-- api_published_content is defined in terms of api_current_content, so both are rebuilt in order.
DROP VIEW api_published_content;
DROP VIEW api_current_content;

CREATE VIEW api_current_content AS
SELECT canonical.canonical_id,
       state.revision_id,
       revision.record_id,
       revision.revision_number,
       CASE
         WHEN state.workflow_state IN ('approved', 'published') THEN 'verified'
         WHEN state.workflow_state = 'changes_requested' THEN 'changes_requested'
         ELSE 'pending_review'
       END AS workflow_state,
       CASE
         WHEN state.verified_at IS NOT NULL
           AND state.workflow_state IN ('approved', 'published')
         THEN 'verified'
         ELSE 'unverified'
       END AS verification_status,
       state.verified_by_external_id,
       state.verified_at,
       publication.published_at
FROM canonical_records canonical
JOIN editorial_record_state state
  ON state.canonical_id = canonical.canonical_id
JOIN content_revisions revision
  ON revision.id = state.revision_id
LEFT JOIN canonical_publications publication
  ON publication.canonical_id = canonical.canonical_id
 AND publication.revision_id = state.revision_id
 AND publication.publication_status = 'published'
WHERE NOT EXISTS (
  SELECT 1 FROM canonical_withdrawals withdrawal
  WHERE withdrawal.canonical_id = canonical.canonical_id
);

CREATE VIEW api_published_content AS
SELECT current.*
FROM api_current_content current
WHERE current.workflow_state = 'verified'
  AND current.verification_status = 'verified'
  AND current.published_at IS NOT NULL;

-- Chapter 45 of Hisn al-Muslim lists three means of repelling the devil. Only the first is an
-- invocation; the other two ("the call to prayer" and "remembrance and recitation of the Qur'an")
-- are list items with no supplication to recite, which is why they carried a literal "--" where a
-- transliteration belongs. They are withdrawn rather than corrected: there is no text to fix.
-- Selected from canonical_records so this is a no-op wherever those records do not exist.
INSERT OR IGNORE INTO canonical_withdrawals (canonical_id, reason)
SELECT canonical_id,
       'Not a supplication. Hisn al-Muslim chapter 45 enumerates means of repelling the devil; this entry is a list item (not recitable text) that the reader rendered as a dua with an empty transliteration.'
FROM canonical_records
WHERE canonical_id IN ('dua.hisn.142', 'dua.hisn.143');

-- Lexical search reads the FTS table directly, so withdrawn rows come out of it too.
DELETE FROM canonical_search_fts
WHERE canonical_id IN (SELECT canonical_id FROM canonical_withdrawals);
