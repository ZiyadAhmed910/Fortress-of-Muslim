-- Seeds the same starting vocabulary the offline PWA already uses (pwa-website/js/categories.js
-- CATEGORY_GROUPS/MOOD_GROUPS), so the online/canonical taxonomy system and the offline bundle
-- speak the same terms instead of drifting into two separate vocabularies. Assignment (which
-- records use which term) is still an editorial decision made through the Admin Console -- this
-- only creates the terms themselves, it does not assign anything.

INSERT INTO taxonomy_terms (id, taxonomy_type, slug, label, language_code, description) VALUES
  ('taxonomy.occasion.morning', 'occasion', 'morning', 'Morning', 'en', 'Morning and waking remembrances'),
  ('taxonomy.occasion.evening', 'occasion', 'evening', 'Evening', 'en', 'Evening and night remembrances'),
  ('taxonomy.occasion.sleep', 'occasion', 'sleep', 'Sleep', 'en', 'Before sleep and night protection'),
  ('taxonomy.occasion.salah', 'occasion', 'salah', 'Salah', 'en', 'Prayer, mosque, and ablution'),
  ('taxonomy.occasion.travel', 'occasion', 'travel', 'Travel', 'en', 'Travel, pilgrimage, and journeys'),
  ('taxonomy.occasion.ruqyah', 'occasion', 'ruqyah', 'Ruqyah', 'en', 'Protection and healing recitations'),
  ('taxonomy.mood.anxious', 'mood', 'anxious', 'Anxious', 'en', 'Anxiety, distress, worry, hardship'),
  ('taxonomy.mood.afraid', 'mood', 'afraid', 'Afraid', 'en', 'Fear, danger, seeking refuge'),
  ('taxonomy.mood.sad', 'mood', 'sad', 'Sad', 'en', 'Grief, sadness, sorrow'),
  ('taxonomy.mood.grateful', 'mood', 'grateful', 'Grateful', 'en', 'Praise, thanks, gratitude'),
  ('taxonomy.mood.protection', 'mood', 'protection', 'Protection', 'en', 'Seeking protection from harm');
