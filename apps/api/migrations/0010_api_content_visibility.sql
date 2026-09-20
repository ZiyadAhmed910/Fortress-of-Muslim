CREATE VIEW api_current_content AS
SELECT canonical.canonical_id,
       state.revision_id,
       revision.record_id,
       revision.revision_number,
       state.workflow_state,
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
WHERE current.workflow_state = 'published'
  AND current.verification_status = 'verified'
  AND current.published_at IS NOT NULL;
