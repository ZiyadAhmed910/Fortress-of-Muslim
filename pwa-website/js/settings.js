import { state } from './state.js';
import { els } from './dom.js';
import { APP_VERSION } from './constants.js';
import { syncPrayerSettingsControls } from './prayer.js';
import { syncReminderControls } from './reminders.js';

export function applySettings() {
  els.appVersion.textContent = `Version ${APP_VERSION}`;
  document.documentElement.classList.toggle('dark', state.darkMode);
  document.documentElement.classList.toggle('large-arabic', state.largeArabic);
  document.documentElement.classList.toggle('advanced-ui', state.advancedUi);
  document.documentElement.classList.toggle('advanced-list', state.advancedListMode);
  document.documentElement.style.setProperty('--font-scale', state.fontScale.toFixed(2));
  document.querySelector('meta[name="theme-color"]').setAttribute('content', state.darkMode || state.advancedUi ? '#071827' : '#f3f3f0');
  els.darkModeToggle.checked = state.darkMode;
  els.arabicSizeToggle.checked = state.largeArabic;
  els.advancedUiToggle.checked = state.advancedUi;
  syncPrayerSettingsControls();
  syncReminderControls();
  updateAdvancedNavActive();
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
  els.settingsCategoryList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-toggle]');
    if (button) toggleSettingsCategory(button);
  });
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
