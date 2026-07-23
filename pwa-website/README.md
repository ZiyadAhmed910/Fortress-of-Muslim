# Fortress of Muslim PWA

Responsive offline-first reader backed by Fortress Platform's published canonical dua snapshot.

## Local preview

Run a static server from this folder:

```powershell
python serve.py
```

Then open `http://localhost:8080`.

Service workers require `localhost` or HTTPS, so opening `index.html` directly will not fully test install/offline behavior.

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
