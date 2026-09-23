# Fortress Platform

Fortress Platform is an open-source Islamic data and agent platform. Fortress of Muslim, its offline-first dua reader, is the first reference application and remains available without login, ads, or tracking requirements.

The platform is being developed as a monorepo. The existing static PWA continues to deploy from `pwa-website/`, while independently deployable services and shared packages live under `apps/` and `packages/`.

## Why This Exists

Many dua apps are either heavy, unavailable, cluttered, or tied to platform stores. This project aims to be:

- Simple enough to run from static hosting.
- Fast enough for older phones and slow connections.
- Offline-friendly after the first load.
- Accessible without accounts, tracking, or ads.
- Easy for contributors to improve as the dua data becomes cleaner and richer.

The long-term plan is to support a larger curated library with 300-400 duas, references, ruqyah sections, mood-based discovery, and import/export for personal settings.

## App Features

The PWA is the flagship: a complete Islamic companion that works with no connection. Only the
Hadith browser and the Ask assistant require the network, and both are deliberately isolated from
the offline caches.

**Duas** — 132 Hisn al-Muslim chapters / 268 readings bundled locally. Categories and moods come
from curated data on each entry, never inferred from the text. Search covers titles, Arabic,
transliteration, translation, categories, moods and tags, with matches highlighted. Favourites,
part-by-part reader, swipe navigation, copy and share.

**Quran** — all 114 surahs with Saheeh International translation, fetched per surah on first open
and kept in a cache that survives deploys. Tajweed colouring, page or continuous reading, sajdah
marks, per-ayah and per-surah favourites, continue-reading, and full-Quran download for offline use.

**Recitation** — ayah-by-ayah playback from six reciters that advances through the surah on its
own, highlighting and scrolling to each ayah, and keeps playing with the phone locked. Repeat off/ayah/surah, and a per-surah offline
download that reports real bytes as it goes and can be cancelled.

**Word by word** — every word with its English meaning, and tap any word to hear it. Word positions
are built from the same source that numbers the audio files rather than derived from the text, so a
word never plays out of step with the one shown.

**Prayer times** — Meeus solar-position maths with five calculation methods and both Asr methods.
Above ~48° where Fajr and Isha cannot be observed, four high-latitude conventions are offered
(angle-based, one-seventh, middle of the night, or none); inside the polar circles times come from
the nearest latitude where the sun rises and sets. Every derived time is labelled as estimated.

**Qibla** — great-circle bearing with a live compass where the device supports absolute heading.

**Tasbih** — presets, custom phrases, lifetime totals, progress ring and haptics.

**Reminders** — opt-in local notifications for the five prayers and for morning and evening adhkar.

**Throughout** — installable PWA with update banner, simple and advanced layouts, per-feature
show/hide, dark mode, adjustable Arabic size, first-run walkthrough, and backup export/import
covering favourites, settings, tasbih, layout and Quran preferences.

## Project Structure

```text
.
├── apps/
│   ├── api/              Cloudflare Worker public API
│   ├── auth/             Identity, credentials, OAuth and control plane
│   ├── developers/       Developer documentation and API explorer
│   └── status/           Live service status dashboard
├── packages/
│   ├── contracts/        Shared runtime schemas and TypeScript types
│   └── portal-ui/        Shared portal design system and build tooling
├── android-app/
│   └── README.md
├── docs/
│   ├── deployment.md
│   └── platform-architecture.md
├── pwa-website/
│   ├── assets/
│   ├── css/
│   ├── data/
│   ├── icons/
│   ├── js/
│   ├── tools/
│   ├── index.html
│   ├── manifest.json
│   ├── serve.py
│   ├── styles.css
│   └── sw.js
└── Fortress_of_Muslim.docx
```

## Platform Development

Install dependencies and verify every workspace:

```powershell
npm install
npm run check
```

Run the Cloudflare API locally:

```powershell
npm run dev:api
```

Run either static platform portal locally:

```powershell
npm run dev:developers
npm run dev:status
```

Current hosted test API:

```text
https://api-test.fortressofmuslim.org
```

Useful verification endpoints:

```text
/health
/v1
/v1/datasets/current
/v1/duas?limit=2
/v1/duas/search?q=protection
/v1/duas/random
/v1/duas/dua.hisn.001
/v1/duas/dua.hisn.001/parts
/v1/duas/dua.hisn.001/parts/1
/v1/collections?type=hadith
/v1/hadith?collection=bukhari&limit=2
/v1/hadith/search?q=intentions&collection=bukhari
/v1/hadith/hadith.bukhari.1
/v1/hadith/resolve?collection=bukhari&book=1&number=1
/v1/ask
/v1/queries/{named-query-id}
```

Canonical IDs and retained Fortress legacy dua IDs are accepted by detail and part routes. List, search, detail, part, random, and evidence routes expose the current editorial revision, including unverified candidates. Every response carries `verificationStatus`, `workflowState`, `verifiedBy`, `verifiedAt`, and nullable `publishedAt` fields so consumers can make an explicit trust decision.

The PWA snapshot contains only published canonical Fortress of Muslim chapters. Candidate records under editorial review are never included. Hadith browse/search and the source-grounded assistant are API-based and are not stored for offline use.

Current editorial records and browse, search, detail, part, random, and evidence endpoints are public without login. Developer-owned named queries and management capabilities require a Fortress API key or OAuth 2.1 bearer token.

The API stores candidates, immutable revisions, editorial decisions, and published records in Cloudflare D1. Verify the public migration and governance invariants with:

```powershell
npm run db:verify --workspace @fortress/api
npm run editorial:verify --workspace @fortress/api
```

The public REST API and API-backed MCP tools expose current records through `api_current_content`, including unverified material with an explicit editorial status. The public statuses are intentionally small: `pending_review`, `verified`, and `changes_requested`. RAG remains restricted to verified records in `canonical_publications`, while the 132-chapter Hisn library is bundled locally with the PWA for reliable offline reading.

Build the PWA's offline dua snapshot from the published API boundary:

```powershell
npm run pwa:data:build
```

Vector indexing is idempotent, resumable, and restricted to the current published canonical dataset. The API Worker checks for pending batches every minute; the command remains available for supervised recovery:

```powershell
node apps/api/tools/index-rag.mjs test --cursor=10050
```

The test API uses the `dev` branch and the production API uses `main`. Cloudflare deployment remains disabled until the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is set to `true` and the required account secrets are configured. Setup is documented in `docs/cloudflare-setup.md`.

Every platform release must:

1. Update the platform release notes in this README.
2. Pass `npm run check` and the Cloudflare Worker bundle check.
3. Deploy to the test environment from `dev`.
4. Be verified through its live health and version endpoints.
5. Deploy to production from `main` only after test verification.

## Platform Releases

### 0.48.2

_2026-09-23_

- **Ready for production.** `www.fortressofmuslim.org` is redirected (301) to the apex by
  `pwa-website/edge/worker.js`, so the production move attaches both hosts to one Worker and the
  site exists at one address only.
- **`npm run pwa:visual-check` works again.** It had not passed since the first-run walkthrough
  shipped: the walkthrough's modal covered the page and every click timed out. It now marks the
  walkthrough seen, as a returning user's device has it. Its size budget also still said 250 KB,
  not the 500 KB `docs/release-readiness.md` records, and counted every performance entry -- so a
  preloaded file was counted twice. It now counts each file once: 376 KB.
- `docs/release-readiness.md`: production is live (0.43.0 before this release, Ask ready); the
  "never stood up" section is kept as the record of the first build-out.

### 0.48.1

_2026-09-23_

- **Fixed: 0.47.3's build stamp emptied every link it stamped, so the test site loaded no code.**
  The new rule in `tools/stamp_version.py` that stamps `index.html`'s preloads and entry script had
  lost its back-reference (a control character had replaced `\1`), so each link became
  `src="?v=build-<sha>"`. Only the test environment received it; the first deploy to Cloudflare
  caught it in its smoke test, which also kept that build off Bluehost. `test/stamp.test.js` now runs
  the real stamp script on a copy of the app and checks every stamped link still names a real file
  -- the check every earlier test missed by reading only the unstamped source.

### 0.48.0

_2026-09-23_

- **The PWA can be served from Cloudflare, with Bluehost as a standby.** Bluehost answered small
  files in 0.3-10 s on 2026-09-23; Cloudflare's static assets have no origin behind them. Every
  push now deploys the PWA to the `fortress-pwa-test` / `fortress-pwa-production` Worker as well as
  to Bluehost, and smoke-tests the Cloudflare copy at its `workers.dev` address. Nothing moves until
  a domain is pointed at it -- the steps and the rollback are in `docs/deployment.md` -> "PWA
  hosting". Bluehost keeps the email, FTP and cPanel.
  - `pwa-website/edge/worker.js` does what `.htaccess` did: the three app URL shapes and `/` answer
    with `index.html`, unknown URLs are real 404s, and it sets the cache headers the update model
    depends on (`sw.js` never cached, build-stamped files immutable, the rest revalidated).
    `html_handling: none` keeps `/reset.html` at its own name, which the service worker relies on.
  - `pwa-website/tools/build-dist.mjs` copies only what the site publishes into `dist/`, so
    development files are not denied but absent.
  - `isTestHost()` in `js/utils.js` replaces two copies of the "is this the test site" check, and
    also recognises the Cloudflare test preview, so it talks to the test API and test media host.
  - `pwa-website/test/edge-worker.test.js` pins routes, 404s, headers, the publish list and the
    environment check.
- Documentation: `docs/deployment.md` (new "PWA hosting" section with the move and the rollback),
  `docs/cloudflare-setup.md`, `docs/incident-response.md`, `docs/project-overview.md`, `CLAUDE.md`.

### 0.47.3

_2026-09-23_

- **First visits and first launches after a deploy no longer wait on Bluehost file by file.** A
  first launch measured 20 seconds on 2026-09-23. Two causes, both fixed in the PWA:
  - **Cloudflare re-asked Bluehost about every file.** Build-stamped files went out as "re-check
    every time" (the host's own `mod_expires` and our `.htaccess` combined into
    `max-age=14400, must-revalidate`), so the edge answered each one only after a round trip to
    Bluehost (`cf-cache-status: REVALIDATED`, 0.3-4.7 s each). `.htaccess` now marks any
    `?v=build-<sha>` file as `public, max-age=31536000, immutable`, which is true -- a new build is
    a new URL -- so both the edge and the browser keep it.
  - **Files were discovered three round trips deep.** `styles.css` `@import`s eight stylesheets
    and the 35 modules are found import by import. `index.html` now preloads all of them, so the
    browser asks for everything in one go. `tools/stamp_version.py` stamps the preload URLs to
    match the imports exactly, and `test/preload.test.js` keeps the lists equal to what is
    actually imported.

### 0.47.2

_2026-09-23_

- **The app opens from its cached shell instead of waiting on the network.** Navigations were
  network-first with no timeout and fell back to the cache only when the request failed outright,
  so every launch waited on Bluehost -- measured at 2-7 s per small file on 2026-09-23 -- and a
  weak signal held the launch splash until the request gave up. After each deploy it was worse:
  the network's `index.html` named the new build's files, none of them cached yet, so the first
  launch after a release re-downloaded the whole app before painting. Navigations to app routes
  (every one of them `index.html` on the server, per `.htaccess`) are now answered from the
  shell this service worker cached at install; updates still arrive through the background
  install and the update banner. Real pages (`reset.html`, `art-preview.html`) still go to the
  network. `test/sw-navigation.test.js` runs the real `sw.js` fetch handler to pin this.

### 0.47.1

_2026-09-23_

- **The dua reciter is credited by name.** `data/dua-audio.json` carries `reciter`, shown once
  above the Listen buttons ("Recited by Muhammad Jumah") and as the artist on the lock screen. His
  name was on the confidentiality guard's list and has been taken off it now that crediting him is
  approved; the audio provider stays on the list and stays unnamed.

### 0.47.0

_2026-09-23_

- **Recorded recitation for the duas, self-hosted on Cloudflare R2.** 232 recordings across 109
  readings, used under a written agreement with their provider, stored in the `fortress-media` R2
  bucket under versioned keys (`duas/v1/<reading>/<part>.mp3`) and served from our own domain. The
  provider is deliberately not named anywhere in this repository or in the app's network traffic.
  - **A new Worker, `apps/media`**, in front of the bucket: `media.fortressofmuslim.org` in
    production, `media-test.fortressofmuslim.org` on test. Read-only (GET, HEAD, OPTIONS), serves
    only prefixes listed in `PUBLIC_PREFIXES`, honours byte ranges (an iPhone will not play audio
    from a server that refuses them) and conditional requests, CORS-open, cached immutably. One
    bucket serves both environments; the counts go to each environment's own D1.
  - **Usage counting for the provider's report.** Each play and each offline download is tallied
    into the new `media_daily_stats` table (migration `0029`) by day, file and kind. A play counts
    once per listen: only a request for the start of the file counts, so seeking does not inflate
    it. A download is marked by the app (`?intent=download`). A failed tally is logged and dropped,
    never costing anyone the audio. Plays from a copy saved on the phone never reach the server and
    are not counted -- the report says so rather than estimating them.
  - **Admin console: Audio usage** (`GET /v1/admin/media-stats`, admin role). Totals, by day and by
    recording for any range up to a year, with CSV export of each for the partner report.
    `apps/api/test/media-stats.test.ts` runs the Worker's upsert and the admin query against the
    real migrated schema.
  - **Which part a recording belongs to was checked against the text**, not assumed from file
    order: every recording was matched to its part by comparing its source text with ours after the
    same Arabic normalisation the API uses. Recordings that could not be matched confidently were
    left out rather than guessed; those parts simply have no play button.
  - **Confidentiality guard.** `tools/verify-public-canonical-boundary.mjs` now fails the check if
    any tracked file names the provider. It compares hashes of short phrases rather than the names
    themselves, so the guard does not disclose what it protects.
