-- 0030: settings the app reads at launch, changed from the Admin Console without a release.
--
-- One row, like ask_settings. The first setting is where Quran recitation and word-by-word audio come
-- from: 'own' is the platform's media host (apps/media, R2) -- the default, and the owner's choice --
-- and 'external' is everyayah.com and audio.qurancdn.com, where the same files lived before 0.50.3.
-- Switching is the way back if the media host ever has a problem, with no deploy and no app update.
-- Dua recitation exists only on the media host, so it is not switchable.
--
-- Read publicly through GET /v1/app-config (apps/api) and changed through PATCH
-- /v1/admin/app-settings (apps/auth, admin only, audited).

CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  audio_source TEXT NOT NULL DEFAULT 'own' CHECK (audio_source IN ('own', 'external')),
  updated_by_external_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_settings (id) VALUES (1);
