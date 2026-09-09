# Fortress of Muslim PWA

Responsive offline-first reader backed by Fortress Platform's published canonical dua snapshot.

## Local preview

Run a static server from this folder:

```powershell
python serve.py
```

Then open `http://localhost:8080`.

Service workers require `localhost` or HTTPS, so opening `index.html` directly will not fully test install/offline behavior.

## Living card artwork

Open `http://localhost:8080/art-preview.html` to review all nine animated, text-free banners.
The Advanced home uses these illustrations from `assets/cards/living/`. Original WebP images
and earlier SVG studies remain available in `assets/cards/`.

The scenes are standalone 1200 × 520 SVGs, with shaded stone and domes, geometric ornament,
foreground plants, layered landscapes, reflections and quiet CSS animation. Each category has
its own composition: a moonlit waterfront, a dawn valley, an evening balcony, a night chamber,
a prayer courtyard, a desert oasis, a library, a garden and an arched sanctuary.

Rebuild and check from the repository root:

```powershell
node pwa-website/tools/build-living-art.mjs
node pwa-website/tools/check-living-art.mjs
```

Edit `tools/living-exteriors.mjs` or `tools/living-interiors.mjs`, then regenerate the SVGs.
The generator uses deterministic geometry and reports both raw and gzip sizes. No runtime
drawing library, external fonts, image requests or JavaScript are needed inside the artwork.
Animations use opacity and transforms and respect the device's reduced-motion preference.
Images keep the existing button accessibility labels and use the optional service-worker cache.
The browser check covers embedded animation, reduced motion, phone/desktop layouts, category
navigation and offline image loading. Screenshots go to `.fortress-import/living-art/`.
It uses installed Microsoft Edge on Windows; set `EDGE_EXECUTABLE_PATH` to use another Chromium
executable.

## Current features

- Published canonical Fortress chapters available offline after snapshot generation.
- Search across Arabic, transliteration, translation, categories, tags, and moods.
- Add/remove favourites and open the favourites list from the center button.
- Detail reader with swipe left/right navigation.
- Full-dua share and copy actions.
- Zoom in/out controls.
- Dark mode and larger Arabic settings.
- Online Hadith browse and full-text search powered by the Fortress API.
- Online source-grounded Ask mode powered by Workers AI and Vectorize.
- PWA manifest and service worker for offline use.

Hadith and Ask are intentionally online-only. The service worker never caches API responses; only Fortress duas and the app shell are stored on the device.

## Local data build

Rebuild the committed PWA artifact from the public test API with:

```powershell
npm run pwa:data:build
```

Set `FORTRESS_API_URL` to use another Fortress environment. The builder follows pagination, retrieves each complete published dua, and writes the active canonical dataset ID, verification state, revision numbers, and Fortress URLs. Editorial candidates are not accessible to the builder and cannot enter the offline snapshot.
