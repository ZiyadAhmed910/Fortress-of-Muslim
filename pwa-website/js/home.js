import { state } from './state.js';
import { els } from './dom.js';
import { escapeHtml } from './utils.js';
import { applyFilters, shouldUseFavouriteFilter } from './filters.js';
import { applySettings, updateAdvancedNavActive } from './settings.js';

let openEntryHandler = () => {};

export function setOpenEntryHandler(handler) {
  openEntryHandler = handler;
}

export function filterList() {
  applyFilters();
  renderList();
}

export function renderList() {
  const label = shouldUseFavouriteFilter() ? 'favourite' : 'dua';
  els.resultCount.textContent = `${state.filtered.length} ${label}${state.filtered.length === 1 ? '' : 's'}`;
  els.favouritesButton.classList.toggle('active', shouldUseFavouriteFilter());
  els.favouritesButton.querySelector('span:last-child').textContent = shouldUseFavouriteFilter() ? 'All duas' : 'Favourites';

  if (!state.filtered.length) {
    els.duaList.innerHTML = `<div class="empty-state">No duas found.</div>`;
    return;
  }

  els.duaList.innerHTML = state.filtered.map((entry, index) => {
    const isFav = state.favourites.has(entry.uid);
    return `
      <div class="dua-row">
        <button class="row-main" data-open="${index}">
          <span class="row-title">${escapeHtml(entry.id)}. ${escapeHtml(entry.title)}</span>
          <span class="row-meta">${entry.parts.length} part${entry.parts.length === 1 ? '' : 's'}</span>
        </button>
        <button class="row-star ${isFav ? 'active' : ''}" data-fav="${entry.uid}" aria-label="Toggle favourite">${isFav ? '★' : '☆'}</button>
      </div>
    `;
  }).join('');

  els.duaList.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => openEntryHandler(Number(button.dataset.open)));
  });
  els.duaList.querySelectorAll('[data-fav]').forEach((button) => {
    button.addEventListener('click', () => toggleFavourite(button.dataset.fav));
  });
}

export function toggleFavourite(uid) {
  if (state.favourites.has(uid)) {
    state.favourites.delete(uid);
  } else {
    state.favourites.add(uid);
  }
  localStorage.setItem('favourites', JSON.stringify([...state.favourites]));
  filterList();
}

export function openAdvancedFilter(filter) {
  state.advancedListMode = true;
  state.advancedFilter = filter;
  state.showFavouritesOnly = filter === 'favourites';
  els.searchInput.value = '';
  applySettings();
  filterList();
  applyAdvancedTitle();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function showAdvancedDashboard() {
  state.advancedListMode = false;
  state.advancedFilter = 'all';
  state.showFavouritesOnly = false;
  els.searchInput.value = '';
  applySettings();
  filterList();
  els.screenTitle.textContent = 'Fortress of Muslim';
  els.screenSubtitle.textContent = 'Supplications and remembrances';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function applyAdvancedTitle() {
  const titleMap = {
    all: 'All Duas',
    morning: 'Morning',
    evening: 'Evening',
    sleep: 'Before Sleep',
    salah: 'Salah',
    travel: 'Travel',
    favourites: 'Favourites',
  };
  els.screenTitle.textContent = titleMap[state.advancedFilter] || 'Fortress of Muslim';
  els.screenSubtitle.textContent = state.advancedFilter === 'all' ? 'All supplications' : 'Filtered supplications';
  updateAdvancedNavActive();
}
