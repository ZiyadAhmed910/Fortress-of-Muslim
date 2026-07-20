# Fortress of Muslim PWA

Responsive offline-first PWA backed by a validated Hisn al-Muslim source corpus.

## Local preview

Run a static server from this folder:

```powershell
python serve.py
```

Then open `http://localhost:8080`.

Service workers require `localhost` or HTTPS, so opening `index.html` directly will not fully test install/offline behavior.

## Current features

- 132 local chapters containing all 268 source recitations, available offline.
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

The approved raw corpus is local-only and ignored by Git. Rebuild the committed PWA artifact with:

```powershell
npm run pwa:data:build
```

The builder fails unless the result contains exactly 132 chapters, 268 source records, stable `dua-001` through `dua-132` identifiers, and the required text and reference segments. Categories and moods are explicit curated chapter mappings rather than guesses from keyword matching.
