-- 0022: put Sahih Muslim into the corpus Ask answers from.
--
-- Ask has only ever had 268 duas to work with. The platform holds 14,357 hadith as well, none of
-- them published, so a question Ask could have answered from Sahih Muslim returned nothing.
--
-- Two things decide the size of this step rather than publishing all three collections at once:
--
-- 1. Vectorize. Embeddings are @cf/baai/bge-m3 at 1024 dimensions, and the account's free
--    allowance is 5,000,000 stored dimensions -- about 4,880 records. The whole hadith corpus is
--    ~15,000,000 dimensions, three times over that, and a production index later needs its own
--    copy of whatever this one holds. Sahih Muslim is 3,098 records: with the 268 duas that is
--    3,366 records, ~3.45M dimensions, inside the free allowance with room left.
-- 2. Whether this is worth paying for is exactly what publishing one collection answers.
--
-- These records are NOT verified. Ask's published rule has been that only verified content grounds
-- an answer; the decision here is that an unverified source clearly labelled as unverified is
-- better than no answer, and every layer already carries that label: the retrieval context tells
-- the model "Verification: unverified", the API returns verificationStatus per source, and the PWA
-- renders those sources differently with a note above them. Nothing here fabricates a verification
-- that has not happened -- the dataset version itself is recorded as verification_status 'pending'.
-- docs/canonical-editorial-architecture.md is updated in the same change.
--
-- Reversible: the previous dataset version is superseded, not deleted, and the Admin Console can
-- roll back to it from its complete canonical_dataset_items snapshot.

-- 1. Supersede the dataset Ask is currently answering from.
UPDATE canonical_dataset_versions
SET publication_status = 'superseded'
WHERE publication_status = 'published'
  AND EXISTS (SELECT 1 FROM collections WHERE slug = 'muslim');

-- 2. The new dataset version. record_count is filled in once its members are known.
INSERT INTO canonical_dataset_versions (
  id, version_label, publication_status, verification_status, record_count,
  canonical_hash, published_by_external_id, published_at
)
SELECT 'canonical.muslim-in-ask.2026-09-13',
       'Hisn duas and Sahih Muslim 2026-09-13',
       'published',
       -- 'pending': this dataset contains records no one has verified. Saying 'verified' here
       -- would be the one thing in this migration that is not true.
       'pending',
       0,
       'muslim-in-ask-2026-09-13',
       'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM collections WHERE slug = 'muslim');

-- 3. Publish every current Sahih Muslim revision that is not published and not withdrawn.
INSERT INTO canonical_publications (
  canonical_id, revision_id, record_id, dataset_version_id, revision_number,
  publication_status, published_by_external_id, published_at
)
SELECT canonical.canonical_id, revision.id, revision.record_id,
       'canonical.muslim-in-ask.2026-09-13', revision.revision_number,
       'published', 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', CURRENT_TIMESTAMP
FROM canonical_records canonical
JOIN content_revisions revision ON revision.id = canonical.current_revision_id
JOIN revision_metadata metadata ON metadata.revision_id = revision.id
JOIN collections collection ON collection.id = metadata.collection_id
WHERE canonical.content_type = 'hadith'
  AND collection.slug = 'muslim'
  AND NOT EXISTS (
    SELECT 1 FROM canonical_publications existing
    WHERE existing.canonical_id = canonical.canonical_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM canonical_withdrawals withdrawal
    WHERE withdrawal.canonical_id = canonical.canonical_id
  )
  AND EXISTS (SELECT 1 FROM canonical_dataset_versions WHERE id = 'canonical.muslim-in-ask.2026-09-13');

-- 4. Everything published now belongs to the new dataset, duas included.
UPDATE canonical_publications
SET dataset_version_id = 'canonical.muslim-in-ask.2026-09-13'
WHERE publication_status = 'published'
  AND EXISTS (SELECT 1 FROM canonical_dataset_versions WHERE id = 'canonical.muslim-in-ask.2026-09-13');

