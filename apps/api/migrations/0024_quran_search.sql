-- 0024: thematic Quran search -- "an ayah about tawakkul", "verses on patience".
--
-- Lexical search alone cannot answer these. The word "tawakkul" appears nowhere in an English
-- translation; "reliance upon Allah" does. That gap is exactly what embeddings close, so ayahs are
-- embedded the same way dua and hadith records are, into their own Vectorize namespace
-- (quran.saheeh.v1) so Ask's retrieval never sees them and this never competes with it.
--
-- This is deliberately NOT part of the canonical editorial corpus. Those tables model records that
-- are drafted, revised, reviewed and verified; the Quran is none of those things. It has no
-- revision history to keep, no reviewer to stamp it, and no verification status that would mean
-- anything. Putting it in canonical_records would have forced a workflow onto text that does not
-- have one, so it gets a plain table instead.
--
-- Licensing, which shapes the API response: the Arabic is Tanzil (CC BY 3.0, redistributable), but
-- the Saheeh International translation is not redistributable -- "copyright retained by the
-- publisher; free non-commercial religious use with attribution". Storing it here to search over is
-- internal use. Serving it from a public API to third-party developers would not be. So the
-- translation lives in this table and is never returned by the endpoint: search returns the surah
-- and ayah numbers, and the PWA renders the text from the copy it already ships. See
-- pwa-website/data/quran/index.json for the full attribution block.

CREATE TABLE quran_ayahs (
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  surah_name_simple TEXT NOT NULL,
  surah_name_english TEXT NOT NULL,
  revelation_place TEXT NOT NULL,
  -- Search-only. Never returned by the API; see the licensing note above.
  translation TEXT NOT NULL,
  PRIMARY KEY (surah, ayah)
);

-- The lexical half. Someone searching a phrase they half-remember ("no soul is burdened beyond")
-- should land on it exactly, which is what bm25 over the translation does and what an embedding
-- does poorly.
CREATE VIRTUAL TABLE quran_search_fts USING fts5(
  surah UNINDEXED,
  ayah UNINDEXED,
  surah_name,
  translation,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Mirrors rag_index_state: the per-minute cron walks this the same way, and the same status is
-- reported so a half-built index is visible rather than silently returning nothing.
CREATE TABLE quran_index_state (
  namespace TEXT PRIMARY KEY,
  expected_count INTEGER NOT NULL DEFAULT 0,
  indexed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
