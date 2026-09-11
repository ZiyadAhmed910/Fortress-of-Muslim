const ART_MOTION_STORAGE_KEY = 'artMotion';
const DEFAULT_ART_MOTION = 'optimized';
const ART_MOTION_DESCRIPTIONS = {
  optimized: 'Gentle light and limited movement, balanced for everyday devices.',
  full: 'Richer skies, drifting clouds and extra movement for more capable devices.',
  still: 'Keep every illustration still for the lightest experience.',
};

let preference = readArtMotionStorage();
let initialized = false;
let controls = {};
const reducedMotion = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

function normalizeArtMotion(value) {
  return typeof value === 'string' && Object.hasOwn(ART_MOTION_DESCRIPTIONS, value)
    ? value
    : DEFAULT_ART_MOTION;
}

function readArtMotionStorage() {
  try {
    return normalizeArtMotion(localStorage.getItem(ART_MOTION_STORAGE_KEY));
  } catch {
    return DEFAULT_ART_MOTION;
  }
}

export function getArtMotionPreference() {
  return preference;
}

export function setArtMotionPreference(value) {
  preference = normalizeArtMotion(value);
  try {
    localStorage.setItem(ART_MOTION_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable in private or restricted contexts. Keep the choice for this visit.
  }
  applyArtMotion();
}

export function applyArtMotion() {
  const mode = reducedMotion?.matches ? 'still' : preference;
  document.querySelectorAll('img[data-living-art]').forEach((image) => {
    const source = image.getAttribute('src');
    if (!source) return;
    // Each mode has its own self-contained file, so neither browser image caches nor service
    // workers can accidentally retain the previous mode's animation state.
    const base = source.split(/[?#]/)[0].replace(/\/living\/(?:full|still)\//, '/living/');
    const query = new URL(source, document.baseURI).searchParams;
    query.delete('art-motion'); // Discard the previous fragment-based controller's cache key.
    const modePath = mode === 'optimized' ? base : base.replace('/living/', `/living/${mode}/`);
    const nextSource = `${modePath}${query.size ? `?${query}` : ''}`;
    if (source !== nextSource) image.setAttribute('src', nextSource);
    // Full-scene links in the gallery should open the mode the visitor is actually viewing.
    const figure = image.closest('figure');
    figure?.querySelectorAll('a[href*="/living/"]').forEach((link) => link.setAttribute('href', nextSource));
  });
  if (controls.select) controls.select.value = preference;
  if (controls.description) controls.description.textContent = ART_MOTION_DESCRIPTIONS[preference];
  if (controls.systemNote) controls.systemNote.hidden = !reducedMotion?.matches;
}

// Settings calls this after the module-driven app has parsed the DOM. The gallery can use the
// same controller without importing the rest of the PWA or duplicating persistence behavior.
export function initArtMotion({
  select = document.getElementById('artMotion'),
  description = document.getElementById('artMotionDescription'),
  systemNote = document.getElementById('artMotionSystemNote'),
} = {}) {
  if (initialized) return;
  initialized = true;
  controls = { select, description, systemNote };
  select?.addEventListener('change', () => setArtMotionPreference(select.value));
  if (reducedMotion?.addEventListener) {
    reducedMotion.addEventListener('change', applyArtMotion);
  } else {
    reducedMotion?.addListener?.(applyArtMotion);
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== ART_MOTION_STORAGE_KEY && event.key !== null) return;
    preference = readArtMotionStorage();
    applyArtMotion();
  });
  applyArtMotion();
}
