import { state } from './state.js';
import { els } from './dom.js';
import { filterEntryByGroup, filterEntryByMood, normalizeSearch } from './categories.js';

export function shouldUseFavouriteFilter() {
  return state.showFavouritesOnly || (state.advancedUi && state.advancedListMode && state.advancedFilter === 'favourites');
}

export function advancedCategoryPass(entry) {
  const activeGroup = state.advancedListMode ? state.advancedFilter : state.activeQuickFilter;
  const groupPass = filterEntryByGroup(entry, activeGroup);
  const moodPass = activeGroup === 'moods' ? filterEntryByMood(entry, state.activeMood) : true;
  return groupPass && moodPass;
}

export function applyFilters() {
  const query = normalizeSearch(els.searchInput.value);
  state.filtered = state.entries.filter((entry) => {
    const favouritePass = shouldUseFavouriteFilter() ? state.favourites.has(entry.uid) : true;
    const categoryPass = advancedCategoryPass(entry);
    const searchPass = !query || entry.searchText.includes(query);
    return favouritePass && categoryPass && searchPass;
  });
}
