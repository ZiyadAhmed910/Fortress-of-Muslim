import { els } from './dom.js';
import { escapeHtml } from './utils.js';

export const TASBIH_STORAGE_KEY = 'fortress_tasbih';
const STORAGE_KEY = TASBIH_STORAGE_KEY;
const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
const SWIPE_DISTANCE_THRESHOLD = 56;

const DEFAULT_PRESETS = [
  { id: 'subhanallah', label: 'SubhanAllah', labelArabic: 'سُبْحَانَ اللَّه', count: 0, target: 33 },
  { id: 'alhamdulillah', label: 'Alhamdulillah', labelArabic: 'الْحَمْدُ لِلَّه', count: 0, target: 33 },
  { id: 'allahuakbar', label: 'Allahu Akbar', labelArabic: 'اللَّهُ أَكْبَر', count: 0, target: 34 },
];
const DEFAULT_PRESET_IDS = new Set(DEFAULT_PRESETS.map((preset) => preset.id));

let data = loadData();
let pendingConfirmAction = null;

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && Array.isArray(parsed.presets) && parsed.presets.length > 0) {
      return {
        presets: parsed.presets,
        activePresetId: parsed.activePresetId || parsed.presets[0].id,
        totalLifetimeCount: Number(parsed.totalLifetimeCount) || 0,
      };
    }
  } catch {
    // fall through to defaults -- a corrupted/unreadable value shouldn't break the counter
  }
  return { presets: DEFAULT_PRESETS.map((preset) => ({ ...preset })), activePresetId: 'subhanallah', totalLifetimeCount: 0 };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function activePreset() {
  return data.presets.find((preset) => preset.id === data.activePresetId) || data.presets[0];
}

export function initTasbih() {
  els.tasbihTapArea.addEventListener('click', increment);

  let touchStartX = 0;
  let touchStartY = 0;
  els.tasbihTapArea.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0].clientX;
    touchStartY = event.changedTouches[0].clientY;
  }, { passive: true });
  els.tasbihTapArea.addEventListener('touchend', (event) => {
    const dx = event.changedTouches[0].clientX - touchStartX;
    const dy = event.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > SWIPE_DISTANCE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.35) {
      event.preventDefault(); // a swipe switches phrases -- suppress the synthetic click that would otherwise also increment
      switchPreset(dx < 0 ? 1 : -1);
    }
  }, { passive: false });

  els.tasbihResetButton.addEventListener('click', () => {
    pendingConfirmAction = 'reset';
    els.tasbihResetConfirmDialog.querySelector('p').textContent = `Reset "${activePreset().label}" back to 0? This can't be undone.`;
    els.tasbihResetConfirmDialog.showModal();
  });
  // Reacts on the form's own submit event (fires synchronously on the click that submits it)
  // rather than the dialog's close event -- functionally equivalent for a real click, but doesn't
  // depend on <dialog>'s close-event indirection, which some automated/embedded browser contexts
  // don't fire reliably for a programmatically-triggered method="dialog" submission.
  els.tasbihResetConfirmDialog.querySelector('form').addEventListener('submit', (event) => {
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    if (event.submitter?.value !== 'confirm') return;
    if (action === 'reset') {
      activePreset().count = 0;
      persist();
      renderCount();
    } else if (action === 'delete') {
      deleteActivePreset();
    }
  });

  els.tasbihAddPresetButton.addEventListener('click', () => {
    els.tasbihPresetForm.reset();
    els.tasbihPresetForm.querySelector('[name="target"]').value = '33';
    els.tasbihPresetDialog.showModal();
  });
  els.tasbihPresetForm.addEventListener('submit', (event) => {
    if (event.submitter?.value !== 'save') return;
    const form = new FormData(els.tasbihPresetForm);
    const label = String(form.get('label') || '').trim();
    if (!label) return;
    const labelArabic = String(form.get('labelArabic') || '').trim();
    const target = Math.max(1, Math.min(9999, Math.round(Number(form.get('target')) || 33)));
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    data.presets.push({ id, label, labelArabic, count: 0, target });
    data.activePresetId = id;
    persist();
    renderAll();
  });

  els.tasbihDeletePresetButton.addEventListener('click', () => {
    const preset = activePreset();
    if (!preset || DEFAULT_PRESET_IDS.has(preset.id)) return;
    pendingConfirmAction = 'delete';
    els.tasbihResetConfirmDialog.querySelector('p').textContent = `Delete "${preset.label}"? This can't be undone.`;
    els.tasbihResetConfirmDialog.showModal();
  });

  renderAll();
}

