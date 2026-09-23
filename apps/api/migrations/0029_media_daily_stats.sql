-- 0029: count how often each media file is played and downloaded, one row per file per day.
--
-- Written by the media Worker as it serves a file, so the counts are what actually left our servers:
-- nothing depends on the app reporting back, and nothing can be inflated or skipped from the client.
--
-- What is deliberately not here: no IP address, no user agent, no identifier of any kind, nothing
-- that could join two plays to the same person. A row says "this file was played 41 times on this
-- day" and that is all it can ever say. Aggregates are what an audio provider's usage report needs,
-- and they are all this table can produce.
--
-- kind:
--   'play'      a request for the start of the file. Players fetch audio in ranges and re-request
--               on every seek, so only the first range is counted -- otherwise one listen through
--               would count as a dozen plays.
--   'download'  a whole-file fetch made to save the file for offline listening, which the app marks.
--
-- Plays of a file already saved on the device are served from the device and never reach us, so
-- they are not counted. That undercounts listening, never overcounts it.

CREATE TABLE media_daily_stats (
  day TEXT NOT NULL,               -- UTC, YYYY-MM-DD
  path TEXT NOT NULL,              -- the object key, e.g. duas/v1/dua-001/1.mp3
  kind TEXT NOT NULL CHECK (kind IN ('play', 'download')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, path, kind)
);

-- The report is read by date range, and by collection prefix within it.
CREATE INDEX media_daily_stats_day ON media_daily_stats (day);
