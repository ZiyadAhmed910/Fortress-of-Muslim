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
  ['talbiyah', 'talbiya'],
  ['tashahhud', 'tashahud', 'attahiyat'],
  ['istikharah', 'istikhara', 'guidance prayer'],
  ['taraweeh', 'tarawih', 'taraweh'],
  ['iftar', 'iftaar', 'breaking the fast'],
  ['suhoor', 'suhur', 'sahur', 'sahoor', 'pre-dawn meal'],
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
