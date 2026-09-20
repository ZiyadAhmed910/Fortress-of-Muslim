ALTER TABLE editorial_record_state
ADD COLUMN verified_by_external_id TEXT;

ALTER TABLE editorial_record_state
ADD COLUMN verified_at TEXT;

CREATE INDEX editorial_record_verifier_idx
ON editorial_record_state(verified_by_external_id, verified_at);

UPDATE editorial_record_state
SET verified_by_external_id = (
      SELECT decision.reviewer_external_id
      FROM review_decisions decision
      WHERE decision.revision_id = editorial_record_state.revision_id
        AND decision.decision = 'approved'
      ORDER BY decision.decided_at
      LIMIT 1
    ),
    verified_at = (
      SELECT decision.decided_at
      FROM review_decisions decision
      WHERE decision.revision_id = editorial_record_state.revision_id
        AND decision.decision = 'approved'
      ORDER BY decision.decided_at
      LIMIT 1
    )
WHERE workflow_state IN ('approved', 'published');
