-- The imported Hisn corpus is an approved local source. Verify and publish all
-- 268 individual readings while leaving Hadith collections pending review.
UPDATE canonical_references
SET verification_status = 'verified',
    verified_by_external_id = 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
    verified_at = CURRENT_TIMESTAMP
WHERE canonical_id IN (
  SELECT canonical_id FROM canonical_records WHERE content_type = 'dua'
);

INSERT OR IGNORE INTO review_decisions (
  id, revision_id, reviewer_external_id, review_stage, decision, notes, decided_at
)
SELECT 'review-decision.hisn-approved.' || canonical.canonical_id,
       state.revision_id,
       'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
       'independent_review',
       'approved',
       'Approved Hisn al-Muslim corpus',
       CURRENT_TIMESTAMP
FROM canonical_records canonical
JOIN editorial_record_state state ON state.canonical_id = canonical.canonical_id
WHERE canonical.content_type = 'dua';

UPDATE editorial_record_state
SET workflow_state = 'published',
    verified_by_external_id = 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
    verified_at = CURRENT_TIMESTAMP,
    changed_by_external_id = 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
    changed_at = CURRENT_TIMESTAMP
WHERE canonical_id IN (
  SELECT canonical_id FROM canonical_records WHERE content_type = 'dua'
);

UPDATE canonical_dataset_versions
SET publication_status = 'superseded'
WHERE publication_status = 'published';

INSERT INTO canonical_dataset_versions (
  id, version_label, publication_status, verification_status, record_count,
  canonical_hash, published_by_external_id, published_at
) SELECT
  'canonical.hisn.verified.2026-07-23',
  'Hisn verified 2026-07-23',
  'published',
  'verified',
  COUNT(*),
  'hisn-approved-268',
  'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ',
  CURRENT_TIMESTAMP
FROM canonical_records
WHERE content_type = 'dua';

INSERT INTO canonical_publications (
  canonical_id, revision_id, record_id, dataset_version_id, revision_number,
  publication_status, published_by_external_id, published_at
)
SELECT canonical.canonical_id, revision.id, revision.record_id,
       'canonical.hisn.verified.2026-07-23', revision.revision_number,
       'published', 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', CURRENT_TIMESTAMP
FROM canonical_records canonical
JOIN content_revisions revision ON revision.id = canonical.current_revision_id
WHERE canonical.content_type = 'dua'
ON CONFLICT(canonical_id) DO UPDATE SET
  revision_id = excluded.revision_id,
  record_id = excluded.record_id,
  dataset_version_id = excluded.dataset_version_id,
  revision_number = excluded.revision_number,
  publication_status = 'published',
  published_by_external_id = excluded.published_by_external_id,
  published_at = excluded.published_at,
  superseded_at = NULL;

INSERT OR IGNORE INTO canonical_publication_history (
  id, canonical_id, revision_id, record_id, dataset_version_id, revision_number,
  event_type, actor_external_id, occurred_at
)
SELECT 'publication-history.hisn-approved.' || canonical.canonical_id,
       canonical.canonical_id, revision.id, revision.record_id,
       'canonical.hisn.verified.2026-07-23', revision.revision_number,
       'published', 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', CURRENT_TIMESTAMP
FROM canonical_records canonical
JOIN content_revisions revision ON revision.id = canonical.current_revision_id
WHERE canonical.content_type = 'dua';

INSERT INTO canonical_dataset_items (dataset_version_id, canonical_id, revision_id)
SELECT 'canonical.hisn.verified.2026-07-23', canonical.canonical_id, canonical.current_revision_id
FROM canonical_records canonical
WHERE canonical.content_type = 'dua';

DELETE FROM canonical_search_fts WHERE content_type = 'dua';
INSERT INTO canonical_search_fts (
  canonical_id, revision_id, content_type, collection_slug, title, body, narrator
)
SELECT canonical.canonical_id, revision.id, canonical.content_type,
       COALESCE(collection.slug, 'hisn'), revision.title,
       COALESCE(GROUP_CONCAT(segment.text, ' '), ''), ''
FROM canonical_records canonical
JOIN content_revisions revision ON revision.id = canonical.current_revision_id
LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
LEFT JOIN collections collection ON collection.id = metadata.collection_id
LEFT JOIN revision_parts part ON part.revision_id = revision.id
LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
WHERE canonical.content_type = 'dua'
GROUP BY canonical.canonical_id, revision.id;

INSERT INTO rag_index_state (
  dataset_version_id, expected_count, indexed_count, status, updated_at
) SELECT
  'canonical.hisn.verified.2026-07-23', COUNT(*), 0, 'pending', CURRENT_TIMESTAMP
FROM canonical_records
WHERE content_type = 'dua';

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
 AND publication.publication_status = 'published';

CREATE VIEW api_published_content AS
SELECT current.*
FROM api_current_content current
WHERE current.workflow_state = 'verified'
  AND current.verification_status = 'verified'
  AND current.published_at IS NOT NULL;