export function activateTasbih() {
  data = loadData(); // pick up anything a backup import changed while this tab wasn't active
  renderAll();
}

function deleteActivePreset() {
  data.presets = data.presets.filter((preset) => preset.id !== data.activePresetId);
  if (data.presets.length === 0) data.presets = DEFAULT_PRESETS.map((preset) => ({ ...preset }));
  data.activePresetId = data.presets[0].id;
  persist();
  renderAll();
}

function switchPreset(direction) {
  const ids = data.presets.map((preset) => preset.id);
  const currentIndex = ids.indexOf(data.activePresetId);
  const nextIndex = (currentIndex + direction + ids.length) % ids.length;
  data.activePresetId = ids[nextIndex];
  persist();
  renderAll();
}

// Deliberately never resets or auto-advances at the target -- crossing it just marks the ring/tap
// area as "reached" (visually and with a distinct haptic pulse) while the count keeps going up.
// Simpler and less surprising than a lap counter nobody asked for; the person doing dhikr decides
// when to reset for a fresh set via the Reset button.
function increment() {
  const preset = activePreset();
  if (!preset) return;
  const justReachedTarget = preset.count + 1 === preset.target;
  preset.count += 1;
  data.totalLifetimeCount += 1;
  persist();
  renderCount();
  vibrate(justReachedTarget ? [15, 45, 15] : 10);
}

function vibrate(pattern) {
  if (!navigator.vibrate) return; // iOS Safari has no Vibration API -- silently skip, never error
  try { navigator.vibrate(pattern); } catch { /* some browsers throw outside a user gesture; harmless to ignore */ }
}

function renderAll() {
  renderPresetTabs();
  renderPresetDetails();
  renderCount();
}

function renderPresetTabs() {
  els.tasbihPresetTabs.innerHTML = data.presets.map((preset) => `
    <button class="tasbih-preset-tab${preset.id === data.activePresetId ? ' active' : ''}" data-preset-tab="${escapeHtml(preset.id)}" type="button">${escapeHtml(preset.label)}</button>
  `).join('');
  els.tasbihPresetTabs.querySelectorAll('[data-preset-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      data.activePresetId = button.dataset.presetTab;
      persist();
      renderAll();
    });
  });
}

function renderPresetDetails() {
  const preset = activePreset();
  if (!preset) return;
  els.tasbihLabel.textContent = preset.label;
  els.tasbihArabicLabel.textContent = preset.labelArabic || '';
  els.tasbihArabicLabel.hidden = !preset.labelArabic;
  els.tasbihDeletePresetButton.hidden = DEFAULT_PRESET_IDS.has(preset.id);
}

function renderCount() {
  const preset = activePreset();
  if (!preset) return;
  els.tasbihCount.textContent = String(preset.count);
  els.tasbihTarget.textContent = `/ ${preset.target}`;
  const progress = preset.target > 0 ? Math.min(1, preset.count / preset.target) : 0;
  els.tasbihRingFill.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  els.tasbihRingFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
  els.tasbihTapArea.classList.toggle('tasbih-target-reached', preset.target > 0 && preset.count >= preset.target);
  els.tasbihLifetime.textContent = `${data.totalLifetimeCount.toLocaleString()} total taps across all phrases`;
}
