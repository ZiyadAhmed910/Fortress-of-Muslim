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
You can also open `art-preview.html` directly from disk; its animation controls work with
`file://`. The full PWA still needs the local server because it uses ES modules and data requests.
The Advanced home uses these illustrations from `assets/cards/living/`. Original WebP images
and earlier SVG studies remain available in `assets/cards/`.

The scenes are standalone 1200 × 520 SVGs, with shaded stone and domes, geometric ornament,
foreground plants, layered landscapes, reflections and quiet CSS animation. Each category has
its own composition: a moonlit waterfront, a dawn valley, an evening balcony, a night chamber,
a prayer courtyard, a desert oasis, a library, a garden and a roofed sanctuary with a round pool.

**Settings → Appearance → Artwork animation** offers Optimized (default), Full animation and
Still. The gallery has the same control. Full adds a changing sun glow and scene lighting,
swaying trees, flapping birds, twinkling stars and richer water movement. The choice is saved
locally and included in user backups. A device reduced-motion preference always selects Still
without discarding the saved choice.

| Scene | Optimized movement | Full animation adds |
| --- | --- | --- |
| 01 All Duas | Clouds and crescent drift; stars twinkle; birds glide; mosque/lamps flicker; lake highlights move. | Swaying palm fronds, flapping wings, changing night tones and quicker sky/water cycles. |
| 02 Morning | Sun and clouds drift; birds glide; stream highlights move; entrance light flickers. | Sun brightens and changes colour, warmer scene tones, swaying pine trees and flapping wings. |
| 03 Evening | Crescent/clouds drift; stars twinkle; balcony lantern and mosque lights flicker. | Swaying palms, changing dusk tones and quicker sky cycles. |
| 04 Before Sleep | Lamp flame, glass and reflected light flicker; window stars twinkle. | Slight moon/cloud movement, drifting light beam and dust, changing room illumination. |
| 05 Salah | Two lamps flicker; fountain ripples expand and fade. | Falling fountain droplets, extra ripples, drifting light beam/dust and changing warm illumination. |
| 06 Travel | Sun/clouds drift; birds glide; oasis highlights move; entrance light flickers. | Sun intensity/colour and scene warmth change; palms sway and birds flap. |
| 07 Favourites | Lantern flame/glass/glow and reflected light flicker. | Balcony foliage sways; light beams/dust drift; room warmth changes. |
| 08 Moods | Sun/clouds drift; birds glide; lamps flicker; pool/fountain highlights move. | Sun brightens and changes colour, shifting garden warmth, swaying palms and flapping birds. |
| 09 Ruqyah | Crescent/clouds drift; stars twinkle; sanctuary/lamps flicker; pool and fountain highlights move. | Olive canopy sways, fireflies drift and glow, fountain streams flow and droplets fall, night tones shift. |

Full lighting changes repeat every 12 seconds. Clouds, water and interior light/dust move
more visibly, with offset starting phases so movement is apparent soon after opening a card.
Celestial movement is a gentle looping drift,
not a complete sunrise-to-sunset simulation. Buildings, the book/stand and lamp supports stay
fixed; lamp animation affects the flame and light. Still stops all listed movement.

The generator produces three independent files for each scene: `living/<name>.svg`,
`living/full/<name>.svg` and `living/still/<name>.svg`. Full and Still do not depend on image URL
fragments, whose rendering state can be shared by browsers. Still files have no animation
declarations, including in reflected `<use>` content. All 27 files use the optional cache so
switching animation modes also works offline. Each displayed mode loads just one file per card.

Rebuild and check from the repository root:

```powershell
node pwa-website/tools/build-living-art.mjs
node pwa-website/tools/check-living-art.mjs
```

Edit `tools/living-exteriors.mjs` or `tools/living-interiors.mjs`, then regenerate the SVGs.
This command also refreshes the gallery's inline controller from `js/art-motion.js`; run it
after changing the controller. Do not edit the generated script block in the gallery directly.
The generator uses deterministic geometry and reports both raw and gzip sizes. No runtime
drawing library, external fonts, image requests or JavaScript are needed inside the artwork.
Animations use opacity and transforms and respect the device's reduced-motion preference.
Images keep the existing button accessibility labels and use the optional service-worker cache.
The browser check covers actual mode transitions, still-frame equality, reduced motion,
phone/desktop layouts, category navigation and offline mode switching. Screenshots go to
`.fortress-import/living-art/`.
It uses installed Microsoft Edge on Windows; set `EDGE_EXECUTABLE_PATH` to use another Chromium
executable.

## Current features

- Published canonical Fortress chapters available offline after snapshot generation.
- Each reading has a role -- supplication, framed, instruction or virtue -- and the reader labels
  Guidance and Virtue readings rather than presenting them as words to recite.
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

`data/duas.json` is a committed, hand-maintained snapshot. Validate it with:

```powershell
npm run pwa:data:build
```

Despite the name, this does not fetch anything: `tools/build-canonical-snapshot.mjs` checks the
committed file (schema 4, exactly 132 chapters in sequence, explicitly verified) and fails if it is
not. An earlier version of this README described it downloading from the API; that is no longer
what the code does.

Each entry's `parts` holds its readings and `partRoles` holds one role per reading, in the same
order: `supplication`, `framed`, `instruction` or `virtue`. Segment kinds are `arabic`,
`transliteration`, `translation`, `reference` and `context` (the narration that introduces a framed
reading). The roles and the data changes that came with them were applied once by
`tools/apply-reading-roles.mjs`, which records every judgement and refuses to run if a change would
lose text; `test/reading-roles.test.js` holds them in place. The same roles are on the API's
records (migration `0018`), where a `context` line is a `comment` segment.

When `data/duas.json` changes, bump `DATA_VERSION` in `js/constants.js` and the matching
`duas.json?v=` entry in `sw.js` so installed apps fetch the new file.
