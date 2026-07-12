import { state } from './state.js';
import { els } from './dom.js';

export function shouldUseFavouriteFilter() {
  return state.showFavouritesOnly || (state.advancedUi && state.advancedListMode && state.advancedFilter === 'favourites');
}

export function advancedCategoryPass(entry) {
  if (!state.advancedUi || !state.advancedListMode) return true;
  if (state.advancedFilter === 'all' || state.advancedFilter === 'favourites') return true;

  const haystack = `${entry.title} ${entry.searchText}`.toLowerCase();
  const categoryTerms = {
    morning: ['morning'],
    evening: ['evening'],
    sleep: ['sleep', 'night', 'bed'],
    salah: ['prayer', 'salah', 'ablution', 'mosque', 'tashahhud', 'prostrat', 'bowing'],
    travel: ['travel', 'traveller', 'journey', 'mount', 'safa', 'marwah', 'arafah', 'muzdalifa'],
  };

  return (categoryTerms[state.advancedFilter] || []).some((term) => haystack.includes(term));
}

export function applyFilters() {
  const query = els.searchInput.value.trim().toLowerCase();
  state.filtered = state.entries.filter((entry) => {
    const favouritePass = shouldUseFavouriteFilter() ? state.favourites.has(entry.uid) : true;
    const categoryPass = advancedCategoryPass(entry);
    const searchPass = !query || entry.searchText.includes(query);
    return favouritePass && categoryPass && searchPass;
  });
}
