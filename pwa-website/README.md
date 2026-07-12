# Fortress of Muslim PWA

Responsive offline-first PWA for the Fortress of Muslim content extracted from `../Fortress_of_Muslim.docx`.

## Local preview

Run a static server from this folder:

```powershell
python serve.py
```

Then open `http://localhost:8080`.

Service workers require `localhost` or HTTPS, so opening `index.html` directly will not fully test install/offline behavior.

## Current features

- Search across all extracted duas.
- Add/remove favourites and open the favourites list from the center button.
- Detail reader with swipe left/right navigation.
- Full-dua share and copy actions.
- Zoom in/out controls.
- Dark mode and larger Arabic settings.
- PWA manifest and service worker for offline use.
