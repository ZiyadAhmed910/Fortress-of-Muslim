// Categories and moods are curated per dua in data/duas.json and are NOT inferred from the text.
//
// They used to be derived by testing whether a keyword appeared anywhere in the dua, body text
// included. Because almost every supplication contains "I seek refuge" or "praise be to Allah",
// that filed 58% of assignments wrongly -- "When wearing a new garment" became a healing recitation
// on the strength of the word "refuge". Terms are gone entirely; the labels below are presentation
// only, and membership comes from the data.
export const CATEGORY_GROUPS = {
  all: {
    label: 'All',
    description: 'Complete dua library',
  },
  morning: {
    label: 'Morning',
    description: 'Morning and waking remembrances',
  },
  evening: {
    label: 'Evening',
    description: 'Evening remembrances',
  },
  sleep: {
    label: 'Sleep',
    description: 'Before sleep and night protection',
  },
  salah: {
    label: 'Salah',
    description: 'Prayer, mosque, and ablution',
  },
  travel: {
    label: 'Travel',
    description: 'Travel, pilgrimage, and journeys',
  },
  protection: {
    label: 'Protection',
    description: 'Seeking refuge from harm, fear, and evil',
  },
  ruqyah: {
    label: 'Ruqyah',
    description: 'Recitation over a person for protection or cure',
  },
  other: {
    label: 'Other',
    description: 'Everything else in the collection',
  },
};

export const MOOD_GROUPS = {
  anxious: {
    label: 'Anxious',
    description: 'Duas for worry, distress, and difficult moments',
  },
  afraid: {
    label: 'Afraid',
    description: 'Duas for fear, danger, and seeking refuge',
  },
  sad: {
    label: 'Sad',
    description: 'Duas for grief, sorrow, and hardship',
  },
  grateful: {
    label: 'Grateful',
    description: 'Duas for praise, thanks, and gratitude',
  },
  protection: {
    label: 'Protection',
    description: 'Duas for protection from harm and evil',
  },
};

export const QUICK_FILTERS = ['all', 'morning', 'evening', 'sleep', 'salah', 'travel', 'protection', 'ruqyah', 'other'];
export const DEFAULT_MOOD = 'anxious';

export function enrichEntry(entry) {
  const curated = entry.categories || [];
  // Anything the curators have not placed is browsable under Other rather than being unreachable.
  const categories = ['all', ...(curated.length ? curated : ['other'])];
  const moods = [...(entry.moods || [])];
  const tags = [...new Set([...(entry.tags || []), ...categories, ...moods, ...tokenTags(entry.title)])];
  // Body text still feeds SEARCH -- that is what search is for. It just no longer decides categories.
  const searchText = normalizeSearch(`${buildSearchText(entry)} ${categories.join(' ')} ${moods.join(' ')} ${tags.join(' ')}`);

  return { ...entry, categories, moods, tags, searchText };
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

// Shown as a count badge on each category/mood chip so someone can see how much is inside before
// tapping in -- discoverability that a bare label doesn't give, especially for a lightly-populated
// group like a mood that only matches a handful of entries.
export function countByGroup(entries, group) {
  return entries.filter((entry) => filterEntryByGroup(entry, group)).length;
}

export function countByMood(entries, mood) {
  return entries.filter((entry) => filterEntryByMood(entry, mood)).length;
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


function tokenTags(title) {
  return String(title)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3)
    .slice(0, 6);
}
