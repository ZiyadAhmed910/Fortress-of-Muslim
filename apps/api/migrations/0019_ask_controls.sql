-- Controls for the Ask assistant: which model answers, how much of each model may be spent in a
-- day, and how many questions one client may ask.
--
-- Why any of this is configurable rather than constants in code: the good reasoning models cost
-- real money per answer, and the right trade between "best answer" and "answers for everyone"
-- depends on the day's traffic, not on what was true when the code was written. Workers AI gives
-- every account a fixed pool of free Neurons per day; gpt-oss-120b spends that pool roughly twice
-- as fast as gpt-oss-20b, so the policy is: use the better model until a set share of its daily
-- allowance is gone, then drop to the cheaper one for the rest of the day. Nobody is refused an
-- answer because the good model ran out -- they get the cheaper one.
--
-- A limit of 0 means unlimited, everywhere in this table. That is what makes the per-client limit
-- switchable off for testing without a deploy, which is the state this was asked for.
CREATE TABLE ask_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- Questions one client (hashed IP, per UTC day) may ask. 0 = unlimited.
  per_ip_daily_limit INTEGER NOT NULL DEFAULT 20 CHECK (per_ip_daily_limit >= 0),
  -- The model that answers while its allowance holds out.
  primary_model TEXT NOT NULL DEFAULT '@cf/openai/gpt-oss-120b',
  primary_daily_limit INTEGER NOT NULL DEFAULT 80 CHECK (primary_daily_limit >= 0),
  -- Share of that allowance to spend before handing over, leaving the rest of the day's Neurons
  -- for embeddings, indexing and the cheaper model.
  primary_switch_percent INTEGER NOT NULL DEFAULT 75 CHECK (primary_switch_percent BETWEEN 1 AND 100),
  -- Where questions go once the primary model has had its share.
  secondary_model TEXT NOT NULL DEFAULT '@cf/openai/gpt-oss-20b',
  secondary_daily_limit INTEGER NOT NULL DEFAULT 600 CHECK (secondary_daily_limit >= 0),
  updated_by_external_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ask_settings (id) VALUES (1);

-- One row per model per UTC day. Counted after a model actually answers, so a failed call does not
-- spend anyone's allowance.
CREATE TABLE ask_model_usage (
  usage_date TEXT NOT NULL,
  model TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usage_date, model)
);

CREATE INDEX idx_ask_model_usage_date ON ask_model_usage(usage_date);