- **Deploys:** the test and production platform workflows deploy the media Worker with
  `wrangler.ci.jsonc` (no route permissions needed, same pattern as the portals); the custom domain
  is provisioned once with `wrangler.jsonc` from an authenticated session.
- Removed a dangling, bodiless selector list at the end of `pwa-website/css/reader.css` that had
  been there since the first commit. It did nothing at the end of the file, but swallowed the first
  rule appended after it.

### 0.46.0

_2026-09-23_

- **An Islamic calendar, as a fourth tool behind the Prayer button.** Today's Hijri date, the next
  date that matters with a countdown, and the year ahead -- Ramadan, Eid al-Fitr, the Day of Arafah,
  Eid al-Adha, the Islamic New Year and Ashura. Works offline: nothing is fetched but a six-line
  table of fixed Hijri dates the app ships with.
  - **Where the date comes from, stated plainly on the screen.** The Hijri calendar is not settled
    by astronomy the way prayer times are: a month begins when the crescent is sighted, and that is
    decided locally, so the same day can be the 29th in one country and the 1st in another. This
    uses the browser's own Umm al-Qura calendar -- the pre-calculated Saudi civil calendar, the most
    widely used convention -- and says so, with the caveat that local sighting may differ by a day.
    The same honesty the prayer times use for an estimated high-latitude time.
  - **Hidden rather than guessed where unsupported.** An unknown calendar does not make `Intl`
    throw; it silently resolves to Gregorian. So support is detected by checking what the calendar
    actually resolved to, and where it is not Umm al-Qura the screen says so instead of showing a
    Gregorian date labelled as Hijri. It deliberately does not fall back to a second calculation:
    two quietly different Hijri dates depending on the browser would be worse than none.
  - `Intl` only converts Gregorian to Hijri, so events are found by walking forward a day at a
    time. Nothing then needs to know how long a Hijri month is -- the thing that varies -- and the
    year boundary is handled for free. Month names are formatted only for matching days, which took
    a year's search from about 52 ms to 4 ms.
  - Pinned in `test/hijri.test.js` against five dates of record (1 Ramadan 1445 is 11 March 2024,
    and so on), plus the logic that is this app's own: the soonest event, Arafah falling the day
    before Eid al-Adha, crossing into the next Hijri year, and returning nothing when unsupported.
- **The Prayer group is now four.** `layout.js` treats that grouping as structural, so the calendar
  joining it was a deliberate choice and its comment says so. `test/worship-nav.test.js` also now
  checks that every non-Duas mode hides the Duas home's bottom bar -- the calendar's first version
  showed that bar over the Prayer sub-bar, because the rule hiding it names each mode individually.

### 0.45.0

_2026-09-23_

- **Install shortcuts.** Long-pressing the installed app's icon (or right-clicking it on desktop,
  where supported) now offers Prayer Times, Qibla, Tasbih and Quran directly, without landing on
  the home screen first. Four rather than a menu of everything: the launcher gives shortcuts very
  little room, and a long list is worse than a short one. Duas is deliberately not among them --
  it is the screen the app already opens to, so a shortcut to it would be a shortcut to nothing.
  - Each opens `./?screen=<name>`, handled at boot the same way the adhkar notification link
    already is: acted on once, then stripped, so a reload is the plain app. Only screens listed in
    `SHORTCUT_SCREENS` act -- the URL is handed over by the OS, and the app should respond only to
    shortcuts it declared. Kept apart from `openCanonicalRoute`, which resolves content pages with
    real canonical addresses; a tool is not a page.
  - Each shortcut has its own icon, drawn from the same glyph the app's navigation uses for that
    screen, in the brand's gold on teal (`tools/build-shortcut-icons.mjs`). Four copies of the logo
    in a four-item menu would carry no information.
  - Offline works: the service worker answers every navigation with the cached shell regardless of
    query string.
  - What cannot be verified here: whether shortcuts appear, how many are shown and how their icons
    are cropped are decided per OS and browser. `test/shortcuts.test.js` covers everything on this
    side of the launcher -- each URL opens a real screen, stays in scope, and has icons that exist.

### 0.44.0

_2026-09-23_

- **You can see what the app has saved, and free it one piece at a time.** Settings > Data now
  lists each thing stored on the device -- Quran recitation, Quran text, and the app's own files --
  with its size, and a Clear for each one that can safely go. Before this the three caches the
  service worker fills were invisible, and the only way to free a few hundred megabytes of
  downloaded recitation was to clear all site data from the browser, which also wiped favourites,
  settings and reading position. There is deliberately no "clear everything": each action says
  what it will remove and nothing else. The app files are listed but not clearable -- without them
  the app does not open offline, and they are replaced on every update anyway.
  - `js/storage.js` measures from `Content-Length` rather than reading every body, because the
    audio cache can hold thousands of ayahs; it uses `caches.has()` before looking so that measuring
    never creates an empty cache; and `clearCache()` refuses any name it does not list as clearable,
    so the app shell cannot be deleted by passing the wrong string.
  - The total comes from `navigator.storage.estimate()` and is hidden where that does not exist
    (older Safari) rather than shown as a guess. The per-cache lines do not depend on it.
  - `sw.js` is a classic worker and cannot import the module, so the cache names are written in
    both. `test/storage.test.js` reads `sw.js` and fails if they drift -- which matters, because
    the worker deletes every cache it does not recognise on activate, and a drifted name would
    make downloads silently vanish on the next deploy.

### 0.43.0

_2026-09-20_

- **The admin console has a dark theme again, and a switch to reach it.** It had neither. Every
  portal loads `portal.css` and then its own stylesheet, and `admin.css` was redefining `:root`
  there with a hard-coded light palette -- overriding every token `portal.css` had just set,
  including both of its dark themes -- then pinning `html { color-scheme: light }` on top. The
  header had no theme toggle either, unlike the developer and status portals, so there was no way
  back. The result was exactly what it looked like: anything styled by `portal.css` followed the
  theme and anything styled by `admin.css` did not, so half the console went dark and half stayed
  white.
  - `admin.css` now defines only what admin adds on top, in terms of the shared tokens wherever the
    two mean the same thing, with dark values in the same two blocks `portal.css` uses -- an
    explicit `[data-theme]` choice, and `prefers-color-scheme` when no choice has been made. A
    machine in dark mode now gets a dark console without touching anything.
  - 62 hard-coded colours became tokens: surfaces, borders, muted text, status tints, the login
    gradient, dialog scrims. White text on a coloured button stays literal, because it is correct in
    both themes.
  - The theme toggle from the other portals is now in the admin header, driven by the same
    `portal.js` it already loaded.
- **`verify-portals.mjs` now checks theming for all three portals**, because every fault here is
  silent: a stylesheet that quietly wins, a token with no dark value, the two dark blocks drifting
  apart, a token defined in terms of itself. Each was introduced deliberately and confirmed to fail
  the check.

### 0.42.0

_2026-09-20_

- **The next-prayer card is a sky now, and it is the real one.** The sun sits where the sun sits,
  from your location, at this moment: overhead at Dhuhr, on the horizon at Maghrib, gone at Isha
  with the moon up and the stars out. Nothing here interpolates between sunrise and sunset, because
  a real sun does not trace a symmetrical arc about clock noon -- it traces one about solar noon,
  and the two are up to sixteen minutes apart before longitude is considered. Faking it would look
  approximately right and be wrong at exactly the moment someone is looking: the prayer time itself.
  - `prayer-times.js` gains `solarPosition()` -- the same Meeus solar position the prayer times are
    already computed from, asked for altitude and hour angle instead of for a clock time -- and
    `moonIllumination()` for the moon's phase.
  - The palette is keyed to solar altitude and interpolated, with its stops at the real twilight
    boundaries (-18 astronomical, -12 nautical, -6 civil, 0 the horizon), so dusk is a slide rather
    than four states that snap.
  - `test/sky.test.js` ties it back to the prayer times: across three latitudes and both
    hemispheres, the sun's highest altitude of the day falls within two minutes of the computed
    Dhuhr, and reaches the `90 - |latitude - declination|` that geometry predicts.
- **Almost nothing moves.** The sun shifts about a degree every four minutes -- invisible while you
  watch, clearly different when you come back -- so only the rays breathe and the stars twinkle. A
  sun that visibly slides would be lying about how fast the sky moves. Both stop entirely under
  `prefers-reduced-motion` or the Still artwork setting.

### 0.41.0

_2026-09-20_

- **Every deep link was broken, and had been all along.** Opening
  `fortressofmuslim.org/tirmidhi/book1/1` directly gave an unstyled skeleton with no JavaScript.
  The rewrite correctly hands those URLs the same `index.html` the root gets, but every asset in
  that file is referenced relatively -- so a browser at `/tirmidhi/book1/1` asked for
  `/tirmidhi/book1/styles.css` and `/tirmidhi/book1/js/app.js`, got 404s, and rendered what was
  left. This affected every deep link on the site, including all 247 the sitemap had just started
  advertising to Google. One `<base href="/">` fixes it: the HTML references, the `fetch()` calls
  inside the modules (which resolve against the document base, not the module that made them), and
  the service worker registration. ES module imports were never affected, resolving against the
  importing module's own URL.
- **A hadith now names itself.** The detail view left the title as "Hadith Library", so all 14,357
  hadith URLs were identical to anything reading titles. Each now reads "Jami at-Tirmidhi 1" with
  its chapter as the description.
- `test/deep-links.test.js` pins the base tag, that it precedes the first relative reference, the
  three rewrite shapes, and that the server's routes and the app's parser stay in step -- because
  nothing about the homepage changes when `<base>` is deleted, which makes it very easy to lose.

### 0.40.0

_2026-09-20_

- **The site can now be found.** Before this, `fortressofmuslim.org` had a `<title>` and nothing
  else: no description, no canonical, no Open Graph, no robots.txt, no sitemap, and -- the one that
  mattered most -- `document.title` was never changed, so every URL on the site was the same title
  and the same description to anything that was not running the app. Al-Baqarah and the qibla
  compass were literally indistinguishable to a crawler.
  - `js/seo.js` now owns what the page currently is. The heading, the document title, the meta
    description and the canonical link move together, because the person reading the heading and
    the crawler reading the title are being told about the same thing.
  - A full head: description, canonical, robots, Open Graph and Twitter cards, and JSON-LD
    describing the site as a free `WebApplication` with a `SearchAction`.
  - `robots.txt`, and `sitemap.xml` generated by `tools/build-sitemap.mjs` from the app's own data
    so it cannot drift: 247 URLs -- the home page, the 114 surahs and the 132 duas. Individual
    ayahs and hadith are deliberately excluded; see that file for why.
  - `icons/social-card.png`, built by `tools/build-social-card.mjs`, so a shared link stops looking
    broken.
- **Every URL used to return 200.** `.htaccess` rewrote everything that was not a file to the app
  shell, so any invented path answered with a page. That is a soft 404, and it invites a crawler to
  index unlimited contentless variations. The rewrite now matches only the three URL shapes the app
  actually owns; everything else 404s.
- **A limit worth stating plainly:** this app renders on the client, so none of the above is in the
  HTML a crawler is first served. Search engines that execute JavaScript will see it; the rest see
  the defaults. Ranking for individual verses needs prerendered pages, which this release does not
  attempt.

### 0.39.0

_2026-09-20_

- **Customize Layout is gone.** Every tab could be switched off, and each could be restricted to the
  picture home screen, the plain one, or both. It earned none of what it cost: every tab had to be
  written twice, once for existing and once for being reachable; every new feature had to be placed
  into a three-way visibility matrix before it could ship; and what it bought was a settings panel
  for hiding parts of a small app that is already one tap deep. Removed: `layout-settings.js`
  entirely, most of `layout.js`, the settings category and panel, its CSS, and the `layout` field in
  backups. Roughly 300 lines of code and markup, and one whole axis every future tab would have had
  to reason about.
- **What was never configuration stays.** Prayer Times, Qibla and Tasbih are three screens behind one
  Prayer button with a sub-bar, which is the shape of the nav rather than anything a reader chose.
  That is now all `layout.js` holds. `test/worship-nav.test.js` replaces `test/layout.test.js` and
  checks the three lists that have to agree -- the tabs, the nav buttons, and the screens -- because
  the way a removal like this goes wrong is a leftover: markup for a tab nothing renders, or a screen
  the nav can no longer reach.
- **Existing installs and old backups.** Every tab is simply present for everyone now. A stored
  `fortress_layout_config` is left where it is rather than spending code to delete something inert,
  and a `layout` field in a backup taken before this release is read and ignored, so importing one
  cannot switch tabs off that nothing can switch back on.

### 0.38.0

_2026-09-20_

