import { state } from './state.js';
import { els } from './dom.js';
import { loadDuas } from './data.js';
import { applySettings, setFontScale } from './settings.js';
import { filterList, openAdvancedFilter, setOpenEntryHandler, showAdvancedDashboard, showMoreResults, toggleFavourite } from './home.js';
import {
  bindSwipe,
  copyCurrentEntry,
  currentEntry,
  nextPart,
  openEntry,
  previousPart,
  renderReader,
  shareCurrentEntry,
  showHome,
} from './reader.js';
import { applyWaitingUpdate, promptInstall, setupInstallPrompt, setupServiceWorker } from './pwa.js';
import { exportUserData, importUserDataFile } from './userData.js';
import { initAssistant } from './assistant.js';
import { initHadith } from './hadith.js';
import { initContentModes } from './modes.js';
import { initPrayer } from './prayer.js';
import { initReminders, openAdhkarFromNotification } from './reminders.js';
import { openCanonicalRoute } from './routes.js';

init();

async function init() {
  setOpenEntryHandler(openEntry);
  applySettings();
  bindEvents();
  initHadith();
  initAssistant();
  initPrayer();
  initReminders();
  initContentModes();
  renderLoadingSkeleton();

  try {
    const data = await loadDuas();
    state.entries = data.entries;
    state.filtered = state.entries;
    filterList();
    await openCanonicalRoute();
    openAdhkarFromNotificationUrl();
  } catch (error) {
    els.resultCount.textContent = 'Content did not load';
    els.duaList.innerHTML = `
      <div class="empty-state">
        Could not load the dua data. Start the local server from the pwa-website folder and refresh this page.
      </div>
    `;
    console.error(error);
  }

  setupServiceWorker();
  window.addEventListener('popstate', () => openCanonicalRoute());
}

function openAdhkarFromNotificationUrl() {
  const category = new URLSearchParams(location.search).get('adhkar');
  if (!category) return;
  openAdhkarFromNotification(category);
  history.replaceState(null, '', location.pathname);
}

function renderLoadingSkeleton() {
  els.duaList.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton-row" aria-hidden="true"></div>').join('');
}

function bindEvents() {
  setupInstallPrompt();

  els.installButton.addEventListener('click', promptInstall);
  els.exportDataButton.addEventListener('click', exportUserData);
  els.importDataButton.addEventListener('click', () => els.importDataInput.click());
  els.importDataInput.addEventListener('change', () => {
    importUserDataFile(els.importDataInput.files[0]);
    els.importDataInput.value = '';
  });
  els.updateButton.addEventListener('click', applyWaitingUpdate);
  els.dismissUpdateButton.addEventListener('click', () => {
    els.updateBanner.classList.remove('visible');
  });

  els.searchInput.addEventListener('input', filterList);
  els.clearSearchButton.addEventListener('click', () => {
    els.searchInput.value = '';
    filterList();
  });
  els.loadMoreButton.addEventListener('click', showMoreResults);

  els.favouritesButton.addEventListener('click', () => {
    if (state.advancedUi && !state.advancedListMode && !els.app.classList.contains('is-reader')) {
      openAdvancedFilter('favourites');
      return;
    }
    state.showFavouritesOnly = !state.showFavouritesOnly;
    filterList();
  });

  els.backButton.addEventListener('click', showHome);
  els.settingsButton.addEventListener('click', () => els.settingsDialog.showModal());
  els.darkModeToggle.addEventListener('change', () => {
    state.darkMode = els.darkModeToggle.checked;
    localStorage.setItem('darkMode', String(state.darkMode));
    applySettings();
  });
  els.arabicSizeToggle.addEventListener('change', () => {
    state.largeArabic = els.arabicSizeToggle.checked;
    localStorage.setItem('largeArabic', String(state.largeArabic));
    applySettings();
  });
  els.advancedUiToggle.addEventListener('change', () => {
    state.advancedUi = els.advancedUiToggle.checked;
    state.advancedListMode = false;
    state.advancedFilter = 'all';
    state.activeQuickFilter = 'all';
    state.activeMood = '';
    state.showFavouritesOnly = false;
    els.searchInput.value = '';
    localStorage.setItem('advancedUi', String(state.advancedUi));
    applySettings();
    filterList();
  });

  els.homeView.querySelectorAll('[data-advanced-filter]').forEach((button) => {
    button.addEventListener('click', () => openAdvancedFilter(button.dataset.advancedFilter));
  });
  els.homeView.querySelectorAll('[data-advanced-home]').forEach((button) => {
    button.addEventListener('click', showAdvancedDashboard);
  });

  els.readerFavouriteButton.addEventListener('click', () => {
    toggleFavourite(currentEntry().uid);
    renderReader();
  });
  els.previousButton.addEventListener('click', previousPart);
  els.nextButton.addEventListener('click', nextPart);
  els.shareButton.addEventListener('click', shareCurrentEntry);
  els.copyButton.addEventListener('click', copyCurrentEntry);
  els.zoomInButton.addEventListener('click', () => setFontScale(state.fontScale + 0.12));
  els.zoomOutButton.addEventListener('click', () => setFontScale(state.fontScale - 0.12));

  bindSwipe();

  document.addEventListener('keydown', (event) => {
    if (!els.app.classList.contains('is-reader')) return;
    if (event.key === 'ArrowRight') previousPart();
    if (event.key === 'ArrowLeft') nextPart();
    if (event.key === 'Escape') showHome();
  });
}
