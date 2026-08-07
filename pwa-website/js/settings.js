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

// Settings is a category list that drills into one subscreen at a time (Appearance, Prayer &
// Qibla, Reminders, ...) rather than one long flat scroll -- each category's rows live in a
// `[data-settings-panel]` section, hidden until its `[data-settings-open]` row is tapped.
export function initSettingsNav() {
  els.settingsCategoryList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-open]');
    if (!button) return;
    openSettingsCategory(button.dataset.settingsOpen);
  });
  els.settingsBackButton.addEventListener('click', showSettingsCategoryList);
}

function openSettingsCategory(id) {
  const panel = els.settingsPanels.find((section) => section.dataset.settingsPanel === id);
  if (!panel) return;
  els.settingsCategoryList.hidden = true;
  els.settingsPanels.forEach((section) => { section.hidden = section !== panel; });
  els.settingsBackButton.hidden = false;
  els.settingsTitle.textContent = panel.dataset.settingsTitle || 'Settings';
}

// Called both by the back button and whenever Settings is (re)opened, so it never reopens stuck
// on whichever subscreen was last visited.
export function showSettingsCategoryList() {
  els.settingsCategoryList.hidden = false;
  els.settingsPanels.forEach((section) => { section.hidden = true; });
  els.settingsBackButton.hidden = true;
  els.settingsTitle.textContent = 'Settings';
}
