-- 0023: let Ask read the records 0022 published.
--
-- 0022 published 14,357 hadith, the indexer embedded all of them, lexical search returned them --
-- and Ask cited none of them. Retrieval was never the problem. After retrieval, every candidate is
-- hydrated into a full record through api_published_content, and that view requires
-- workflow_state = 'verified' AND verification_status = 'verified' on top of being published. The
-- hadith are published and unverified by design, so every one of them was fetched, found missing,
-- and dropped without a trace. Asking "what are the pillars of Islam" returned supplications about
-- throwing pebbles at the Jamarat.
--
-- api_published_content is not the thing to change: it is what /v1/duas and /v1/hadith serve, and
-- those endpoints promise verified content. This is a third view for the one caller whose rule is
-- different -- Ask answers from what is published, and states each source's verification status
-- rather than requiring it.
--
-- Withdrawals are still excluded (api_current_content does that), verification is still reported
-- honestly (verification_status comes through untouched), and nothing here publishes or verifies
-- anything on its own.
CREATE VIEW api_ask_content AS
SELECT current.*
FROM api_current_content current
WHERE current.published_at IS NOT NULL;
