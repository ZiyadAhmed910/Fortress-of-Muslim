-- 0027: record what Ask retrieved, so retrieval can be improved from evidence rather than anecdote.
--
-- Every gap found so far was found by hand: "toilet" returning bathroom-adjacent readings,
-- "when angry" returning nothing, "tawakkul" returning nothing, "what does the Quran say about
-- patience" citing four hadith and no verse. Each took a person noticing and a session of digging.
-- This is the same information, written down as it happens: the question, the query retrieval
-- actually ran, what was cited and with what score. A month of it answers questions like which
-- terms keep missing, which kind of source wins when, and whether the relevance cut is set right.
--
-- What is deliberately not here: no IP address, no identifier, nothing joining two questions to the
-- same person. The rate limiter keeps its own per-IP counter and this does not touch it. A question
-- is user-written text, so it is kept as typed and treated as content, never as an instruction.
--
-- One row per answered question. At any plausible traffic for this app that is a rounding error
-- against D1's storage, and it can be pruned by asked_at whenever it stops being useful.

CREATE TABLE ask_query_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- As typed. The retrieval query differs: synonyms are appended, and a follow-up is rewritten to
  -- stand alone, which is exactly the difference worth being able to see.
  question TEXT NOT NULL,
  retrieval_query TEXT NOT NULL,
  -- 'dua', 'hadith', 'quran', or NULL for all sources.
  scope TEXT,
  rewritten INTEGER NOT NULL DEFAULT 0,
  -- How many candidates each half of retrieval produced before reranking.
  vector_candidates INTEGER NOT NULL DEFAULT 0,
  lexical_candidates INTEGER NOT NULL DEFAULT 0,
  verse_candidates INTEGER NOT NULL DEFAULT 0,
  reranked INTEGER NOT NULL DEFAULT 0,
  -- The sources the answer was written from: [{id, contentType, score}], best first. Empty when
  -- nothing survived, which is the most interesting row of all.
  sources TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  generated INTEGER NOT NULL DEFAULT 0
);

-- The two questions this table gets asked: what happened recently, and what found nothing.
CREATE INDEX ask_query_log_asked_at ON ask_query_log (asked_at DESC);
CREATE INDEX ask_query_log_empty ON ask_query_log (generated, asked_at DESC);
