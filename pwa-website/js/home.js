import { state } from './state.js';
import { els } from './dom.js';
import { escapeHtml } from './utils.js';
import { applyFilters, shouldUseFavouriteFilter } from './filters.js';
import { applySettings, updateAdvancedNavActive } from './settings.js';
import { CATEGORY_GROUPS, DEFAULT_MOOD, MOOD_GROUPS, QUICK_FILTERS, groupLabel, normalizeSearch } from './categories.js';

let openEntryHandler = () => {};

export function setOpenEntryHandler(handler) {
  openEntryHandler = handler;
}

export function filterList() {
  state.visibleCount = 36;
  applyFilters();
  renderList();
}

export function renderList() {
  renderFilterControls();
  const label = shouldUseFavouriteFilter() ? 'favourite' : 'dua';
  const visibleEntries = state.filtered.slice(0, state.visibleCount);
  els.resultCount.textContent = `${state.filtered.length} ${label}${state.filtered.length === 1 ? '' : 's'}`;
  els.favouritesButton.classList.toggle('active', shouldUseFavouriteFilter());
  els.favouritesButton.querySelector('span:last-child').textContent = shouldUseFavouriteFilter() ? 'All duas' : 'Favourites';

  if (!state.filtered.length) {
    els.duaList.innerHTML = `<div class="empty-state">No duas found.</div>`;
    els.loadMoreButton.hidden = true;
    return;
  }

  els.duaList.innerHTML = visibleEntries.map((entry, index) => {
    const isFav = state.favourites.has(entry.uid);
    return `
      <div class="dua-row">
        <button class="row-main" data-open="${index}">
          <span class="row-title">${escapeHtml(entry.id)}. ${highlightMatch(entry.title)}</span>
          <span class="row-meta">${escapeHtml(rowMeta(entry))}</span>
        </button>
        <button class="row-star ${isFav ? 'active' : ''}" data-fav="${entry.uid}" aria-label="Toggle favourite">${isFav ? '&#9733;' : '&#9734;'}</button>
      </div>
    `;
  }).join('');
  els.loadMoreButton.hidden = state.visibleCount >= state.filtered.length;
  els.loadMoreButton.textContent = `Load more (${state.filtered.length - visibleEntries.length})`;

  els.duaList.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => openEntryHandler(Number(button.dataset.open)));
  });
  els.duaList.querySelectorAll('[data-fav]').forEach((button) => {
    button.addEventListener('click', () => toggleFavourite(button.dataset.fav));
  });
}

export function renderFilterControls() {
  els.categoryChips.innerHTML = [
    ...QUICK_FILTERS.map((key) => filterButton(key, CATEGORY_GROUPS[key].label)),
    filterButton('moods', 'Moods'),
  ].join('');

  els.moodPanel.hidden = activeGroup() !== 'moods';
  els.moodChips.innerHTML = Object.entries(MOOD_GROUPS).map(([key, group]) => {
    const active = state.activeMood === key;
    return `<button class="filter-chip ${active ? 'active' : ''}" data-mood-filter="${key}" type="button">${escapeHtml(group.label)}</button>`;
  }).join('');

  els.categoryChips.querySelectorAll('[data-quick-filter]').forEach((button) => {
    button.addEventListener('click', () => setQuickFilter(button.dataset.quickFilter));
  });
  els.moodChips.querySelectorAll('[data-mood-filter]').forEach((button) => {
    button.addEventListener('click', () => setMoodFilter(button.dataset.moodFilter));
  });
}

export function setQuickFilter(filter) {
  if (filter === 'all') {
    showAdvancedDashboard();
    return;
  }
  openAdvancedFilter(filter);
}

export function setMoodFilter(mood) {
  state.activeMood = mood;
  filterList();
}

export function showMoreResults() {
  state.visibleCount += 36;
  renderList();
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
  state.activeQuickFilter = 'all';
  state.activeMood = filter === 'moods' ? (state.activeMood || DEFAULT_MOOD) : '';
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
  state.activeQuickFilter = 'all';
  state.activeMood = '';
  els.searchInput.value = '';
  applySettings();
  filterList();
  els.screenTitle.textContent = 'Fortress of Muslim';
  els.screenSubtitle.textContent = 'Supplications and remembrances';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function applyAdvancedTitle() {
  els.screenTitle.textContent = groupLabel(state.advancedFilter);
  els.screenSubtitle.textContent = subtitleForFilter(state.advancedFilter);
  updateAdvancedNavActive();
}

function activeGroup() {
  return state.advancedListMode ? state.advancedFilter : state.activeQuickFilter;
}

function filterButton(key, label) {
  const active = activeGroup() === key;
  return `<button class="filter-chip ${active ? 'active' : ''}" data-quick-filter="${key}" type="button">${escapeHtml(label)}</button>`;
}

function rowMeta(entry) {
  const category = entry.categories.find((key) => key !== 'all');
  const mood = entry.moods[0];
  const chips = [category ? groupLabel(category) : '', mood ? groupLabel(mood) : ''].filter(Boolean);
  const suffix = chips.length ? ` - ${chips.join(' / ')}` : '';
  return `${entry.parts.length} part${entry.parts.length === 1 ? '' : 's'}${suffix}`;
}

function highlightMatch(value) {
  const raw = String(value);
  const query = normalizeSearch(els.searchInput.value);
  if (!query) return escapeHtml(raw);

  const lower = normalizeSearch(raw);
  const index = lower.indexOf(query);
  if (index < 0) return escapeHtml(raw);

  return [
    escapeHtml(raw.slice(0, index)),
    `<mark>${escapeHtml(raw.slice(index, index + query.length))}</mark>`,
    escapeHtml(raw.slice(index + query.length)),
  ].join('');
}

function subtitleForFilter(filter) {
  if (filter === 'all') return 'All supplications';
  if (filter === 'moods') return state.activeMood ? `${groupLabel(state.activeMood)} duas` : 'Duas by feeling';
  if (filter === 'ruqyah') return 'Protection and healing';
  return CATEGORY_GROUPS[filter]?.description || 'Filtered supplications';
}
