import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_GROUPS, MOOD_GROUPS, QUICK_FILTERS, enrichEntry, filterEntryByGroup, filterEntryByMood } from '../js/categories.js';

const duas = JSON.parse(readFileSync(resolve(process.cwd(), 'data/duas.json'), 'utf8')).entries;
const enriched = duas.map(enrichEntry);
const byId = (id) => enriched.find((e) => e.id === id);

// The regression this file exists for: categories used to be inferred by testing whether a keyword
// appeared anywhere in a dua, body text included. Because nearly every supplication contains
// "I seek refuge" or "praise be to Allah", 58% of assignments were wrong -- "When wearing a new
// garment" was filed as a healing recitation on the strength of one word in its translation.
describe('categories come from curated data, never from the text', () => {
  it('never assigns a category the curator did not set', () => {
    for (const entry of enriched) {
      const curated = duas.find((d) => d.id === entry.id).categories || [];
      const assigned = entry.categories.filter((c) => c !== 'all' && c !== 'other');
      expect(assigned.sort(), `dua ${entry.id} (${entry.title})`).toEqual([...curated].sort());
    }
  });

  it('does not put "When wearing a new garment" in Ruqyah', () => {
    const garment = byId(3);
    expect(garment.categories).not.toContain('ruqyah');
    expect(garment.categories).not.toContain('protection');
  });

  it('keeps Ruqyah to recitation made over a person', () => {
    const ruqyah = enriched.filter((e) => e.categories.includes('ruqyah')).map((e) => e.id).sort((a, b) => a - b);
    expect(ruqyah).toEqual([45, 48, 49, 51, 124, 125]);
  });

  it('serves the morning reminder only genuine morning adhkar', () => {
    const morning = enriched.filter((e) => e.categories.includes('morning')).map((e) => e.id).sort((a, b) => a - b);
    expect(morning).toEqual([1, 27]);
    // "Before sleeping" used to appear here, which is what a Fajr notification opened.
    expect(byId(28).categories).not.toContain('morning');
  });

  it('files everything uncategorised under Other rather than losing it', () => {
    for (const entry of enriched) {
      expect(entry.categories.length, `dua ${entry.id} has no category`).toBeGreaterThan(1); // 'all' plus one
    }
    const other = enriched.filter((e) => e.categories.includes('other'));
    expect(other.length).toBeGreaterThan(0);
    for (const entry of other) {
      expect(duas.find((d) => d.id === entry.id).categories || []).toHaveLength(0);
    }
  });

  it('reaches every dua through at least one chip', () => {
    const reachable = new Set();
    for (const group of QUICK_FILTERS) {
      enriched.filter((e) => filterEntryByGroup(e, group)).forEach((e) => reachable.add(e.id));
    }
    expect(reachable.size).toBe(duas.length);
  });

  it('offers a chip for every category that has members', () => {
    for (const entry of enriched) {
      for (const category of entry.categories) {
        if (category === 'all') continue;
        expect(QUICK_FILTERS, `no chip for "${category}"`).toContain(category);
        expect(CATEGORY_GROUPS[category], `no label for "${category}"`).toBeTruthy();
      }
    }
  });

  it('has no keyword term lists left to match against', () => {
    for (const group of Object.values({ ...CATEGORY_GROUPS, ...MOOD_GROUPS })) {
      expect(group).not.toHaveProperty('terms');
    }
  });
});

describe('moods', () => {
  it('never assigns a mood the curator did not set', () => {
    for (const entry of enriched) {
      const curated = duas.find((d) => d.id === entry.id).moods || [];
      expect([...entry.moods].sort(), `dua ${entry.id}`).toEqual([...curated].sort());
    }
  });

  it('keeps Grateful to occasions of thanks, not every dua containing "praise"', () => {
    const grateful = enriched.filter((e) => e.moods.includes('grateful'));
    // It held 47 when derived from the word "praise"; the curated set is far smaller.
    expect(grateful.length).toBeLessThan(20);
    expect(grateful.map((e) => e.id)).not.toContain(3);
  });

  it('has a label for every mood in use', () => {
    for (const entry of enriched) {
      for (const mood of entry.moods) expect(MOOD_GROUPS[mood], `no label for "${mood}"`).toBeTruthy();
    }
  });

  it('filters by mood', () => {
    const anxious = enriched.filter((e) => filterEntryByMood(e, 'anxious'));
    expect(anxious.length).toBeGreaterThan(0);
    expect(anxious.every((e) => e.moods.includes('anxious'))).toBe(true);
  });
});

describe('search', () => {
  it('still indexes body text, which is what search is for', () => {
    // "protection" appears in many translations and used to force those duas into Ruqyah. It is
    // still searchable; it just no longer decides anything.
    const hits = enriched.filter((e) => e.searchText.includes('protection'));
    expect(hits.length).toBeGreaterThan(10);
    // Dua 3's translation reads "I seek Your protection from its evil" -- the exact phrase that
    // used to file a clothing dua as a healing recitation.
    expect(hits.map((e) => e.id)).toContain(3);
    expect(byId(3).searchText).toContain('clothed');
  });

  it('indexes the title', () => {
    expect(byId(3).searchText).toContain('garment');
  });
});
