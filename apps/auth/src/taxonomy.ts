// Mirrors pwa-website/js/categories.js's CATEGORY_GROUPS/MOOD_GROUPS keyword lists, so the online
// (editorial-confirmed) taxonomy and the offline PWA's auto-derived tags stay aligned on the same
// vocabulary. This module only *suggests* candidate terms from keyword matches -- an editor must
// still confirm them via the taxonomy assignment endpoint before anything is actually assigned.
// (Keeping the human confirmation step is deliberate: the platform's rule that AI/heuristics never
// originate a religious claim without human verification applies here too.)
export const TAXONOMY_KEYWORD_GROUPS: Record<string, string[]> = {
  morning: ['morning', 'waking', 'sunrise', 'after prayer'],
  evening: ['evening', 'night', 'sunset', 'after asr'],
  sleep: ['sleep', 'bed', 'nightmare', 'dream'],
  salah: ['prayer', 'salah', 'ablution', 'mosque', 'tashahhud', 'prostrat', 'bowing', 'adhan'],
  travel: ['travel', 'traveller', 'journey', 'mount', 'safa', 'marwah', 'arafah', 'muzdalifa'],
  ruqyah: ['illness', 'sick', 'pain', 'devil', 'shaytan', 'protection', 'refuge', 'evil eye', 'magic', 'harm'],
  anxious: ['anxiety', 'distress', 'worry', 'grief', 'sadness', 'hardship', 'difficult', 'calamity'],
  afraid: ['fear', 'afraid', 'enemy', 'danger', 'harm', 'refuge', 'protection'],
  sad: ['grief', 'sadness', 'sorrow', 'distress', 'hardship'],
  grateful: ['praise', 'thanks', 'gratitude', 'blessing', 'favour', 'favor', 'alhamdu', 'hamd'],
  protection: ['protect', 'protection', 'refuge', 'evil', 'devil', 'shaytan', 'harm', 'nightmare'],
};

export function suggestTaxonomySlugs(text: string): string[] {
  const normalized = text.toLowerCase();
  return Object.entries(TAXONOMY_KEYWORD_GROUPS)
    .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))
    .map(([slug]) => slug);
}
