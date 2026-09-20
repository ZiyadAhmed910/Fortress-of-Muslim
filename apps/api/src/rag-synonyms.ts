// Curated aliases for Islamic/Hadith terms with more than one common transliteration or English
// rendering (siwak/miswak, wudu/wudhu, ...), so a search using one spelling still finds content
// written with another. Deliberately not exhaustive: this grows as real search gaps get reported,
// rather than trying to enumerate every transliteration variant up front. Each inner array is one
// concept -- if the question contains any member, every other member gets appended to the query
// used for retrieval (lexical FTS and embedding), never to the question shown to the generation
// model or the user.
const SYNONYM_GROUPS: string[][] = [
  ['siwak', 'miswak', 'miswaak', 'tooth stick', 'toothstick'],
  ['dua', "du'a", 'duaa', 'supplication', 'invocation'],
  ['ruqyah', 'ruqya', 'incantation', 'spiritual healing'],
  ['adhan', 'azan', 'athan', 'call to prayer'],
  ['iqamah', 'iqama', 'iqaamah'],
  ['wudu', 'wudhu', 'wuduu', 'ablution'],
  ['ghusl', 'ghusul', 'ritual bath', 'full ablution'],
  ['tayammum', 'tayammom', 'dry ablution', 'dust ablution'],
  ['witr', 'witr prayer', 'odd-numbered prayer'],
  ['zakat', 'zakah', 'zakaat', 'almsgiving'],
  ['sunnah', 'sunna', 'sunnat'],
  ['istighfar', 'astaghfirullah', 'seeking forgiveness'],
  // The words themselves, because the group is otherwise unreachable: "talbiya" is a substring of
  // "talbiyah", so expansion excluded it as already present and the group added nothing at all.
  ['talbiyah', 'talbiya', 'labbayk', 'here I am'],
  ['tashahhud', 'tashahud', 'attahiyat'],
  ['istikharah', 'istikhara', 'guidance prayer'],
  ['taraweeh', 'tarawih', 'taraweh'],
  ['iftar', 'iftaar', 'breaking the fast'],
  ['suhoor', 'suhur', 'sahur', 'sahoor', 'pre-dawn meal'],
  // Thematic Quran search brought a second kind of gap. The first groups above are spelling
  // variants of a practice; these are concepts people name in Arabic and that scripture renders
  // only in English. Measured against the live corpus: "reliance upon Allah" returns 8:49, 27:79
  // and 33:3 at 0.99, and "tawakkul" -- the same question, the word a person is far more likely to
  // type -- returned nothing at all, because the transliteration sits nowhere near the English in
  // embedding space and appears in no translation for the lexical half to find.
  // Matched on the bare concept words as well as the full phrases. "Reliance upon Allah" is how the
  // translation renders it, "reliance on Allah" is how a person types it, and matching only the
  // former meant the question that motivated this whole group expanded to nothing -- and returned
  // five verses of Surah Ash-Shu'ara at 0.02 instead of 64:13 and 9:51.
  ['tawakkul', 'reliance', 'rely', 'reliance upon Allah', 'trust in Allah', 'put their trust'],
  ['sabr', 'patience', 'perseverance', 'steadfastness'],
  ['taqwa', 'god-consciousness', 'piety', 'fear of Allah'],
  ['shukr', 'gratitude', 'thankfulness', 'giving thanks'],
  ['rizq', 'provision', 'sustenance', 'livelihood'],
  ['tawbah', 'tawba', 'repentance', 'turning in repentance'],
  ['dhikr', 'zikr', 'remembrance of Allah'],
  ['sadaqah', 'sadaqa', 'charity'],
  ['jannah', 'paradise', 'the gardens'],
  ['jahannam', 'hellfire', 'the fire of hell'],
  ['qadar', 'divine decree', 'predestination'],
  ['ilm', 'knowledge', 'seeking knowledge'],
  ['rahmah', 'mercy', 'compassion'],
];

export function expandRetrievalQuery(question: string): string {
  const normalized = question.toLowerCase();
  const additions = new Set<string>();
  for (const group of SYNONYM_GROUPS) {
    if (group.some((term) => normalized.includes(term))) {
      for (const term of group) {
        if (!normalized.includes(term)) additions.add(term);
      }
    }
  }
  return additions.size ? `${question} ${[...additions].join(' ')}` : question;
}
