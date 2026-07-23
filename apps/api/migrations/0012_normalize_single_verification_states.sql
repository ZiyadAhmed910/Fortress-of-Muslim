UPDATE editorial_record_state
SET workflow_state = 'pending_review',
    changed_at = CURRENT_TIMESTAMP
WHERE workflow_state IN ('needs_second_review', 'needs_senior_approval');
