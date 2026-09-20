/**
 * Which kind of source a question is asking for, read from the question itself.
 *
 * "find tawakkul in the Quran" wants verses. "what did the Prophet say about intentions" wants
 * hadith. "dua for entering the toilet" wants a supplication. Retrieval scores cannot see any of
 * that -- they see topical similarity, and on a common theme the 14,357 hadith outnumber everything
 * else regardless of what was actually asked for.
 *
 * This is a preference, never a filter. The scope dropdown is the filter: it excludes. An intent
 * read out of wording only reorders, because wording is a hint and a wrong guess must not be able
 * to hide the answer. "Dua for patience" leans dua and still shows the verse that answers it.
 */
export type AskIntent = 'dua' | 'hadith' | 'quran' | null;

/**
 * Phrases that name a kind of source. Matched on word boundaries: "sunnah" must not fire inside
 * "sunnahs of the day" -- it should -- while "dua" must not fire inside "graduation".
 */
const INTENT_PATTERNS: Array<[AskIntent, RegExp]> = [
  ['quran', /\b(qur'?an(ic)?|koran|ayah?|ayat|surah?|soorah|verse(s)?|mushaf)\b/i],
  ['hadith', /\b(hadith|hadeeth|ahadith|sunnah|narrat(ed|ion)|bukhari|muslim|tirmidhi|prophet\s+(said|say|says)|messenger\s+(said|say|says))\b/i],
  ['dua', /\b(du'?as?|duaa|supplication(s)?|invocation(s)?|adhkar|azkar|dhikr|what\s+(do|should)\s+i\s+(say|recite))\b/i],
];

/**
 * Reads a source preference out of a question, or null when it names none.
 *
 * Returns null when the question points at more than one kind -- "what does the Quran and the
 * Sunnah say" is a request for both, and picking one of them would be a worse answer than picking
 * neither.
 */
export function detectAskIntent(question: string): AskIntent {
  const matched = INTENT_PATTERNS.filter(([, pattern]) => pattern.test(question)).map(([intent]) => intent);
  return matched.length === 1 ? matched[0]! : null;
}
