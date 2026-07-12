import { state } from './state.js';
import { els } from './dom.js';
import { APP_VERSION } from './constants.js';

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
