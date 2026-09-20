-- Search aliases: the everyday words people type when the book uses a different one.
--
-- The corpus says "bathroom" and never "toilet", so lexical search for a toilet found nothing at
-- all, and the whole burden of the vocabulary gap fell on the embedding model. These are search
-- terms only: they are appended to the lexical index and to the text each record is embedded from,
-- and are never displayed, never part of a revision, and never religious text. Keyed by chapter,
-- because that is the unit people search for; every reading in a chapter inherits them.
--
-- Reviewed source: apps/api/data/search-aliases.json (480 aliases over all 132 chapters).

CREATE TABLE canonical_search_aliases (
  chapter_id TEXT PRIMARY KEY,
  aliases TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO canonical_search_aliases (chapter_id, aliases) VALUES
  ('book.sunnah.hisn.1.chapter.c1.00', 'wake up, woke up, getting out of bed, after sleeping, first thing in the morning'),
  ('book.sunnah.hisn.1.chapter.c2.00', 'clothes, clothing, getting dressed, putting on clothes'),
  ('book.sunnah.hisn.1.chapter.c3.00', 'new clothes, new dress, new shirt, just bought clothes'),
  ('book.sunnah.hisn.1.chapter.c4.00', 'complimenting new clothes, someone wearing new clothes'),
  ('book.sunnah.hisn.1.chapter.c5.00', 'taking off clothes, removing clothes, getting undressed, changing clothes'),
  ('book.sunnah.hisn.1.chapter.c6.00', 'toilet, washroom, restroom, lavatory, loo, wc, going to the toilet, entering the toilet'),
  ('book.sunnah.hisn.1.chapter.c7.00', 'leaving the toilet, after the toilet, coming out of the washroom, exiting the restroom'),
  ('book.sunnah.hisn.1.chapter.c8.00', 'wudu, wudhu, wuzu, washing before prayer, ritual washing'),
  ('book.sunnah.hisn.1.chapter.c9.00', 'after wudu, finishing wudu, completed ablution'),
  ('book.sunnah.hisn.1.chapter.c10.00', 'leaving the house, going out, stepping out, exiting home'),
  ('book.sunnah.hisn.1.chapter.c11.00', 'coming home, entering the house, returning home, arriving home'),
  ('book.sunnah.hisn.1.chapter.c12.00', 'walking to the masjid, heading to the mosque, on the way to masjid'),
  ('book.sunnah.hisn.1.chapter.c13.00', 'entering the masjid, coming into the mosque, masjid entry'),
  ('book.sunnah.hisn.1.chapter.c14.00', 'leaving the masjid, exiting the mosque, coming out of the masjid'),
  ('book.sunnah.hisn.1.chapter.c15.00', 'adhan, azan, muezzin, muadhdhin, after the adhan, iqamah'),
  ('book.sunnah.hisn.1.chapter.c16.00', 'opening supplication, istiftah, beginning the prayer, after takbir, start of salah'),
  ('book.sunnah.hisn.1.chapter.c17.00', 'ruku, rukoo, bowing in salah, bowing in salat'),
  ('book.sunnah.hisn.1.chapter.c18.00', 'itidal, standing after ruku, rising from bowing, sami allahu liman hamidah'),
  ('book.sunnah.hisn.1.chapter.c19.00', 'sujood, sajdah, prostration, prostrating in salah'),
  ('book.sunnah.hisn.1.chapter.c20.00', 'between the prostrations, sitting between sajdah, jalsa'),
  ('book.sunnah.hisn.1.chapter.c21.00', 'sajdah tilawah, prostration of recitation, quran prostration'),
  ('book.sunnah.hisn.1.chapter.c22.00', 'attahiyat, tahiyyat, sitting in prayer, tashahud'),
  ('book.sunnah.hisn.1.chapter.c23.00', 'durood, darood, salawat, blessings on the prophet, salat ibrahimiyya'),
  ('book.sunnah.hisn.1.chapter.c24.00', 'before ending the prayer, before salaam, end of salah'),
  ('book.sunnah.hisn.1.chapter.c25.00', 'after prayer, after salah, post prayer remembrance, finishing the prayer'),
  ('book.sunnah.hisn.1.chapter.c26.00', 'istikhara, istikhaarah, making a decision, guidance prayer, which choice'),
  ('book.sunnah.hisn.1.chapter.c27.00', 'morning adhkar, evening adhkar, morning azkar, daily remembrance, morning and evening dhikr'),
  ('book.sunnah.hisn.1.chapter.c28.00', 'bedtime, going to bed, before bed, night time'),
  ('book.sunnah.hisn.1.chapter.c29.00', 'cannot sleep, insomnia, restless at night, waking in the night, turning in bed'),
  ('book.sunnah.hisn.1.chapter.c30.00', 'nightmare, night terror, scared at night, frightened in sleep'),
  ('book.sunnah.hisn.1.chapter.c31.00', 'nightmare, saw a dream'),
  ('book.sunnah.hisn.1.chapter.c32.00', 'qunut, witr qunoot, dua qunoot'),
  ('book.sunnah.hisn.1.chapter.c33.00', 'after witr, subhanal malikil quddus'),
  ('book.sunnah.hisn.1.chapter.c34.00', 'anxious, worried, depressed, sadness, grief, stress'),
  ('book.sunnah.hisn.1.chapter.c35.00', 'distressed, hardship, difficulty, in trouble, desperate'),
  ('book.sunnah.hisn.1.chapter.c36.00', 'facing an enemy, confronting a ruler, meeting authority, facing power'),
  ('book.sunnah.hisn.1.chapter.c37.00', 'unjust ruler, tyrant, oppressive leader, injustice from authority'),
  ('book.sunnah.hisn.1.chapter.c38.00', 'opponents, adversaries'),
  ('book.sunnah.hisn.1.chapter.c39.00', 'afraid of people, afraid of a crowd, threatened by a group'),
  ('book.sunnah.hisn.1.chapter.c40.00', 'doubts about faith, questioning faith, weak iman, waswas about belief'),
  ('book.sunnah.hisn.1.chapter.c41.00', 'loan, owing money, repay a debt, financial burden, paying off debt'),
  ('book.sunnah.hisn.1.chapter.c42.00', 'waswas, whispers in prayer, distraction in salah, losing concentration'),
  ('book.sunnah.hisn.1.chapter.c43.00', 'things are difficult, stuck, obstacles, nothing is working'),
  ('book.sunnah.hisn.1.chapter.c44.00', 'sinned, after a sin, guilt, repenting a sin'),
  ('book.sunnah.hisn.1.chapter.c45.00', 'shaytan, satan, evil whispers, evil thoughts, waswas'),
  ('book.sunnah.hisn.1.chapter.c46.00', 'calamity struck, something bad happened, misfortune, setback'),
  ('book.sunnah.hisn.1.chapter.c47.00', 'newborn, new baby, baby born, childbirth congratulations'),
  ('book.sunnah.hisn.1.chapter.c48.00', 'protecting children, kids protection, children safety, evil eye on children'),
  ('book.sunnah.hisn.1.chapter.c49.00', 'sick person, patient, ill, hospital visit, visiting the ill'),
  ('book.sunnah.hisn.1.chapter.c50.00', 'reward for visiting the sick, virtue of visiting a patient'),
  ('book.sunnah.hisn.1.chapter.c51.00', 'terminally ill, no hope of recovery, dying person'),
  ('book.sunnah.hisn.1.chapter.c52.00', 'dying, deathbed, last moments, talqeen'),
  ('book.sunnah.hisn.1.chapter.c53.00', 'disaster, tragedy, loss, inna lillahi, bereaved'),
  ('book.sunnah.hisn.1.chapter.c54.00', 'someone died, at the moment of death'),
  ('book.sunnah.hisn.1.chapter.c55.00', 'janazah, salat al janazah'),
  ('book.sunnah.hisn.1.chapter.c56.00', 'child died, infant death, baby funeral'),
  ('book.sunnah.hisn.1.chapter.c57.00', 'condolences, sympathy, consoling, comforting the grieving'),
  ('book.sunnah.hisn.1.chapter.c58.00', 'burial, lowering into the grave, laying to rest'),
  ('book.sunnah.hisn.1.chapter.c59.00', 'after burial, after the funeral, at the graveside'),
  ('book.sunnah.hisn.1.chapter.c60.00', 'graveyard, cemetery, visiting the dead, qabristan'),
  ('book.sunnah.hisn.1.chapter.c61.00', 'strong wind, gale, hurricane, cyclone'),
  ('book.sunnah.hisn.1.chapter.c62.00', 'thunderstorm, lightning'),
  ('book.sunnah.hisn.1.chapter.c63.00', 'asking for rain, istisqa, drought, need rain, no rain'),
  ('book.sunnah.hisn.1.chapter.c64.00', 'raining, rainfall, rain falling'),
  ('book.sunnah.hisn.1.chapter.c65.00', 'after the rain, rain stopped'),
  ('book.sunnah.hisn.1.chapter.c66.00', 'too much rain, stop the rain, flooding, clear weather'),
  ('book.sunnah.hisn.1.chapter.c67.00', 'new moon, hilal, moon sighting, start of the month, ramadan moon'),
  ('book.sunnah.hisn.1.chapter.c68.00', 'iftar, opening the fast, ending the fast, roza, breaking the fast'),
  ('book.sunnah.hisn.1.chapter.c69.00', 'meal, food, before food, bismillah before eating'),
  ('book.sunnah.hisn.1.chapter.c70.00', 'after eating, finished the meal, after food'),
  ('book.sunnah.hisn.1.chapter.c71.00', 'thanking the host, hospitality'),
  ('book.sunnah.hisn.1.chapter.c72.00', 'someone fed me, offered a drink, feeding others'),
  ('book.sunnah.hisn.1.chapter.c73.00', 'iftar at someone''s house, guest for iftar'),
  ('book.sunnah.hisn.1.chapter.c74.00', 'invited while fasting, offered food while fasting, declining food while fasting'),
  ('book.sunnah.hisn.1.chapter.c75.00', 'abused while fasting, argument while fasting, provoked while fasting'),
  ('book.sunnah.hisn.1.chapter.c76.00', 'first fruit, new harvest, fruit season'),
  ('book.sunnah.hisn.1.chapter.c77.00', 'sneeze, alhamdulillah after sneezing, yarhamukallah'),
  ('book.sunnah.hisn.1.chapter.c78.00', 'non muslim sneezes, disbeliever sneezing'),
  ('book.sunnah.hisn.1.chapter.c79.00', 'marriage congratulations, wedding, just married, nikah'),
  ('book.sunnah.hisn.1.chapter.c80.00', 'new wife, buying livestock'),
  ('book.sunnah.hisn.1.chapter.c81.00', 'intimacy, marital relations, husband and wife, before intercourse'),
  ('book.sunnah.hisn.1.chapter.c82.00', 'anger, rage, temper, losing my temper'),
  ('book.sunnah.hisn.1.chapter.c83.00', 'someone suffering, afflicted person, seeing disability, someone in hardship'),
  ('book.sunnah.hisn.1.chapter.c84.00', 'majlis, meeting, assembly, gathering of people'),
  ('book.sunnah.hisn.1.chapter.c85.00', 'kaffaratul majlis, ending a meeting, leaving a gathering, closing a gathering'),
  ('book.sunnah.hisn.1.chapter.c86.00', 'someone prayed for me, replying to forgiveness'),
  ('book.sunnah.hisn.1.chapter.c87.00', 'jazakallah, thank you, gratitude, someone helped me, returning a favour'),
  ('book.sunnah.hisn.1.chapter.c88.00', 'antichrist, false messiah'),
  ('book.sunnah.hisn.1.chapter.c89.00', 'loves you for allah''s sake, brotherhood, declaring love'),
  ('book.sunnah.hisn.1.chapter.c90.00', 'gift of money, someone gave wealth, generosity, offered money'),
  ('book.sunnah.hisn.1.chapter.c91.00', 'repaid a loan, debt paid back, settled the debt'),
  ('book.sunnah.hisn.1.chapter.c92.00', 'associating partners, polytheism, hidden shirk'),
  ('book.sunnah.hisn.1.chapter.c93.00', 'barakallahu feek, replying to a blessing'),
  ('book.sunnah.hisn.1.chapter.c94.00', 'superstition, bad omen, tiyara, luck, unlucky'),
  ('book.sunnah.hisn.1.chapter.c95.00', 'car, vehicle, driving, riding, bus, plane, boarding'),
  ('book.sunnah.hisn.1.chapter.c96.00', 'journey, trip, travelling, safar, going away, travel dua'),
  ('book.sunnah.hisn.1.chapter.c97.00', 'arriving at a city, entering a new town, reaching a village'),
  ('book.sunnah.hisn.1.chapter.c98.00', 'shopping, mall, bazaar, going shopping'),
  ('book.sunnah.hisn.1.chapter.c99.00', 'vehicle trouble, breakdown, the animal stumbles'),
  ('book.sunnah.hisn.1.chapter.c100.00', 'leaving someone behind, farewell, saying goodbye'),
  ('book.sunnah.hisn.1.chapter.c101.00', 'seeing someone off, farewell to a traveller, safe journey'),
  ('book.sunnah.hisn.1.chapter.c102.00', 'going uphill, going downhill, ascending, descending'),
  ('book.sunnah.hisn.1.chapter.c103.00', 'dawn on a journey, fajr while travelling'),
  ('book.sunnah.hisn.1.chapter.c104.00', 'resting place, camping, staying somewhere, stopping for the night, hotel'),
  ('book.sunnah.hisn.1.chapter.c105.00', 'coming back home, back from a trip, returning from a journey'),
  ('book.sunnah.hisn.1.chapter.c106.00', 'good news, bad news, hearing news'),
  ('book.sunnah.hisn.1.chapter.c107.00', 'virtue of durood, reward of salawat, benefits of blessings on the prophet'),
  ('book.sunnah.hisn.1.chapter.c108.00', 'salam, assalamu alaikum, spreading peace'),
  ('book.sunnah.hisn.1.chapter.c109.00', 'greeting a non muslim, replying to a non muslim'),
  ('book.sunnah.hisn.1.chapter.c110.00', 'rooster crowing, cock crowing, donkey braying, animal sounds'),
  ('book.sunnah.hisn.1.chapter.c111.00', 'dogs barking, barking at night'),
  ('book.sunnah.hisn.1.chapter.c112.00', 'insulted someone, said something bad, apologising'),
  ('book.sunnah.hisn.1.chapter.c113.00', 'complimenting someone, praising someone, praise etiquette'),
  ('book.sunnah.hisn.1.chapter.c114.00', 'being complimented, when praised'),
  ('book.sunnah.hisn.1.chapter.c115.00', 'labbayk, pilgrimage, talbiyah'),
  ('book.sunnah.hisn.1.chapter.c116.00', 'hajar al aswad, tawaf'),
  ('book.sunnah.hisn.1.chapter.c117.00', 'rabbana atina, tawaf supplication'),
  ('book.sunnah.hisn.1.chapter.c118.00', 'saee, sai, safa marwah, walking between the hills'),
  ('book.sunnah.hisn.1.chapter.c119.00', 'arafat, ninth of dhul hijjah, standing at arafah'),
  ('book.sunnah.hisn.1.chapter.c120.00', 'muzdalifah, mashar al haram'),
  ('book.sunnah.hisn.1.chapter.c121.00', 'stoning, rami, throwing pebbles'),
  ('book.sunnah.hisn.1.chapter.c122.00', 'amazed, wonder, surprise, delighted, astonished'),
  ('book.sunnah.hisn.1.chapter.c123.00', 'happy news, joyful news, pleasant surprise'),
  ('book.sunnah.hisn.1.chapter.c124.00', 'hurts, ache, injury, sore, body pain'),
  ('book.sunnah.hisn.1.chapter.c125.00', 'evil eye, nazar, ayn, jealousy, mashallah'),
  ('book.sunnah.hisn.1.chapter.c126.00', 'frightened, shock, sudden fear, jumped'),
  ('book.sunnah.hisn.1.chapter.c127.00', 'qurbani, udhiya, zabiha, eid sacrifice'),
  ('book.sunnah.hisn.1.chapter.c128.00', 'jinn, evil spirits, protection from jinn'),
  ('book.sunnah.hisn.1.chapter.c129.00', 'tawbah, istighfar, astaghfirullah, seeking pardon'),
  ('book.sunnah.hisn.1.chapter.c130.00', 'subhanallah, alhamdulillah, la ilaha illallah, allahu akbar, dhikr reward, virtue of remembrance'),
  ('book.sunnah.hisn.1.chapter.c131.00', 'counting dhikr, counting on fingers, how to do tasbih'),
  ('book.sunnah.hisn.1.chapter.c132.00', 'good manners, akhlaq, character, etiquette, comprehensive good');

-- Rebuild the dua rows of the lexical index with the aliases appended, so a search for a word the
-- book never uses reaches the reading that answers it. Same normalisation as every other write to
-- this table (tashkeel and tatweel removed, alef forms folded) -- see migration 0018.
DELETE FROM canonical_search_fts WHERE content_type = 'dua';
INSERT INTO canonical_search_fts (
  canonical_id, revision_id, content_type, collection_slug, title, body, narrator
)
SELECT canonical.canonical_id, revision.id, canonical.content_type,
       COALESCE(collection.slug, 'hisn'),
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         revision.title,
         'ً', ''), 'ٌ', ''), 'ٍ', ''), 'َ', ''), 'ُ', ''), 'ِ', ''), 'ّ', ''), 'ْ', ''), 'ٰ', ''), 'ـ', ''),
         'آ', 'ا'), 'أ', 'ا'), 'إ', 'ا'), 'ٱ', 'ا'),
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         COALESCE(GROUP_CONCAT(segment.text, ' '), '') || ' ' || COALESCE(alias.aliases, ''),
         'ً', ''), 'ٌ', ''), 'ٍ', ''), 'َ', ''), 'ُ', ''), 'ِ', ''), 'ّ', ''), 'ْ', ''), 'ٰ', ''), 'ـ', ''),
         'آ', 'ا'), 'أ', 'ا'), 'إ', 'ا'), 'ٱ', 'ا'),
       COALESCE(metadata.narrator, '')
FROM canonical_publications publication
JOIN canonical_records canonical ON canonical.canonical_id = publication.canonical_id
JOIN content_revisions revision ON revision.id = publication.revision_id
LEFT JOIN revision_metadata metadata ON metadata.revision_id = revision.id
LEFT JOIN canonical_search_aliases alias ON alias.chapter_id = metadata.chapter_id
LEFT JOIN collections collection ON collection.id = metadata.collection_id
LEFT JOIN revision_parts part ON part.revision_id = revision.id
LEFT JOIN revision_segments segment ON segment.revision_part_id = part.id
WHERE canonical.content_type = 'dua'
  AND publication.publication_status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM canonical_withdrawals withdrawal
    WHERE withdrawal.canonical_id = canonical.canonical_id
  )
GROUP BY canonical.canonical_id, revision.id;

-- The vectors were embedded from text that had no aliases in it, so they are now stale. Marking the
-- current dataset pending makes the per-minute cron re-embed it in place -- no new dataset version,
-- because nothing about what is published has changed, only the text each record is indexed from.
UPDATE rag_index_state
SET status = 'pending', indexed_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
WHERE dataset_version_id = (
  SELECT id FROM canonical_dataset_versions WHERE publication_status = 'published' LIMIT 1
);
