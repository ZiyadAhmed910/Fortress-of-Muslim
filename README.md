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

- Offline-first PWA with manifest and service worker.
- Responsive mobile-first interface.
- Simple UI by default.
- Optional advanced graphical UI.
- Home list with category pills.
- Advanced home cards for all duas, morning, evening, sleep, salah, travel, favourites, moods, and ruqyah.
- Advanced bottom navigation with Home, Favourites, Morning, Evening, Moods, and Ruqyah.
- Search across titles, dua text, Arabic/transliteration/translation content, derived categories, moods, and tags.
- Highlighted title matches in search results.
- Favourites saved locally in the browser.
- Favourites-only view.
- Detail reader with part navigation.
- Swipe support in the reader.
- Copy and share full dua text.
- Zoom in/out reading controls.
- Dark mode.
- Larger Arabic text option.
- Settings backup export/import for favourites and settings.
- Lightweight loading skeleton.
- Lazy list rendering with Load more.
- Lazy-loaded advanced card images.
- Version display in Settings.
- Install prompt and update banner support.

## Project Structure

```text
.
├── apps/
│   └── api/              Cloudflare Worker public API
├── packages/
│   └── contracts/        Shared runtime schemas and TypeScript types
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

Current hosted test API:

```text
https://fortress-platform-api-test.ziyadahmed910.workers.dev
```

Useful verification endpoints:

```text
/health
/v1
/v1/datasets/current
/v1/duas?limit=2
```

The test API uses the `dev` branch and the production API uses `main`. Cloudflare deployment remains disabled until the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is set to `true` and the required account secrets are configured. Setup is documented in `docs/cloudflare-setup.md`.

Every platform release must:

1. Update the platform release notes in this README.
2. Pass `npm run check` and the Cloudflare Worker bundle check.
3. Deploy to the test environment from `dev`.
4. Be verified through its live health and version endpoints.
5. Deploy to production from `main` only after test verification.

## Platform Releases

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

The current dua data is loaded from:

```text
pwa-website/data/duas.json
```

Runtime metadata is currently derived without changing the JSON. This lets the UI support categories, moods, ruqyah filtering, and tag-search now while keeping the door open for cleaner curated data later.

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

- `dev` deploys to the Bluehost test site.
- `main` deploys to production.

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

The service worker build/cache version is stamped from the current commit SHA. The deploy workflows run the stamping script automatically before uploading to Bluehost.

## Release Notes

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
