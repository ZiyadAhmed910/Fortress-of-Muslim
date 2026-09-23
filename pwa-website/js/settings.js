import { state } from './state.js';
import { els } from './dom.js';
import { APP_VERSION } from './constants.js';
import { syncPrayerSettingsControls } from './prayer.js';
import { syncReminderControls } from './reminders.js';
import { applyArtMotion, initArtMotion } from './art-motion.js';
import {
  CACHES,
  clearCache,
  estimateTotal,
  formatBytes,
  measureCache,
  shellCacheName,
  storageSupported,
} from './storage.js';
import { escapeHtml, toast } from './utils.js';

export function applySettings() {
  els.appVersion.textContent = `Version ${APP_VERSION}`;
  document.documentElement.classList.toggle('dark', state.darkMode);
  document.documentElement.classList.toggle('large-arabic', state.largeArabic);
  document.documentElement.classList.toggle('advanced-ui', state.advancedUi);
  // The card artwork only exists in the Advanced home, so its motion setting is hidden in Simple UI
  // rather than offered as a control that visibly does nothing -- the same rule the other settings
  // for switched-off features follow.
  if (els.artMotionRow) els.artMotionRow.hidden = !state.advancedUi;
  document.documentElement.classList.toggle('advanced-list', state.advancedListMode);
  document.documentElement.style.setProperty('--font-scale', state.fontScale.toFixed(2));
  document.querySelector('meta[name="theme-color"]').setAttribute('content', state.darkMode || state.advancedUi ? '#071827' : '#f3f3f0');
  els.darkModeToggle.checked = state.darkMode;
  els.arabicSizeToggle.checked = state.largeArabic;
  els.advancedUiToggle.checked = state.advancedUi;
  applyArtMotion();
  ensureAdvancedCardsLoad();
  syncPrayerSettingsControls();
  syncReminderControls();
  updateAdvancedNavActive();
}

// The advanced home's card images are loading="lazy" so Simple UI users never pay for them. But a
// lazy image inside a subtree that was hidden at parse time can fail to start loading when that
// subtree is later revealed, which leaves the advanced home showing empty card frames. Once Advanced
// UI is actually on the images are certain to be wanted, so the hint is dropped and any that never
// started are re-kicked by reassigning src.
function ensureAdvancedCardsLoad() {
  if (!state.advancedUi) return;
  els.homeView.querySelectorAll('.advanced-home img[loading="lazy"]').forEach((image) => {
    image.loading = 'eager';
    if (!image.complete || image.naturalWidth === 0) {
      const { src } = image;
      image.src = '';
      image.src = src;
    }
  });
}

export function updateAdvancedNavActive() {
  els.homeView.querySelectorAll('.advanced-bottom-nav button').forEach((button) => {
    const isHome = button.hasAttribute('data-advanced-home') && !state.advancedListMode;
    const isFilter = button.dataset.advancedFilter && state.advancedListMode && button.dataset.advancedFilter === state.advancedFilter;
    button.classList.toggle('active', Boolean(isHome || isFilter));
  });
}

export function setFontScale(value) {
  state.fontScale = Math.min(1.9, Math.max(0.82, value));
  localStorage.setItem('fontScale', String(state.fontScale));
  applySettings();
}

// Settings is an accordion: each category expands in place under its own row, so the list stays on
// screen and the panel reads as part of it. The previous drill-down swapped the entire dialog for a
// single panel, which lost the reader's position in the list on every change of section.
export function initSettingsNav() {
  initArtMotion({
    select: els.artMotionSelect,
    description: els.artMotionDescription,
    systemNote: els.artMotionSystemNote,
  });
  els.settingsCategoryList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-toggle]');
    if (button) toggleSettingsCategory(button);
  });
  els.storageList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-clear-cache]');
    if (button) clearStoredCache(button.dataset.clearCache);
  });
}

/**
 * Measures what is stored and lists it, each cache on its own line.
 *
 * Run when the Data panel is opened rather than at startup: walking a cache that holds thousands
 * of ayahs is not free, and nobody needs the number until they are looking at it.
 */
async function refreshStorage() {
  if (!els.storageList) return;
  if (!storageSupported()) {
    els.storageSection.hidden = true;
    return;
  }
  els.storageList.innerHTML = '<p class="storage-note">Measuring&hellip;</p>';

  const [total, shellName, ...measured] = await Promise.all([
    estimateTotal(),
    shellCacheName(),
    ...CACHES.map((cache) => measureCache(cache.name)),
  ]);
  const shell = shellName ? await measureCache(shellName) : { entries: 0, bytes: 0 };

  // Shown only when the browser can say it. An absent figure is better than one that might be wrong,
  // and the per-cache lines below do not depend on it.
  els.storageTotal.textContent = total
    ? `${formatBytes(total.usage)} used${total.quota ? ` of ${formatBytes(total.quota)} available` : ''}`
    : 'Space used by what this app has saved.';

  const rows = CACHES.map((cache, index) => {
    const { entries, bytes } = measured[index];
    const empty = entries === 0;
    return `
      <div class="storage-row">
        <span>
          <strong>${escapeHtml(cache.label)}</strong>
          <small>${empty ? 'Nothing saved' : `${formatBytes(bytes)} &middot; ${entries} file${entries === 1 ? '' : 's'}`}</small>
          <small class="storage-detail">${escapeHtml(cache.detail)}</small>
        </span>
        <button class="small-action-button secondary" type="button" data-clear-cache="${escapeHtml(cache.name)}"
          ${empty ? 'disabled' : ''} aria-label="Clear ${escapeHtml(cache.label.toLowerCase())}">Clear</button>
      </div>`;
  });
  rows.push(`
      <div class="storage-row">
        <span>
          <strong>App files</strong>
          <small>${formatBytes(shell.bytes)} &middot; ${shell.entries} file${shell.entries === 1 ? '' : 's'}</small>
          <small class="storage-detail">What the app needs to open without a connection. Replaced automatically on each update, so it cannot be cleared here.</small>
        </span>
      </div>`);
  els.storageList.innerHTML = rows.join('');
}

async function clearStoredCache(name) {
  const cache = CACHES.find((entry) => entry.name === name);
  if (!cache) return;
  if (!window.confirm(`Clear ${cache.label.toLowerCase()}? ${cache.detail}`)) return;
  try {
    await clearCache(name);
    toast(`${cache.label} cleared.`);
  } catch {
    toast(`Could not clear ${cache.label.toLowerCase()}.`);
  }
  refreshStorage();
}

function toggleSettingsCategory(button) {
  const group = button.closest('.settings-group');
  const panel = group.querySelector('.settings-panel');
  const open = button.getAttribute('aria-expanded') === 'true';
  // One section at a time: the dialog is short on a phone, and several open panels push the rest of
  // the list off screen, which is the problem the accordion is meant to avoid.
  if (!open) collapseAllSettings();
  button.setAttribute('aria-expanded', String(!open));
  group.classList.toggle('is-open', !open);
  panel.hidden = open;
  if (!open && button.dataset.settingsToggle === 'data') refreshStorage();
}

function collapseAllSettings() {
  els.settingsCategoryList.querySelectorAll('[data-settings-toggle]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
    button.closest('.settings-group').classList.remove('is-open');
    button.closest('.settings-group').querySelector('.settings-panel').hidden = true;
  });
}

// Called whenever Settings is opened so it never reopens mid-section.
export function showSettingsCategoryList() {
  collapseAllSettings();
}