UPDATE canonical_dataset_versions
SET record_count = (SELECT COUNT(*) FROM canonical_publications WHERE publication_status = 'published')
WHERE id = 'canonical.muslim-in-ask.2026-09-13';

-- 5. The immutable membership snapshot a rollback restores from.
INSERT INTO canonical_dataset_items (dataset_version_id, canonical_id, revision_id)
SELECT 'canonical.muslim-in-ask.2026-09-13', canonical_id, revision_id
FROM canonical_publications
WHERE publication_status = 'published'
  AND EXISTS (SELECT 1 FROM canonical_dataset_versions WHERE id = 'canonical.muslim-in-ask.2026-09-13');

INSERT INTO canonical_publication_history (
  id, canonical_id, revision_id, record_id, dataset_version_id, revision_number,
  event_type, actor_external_id, occurred_at
)
SELECT 'publication-history.muslim-in-ask.' || publication.canonical_id,
       publication.canonical_id, publication.revision_id, publication.record_id,
       publication.dataset_version_id, publication.revision_number,
       'published', 'SxmXyBhmsGgVo5yCXiAl0XAHbiSwzCrZ', CURRENT_TIMESTAMP
FROM canonical_publications publication
JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
JOIN revision_metadata metadata ON metadata.revision_id = publication.revision_id
JOIN collections collection ON collection.id = metadata.collection_id
WHERE canonical.content_type = 'hadith'
  AND collection.slug = 'muslim'
  AND publication.publication_status = 'published';

-- 6. The lexical half of retrieval. Hadith carry a narrator, which is its own searchable column,
-- and no aliases -- those are per dua chapter. Same Arabic normalisation as every other write to
-- this table (tashkeel and tatweel removed, alef forms folded); see migration 0018.
DELETE FROM canonical_search_fts WHERE content_type = 'hadith';
INSERT INTO canonical_search_fts (
  canonical_id, revision_id, content_type, collection_slug, title, body, narrator
)
SELECT canonical.canonical_id, revision.id, canonical.content_type,
       COALESCE(collection.slug, 'unknown'),
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         revision.title,
         'ً', ''), 'ٌ', ''), 'ٍ', ''), 'َ', ''), 'ُ', ''), 'ِ', ''), 'ّ', ''), 'ْ', ''), 'ٰ', ''), 'ـ', ''),
         'آ', 'ا'), 'أ', 'ا'), 'إ', 'ا'), 'ٱ', 'ا'),
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         COALESCE(GROUP_CONCAT(segment.text, ' '), ''),
         'ً', ''), 'ٌ', ''), 'ٍ', ''), 'َ', ''), 'ُ', ''), 'ِ', ''), 'ّ', ''), 'ْ', ''), 'ٰ', ''), 'ـ', ''),
         'آ', 'ا'), 'أ', 'ا'), 'إ', 'ا'), 'ٱ', 'ا'),
       COALESCE(metadata.narrator, '')
FROM canonical_publications publication
JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
JOIN content_revisions revision ON revision.id = publication.revision_id
LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
LEFT JOIN collections collection ON collection.id = metadata.collection_id
LEFT JOIN revision_parts part ON part.revision_id = revision.id
LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
WHERE canonical.content_type = 'hadith'
  AND publication.publication_status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM canonical_withdrawals withdrawal
    WHERE withdrawal.canonical_id = canonical.canonical_id
  )
GROUP BY canonical.canonical_id, revision.id;

-- 7. Embed the new dataset. The per-minute cron walks it in batches; 3,366 records is well inside
-- one day's free Neuron allowance, and /v1/ask/status reports the progress.
INSERT INTO rag_index_state (dataset_version_id, expected_count, indexed_count, status, updated_at)
SELECT id, record_count, 0, CASE WHEN record_count = 0 THEN 'ready' ELSE 'pending' END, CURRENT_TIMESTAMP
FROM canonical_dataset_versions
WHERE id = 'canonical.muslim-in-ask.2026-09-13';