- **Words the reader actually uses.** A sweep of the app's own vocabulary, which had been describing
  the editorial pipeline rather than the thing in front of someone:
  - A cited source now says **"Checked against source"** / **"Source not checked yet"** rather than
    "Verified" / "Not yet verified". This is the more useful claim and the more honest one: what the
    workflow establishes is that a revision was checked against its original text with canonical
    references -- not that a hadith is authentic, which is a scholarly grading this platform does not
    make and must not appear to. Naming the check rather than an authority also says something
    specific, which reads as more confident, not less. The note above an answer follows the same
    words.
  - Prayer Times and Qibla shared one subtitle describing the implementation ("Computed on this
    device"). They do different things, so they now each say what they give you.
  - The Appearance toggle is **"Pictures on the home screen"** -- a state rather than the name of a
    mode -- and says plainly that turning it off is lighter on older phones. The per-tab layout
    control drops "Simple UI / Advanced UI" for the picture and plain home screens it means.
  - The reminders note drops "no push server", which is true and tells a reader nothing, for what
    they want to know: it is worked out on the phone, with no account, and nothing sent anywhere.

### 0.37.0

_2026-09-20_

- **The Ask source filter is now actually a filter.** Choosing "Quran verses" returned hadith and
  duas alongside the verses. The live log made the shape of it plain: every leaking row was a Quran
  scope, and none was a dua or hadith scope. `recordScope()` translates a Quran scope to `undefined`,
  and `undefined` means "no filter" to every repository call it reaches -- so any retrieval path that
  did not check the scope *before* calling searched the whole editorial corpus the scope existed to
  exclude. Two paths were still doing that (the unverified-content top-up, and exact hadith
  reference resolution, which fired for anything not scoped to duas and could return a hadith as the
  entire answer). Both are fixed, `retrieveUnverifiedFallback` now takes a filter the repository
  understands rather than a scope it has to translate, and the answer is checked once against the
  chosen scope where it is assembled -- loudly, because reaching that check means a path upstream
  leaked and wants fixing at its source. `test/ask-scope.test.ts` pins all four scopes against a
  repository that deliberately ignores the filter it is given, so a scope holds only because the
  caller respected it. Scoped to the Quran, Ask will now return nothing rather than answer from the
  wrong kind of source.
- **Plainer words in the app.** The line under the title at launch said "Verified canonical chapters
  available offline", which describes the editorial pipeline rather than the app; it now says what
  the other two code paths for that same screen already said. Ask's "Source-grounded answers"
  described how retrieval works rather than what the reader gets. The Quran browse toggle reads
  "Juz" without glossing it.

### 0.36.0

_2026-09-20_

- **The juz boundaries are ours; outside sources only ever check them.** The generator added in
  0.35.0 had the direction backwards: it fetched the thirty boundaries from quran.com on every run
  and used alquran.cloud to validate the result, which made a third party the authority over what
  this app says the Quran is divided into -- the file would change underneath us whenever theirs
  did, and a review would show a diff nobody chose. `pwa-website/data/quran/juz.json` is now simply
  canonical data in this repository, and `tools/verify-quran-juz.mjs` replaces the generator and
  never writes it. Offline it proves the thirty ajza tile all 6,236 ayahs of the mushaf we ship, in
  order, with no gap or overlap -- the strongest check available and the one no single outside
  source can make -- and that check now runs in `npm run data:safety`. `--online`
  (`npm run pwa:quran:juz-check`) corroborates against quran.com and alquran.cloud, which can only
  disagree, never supply; a disagreement is reported for a person to investigate rather than
  silently applied. The boundaries themselves are unchanged and still agree with both projects on
  all thirty. Nothing about this was ever a runtime dependency: the app reads `juz.json` from its
  own origin and always did.

### 0.35.0

_2026-09-19_

- **The Quran browses by juz (parah) as well as by surah.** A toggle above the list switches between
  the 114 surahs and the thirty ajza. A juz row names where it runs -- "Juz 2 - Al-Baqarah 142 - 252
  - 111 ayahs" -- and opening one goes straight to its first ayah, which for most ajza is in the
  middle of a surah rather than at the top of one. While a juz is open the reader carries a strip
  naming it, with a step to the juz either side, and the strip follows you: reading or listening
  across a boundary moves it along rather than leaving it stale. Playing a juz needs nothing new to
  carry it across the surahs it spans -- recitation already continues into the next surah, so juz 30
  runs from An-Naba to the end of the mushaf on its own.
- **The juz boundaries are ours, and outside sources only ever check them.**
  `pwa-website/data/quran/juz.json` is canonical data in this repository, served from our own origin
  and precached with the rest of the Quran -- nothing in the app asks a third party where a juz
  begins. `pwa-website/tools/verify-quran-juz.mjs` verifies that file and never writes it: offline,
  it proves the thirty ajza tile all 6,236 ayahs of the mushaf this app ships, in order, with no gap
  and no overlap, which is the strongest check available and the one no single outside source can
  establish on its own. Run with `--online` (`npm run pwa:quran:juz-check`) it also corroborates them
  against quran.com and alquran.cloud, and a disagreement is reported for a person to investigate
  rather than silently applied. The offline check runs in `npm run data:safety` and the same
  invariant is asserted in `pwa-website/test/quran-juz.test.js`, because a boundary that is quietly
  wrong sends someone to the wrong place to start reading.

### 0.34.0

_2026-09-19_

- **Recitation carries into the next surah.** Reading does not stop at the end of a surah and
  listening should not either. Reaching the last ayah opened the surah again from the top, which
  made the ordinary case behave like the deliberate one -- repeat-surah is the mode for staying put.
  The reader follows the recitation across, and it stops at the end of An-Nas.
- **Every surah is recited from its Bismillah**, except At-Tawbah, which has none, and Al-Fatihah,
  where it is the first ayah rather than an opening to it. The rule is not written into the player:
  the surah data already records it per surah as `bismillahPre`, which is what the reader displays
  from, so the recitation and the page cannot disagree. A test holds it across the whole mushaf --
  112 of 114.
- **The Ask scope filter no longer leaks.** Asking with the Quran scope returned three verses and a
  hadith: the base retrieval was gated on the scope and the expansion variants were not, and a Quran
  scope resolves to "no record filter", which the repository reads as every record. Duas-only and
  hadith-only were unaffected.
- **Advanced is the default interface.** Simple is now the opt-out rather than the starting point.
  Anyone who already chose Simple keeps it: the preference is read as "not explicitly off", because
  a stored setting is an answer someone gave and a changed default must not overwrite it.

### 0.33.1

_2026-09-19_

- **"Reliance on Allah" reaches the verses about it.** Making retrieval deterministic in 0.33.0 made
  this question consistently wrong rather than sometimes right: it returned five verses of Surah
  Ash-Shu'ara at 0.02 on every run. The synonym group matched "reliance upon Allah" -- how the
  translation renders it -- and never "reliance on Allah", which is how a person types it, so the
  question that motivated the group expanded to nothing at all. It matches the bare words now.
- **A guard so that gap cannot recur.** Every concept group is asserted reachable by a single word.
  It immediately found a second one: `talbiya` is a substring of `talbiyah`, so expansion treated it
  as already present and that group added nothing whatever it was asked. It carries `labbayk` now.
- **The flaky Quran-words test was never flaky.** 77,429 words across 114 files, each asserted on,
  is several seconds of real work, and it exceeded vitest's 5s default only when the rest of the
  suite was competing for the disk. The data is worth checking in full; the test is now allowed the
  time it takes.

### 0.33.0

_2026-09-19_

Read out of `ask_query_log` rather than guessed at. Forty questions, 26 answered, nine discarded --
and the log said why for each.

- **The same question stopped giving different answers.** "Give me a Quran verse for reliance on
  Allah" returned 64:13, 9:51 and 27:26 at 0.99 on one run and three verses of Surah Ash-Shu'ara at
  0.02 on the next. The query-expansion model ran at `temperature: 0.4`, inventing different search
  phrasings each time, and those phrasings drive retrieval. It is deterministic now. This was the
  single largest source of answers that felt wrong.
- **`[1 — unverified]` no longer throws the answer away.** The prompt asks the model to flag an
  unverified source in the sentence citing it, and the model obliged by putting the flag inside the
  bracket -- which the strict `[1]` pattern did not recognise, so a correct, properly attributed
  answer about cleanliness was discarded whole. Brackets are read for the numbers they carry, and
  every number is still checked against the sources that exist.
- **A refusal is passed through instead of buried.** Asked for a verse the retrieved sources did not
  contain, the model said so -- and having no citation, its honest answer was replaced by "could not
  generate a fully cited answer", listing the sources it had just called irrelevant. It now replies
  with an agreed sentinel and the reader is told plainly that the sources found do not answer the
  question. The sentinel is held back from the stream so it never flashes on screen.

### 0.32.1

_2026-09-19_

- **"Open" on a citation actually opens it.** It shipped in 0.32.0 doing nothing: the router was
  meant to take the path a citation names, an edit to its signature silently failed to apply, and it
  went on reading the browser's own address -- which on an installed PWA is always `/index.html`, so
  nothing ever matched. Verified end to end this time rather than assumed: opening the Quran
  citation from an answer lands in the reader on Al-Anfal at the page holding 8:49.
- **A verse opens even if the Quran tab was never visited.** `openSurah` needed the surah index and
  returned silently without it, which is the state a reader is in when their first visit to the
  Quran is a citation in an answer. It loads the index itself now, and says so if that fails.

### 0.32.0

_2026-09-15_

- **A citation opens.** Seeing "[1] Sahih al-Bukhari 6499" and having to leave and go find it is the
  point at which a grounded answer stops being checkable. Every source now travels with its own
  words -- Arabic and translation, for verses, hadith and duas alike -- and expands in place under
  the answer.
- **And it goes somewhere.** "Open" takes the reader to the record itself: the verse in the Quran
  reader at that ayah, the hadith, the dua. It reuses the router that already resolves canonical
  Fortress paths on load, so `/bukhari/book1/1` means one thing in one place; verse paths
  (`/quran/2/255`) join it.
- **"New" moved out of the thread** and into the composer bar, where a control that resets the
  conversation is not living inside the thing it resets. It appears as soon as one question has been
  answered, rather than waiting for a second -- by which point a reader wanting to start over had
  already gone looking for it.
- A hadith's reference already names its collection, so the citation used to read "Sahih al-Bukhari
  Sahih al-Bukhari 6472". The collection stays on the muted line; the strong line is what tells one
  source from the next.

### 0.31.3

_2026-09-15_

- **The preferred source now leads, not merely appears.** "Dua for entering the toilet" returned two
  hadith before the duas, and "find tawakkul in the Quran" put the verse fourth. Selection had been
  right all along; the finished set was then sorted by score, which silently undid the preference --
  demoting each chosen source behind exactly the scores that made the preference necessary. Order
  matters as much as inclusion here: the citation numbers follow it, and a model writing from six
  contexts leads with [1].

### 0.31.2

_2026-09-15_

- **The model was returning nothing at all.** Most questions showed "could not generate a fully
  cited answer" beside the right sources, and two rounds of loosening the citation rule did not fix
  it -- because the citation rule was never involved. Reading the raw stream showed the model
  producing zero tokens. gpt-oss writes a private chain of thought before its answer and those
  tokens come out of `max_tokens`; at 650 the reasoning could consume the entire budget and leave an
  empty string, which became the fallback. It got worse the moment verse contexts gained their
  Arabic, because a longer context means longer reasoning. The budget is 2,000 now, nearly all of it
  headroom for thinking.
- **Contexts are trimmed to 1,500 characters each.** Eight thousand characters times six sources was
  around 16,000 tokens of input on every question -- paid for every time, and more to reason
  through. A reading or a hadith says what it says well inside that.
- **An empty generation is recorded as itself.** It and a rejected-for-citations answer arrived as
  the same fallback text and are nothing alike in cause or fix, which is exactly why the first two
  attempts at this chased the wrong one.

### 0.31.1

_2026-09-15_

- **Correct answers stopped being thrown away for punctuation.** Testing 0.31.0 live, most questions
  came back as "could not generate a fully cited answer" while showing the right sources. The
  citation rule required every line to carry a `[1]`, and the most natural shape for a supplication
  -- a lead-in, the Arabic, then the cited translation -- opens with a line ending in a colon. That
  line asserts nothing the citation beneath it does not already carry, so it no longer needs its
  own. A colon is not a licence: if nothing below it is cited the answer is still discarded, and a
  long paragraph is not a lead-in merely because it ends in one.
- **Rejected answers are recorded (`0028`).** This is the second time the citation rule turned out
  to be too strict, and both times the rejected text existed only in a Worker log, so the cause had
  to be guessed at. `ask_query_log.rejected_answer` keeps it -- model-generated prose about
  published records, not user text -- so "which correct answers are we discarding, and why" has an
  answer better than a hypothesis.

### 0.31.0

_2026-09-15_

- **A cited verse is quoted, not recalled (`0026`).** Ask's context for an ayah carried the English
  translation alone, so when an answer quoted the Arabic, the model was writing it from memory --
  producing Quranic text that trailed off in an ellipsis. Quranic text recalled by a language model
  is the one thing this platform must never put in front of a reader. All 6,236 verses now store
  their Arabic, and the context carries it in full, so the words come from the source or they do not
  appear.
- **The question decides which source leads.** "Find tawakkul in the Quran" wants verses, "what did
  the Prophet say about intentions" wants hadith, "dua for entering the toilet" wants a
  supplication. Retrieval scores cannot see any of that -- they see topical similarity, and on a
  common theme the 14,357 hadith outnumber everything regardless of what was asked. Wording is read
  as a preference, never a filter: the named kind leads and the others still appear, because a wrong
  guess must not be able to hide the answer. A question naming two kinds ("the Quran and the
  Sunnah") states no preference at all.
- **The relevance cut is applied within each kind.** It exists to drop a tail of near-misses by
  comparing against the best candidate -- sound among things of one kind, wrong across two. The best
  hadith scores far above the best verse on a common theme, so every verse fell under a cut computed
  from a hadith: "what does the Quran say about patience?" cited four hadith and not one verse. The
  Quran also holds a floor of two context slots when verses survive that cut.
- **Retrieval is logged for analysis (`0027`).** Every gap so far was found by hand, one session at
  a time. `ask_query_log` records the question, the query retrieval actually ran, how many candidates
  each half produced, what was cited and with what score -- enough to see which terms keep missing
  and whether the cut is set right. No IP, no identifier, nothing joining two questions to one
  person; a logging failure can never fail an answer.
- **The composer is pinned to the bottom of the screen.** Sizing the chat column inside the page
  meant competing with the shell's 100vh floor, its padding and the view's own height, and every
  correction left either dead space under the composer or a page that could scroll it out of reach.
  It is fixed to the viewport now: measured gap below the bar is 0, and the thread grew from 461 to
  531px on a 375x812 phone. "Start a new conversation" sticks to the top of the thread instead of
  scrolling away.

### 0.30.1

_2026-09-15_

- **"What is tawakkul" answers.** 0.30.0 put the Quran into Ask and the question still returned
  nothing, while plain verse search returned the right verses -- because Ask retrieved on the
  expanded query and then reranked on the raw one. The reranker has the same vocabulary problem
  retrieval does: handed "what is tawakkul?", a term in no English translation, it scored every
  candidate under the floor and the answer became "nothing found". It reranks on the expanded query
  now, which is what verse search always did.

### 0.30.0

_2026-09-15_

- **The Quran is a source Ask answers from.** "What is tawakkul" used to be answered out of whatever
  dua sat nearest it in embedding space, because the concept lives in the Quran and Ask could not
  see the Quran. Verses are retrieved and reranked alongside duas and hadith now, and cited the same
  way -- `[1] The Quran, At-Talaq 65:3` -- under the rule that already governs every answer: answer
  only from the sources, cite every claim, no rulings. **"All sources" now genuinely means all of
  them**, rather than "duas and hadith" behind a label that said otherwise.
- **Quran is a scope, not a record filter.** The ayahs live outside the editorial corpus, so asking
  for them means asking for no records at all; it is resolved before any repository call rather than
  passed down into one. Scoping to Duas or Hadith excludes verses entirely.
- **Ask reads like a chat.** The thread scrolls on its own and the composer never leaves the screen,
  instead of the page scrolling and the answer landing below the fold. Measured on a 375x812 phone:
  the composer went from roughly 30% of the screen to **13%**, the thread gets 461px of it, and the
  page itself no longer scrolls at all. The column measures the space actually left below the header
  rather than assuming a constant, because a guess that is 57px out puts the whole page back on a
  scrollbar.
- **It follows the newest answer, unless you have scrolled up.** Yanking the view back while someone
  is reading an earlier answer is worse than not following at all.
- The licensing footer under verse results is gone: permission for the translation was obtained
  directly. The API still answers with references and lets the client render the words it already
  ships, which is what makes a result appear instantly and work offline.

### 0.29.0

_2026-09-14_

- **Ask looks and behaves like a chat.** The conversation is above and the composer is pinned below
  it, which is the fix for "I am not getting answers": the old layout put a four-row textarea and
  its filters *above* the answer, so on a 375x812 phone the answer began 519px down and ran 151px
  past the fold -- and with the keyboard open it was off-screen entirely. The API had been returning
  correct answers the whole time; nobody could see them. Measured before and after: the answer now
  renders at y=166, in view, with no scrolling.
- **Enter sends, Ctrl/Alt/Cmd+Enter makes a new line** -- the reverse of what it was. A chat
  composer is not a code editor: nearly every question here is one line, and making the common
  action the modified one is what made the box feel unresponsive. Shift+Enter is a newline too.
- **One bar, three scopes.** The composer carries a sources dropdown -- All, Duas, Hadith, or
  **Quran verses** -- and the Ask button on the right. Picking Quran searches the verses and shows
  them: the ayahs are not part of the corpus Ask answers from, and nothing should suggest a model is
  interpreting a verse.
- **The citation rule stopped discarding good answers.** Every claim still needs a citation and
  every citation must point at a real source, but a line of quoted Arabic no longer needs one of its
  own -- it is the cited source speaking, not a new assertion. Asked for the travel supplication the
  model writes a cited sentence and puts the dua on the next line, which is exactly the right shape,
  and the whole answer was being replaced by "could not generate a fully cited answer". A cited
  claim followed by an uncited English claim is still rejected, as is a citation pointing at a
  source that does not exist, and a transliteration still counts as the model writing rather than
  the source speaking.

### 0.28.1

_2026-09-14_

- **Ask is a conversation.** Research is: someone asks about travelling, reads the answer, and the
  next thing they want is "what about returning?" -- which used to mean retyping the question,
  because there is no record about "returning" in the abstract for retrieval to find. Follow-ups now
  carry the earlier turns, and the server rewrites the short question into a standalone one before
  retrieving anything. Each turn keeps its own question, answer and sources, so a citation stays
  attached to the answer it belongs to.
- **History rewrites the query and does nothing else.** It never reaches the model that writes the
  answer, which still sees only retrieved records. An assistant allowed to quote its own earlier
  answers can launder an ungrounded claim into a later turn as though it had a citation, and the
  one thing Ask promises is that every claim traces to a source. A test holds that boundary in
  place, and `meta.rewritten` reports when a question was rewritten.
- An unusable rewrite -- empty, enormous, or a refusal -- falls back to joining the previous
  question with the new one, which is worse than a real rewrite and much better than retrieving on
  two dangling words.

### 0.28.0

_2026-09-14_

- **Thematic Quran search (`0024`, `0025`).** "An ayah about tawakkul" is the case it exists for:
  the word appears in no English translation, "relies upon Allah" does, and only an embedding
  bridges that. All 6,236 ayahs are searchable by theme or by a half-remembered phrase, through the
  same hybrid retrieval and cross-encoder rerank Ask uses. `GET /v1/quran/search?q=` returns the
  matching verses best-first; `GET /v1/quran/status` reports how much of the corpus is embedded.
- **No generation step, deliberately.** Finding which verses relate to a theme is retrieval; saying
  what a verse means is tafsir. Search returns references and lets the reader read them, which is
  also what makes it several seconds faster than Ask -- no model writing prose.
- **The response carries references, not verse text.** The Saheeh International translation is
  searched server-side and served to nobody: it is not redistributable ("copyright retained by the
  publisher; free non-commercial religious use with attribution"), and a public API handing it to
  third-party developers would be redistribution where the PWA reading its own offline copy is not.
  So the API answers with surah and ayah numbers plus surah names, and the client renders the words
  it already has. The Arabic is Tanzil Project under CC BY 3.0.
- **Its own Vectorize namespace** (`quran.saheeh.v1`) in the shared index, so Ask's retrieval can
  never return an ayah and this can never return a dua. One cron tick now advances both indexes,
  since they touch different namespaces and different tables.
- **Not part of the canonical editorial corpus, on purpose.** Those tables model records that are
  drafted, revised, reviewed and verified. The Quran has no revision history to keep, no reviewer to
  stamp it and no verification status that would mean anything, so it gets a plain table rather than
  a workflow forced onto text that does not have one.
- **Ask flags unverified answers again.** `includesUnverifiedSource` was set by whichever code path
  added a record, and only the unverified-content fallback ever did -- until `0022` published 14,357
  unverified hadith through the ordinary path. Every source was then individually marked unverified
  while the answer as a whole reported none, so the PWA's banner stayed hidden on exactly the
  answers it exists for. It is read off the sources now.
- The reranker is generic (`rerankByRelevance`), shared by Ask and Quran search, so the floor, the
  relative cut and the reasoning behind both live in one place.

### 0.27.1

_2026-09-13_

- **The whole hadith corpus enters the corpus Ask answers from (`0022`).** Ask had 268 duas to work
  with while the platform held 14,357 hadith -- Sahih al-Bukhari 7,277, Jami at-Tirmidhi 3,982,
  Sahih Muslim 3,098 -- none of them published, so a question it could have answered from any of
  them returned nothing at all. All of them are now published and queued for embedding.
- **These records are not verified, and every layer says so.** The retrieval context hands the model
  `Verification: unverified`, the API returns `verificationStatus` per source and
  `includesUnverifiedSource` in its metadata, the PWA styles those sources differently and marks
  them "Not yet verified" with a note above the answer, and the dataset version itself is recorded
  as `verification_status = 'pending'`. Publishing and verifying stay separate acts: the migration
  writes publication rows and never touches `editorial_record_state`, which is what verification is
  derived from, so reviewing these records later relabels them without republishing.
- **Indexing 200 records a minute instead of 50.** The old batch was sized for 268 duas, where it
  finished in six minutes; at 14,625 records it would have been a five-hour backfill. The cost of a
  bigger batch is subrequests rather than CPU -- embedding calls are already split to fit the
  model's context, and awaiting them burns no CPU -- so 200 is a handful of AI calls against a paid
  limit of 1,000 subrequests per invocation. A full backfill now takes about 75 minutes, and Ask
  keeps answering from lexical retrieval while it runs.
- **What it costs.** 14,625 records at 1,024 dimensions is ~14.98M stored Vectorize dimensions
  against the 10M a paid plan includes: about 5M billable at $0.05 per 100M, under a cent a month.
  Embedding the corpus once is roughly $0.20. An earlier draft of this migration published Sahih
  Muslim alone, because the free allowance is 5M dimensions and one collection fit where three did
  not.
- Reversible in one action: the previous dataset version is superseded rather than deleted and keeps
  its complete membership snapshot, so the Admin Console can roll back to duas alone.
- Withdrawn records stay withdrawn. Publishing the corpus wholesale does not quietly return a record
  that was taken out of public service, and a test holds that in place.

### 0.27.0

_2026-09-13_

- **Ask answers as it writes, instead of after it finishes.** Measured against the test API, a
  question took between 4.5 and 15.7 seconds, and a reader saw an empty panel for every one of
  them. None of that time is waste -- a question costs an embedding call, a vector query, a lexical
  query, a reranker pass and then a model writing prose -- but nothing said so. `POST /v1/ask/stream`
  sends the stage it is on, then the citations as soon as retrieval and reranking have them
  (seconds before any answer text exists), then the answer word by word. `POST /v1/ask` is
  unchanged and still there; the PWA falls back to it if the stream cannot be opened.
- **The citation rule survives streaming intact.** Every paragraph must still cite a source, and
  that can only be checked once the text is complete. An answer that fails it is replaced: the
  client is told to discard what it showed and render the deterministic source list instead. The
  rejected text is logged the same way it always was. Relaxing the rule because the text now
  arrives gradually was never an option -- it is the one commitment Ask makes about religious
  content.
- **A whole round trip removed from every question.** Query expansion is a call to a language model
  that the base question's own retrieval does not depend on, and it used to sit in front of
  everything. It now runs while the policy rows are read and while the question itself is already
  being retrieved. The settings and per-model usage reads were two sequential D1 round trips and
  are now one.
- **An explicit `AskAnswer` type** replaces the shape TypeScript used to infer across the
  pipeline's several exits, so the streaming and non-streaming endpoints cannot drift into
  answering with different fields.
- Failures in a stream arrive as an `error` event carrying the code the plain endpoint would have
  used, because the status line is already committed by the time anything can go wrong.

### 0.26.1

_2026-09-13_

- **The portals wear the app's logo.** Admin, Developer and Status showed the 2024 mark -- a flat
  teal tile with a pale crescent -- months after the app itself had been redrawn. Nothing connected
  the two files: `packages/portal-ui/assets/fortress-mark.svg` was drawn by hand and the redraw
  only ever touched `pwa-website/icons/`, so the portals sat out the rebrand without anything
  failing. The portal mark and its favicon are generated by
  `pwa-website/tools/build-brand.mjs` now, from the geometry the app's own icons come from, and
  `verify-portals.mjs` compares what each portal ships against `pwa-website/icons/logo.svg` on
  every build -- the only difference allowed is the product name the file announces to a screen
  reader. A portal can no longer keep an icon the app has replaced.
- Portal favicons point at a simplified mark (`fortress-favicon.svg`) that drops the gateway, for
  the same reason the app's favicon does: at 16 pixels the gateway is a smudge.
- **Offline downloads stopped waiting in single file.** Downloading a surah's recitation fetched one
  ayah, waited for it, then asked for the next -- 286 round trips laid end to end for Al-Baqarah,
  and 6,236 for the whole Quran a surah at a time. Both that and the 114-file full-Quran text
  download now keep five requests in flight. Measured against everyayah, twenty ayahs went from
  5.0s to 1.8s: almost all of the wait was latency rather than transfer. There is no bulk fetch to
  switch to -- everyayah publishes a zip per surah, but serves it without an
  `Access-Control-Allow-Origin` header where its individual mp3s carry one, so no browser can read
  the archive, and proxying a 116MB zip through our own Worker to add that header would move the
  entire cost of the download onto us.
- None of this touches D1, and no bulk API would help it. Recitation comes from everyayah.com,
  word audio from audio.qurancdn.com, and the Quran text from 229 static JSON files served with the
  app -- the API Worker has no Quran route at all. The row reads that exhausted D1's daily
  allowance came from one source, Ask's unverified-content fallback, which `0021` turned off.

### 0.26.0

_2026-09-12_

- **Ask judges its sources instead of trusting whatever came back.** Asking about a "toilet"
  returned the bathroom reading first and then five more -- undressing, entering the mosque,
  ablution, starting the prayer -- and the small model cited one of them. Retrieval was not blind
  to the synonym; nothing downstream could tell which candidates actually answered the question.
  Embeddings compare two texts encoded apart, so "near this question" is the best they can say. A
  cross-encoder (`@cf/baai/bge-reranker-base`) reads the question and the passage together and
  scores that pair. Retrieval now casts wider (16 candidates), the reranker decides which survive,
  and anything below the relevance floor is dropped even when that leaves nothing -- six confident
  wrong citations are worse than "not found". It costs about half a Neuron per question.
- **Reasoning models answer, with the cost governed rather than hoped about.**
  `@cf/openai/gpt-oss-120b` answers until a configured share of its daily allowance is spent, then
  `@cf/openai/gpt-oss-20b` takes over for the rest of the day, so a busy day serves more questions
  instead of turning people away. Both allowances, the switch point, the models and the per-visitor
  daily limit are set in the Admin Console under the RAG monitor, with today's usage per model
  shown beside them. 0 means unlimited, which is what makes the per-visitor cap switchable off for
  testing without a deploy.
- **Search aliases (`0020`).** The corpus says "bathroom" and never "toilet", so lexical search for
  a toilet found nothing at all. 480 aliases across all 132 chapters record what people actually
  type -- toilet, washroom, wudu, qurbani, nightmare, istikhara, insomnia -- and are appended to
  the lexical index and to the text each record is embedded from. They are search terms only: never
  displayed, never part of a revision, never religious text. Measured against the real corpus,
  seven of nine sample searches went from no result at all to the correct chapter.
- **The unverified-content fallback is now a switch, and it starts off (`0021`).** When verified
  sources came up thin, Ask supplemented them with current-but-unverified records through a query
  with no index behind it: a LIKE over every segment of all 14,625 current records, once per word
  in the question, up to ~200,000 row reads for a single question. Against D1's free allowance of
  5,000,000 row reads a day that is roughly 25 unanswered questions before the database stops
  serving reads -- which is exactly what took the test environment down while this was being
  built. Ask's own rule is that it answers from verified, published sources; this was always the
  exception, so the exception is opt-in, with the cost stated in the Admin Console beside it.
- **`remainingToday` is now nullable** in the Ask response: with no per-visitor limit configured
  there is no number to report. The OpenAPI schema says so, and the PWA no longer risks printing
  "null questions remaining today".

### 0.25.0

_2026-09-11_

- **Reading roles.** Hisn al-Muslim holds four kinds of reading and every record had been shaped as
  a supplication, so 46 of 268 carried `--` or English prose where a transliteration belongs. Every
  dua response now has `readingRole`: `supplication` (205), `framed` (36 — a narration containing
  the words), `instruction` (14 — what to do, no fixed words) or `virtue` (13 — a merit, nothing to
  recite). Stored in `canonical_reading_roles`; documented in the OpenAPI schema and the Developer
  Portal's content model.
- **48 corrected revisions** (migration `0018`). 44 non-transliterations removed from the
  transliteration field, two narration frames moved to `comment` segments, two translations that
  stopped mid-sentence completed. No Arabic or reference changed. Each correction is a new
  immutable revision with a reason in `correction_history`, published as dataset
  `canonical.hisn.reading-roles.2026-09-11`, so the Admin Console can roll back to the previous
  dataset. The migration only revises a record whose published text is exactly what was reviewed,
  and skips anything that differs, which makes it safe on production too.
- **Chapter 45's adhan and adhkar readings restored.** `dua.hisn.142` and `.143` had been withdrawn
  (`0017`) for showing `--` as a transliteration. They are valid readings, so they return as
  `instruction` readings without the `--`. Withdrawal itself — taking a record out of every public
  read without deleting its history, since revisions are undeletable by trigger — remains
  available.
- **Arabic search over Hisn fixed.** 0013 wrote the dua search rows with their diacritics, and FTS5
  does not strip Arabic tashkeel, so a query typed without diacritics found nothing. The dua rows
  are rebuilt with the same normalisation every application write path uses.
- **Ask re-indexing fixed.** Workers AI pads every input in an embedding call to the longest one and
  refuses a call over the model's 60,000-token context. The indexer sent 50 records per call, so
  republishing Hisn failed at once ("Max context reached 81200 tokens": 50 x the longest reading's
  1,624) and retried the same batch every minute. Any republish would have hit it. Calls are now
  sized by that padded cost.
- Verified before shipping by running the migration against a full copy of the test database:
  all 268 readings match the PWA's data in text and role, no existing revision changed, and a
  record with drifted text is skipped. `apps/api/test/reading-roles-migration.test.ts` runs it
  through the real migration chain.

### 0.24.0

_2026-08-23_

- **Recitation player.** Ayah-by-ayah playback in the Quran reader, streamed per ayah from
  everyayah.com so the first word sounds in ~150KB rather than after a whole-surah download.
  Seven reciters, repeat off/ayah/surah, auto-advance with highlight and follow-along scrolling
  across page turns, and a cancellable per-surah offline download that reports real bytes.
- **Word-by-word audio and meaning.** Each word shown with its English gloss and playable on tap.
  Word data is built from quran.com's segmentation (`pwa-website/tools/build-quran-words.mjs`)
  rather than derived by splitting the Arabic: splitting agrees for 6232 of 6236 ayahs, and in the
  other four Tanzil writes as two tokens what the Uthmani script counts as one, which would have
  played every later word in those ayahs one position off with no visible symptom.
- **High-latitude prayer times.** Above ~48° the sun does not always reach the Fajr/Isha angle and
  the app previously showed nothing at all. Four conventions are now offered — angle-based
  (default), one-seventh of the night, middle of the night, or none — with the Aqrab al-Bilaad
  nearest-latitude fallback inside the polar circles. Derived times are labelled "estimated" and a
  note names the convention; choosing "none" still explains the blanks.
- **First-run walkthrough.** Four skippable cards covering offline behaviour, Quran options,
  location handling and personalisation. Replayable from Settings → About.
- **PWA test suite.** `pwa-website` is now a workspace with vitest + happy-dom, wired into
  `npm run check`: 44 tests over prayer-time maths, dua categorisation and Quran word data.
- **Fixed a recurring `hidden` bug class.** The `hidden` attribute is enforced only by a bare
  attribute selector, so any class rule setting `display` defeated it while scripts still read
  `.hidden` as true. This had pinned open a boot banner, a sign-out button and the new player bar,
  and was silently displaying the qibla card and both location forms. `[hidden]` is now enforced
  once, globally, in `css/base.css`.
- **Documentation.** `docs/project-overview.md` and the README feature list rewritten against the
  code; `docs/platform-architecture.md` corrected where it still described shipped apps as future.
- **Customize Layout parent/child.** Prayer is now a configurable entry in its own right rather than
  a button derived from its members: switching it off takes Prayer Times, Qibla and Tasbih with it,
  its Simple/Advanced setting applies to them, and a child cannot be enabled without it. Children
  keep their own setting while the parent is off and return unchanged. Also fixes the worship
  sub-bar keeping stale state after a layout change until the next navigation.
- **PWA shell budget raised 250 KB -> 300 KB.** The app gained recitation, word-by-word mode and the
  walkthrough this release. Escalation agreed for next time: 500 KB, then a deploy-time minification
  step rather than raising it again. See `tools/verify-pwa-release.mjs` for the two known weaknesses
  in what the budget measures.

### 0.23.2

- **Fixed the Developer Portal's Sign out button staying visible while logged out**: the profile
  dropdown's `[hidden]` attribute was being set correctly by `app.js`, but `styles.css`'s
  `.profile-dropdown button { display: block; }` rule had equal specificity to the browser's
  default `[hidden]` behavior and won on source order, so the button rendered anyway despite being
  logically hidden. Added an explicit `.profile-dropdown [hidden] { display: none; }` override in
  both `styles.css` and `console.css` (the latter as a defensive fix; its own sign-out button
  turned out to already be correctly hidden via its ancestor). Verified live that only "Sign out"
  was affected -- the other profile menu links are meant to stay visible when logged out.

### 0.23.1

- **Fixed TOTP QR code unscannable by Microsoft Authenticator**: the Developer Portal's
  authenticator-app QR renderer (`apps/developers/public/console.js`) drew modules edge-to-edge
  in the SVG with no quiet zone, relying only on a fixed CSS padding that didn't scale with the
  QR's module count. Google Authenticator tolerates the missing margin; Microsoft Authenticator's
  scanner does not, and would fail to locate the finder patterns. The 4-module quiet zone required
  by the QR spec is now baked into the SVG's own coordinate system.

### 0.23.0

Search/RAG quality and PWA discovery, closing out the rest of the post-0.20 search roadmap:

- **Arabic search normalization**: SQLite FTS5's `remove_diacritics 2` tokenizer (already set on
  `canonical_search_fts`) does not strip Arabic tashkeel or fold alef-hamza variants (أ إ آ ٱ) --
  verified empirically against the real schema before fixing it. Both the index-population side
  (`apps/auth`, every `canonical_search_fts` write path) and the query side (`apps/api`,
  `toFtsQuery`/`toRagFtsQuery`) now normalize identically, so a diacritic or alef-form mismatch
  alone no longer causes a silent zero-result search.
- **Exact-reference search for Ask**: a question that's essentially just a reference on its own
  (`"Bukhari 52"`) resolves directly against the matching record instead of running the full
  embedding/lexical/synonym-expansion retrieval pipeline -- collections are editor-created with no
  fixed enum, so the hint is fuzzy-matched in JS against the real hadith collections. Falls through
  to normal retrieval when the hint doesn't resolve.
- **Metadata-filtered retrieval for Ask**: `POST /v1/ask` accepts an optional `filters` object
  (`contentType`: `dua`/`hadith`, `collection`: slug) threaded through vector retrieval (Vectorize's
  native metadata filter), lexical FTS retrieval, and the unverified-content fallback. The PWA Ask
  UI got a content-type select wired to it.
- **PWA category/mood discovery**: category and mood filter chips now show a live count of matching
  duas, and the mood panel shows a short description of the selected feeling, computed from the
  existing per-entry categories/moods with no new taxonomy to maintain.
- **Embedding model upgrade (test environment only)**: Ask's semantic retrieval moves from
  `@cf/baai/bge-base-en-v1.5` (768-dim, English-only) to `@cf/baai/bge-m3` (1024-dim, multilingual,
  8192-token context) -- directly targets mixed Arabic/English/transliteration questions ("siwak"
  vs. "miswak"). Vectorize indexes are dimension-locked at creation, so this required a new index
  (`fortress-rag-test-m3`) rather than an in-place resize; the old `fortress-rag-test` index is left
  allocated but unused. **Production's index is not yet migrated** -- see
  `docs/release-readiness.md`'s current blocker before promoting this to `main`.

### 0.22.0

Editorial and Ask/AI improvements, from a working session focused on closing gaps a real user hit
while using the platform:

- **Field-level verification linked to overall approval**: approving a whole record (single,
  bulk, or Hadith book verification) now fills in a `verified` `field_reviews` row for every
  reviewable field (arabic, translation, narrator, grading, ...) not already reviewed by that
  same reviewer -- an individually-reviewed field's own decision is never overwritten. Field-level
  data stays admin/editorial-only; the public API only ever exposes overall verification status.
- **Taxonomy term assignment**: `record_taxonomy` had been read-only since it was created --
  terms could be made and counted, but nothing could ever be assigned to a record. Seeded the same
  mood/occasion vocabulary the offline PWA already uses, added keyword-derived suggestions (an
  editor must still confirm before anything is assigned), and a checklist in the Admin Console
  record dialog to do it.
- **Smarter Ask retrieval**: a curated Islamic-terminology synonym dictionary (siwak/miswak, wudu/
  wudhu, ...), an LLM query-expansion step before retrieval (2 alternate phrasings per question,
  merged in), and a supplementary unverified-content fallback for when verified results come up
  thin -- clearly labeled as not verified in both the generated answer and the sources list, never
  presented with the same confidence as verified material. Deliberately deferred: swapping the
  embedding model for a stronger multilingual one, since the only meaningfully better Workers AI
  options use a different vector dimension than the existing Vectorize index, which would require
  recreating real Cloudflare infrastructure rather than a code change.
- **Ask now submits on Ctrl+Enter or Alt+Enter**, not just the button click, with a visible hint.

### 0.21.0

Developer experience and Admin Console improvements, from a full-codebase review that looked for
built-but-broken and built-but-unreachable functionality alongside genuinely new capability:

- **Developer usage/quota dashboard**: `GET /v1/control/usage` (a non-incrementing peek at the
  same plan limits and rate-limit counters `checkRateLimit` enforces) rendered as a usage card on
  the Developer Console overview, so a developer can see how close they are to their per-minute/
  per-day limit instead of only discovering it from a `429`.
- **Inline validation and live preview for the named-query and MCP toolset/tool builders**: each
  drawer now shows the resulting endpoint/connection URL or tool call name as you type, and the
  filter-value field enforces the same parameter-name pattern the server does, so a mistake surfaces
  before submit instead of after a round-trip failure. Also fixed the MCP connection URL (managed
  endpoint banner and every custom toolset's URL) to derive from environment like the API base URL
  already does, instead of being hardcoded to `mcp-test.fortressofmuslim.org` in all environments.
- **Loading/empty/error states across the Developer Console**: every section fetches independently:
  previously a failed fetch left that section exactly as blank as the static HTML defined it,
  indistinguishable from "still loading" or "genuinely empty," with only one aggregate toast as any
  signal. Each section now shows its own loading spinner while in flight and, on failure, an inline
  error with a scoped Retry button.
- **Admin Console health-first overview banner**: previously only rendered when there were active
  alerts and showed just a count. Now always renders: a positive "All systems normal" state when
  clear, or a severity breakdown plus the top 3 unresolved alert messages inline when not, so an
  admin can see what's wrong without leaving Overview.
- **JS/Python SDK examples** for OAuth client-credentials, named queries, and MCP tool calls in the
  API docs, reusing the existing curl/JavaScript/Python tab component that was previously used only
  for the single basic quickstart request.
- **Webhooks for `record.published` and `record.verified`**: developer-registered, HMAC-signed
  (`X-Fortress-Signature: sha256=...`), best-effort delivery (no Cloudflare Queues/cron, no new
  billed infrastructure) fired from all four publish/verify paths in `editorial-plane.ts`. A failed
  delivery is not retried automatically; the Developer Console's new Webhooks section shows a
  per-subscription delivery log with a manual Redeliver action.

### 0.20.0

0.20 Operations: production reliability and safety, deliberately shipped as one release with no new
user-facing feature surface, per the release goal of proving the platform can be operated safely
before growing it further. All eight items closed:

- Ran and logged a real D1 backup + Time Travel restore drill against the test environment (not a
  dry run): backed up both databases, created a throwaway marker, restored it away with Time Travel,
  and confirmed the platform stayed healthy across all 9 monitored surfaces. See `docs/incident-response.md`
  Drill Log.
- Automated FTS index rebuild after disaster recovery (`tools/rebuild-fts.ps1`), reusing the exact
  SQL the application already runs during Hadith book verification rather than a new implementation.
  The first live run found and corrected a real 1-row drift between the search index and current
  editorial state.
- Added scheduled, genuinely encrypted D1 backups to Cloudflare R2 with a 30-day retention rule
  (`.github/workflows/scheduled-backup.yml`, `tools/lib/backup-crypto.ps1`). `backup-d1.ps1` previously
  wrote plain SQL while being documented as "encrypted-at-rest" -- that was never true; it now
  actually encrypts (streamed AES-256-CBC + HMAC-SHA256, verified against the full 150MB+ content
  export after an in-memory first attempt failed with an out-of-memory error on that exact file).
- Added operational alerts to the Admin Console (service down/maintenance, elevated error rates,
  indexing failures, unusual API usage), evaluated fresh on every view and surfaced as a dedicated
  Alerts page plus an Overview banner -- Admin-Console-only by explicit choice, no external paging.
- Added enforceable, admin-configurable per-plan API rate limits (basic/premium/enterprise), replacing
  telemetry-only visibility with real enforcement on every credentialed request; anonymous public
  reads remain unlimited by design.
- Made two-factor authentication mandatory for the Admin role (Editor/Reviewer remain optional),
  with a clear in-console enrollment prompt instead of a broken console, and documented the account
  recovery procedure for a full MFA lockout.
- Added incident acknowledgement (acknowledge/resolve) on top of the same alerts table, so an alert
  and an incident are one system at different points in its lifecycle rather than two.
- Confirmed release-readiness tooling (`npm run check`, soak test, smoke tests) is ready for the
  promotion gate.

Every item above was verified against live Cloudflare test infrastructure during development, not
just against local mocks -- several of the fixes described (the FTS drift, the backup memory issue)
were found by that verification, not anticipated in advance.

### 0.19.1

- Fixed developer-created "record query" named queries (Developer Portal and the equivalent MCP tool
  path) reading from the retired `content_records`/`dataset_versions` tables instead of the current
  canonical editorial schema. They were silently frozen on the original unverified 2026-07-18 DOCX
  import (135 records) and could never reflect anything published since; every other read path
  already used the canonical schema. Rewired to `api_current_content`/`canonical_records`/`content_revisions`,
  the same join every other content route uses. Verified against the real migrated schema, not just
  the existing mocked unit test.
- Ran a real D1 backup and D1 Time Travel restore drill against the test environment end to end
  (see `docs/incident-response.md` Drill Log) rather than relying on the scripts being untested.

### 0.19.0

- Fixed Developer and Admin sign-out so sessions end cleanly and authenticated controls disappear immediately.
- Added browser-level regression checks for signed-out UI state.
- Added TOTP two-factor authentication and WebAuthn passkey enrollment and sign-in.
- Added a 12-hour absolute Admin session lifetime, active-session inventory, and audited session revocation.
- Added sampled API request telemetry with 30-day retention, latency/error/rate-limit summaries, and API-key usage metrics.
- Added a focused Admin Operations Monitor for traffic, editorial and access queues, and live API/Auth/MCP deployment probes.
- Split Admin user management into searchable Team Access and Developer Accounts views.
- Added user-level active-session inspection and revocation.
- Added D1 backup and guarded restore scripts with checksums, mandatory pre-restore backups, and explicit production approval.
- Added the incident response, rollback, credential-compromise, and recovery runbook in `docs/incident-response.md`.

### 0.18.0

- Replaced the multi-review workflow with one complete verification by an authorized Admin, Editor, or Reviewer.
- Added permanent verifier identity and timestamp stamps to editorial record state and evidence.
- Added a unified Admin, Editor, Reviewer, and Developer hierarchy with an explicit administrator flag.
- Restricted platform management to Admins, while Editors can manage Reviewer access and editorial work.
- Seeded `ziyadahmed910@gmail.com` as the protected default Admin and added self-healing bootstrap on sign-in.
- Exposed current verified and unverified records through REST and API-backed MCP tools with explicit verification and workflow fields.
- Kept PWA snapshots and RAG retrieval restricted to verified, published revisions.
- Added public-read indexes and direct content-type counts to reduce cold list latency as the library grows.
- Restored the verified 132-chapter Hisn offline snapshot and prevented API publication state from emptying local PWA data.
- Simplified visible editorial statuses to Pending Review, Verified, and Change Requested; publication batching is no longer part of the normal Admin Console flow.
- Verified and published all 268 individual Hisn readings while leaving Hadith collections pending review.
- Added Admin authoring for new Dua and Hadith records with ordered parts, metadata, and a required canonical reference.
- Added one-action Hadith book verification that stamps every record, publishes a complete mixed-corpus snapshot, and queues it for RAG indexing.
- Added resumable scheduled indexing for verified Hadith and Duas, with per-content-type readiness counts.
- Unified identity and editorial events in the Admin audit history and protected the default and final active administrator.
- Replaced positional lexical RAG scores with query-aware title and body relevance, then removed evidence that falls materially below the strongest match.
- Normalized known legacy typography corruption in generated-answer context without changing canonical source records.
- Required every generated-answer paragraph to carry a valid citation and prohibited inferred Quran or Hadith attribution.
- Added an Admin RAG monitor with corpus-specific vector readiness, indexing progress, and failure diagnostics.
- Added role-scoped editorial assignments with audited completion and cancellation controls.
- Added selected-record bulk verification and change requests with bounded per-record outcomes.
- Added a reviewer workload dashboard covering open work, pending records, completed assignments, and recent decisions.
- Expanded correction revisions to include Hadith display number, narrator, grade, and grading authority.
- Added reversible lifecycle controls for OAuth apps, named queries, MCP toolsets, and individual custom tools.
- Revoked outstanding OAuth access and refresh tokens whenever a connected app is disabled.
- Reconciled browser-remembered API keys with the authoritative server key list.
- Added PWA cache-manifest, install metadata, accessibility, and shell-size checks to CI.
- Added automated mobile target-size, overflow, online-mode, offline-cache, and update-flow browser checks.
- Added a repeatable multi-surface test soak command for release promotion.

### 0.17.0

- Repaired Ask with canonical-dataset preflight, hybrid vector and lexical retrieval, deterministic cited fallback, citation validation, and public index-readiness reporting.
- Corrected vector indexing to embed the exact immutable revisions selected by `canonical_publications`.
- Added per-dataset RAG index state and status monitoring at `GET /v1/ask/status`.
- Hardened editorial work with reviewer assignment enforcement, queue pagination, operational lookups, revision comparison, duplicate suggestions, and partial immutable field-review progress.
- Added detailed publication validation reports, editable draft batches, complete immutable dataset snapshots, and audited atomic rollback.
- Added an automated editorial pilot covering separate editor, reviewer, senior reviewer, and publisher identities from assignment through publication and rollback.

### 0.16.0

- Established Fortress Platform as the sole public canonical publication boundary.
- Added immutable content revisions, 13-field reviews, two independent reviewer approvals, separate senior approval, disagreement tracking, scoped assignments, and atomic publication batches.
- Added editorial roles for viewer, reviewer, senior reviewer, editor, publisher, and super administrator.
- Rebuilt the Admin Console around queue, review, correction, evidence verification, batch publication, and role-management workflows.
- Restricted REST, MCP, RAG, and PWA data to explicitly published canonical revisions.
- Added sequential Fortress URLs such as `/bukhari/book1/1` and an exact API resolver for those routes.
- Replaced the local data builder with a published-API snapshot builder and moved candidate-preparation tooling outside the public repository.

### 0.15.0

- Replaced the legacy PWA export with a validated local corpus of 132 Fortress chapters and all 268 ordered recitations while preserving stable favourite IDs.
- Added explicit category, mood, and tag metadata to the local PWA artifact and strict reproducible build checks.
- Added an online PWA Hadith browser with collection filtering, full-text search, pagination, and source-linked details.
- Added a rate-limited, source-grounded Ask API and PWA interface using Workers AI and Cloudflare Vectorize.
- Added the `ask_fortress` standard MCP tool, resumable vector indexing, D1 usage accounting, and OpenAPI coverage.
- Kept raw source artifacts out of Git and kept Hadith and AI responses outside the PWA offline cache.

### 0.14.0

- Added the initial Hadith hierarchy, numbering, grading, search, API, and MCP capabilities.
- This release's pre-canonical data flow is superseded by the 0.16.0 editorial and publication architecture.

### 0.13.0

- Added cross-site mutation protection and a 64 KB request-body ceiling for session-authenticated Admin and Developer Console operations.
- Prevented Auth responses from being cached or framed and added a restrictive Content Security Policy to every Cloudflare portal.
- Made Developer Console requests time out cleanly, retry safe reads once, include request IDs, recover from partial loading failures, and return to sign-in when a session expires.
- Improved tabs, profile menus, drawers, focus restoration, keyboard navigation, live error announcements, submit locking, and corrupted dynamic labels in the Developer Console.
- Added production dependency auditing, bounded workflow runtimes, and post-deployment smoke tests for Workers, portals, and both PWA environments.

### 0.12.0

- Standardized request IDs, platform-version headers, server timing, baseline security headers, and privacy-conscious structured request logs across API, Auth, and MCP Workers.
- Added the shared platform version to Auth health and database health responses.
- Rebuilt the Status portal to detect test or production automatically and check API, D1 access, Auth, MCP, PWA, Developer Portal, and Admin Console.
- Added platform-version skew detection and separate browser-local status histories for test and production.
- Hardened Cloudflare static portals with `_headers` rules and extended CI verification for operational checks and security configuration.

### 0.11.0

- Added the first content-governance console, controlled taxonomy, review history, correction history, and content audit events.
- These direct-editing controls are superseded by the immutable editorial workflow introduced in 0.16.0.

### 0.10.0

- Added the canonical knowledge schema for provenance, collections, books, chapters, languages, translations, dua and Hadith metadata, taxonomy, references, contributors, and search metadata.
- Added append-only verification, correction, publication, and content-audit history.
- Added `GET /v1/duas/{id}/evidence` so clients can inspect source and editorial evidence without inferred or fabricated citations.
- Added the read-only MCP tool `get_dua_evidence` for authenticity, attribution, and citation checks.
- Opened core published read routes for anonymous access while keeping owner-scoped named queries authenticated.
- Added the first evidence gate and documented canonical publishing and public access decisions in ADRs.

### 0.9.0

- Added `find_dua`, a one-call MCP tool that fuzzy-matches natural-language and misspelled titles.
- Title lookup now returns complete dua records immediately, avoiding the previous search-summary and ID-detail round trip.
- Added focused ranking tests and MCP instructions that distinguish fast title lookup from broad full-text search.

### 0.8.1

- Fixed the interactive OAuth authorization-code flow used by ChatGPT and other MCP clients.
- Added a dedicated Fortress login and consent screen that preserves and resumes signed OAuth requests.
- Interactive connected apps now include refresh-token access, and MCP tools advertise read-only safety metadata.

### 0.8.0

- Replaced separate custom MCP server drafts with one managed Fortress MCP runtime and user-owned custom toolsets.
- Added standard MCP tools for searching, listing, retrieving, and selecting duas plus dataset metadata.
- Added custom tools backed by standard tools, named-query APIs, or review-gated external HTTPS APIs.
- Rebuilt named queries as declarative record queries with selected fields, allowlisted filters, endpoint parameters, sorting, and enforced row limits.
- Connected OAuth client credentials to their owning developer so permissioned apps can execute owner-scoped named queries and MCP toolsets.
- Made OAuth callbacks conditional on interactive flows and kept PKCE as the default for browser, mobile, and AI clients.
- Added optional browser persistence for one-time API-key secrets so API Explorer can reuse a key after reopening the portal.
- Improved account-creation validation and simplified the Developer Console language around devices, apps, tools, and credentials.

### 0.7.0

- Added a dedicated `admin.fortressofmuslim.org` console with server-side administrator roles.
- Added global search across users, credentials, OAuth clients, devices, MCP registrations, named queries, and content records.
- Added account suspension, credential/resource state controls, content verification controls, and a privileged audit trail.
- Added enforceable API maintenance and disabled states while preserving health endpoints for recovery.
- Added test and production deployment definitions for the Admin Console; production remains protected by the existing GitHub environment gate.

### 0.6.0

- Separated developer identity and credential management from the API documentation into a dedicated Developer Console.
- Added a profile icon and account dropdown with direct access to API keys, connected apps, and MCP management.
- Added multiple API keys with optional expiration, one-time secret display, browser-session Explorer selection, and owner-checked revocation.
- Expanded connected apps with multiple callback URLs, public PKCE, confidential, client credentials, and private-key JWT client profiles.
- Added OAuth 2.0 Device Authorization for limited-input devices plus a device inventory for IoT, CLI, gateway, and service identities.
- Distinguished the official Fortress-managed MCP server from custom OpenAPI-backed and named-query-backed MCP drafts.
- Added safe named queries that compile allowlisted list, search, and record operations into owner-scoped API endpoints without accepting raw SQL.
- Added an executable `/v1/queries/{id}` route, API Explorer handoff, OpenAPI documentation, schema checks, and API contract coverage.

### 0.5.0

- Added a dedicated Cloudflare Auth Worker backed by separate test and production identity D1 databases.
- Added developer accounts, sessions, organizations, hashed one-time-reveal API keys, and scoped key verification.
- Added an OAuth 2.1 authorization server with PKCE, client credentials, JWKS, consent, audience binding, and connected-app management.
- Protected content APIs through an internal Auth Worker service binding while keeping health and discovery public.
- Added a narrow public database-health probe so the Status Portal can verify D1 without holding a content credential.
- Added plans, access requests, usage, audit, and user-defined MCP registration foundations to the control-plane schema.
- Upgraded the Developer Portal with sign-up/sign-in, API-key management, connected apps, MCP drafts, and an authenticated API Explorer.
- Updated quickstarts and OpenAPI security schemes so documentation examples use the same working authentication contract.
- Added deployment ordering, migration checks, dependency auditing, and Auth Worker configuration documentation.

### 0.4.0

- Added a responsive Developer Portal with Salesforce-style documentation navigation.
- Documented environments, authentication direction, content concepts, errors, and every public v1 endpoint.
- Added searchable documentation, language quickstart tabs, copy actions, and downloadable OpenAPI.
- Added a live API Explorer with environment selection, response timing, and formatted JSON.
- Added a responsive Status Portal with real API, database, PWA, and developer portal probes.
- Added measured latency, API version reporting, manual refresh, and local recent-check history.
- Clearly separated live beta services from production services awaiting promotion.
- Added a shared lightweight portal design system with accessible light and dark themes.
- Added independent Cloudflare Worker deployments for test and production portal domains.
- Added automated portal builds and verification to CI.

### 0.3.0

- Added full-text-like D1 search across dua titles, Arabic, transliteration, translations, and commentary.
- Added a random complete-dua endpoint with cache prevention.
- Added ordered part collection and single-part endpoints for swipe-based readers.
- Added structured validation and errors for search parameters and part positions.
- Preserved canonical and legacy ID lookup across all record routes.
- Expanded automated API coverage from five to nine endpoint tests.
- Expanded the OpenAPI specification with parameters and reusable response schemas.

### 0.2.0

- Added separate Cloudflare D1 content stores for test and production.
- Added a normalized, versioned schema for datasets, content records, ordered parts, and typed text segments.
- Assigned stable canonical IDs such as `dua.hisn.001` while retaining legacy IDs for compatibility.
- Added a deterministic JSON-to-D1 migration generator with SHA-256 source provenance.
- Imported 135 duas as 320 parts and 1,105 Arabic, transliteration, translation, and commentary segments.
- Added migration integrity checks for record counts, relationships, and canonical identity.
- Replaced the API's bundled JSON access with a D1 repository without changing the public dua response format.
- Added automatic D1 migrations before Worker deployment.

### 0.1.1

- Activated Cloudflare DNS while retaining Bluehost as the PWA, email, FTP, and cPanel origin.
- Added infrastructure-as-code custom domains for test and production API environments.
- Connected the test API to `api-test.fortressofmuslim.org`.
- Retained the `workers.dev` address as a diagnostic origin rather than the public platform hostname.

### 0.1.0

- Established the Fortress Platform monorepo alongside the existing PWA.
- Added shared TypeScript and runtime API contracts.
- Added the first Cloudflare Worker API with health, dataset, paginated dua, and canonical-ID endpoints.
- Added an OpenAPI 3.0 specification.
- Added test and production Worker environments.
- Added automated GitHub CI and Cloudflare deployment workflows.
- Deployed and verified the first hosted test API on Cloudflare Workers.
- Marked the current Word-derived content as a legacy import pending canonical editorial verification.

## Local Development

### Admin Console

The Admin Console is a separate static portal backed by authenticated `/v1/admin/*` control-plane routes on the Auth Worker. Administrator authorization is stored in D1 and is never inferred from an email address or browser state. Its Knowledge workspace manages source provenance, citation status, controlled taxonomy, evidence eligibility, and append-only editorial history.

```bash
npm run dev:admin
```

Bootstrap the first administrator only after that person has created a normal developer account. Look up the user's canonical ID, then insert it into `platform_admins` with `super_admin` role using Wrangler. Never hard-code a privileged email or user ID in source. Additional administrators should be granted through an audited admin workflow.

Service Control currently enforces maintenance and disabled states for the Content API. Auth and Admin are recovery services and cannot be disabled from the console. The Bluehost PWA and static portals are displayed as monitoring-only until traffic is moved behind an enforceable Cloudflare Worker gateway.

Run the PWA from the `pwa-website` folder:

```powershell
cd pwa-website
python serve.py
```

Then open:

```text
http://127.0.0.1:8080/
```

Do not rely on opening `index.html` directly for PWA testing. Service workers require HTTPS or localhost.

## Data Model Direction

The PWA currently loads its static source from:

```text
pwa-website/data/duas.json
```

The public API imports that source into Cloudflare D1 as a versioned dataset. Each dua receives a canonical ID, ordered parts, and ordered typed segments. The original `uid` remains available as `legacyId`. All initial records are marked `pending` until canonical editorial review.

Current API storage:

```text
dataset_versions -> content_records -> content_parts -> content_segments
```

This normalized structure supports precise updates, references, categories, moods, tags, and additional content types without placing every dua into Worker memory.

Future data should support:

- stable `uid`
- title
- ordered parts
- Arabic
- transliteration
- translation
- comments
- references
- categories
- moods
- tags
- source notes

## Deployment

The repository uses two main branches:

- `dev` deploys to test: the PWA to Cloudflare (`fortress-pwa-test`) and, as a standby, to Bluehost.
- `main` deploys to production the same way.

Where each domain is served from, and how to move it or move it back, is in `docs/deployment.md` ->
"PWA hosting".

Feature branches should use:

```text
feature/name-of-feature
```

The intended workflow is:

```text
feature branch -> PR -> merge to dev -> test deploy -> promote to main -> production deploy
```

Deployment details and required GitHub secrets are documented in:

```text
docs/deployment.md
```

Canonical data decisions and staged work are documented in:

- `docs/canonical-data-roadmap.md`
- `docs/canonical-editorial-architecture.md`
- `docs/incident-response.md`
- `docs/release-readiness.md`
- `docs/adr/0001-canonical-knowledge-and-snapshots.md`
- `docs/adr/0002-public-read-api.md`
- `docs/adr/0003-evidence-gated-verification.md`
- `docs/adr/0004-operational-response-contract.md`
- `docs/adr/0005-browser-and-deployment-hardening.md`

## Contributing

Contributions are welcome. Helpful areas include:

- improving UI and accessibility
- cleaning dua text
- adding references
- improving search
- improving metadata categories/tags/moods
- reducing memory usage
- testing PWA install/update behavior on Android and iOS
- preparing the future Android app

Before submitting work:

1. Create a feature branch from `dev`.
2. Keep changes focused.
3. Test locally with `python serve.py`.
4. Make sure the PWA version/cache is bumped when changing deployed JS/CSS.
5. Avoid editing generated dua data unless the change is intentional and reviewed.

## Versioning

The visible app version is stamped from Git history during deployment:

```text
pwa-website/tools/stamp_version.py
```

Current approach:

- releases use a sequential three-digit patch style: `1.001`, `1.002`, `1.013`, etc.
- the sequence is derived from the Git commit count.
- major redesign or breaking data changes: `2.0`

The service worker build/cache version is stamped from the current commit SHA. The deploy workflows run the stamping script automatically before publishing to Cloudflare and
uploading to Bluehost.

## Release Notes

### Unreleased — one address

- www.fortressofmuslim.org now takes you to fortressofmuslim.org.

### Unreleased — fix for the test build that would not start

- The previous test build could not start. If the app shows its "could not start" message or stays
  blank, close it fully and open it again, twice if needed, to pick up this fix.

### Unreleased — Cloudflare hosting, prepared

- Every update is now also published on Cloudflare, ready for the site to move there from Bluehost.
  Nothing changes for anyone until it does.

### Unreleased — faster first visit

- A first visit, and the first launch after an update, asks for everything at once and lets
  Cloudflare answer from its own cache, instead of waiting on the server file by file.

### Unreleased — faster launch

- The app now opens straight away from what is saved on your phone, instead of waiting for the
  server first. Updates still arrive in the background and are offered with the update banner.

### Unreleased — the dua reciter is named

- The reader now shows who recites the duas, and the lock screen shows his name while one plays.

### Unreleased — listen to the duas

- Many duas now have a Listen button in the reader. Where the book gives a morning and an evening
  wording, there is one button for each.
- Plays on the lock screen like the Quran recitation. Starting one player pauses the other.
- Settings → Data → Dua recitation saves every recording for offline listening (about 53 MB), and
  it can be cleared on its own under Storage.
- Parts that are guidance rather than words to recite have no recording, by design.

### Unreleased — an Islamic calendar

- Prayer now has a Calendar tab beside Times, Qibla and Tasbih.
- It shows today's Hijri date, the next important date with a countdown, and the year ahead:
  Ramadan, both Eids, the Day of Arafah, the Islamic New Year and Ashura.
- Dates follow the Umm al-Qura calendar, and the screen says your local moon sighting may differ
  by a day.
- Works offline. On a browser without an Islamic calendar it says so rather than guessing.

### Unreleased — shortcuts from the app icon

- Long-press the installed app's icon (or right-click on desktop, where supported) to jump
  straight to Prayer Times, Qibla, Tasbih or the Quran.
- Each shortcut has its own icon, matching the button for that screen inside the app.
- Shortcuts work offline, like the rest of the app.
- Whether the menu appears, and how it looks, depends on the phone or browser.

### Unreleased — see and clear what is saved offline

- Settings > Data shows how much space the app uses, with each saved thing on its own line:
  Quran recitation, Quran text, and the app's own files.
- Recitation and Quran text each have their own Clear. Clearing recitation only removes downloads
  (it still streams online); clearing text means a surah needs a connection next time it opens.
- The app's own files are shown but cannot be cleared, since without them it would not open
  offline.
- The overall total is shown only where the browser can estimate it.

### Unreleased — prayer-card sky progression

- Rebuilt the prayer sky with separate sun and crescent arcs, soft layered rays, changing glow,
  twilight colours, stars and a dark foreground for readable prayer times.
- The display arc follows the clock between local Sunrise, Dhuhr and Maghrib. The crescent shows
  progress through the night; it is decorative rather than a lunar ephemeris. Polar locations
  keep the actual solar-altitude fallback instead of inventing sunrise or sunset.
- Artwork preferences now apply to the sky immediately. Still/reduced motion stop ambient
  effects while clock-derived positions continue updating. Added clock, midnight, polar and
  browser checks, including the live prayer tab's countdown updates.

### Unreleased — dark, continuous, and no flash on the way in

- **Dark mode is the default.** Adhkar are read at dawn and after dark, so the low-light theme is
  the app now and light is the opt-out. Anyone who had already chosen light keeps light.
- **Continuous scroll is the default reading mode**, so a surah reads as one text rather than as
  twenty-ayah slices and the recitation player never has to turn a page to keep going. Every
  existing reader stays on pages: the reading-position tracker has been writing that preference out
  for everyone since long before it was a choice, so the stored value cannot tell a deliberate
  answer from a default and is left alone either way.
- **Tajweed colouring was already on by default** and is unchanged.
- **No white flash on launch.** The theme is settled inline, before the first paint, instead of by
  a deferred module -- which used to paint a light page and snap dark a moment later. That was only
  ever seen by people who had chosen dark; with dark as the default it would have been everyone, on
  every launch. The markup carries the defaults and the inline script only ever takes them away, so
  a device with storage blocked lands on the default for free. `test/boot-theme.test.js` runs that
  script against `state.js` for every stored combination, so the second copy of a default cannot
  drift from the first.

### Unreleased — read the Quran by parah

- The Quran list has two modes: **Surahs** and **Juz (Parah)**. The juz list gives each one its
  range and length -- "Juz 2 - Al-Baqarah 142 - 252 - 111 ayahs" -- and searching it accepts a
  number or the name of any surah inside it. Whichever mode you last used is the one you come back
  to, because people who read by parah read by parah every day.
- Opening a juz lands on its first ayah, not on the first ayah of the surah that contains it. Most
  ajza begin mid-surah, so this is the difference between starting your parah and starting the
  surah it happens to fall in.
- While a juz is open the reader shows which one, with a step to the previous and next juz. The
  strip follows the reading: scrolling or listening past a boundary moves it on, so straight-through
  reading never leaves it pointing at the parah you finished.
- The play button on a juz row recites from its first ayah and keeps going across every surah the
  juz spans -- and past it, the way reading does -- until the end of An-Nas.
- The boundaries are generated and cross-checked against two independent sources, then verified to
  tile all 6,236 ayahs with no gap or overlap. `juz.json` is precached, so browsing by parah works
  offline like the rest of the Quran.

### Unreleased — the compass works however you hold the phone

- The qibla compass reads the phone as a 3D object instead of assuming it is lying flat. Hold it
  flat and it follows the top edge, as a compass does; stand it up in front of you and it follows
  where the phone itself points, and says so. Tilting between the two is seamless, because both
  readings agree wherever both can be read.
- Rolling an upright phone into landscape no longer changes where it thinks you are pointing.
- Each pose has one axis that cannot answer at all -- a flat phone's back points at the ground, an
  upright phone's top edge points at the sky -- so it reads whichever of the two is more
  horizontal, keeping the current one until the other is clearly better so the handover cannot
  chatter. The two axes are perpendicular, so one always keeps at least 76% of itself in the
  horizontal plane: there is no way to hold a phone that leaves nothing to read.
- The maths is the rotation matrix from the W3C DeviceOrientation spec; the upright case is that
  spec's own worked compass example. iOS is folded into the same maths by turning its true-north
  heading back into the angle the rest of the calculation expects, so the upright pose works there
  too rather than only on Android.

### Unreleased — qibla compass, location recovery and a teal splash

- The live compass works, and explains itself when it cannot. Three separate faults: readings with
  no north reference were being used as if they had one; a phone held sideways read 90 degrees off;
  and the dial spun the long way round every time you faced north. It also claimed to be "active"
  over a needle that never moved -- a refused permission only produced a toast that vanished. There
  is now a persistent explanation naming the setting to change, and a retry.
- Getting a location after refusing it once is no longer a dead end. A browser that has been told
  no cannot be asked again from inside the page, so "Allow location" could never succeed and said
  nothing about why. The screen now says where the switch lives, and offers manual coordinates.
- Entering coordinates by hand used to leave the Qibla card and the prayer list hidden: the
  location was saved, the bearing computed, and nothing appeared on screen.
- The install splash stays the app's own off-white. Matching it to the icon's teal was tried and
  reverted: a manifest can only give the splash one flat colour, and the icon's background is a
  gradient, so its corners still drew a visible square against any single colour. Removing the
  gradient would have flattened the icon, which is where its depth comes from.

### Unreleased — install, reset and guide fixes

- Installing is findable again. The Install row in Settings used to be hidden unless the browser
  offered a prompt -- an event that never fires on iOS and never fires again once installed -- so
  on a phone there was nothing to find and nothing explaining why. The row is always there now and
  says which case you are in: an Install button when the browser will prompt, "already installed",
  or where to find it in your browser's own menu. A dismissible banner offers it once when the
  browser says the app is installable.
- Reset this count on the tasbih applies immediately instead of asking first. Deleting a phrase
  still asks, and that dialog no longer labels its confirm button "Reset".
- The first-run guide's Settings step drew its own gear, which looked nothing like the real
  control. It now shows the same glyph the header shows.
- The app icon leaves room for the launcher to crop it. Android shows only the middle ~67% of a
  maskable icon, so a symbol sized to the safe zone filled nearly all of what you could see.

### Unreleased — refined PWA identity

- Replaced the crescent artwork with a consistent gold-and-teal mark with a pointed gateway,
  plus a simplified small favicon. Updated the app header, artwork gallery and UI preview.
- Generated matching install icons, separate maskable icons, Apple touch icon and ICO fallback
  from one SVG source. Versioned icon references across install, media and notifications, and
  precached the icons the app itself shows. The install-only icons are left out of the cache,
  since they would otherwise be re-downloaded on every deploy.

### Unreleased — reading roles, card titles and background recitation

- Duas that are not words to recite no longer pretend to be. Each reading has a role, and the reader
  labels Guidance readings ("What to do here -- there are no set words to recite") and Virtue
  readings instead of showing a `--` transliteration. Narrations that introduce a dua appear as a
  context line. 59 of 268 readings had `--` or English prose where the transliteration belongs.
- Chapter 45's adhan and adhkar readings are back, as Guidance.
- Two translations that stopped mid-sentence are complete: the three characteristics that complete
  faith (108), and counting tasbih on the right hand (131).
- The Advanced home cards have titles, descriptions and reading counts, in the same words as the
  screen each opens. Counts are readings, not chapters: Evening is one chapter of 25 readings.
- Quran recitation keeps playing with the phone locked, with lock-screen controls. The screen stays
  on while playing only when "Follow the recitation" is on.

### Unreleased — richer artwork and animation controls

- Gave Morning, Evening and Travel distinct mosque designs and rebuilt Ruqyah as a complete
  roofed sanctuary with a round pool. Joined Travel's roof and tower pieces; corrected the
  library book's contact with its stand and the night lamp's contact with its table.
- Added saved Optimized, Full and Still animation choices in Appearance settings and the
  gallery. Full includes changing sunlight and scene tones, moving foliage and birds, stars,
  water and lamp flicker. Optimized remains the default; device reduced motion selects Still.
- Generated independent mode files to avoid shared SVG fragment state, removed animation
  declarations from Still files, and cached every mode for offline switching.
- Made the gallery's controller self-contained so opening `art-preview.html` directly from
  disk supports animation switching without a blocked ES module import.
- Sped up artwork motion, shortened Full lighting cycles to 12 seconds and increased water,
  interior light and dust movement so effects are easier to notice at card size.

### 1.025

- Replaced the Advanced home category images with nine original text-free SVG scenes: moonlit
  architecture, a dawn valley, an evening balcony, interiors, an oasis and gardens. Ambient light,
  clouds, stars and reflections animate gently and respect reduced-motion preferences.
- Added an artwork gallery at `art-preview.html`, deterministic source generators and browser
  checks for embedded animation, responsive cards, category navigation and offline artwork.
- Kept the original reference images and optional service-worker caching behavior.
- Measured before shipping: the nine animated SVGs are 117 KB Brotli-compressed against 172 KB for
  the nine static webp images they replace, so the animated set is lighter over the wire despite
  being 714 KB on disk. Bluehost already serves SVG with `content-encoding: br`, verified live.

### 1.024

- Dua categories and moods now come from the curated data only. They were previously inferred by checking whether a keyword appeared anywhere in a dua, body text included, which filed 58% of assignments wrongly: "When wearing a new garment" was a healing recitation because its translation contains the word "refuge".
- Split the 25 duas tagged Ruqyah. Ruqyah now means recitation made over a person, for protection or cure, and holds six. Twelve occasional protection duas move to a new Protection category, and seven inner-hardship ones move to Other, where their Anxious and Sad moods still find them.
- Added an Other category so the 69 duas with no curated category stay browsable rather than being reachable only by search.
- Morning, Evening, Sleep, Salah and Travel were audited and their curated membership was already correct; they were only being polluted by the inference. Morning now correctly holds "When waking up" and the morning and evening adhkar, instead of also offering "Before sleeping".
- Search is unchanged and still matches the full text of every dua.

### 1.023

- Added prayer time notifications: an alert at Fajr, Dhuhr, Asr, Maghrib and Isha, alongside the existing morning and evening adhkar reminders. Sunrise is excluded as it marks the end of Fajr's window rather than a prayer.
- Fixed Cancel doing nothing when adding a Tasbih phrase. The close button defaulted to submitting the form, so the required Label field failed validation and blocked it. There is now a visible Cancel button as well.
- Moved Reset and Add phrase above the Tasbih counter.
- The Tasbih phrase strip had its scrollbar hidden, so with more phrases than fit there was no sign the rest existed and no way to drag to them with a mouse. It now shows a slim scrollbar and fades the trailing edge while there is more to reach.
- The Quran surah list now uses the same search bar as Duas, with the search icon, a Clear action, and matched text highlighted in the results.
- Ayah numbers are drawn inside a ring, as in a printed mushaf.
- Previous and next surah buttons now show the Arabic name alongside the transliteration.
- Removed the Quran source credits from the app at the maintainer's instruction, following confirmation of usage permission.

### 1.022

- Prayer Times, Qibla and Tasbih now sit behind one Prayer tab with a floating bottom bar to switch between them. Adding Quran had made seven top-level tabs, which pushed Qibla and Tasbih past the edge of the bar; they were still reachable by scrolling but gave no sign they were there.
- Fixed the tab bar overflowing on phones. Every tab had a fixed 5.4rem minimum, so five tabs needed 432px inside a 351px bar on a 375px screen and the last two were cut off. Tabs now share the width and stack the icon above a smaller label on narrow screens.
- Fixed the Advanced UI card images staying blank. They are lazy-loaded so Simple UI never pays for them, but a lazy image inside a subtree that was hidden when the page parsed can fail to start loading once that subtree is revealed. Turning on Advanced UI now loads them directly.
- Moved the Quran source and licence credits out from under every surah into Settings > About. CC BY still requires the attribution, so it moved rather than being dropped.

### 1.021

- Settings is now an accordion. Tapping a category expands it in place underneath its own row instead of replacing the whole dialog, so the list stays on screen and the panel reads as part of it. One section opens at a time.
- Added a Quran settings category holding tajweed colouring, reading mode and the offline download, which moved out of Data. Reading mode now defaults to Pages and tajweed to on.
- The Quran reader now behaves like the dua reader: opening a surah hides the tab bar, puts the surah name in the header and turns on the shared back button.
- Replaced the chips above the text with a fixed control strip at the bottom, matching the dua reader: previous and next surah, save, share, and text size.
- Continue reading moved below the search field.

### 1.020

- Saved ayahs can now be found again: the Saved filter lists them with a preview and jumps straight back to the verse. Previously an ayah could be starred but never located, which made the feature close to useless.
- Added previous/next surah in the reader, and swipe between surahs, so reading straight through no longer means returning to the list.
- Added A-/A+ text size controls to the Quran reader, sharing the same scale as the dua reader.
- Saved ayahs now store a short preview. Entries saved in the older format, including those inside older backups, are upgraded automatically.

### 1.019

- Rebuilt Settings as grouped cards. It previously drew a single hairline above each transparent row inside a rounded dialog, leaving dangling lines with no surface behind them and no press feedback; rows now sit on a rounded surface with inset separators that stop at the corners, larger touch targets, and hover/press states.
- Added colour-coded tajweed to the Quran, covering all 17 recitation rules, with a per-reader toggle for plain text.
- Added sajdah (prostration) marks, shown as in a printed mushaf.
- Added favourite surahs, favourite ayahs, and a "Continue reading" card that returns to where you stopped.
- Added a scroll/pages toggle for surah reading, 20 ayahs per page, remembered per reader.
- Added per-ayah copy and share, matching the dua reader.
- Quran favourites, bookmarks and reader preferences are included in Settings backup export/import.

### 1.018

- Added the Quran: all 114 surahs in Arabic with the Saheeh International English translation, searchable by name or number, with each ayah's Arabic and English shown together.
- Surahs download as you open them and stay readable offline; Settings > Data has a one-tap "Download" for the whole Quran. Downloaded surahs are kept in a cache that survives app updates, so a deploy never wipes what you saved.
- Fixed the startup banner being permanently visible. Its inline `display:flex` outranked the browser's `[hidden]{display:none}` rule, so the "app didn't finish loading" panel showed on every load no matter how healthy the app was -- and tapping Reload simply returned to it, which is what made the problem look like a loop.

### 1.017

- The "Reload app" recovery now lands on a one-time `?reset=<timestamp>` URL. Reloading the same URL could still be answered from a cache, so a device that reached the fallback could bounce straight back to it; a URL that has never been requested cannot match any cache entry, in CacheStorage or the browser HTTP cache. The marker is stripped from the address bar once the app is up.
- The fallback now explains itself: an expandable "What went wrong?" panel reports the build the device is actually running, whether it is installed or in a browser, online state, service worker and cache status, and the underlying script errors, with a Copy details button.
- Fixed an unhandled rejection from the background location refresh. It is best-effort polish on top of coordinates already on screen, but a rejection there was visible to the startup watchdog as a failed boot.

### 1.016

- Fixed the app getting stuck on "This app didn't finish loading properly", where tapping Reload looped straight back to the same screen. Only the `js/app.js` entry point was cache-busted; every module it imports was not, and the host serves `/js/` with a 4-hour `max-age` that overrode our `.htaccess` no-cache rule. After a deploy the browser paired a fresh `app.js` with hours-stale modules, so startup threw. Clearing the service worker and its caches (what Reload did) never touched the browser HTTP cache holding those modules, so every reload reproduced it until the cache expired. Every module import is now build-stamped, so a stale module can no longer be paired with a new one.
- The service worker now fetches with `cache: 'reload'` during install, so a stale HTTP-cached file can never be baked into a fresh worker cache and outlive the entry that produced it.
- A failed decorative card image no longer fails the whole service worker install, which previously could strand everyone on the old version.
- The startup watchdog now waits for the app shell rather than the dua data, so a slow connection is no longer mistaken for a broken app.

### 1.015

- Reworked Settings from one long scrolling list into a category list that drills into a subscreen per category (Appearance, Prayer & Qibla, Reminders, Customize Layout, Data, About), with a back button, instead of everything shown at once.
- The Prayer & Qibla settings category now disappears entirely from Settings when both those tabs are disabled via Customize Layout, instead of staying visible with nothing to apply to.
- Morning/Evening adhkar rows now fully hide (not just dim) when the Reminders master toggle is off.
- Added a bootstrap-level fallback that detects when the app fails to finish loading (e.g. right after a broken deploy) and offers a "Reload app" button that clears the service worker and caches for a clean retry -- previously a broken update could leave the app stuck with no way to recover.

### 1.014

- Split the combined Prayer screen into independent Prayer Times and Qibla tabs, sharing the same resolved location.
- Reorganized Settings into categorized sections (Appearance, Prayer & Qibla, Reminders, Customize Layout, Data, About) with a clear dimmed/disabled visual state for toggled-off rows.
- Added a Customize Layout section in Settings letting you enable/disable Hadith, Ask, Prayer Times, Qibla, and Tasbih individually, and choose whether each shows in Simple UI, Advanced UI, or both; Duas always stays available.
- Extended backup export/import and the offline cache manifest to cover the new layout configuration.
- Fixed the live Qibla compass using a non-north-referenced heading on many Android/Chrome devices, causing an inaccurate direction.
- Fixed the Qibla card being hidden in Simple UI; it now always shows there, while the full prayer times list is governed by the new layout config.

### 1.013

- Fixed simple-home category pills so they open the same category/list flow as advanced cards.
- Fixed old UI category pills so filtered content actually changes.
- Simplified Settings backup actions back to compact buttons.
- Replaced Moods and Ruqyah placeholder cards with generated bitmap cards.
- Replaced the app icon/favicon with a cleaner moon-and-star mark.
- Added automatic deployment version stamping.

### 1.012

- Improved Settings backup layout with separate Export and Import rows.
- Added this open-source README.

### 1.011

- Restored Morning and Evening to the advanced bottom navigation.
- Added Moods and Ruqyah as additional bottom navigation items.
- Replaced text placeholders with SVG icons.
- Added Moods and Ruqyah cards to the advanced home.

### 1.010

- Added runtime category, mood, tag, and ruqyah filtering.
- Added smarter search across text and metadata.
- Added title highlighting for search matches.
- Added settings export/import for favourites and settings.
- Added loading skeleton rows.
- Added lazy list rendering with Load more.
- Lazy-loaded advanced UI images.

### 1.00

- Added visible app version in Settings.
- Established dev/test and main/production deployment flow.

## License

License is not finalized yet. Before broad public contribution, add a clear open-source license file.
