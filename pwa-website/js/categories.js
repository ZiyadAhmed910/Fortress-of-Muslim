export const CATEGORY_GROUPS = {
  all: {
    label: 'All',
    terms: [],
    description: 'Complete dua library',
  },
  morning: {
    label: 'Morning',
    terms: ['morning', 'waking', 'sunrise', 'after prayer'],
    description: 'Morning and waking remembrances',
  },
  evening: {
    label: 'Evening',
    terms: ['evening', 'night', 'sunset', 'after asr'],
    description: 'Evening and night remembrances',
  },
  sleep: {
    label: 'Sleep',
    terms: ['sleep', 'bed', 'nightmare', 'dream'],
    description: 'Before sleep and night protection',
  },
  salah: {
    label: 'Salah',
    terms: ['prayer', 'salah', 'ablution', 'mosque', 'tashahhud', 'prostrat', 'bowing', 'adhan'],
    description: 'Prayer, mosque, and ablution',
  },
  travel: {
    label: 'Travel',
    terms: ['travel', 'traveller', 'journey', 'mount', 'safa', 'marwah', 'arafah', 'muzdalifa'],
    description: 'Travel, pilgrimage, and journeys',
  },
  ruqyah: {
    label: 'Ruqyah',
    terms: ['illness', 'sick', 'pain', 'devil', 'shaytan', 'protection', 'refuge', 'evil eye', 'magic', 'harm'],
    description: 'Protection and healing recitations',
  },
};

export const MOOD_GROUPS = {
  anxious: {
    label: 'Anxious',
    terms: ['anxiety', 'distress', 'worry', 'grief', 'sadness', 'hardship', 'difficult', 'calamity'],
  },
  afraid: {
    label: 'Afraid',
    terms: ['fear', 'afraid', 'enemy', 'danger', 'harm', 'refuge', 'protection'],
  },
  sad: {
    label: 'Sad',
    terms: ['grief', 'sadness', 'sorrow', 'distress', 'hardship'],
  },
  grateful: {
    label: 'Grateful',
    terms: ['praise', 'thanks', 'gratitude', 'blessing', 'favour', 'favor', 'alhamdu', 'hamd'],
  },
  protection: {
    label: 'Protection',
    terms: ['protect', 'protection', 'refuge', 'evil', 'devil', 'shaytan', 'harm', 'nightmare'],
  },
};

export const QUICK_FILTERS = ['all', 'morning', 'evening', 'sleep', 'salah', 'travel', 'ruqyah'];
export const DEFAULT_MOOD = 'anxious';

export function enrichEntry(entry) {
  const baseSearchText = buildSearchText(entry);
  const derivedCategories = Object.entries(CATEGORY_GROUPS)
    .filter(([key, group]) => key === 'all' || matchesTerms(baseSearchText, group.terms))
    .map(([key]) => key);
  const derivedMoods = Object.entries(MOOD_GROUPS)
    .filter(([, group]) => matchesTerms(baseSearchText, group.terms))
    .map(([key]) => key);
  const categories = [...new Set(['all', ...(entry.categories || []), ...derivedCategories])];
  const moods = [...new Set([...(entry.moods || []), ...derivedMoods])];
  const tags = [...new Set([...(entry.tags || []), ...categories, ...moods, ...tokenTags(entry.title)])];
  const searchText = normalizeSearch(`${baseSearchText} ${categories.join(' ')} ${moods.join(' ')} ${tags.join(' ')}`);

  return {
    ...entry,
    categories,
    moods,
    tags,
    searchText,
  };
}

export function filterEntryByGroup(entry, group) {
  if (!group || group === 'all') return true;
  if (group === 'moods') return entry.moods.length > 0;
  if (group === 'favourites') return true;
  return entry.categories.includes(group);
}

export function filterEntryByMood(entry, mood) {
  if (!mood) return true;
  return entry.moods.includes(mood);
}

export function groupLabel(group) {
  if (group === 'all') return 'All Duas';
  if (CATEGORY_GROUPS[group]) return CATEGORY_GROUPS[group].label;
  if (MOOD_GROUPS[group]) return MOOD_GROUPS[group].label;
  if (group === 'moods') return 'Moods';
  if (group === 'favourites') return 'Favourites';
  return 'All Duas';
}

export function normalizeSearch(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchText(entry) {
  const body = entry.parts
    .flat()
    .map((segment) => segment.text)
    .join(' ');
  const metadata = [
    entry.title,
    entry.id,
    ...(entry.categories || []),
    ...(entry.moods || []),
    ...(entry.tags || []),
  ].join(' ');

  return normalizeSearch(`${metadata} ${body}`);
}

function matchesTerms(text, terms) {
  return terms.some((term) => text.includes(normalizeSearch(term)));
}

function tokenTags(title) {
  return String(title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3)
    .slice(0, 6);
}
