export type TitleCandidate = { id: string; title: string; sequence: number };
export type RankedTitle = TitleCandidate & { score: number };

const stopWords = new Set([
  'a', 'an', 'and', 'dua', 'duas', 'for', 'of', 'on', 'prayer', 'said', 'say',
  'saying', 'supplication', 'the', 'to', 'upon', 'when', 'while', 'with',
]);

export function rankDuaTitles(candidates: TitleCandidate[], query: string, limit = 3): RankedTitle[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const queryTokens = meaningfulTokens(normalizedQuery);

  return candidates
    .map((candidate) => ({ ...candidate, score: titleScore(normalizedQuery, queryTokens, candidate.title) }))
    .filter((candidate) => candidate.score >= 0.42)
    .sort((left, right) => right.score - left.score || left.sequence - right.sequence)
    .slice(0, Math.min(5, Math.max(1, limit)))
    .map((candidate) => ({ ...candidate, score: Math.round(candidate.score * 1000) / 1000 }));
}

function titleScore(query: string, queryTokens: string[], title: string): number {
  const normalizedTitle = normalize(title);
  if (normalizedTitle === query) return 1;
  if (normalizedTitle.includes(query)) return Math.max(0.88, 0.97 - (normalizedTitle.length - query.length) / 200);
  if (query.includes(normalizedTitle)) return 0.9;

  const titleTokens = meaningfulTokens(normalizedTitle);
  const tokenScores = queryTokens.map((queryToken) => titleTokens.reduce(
    (best, titleToken) => Math.max(best, tokenSimilarity(queryToken, titleToken)),
    0,
  ));
  const averageSimilarity = tokenScores.reduce((sum, score) => sum + score, 0) / Math.max(1, tokenScores.length);
  const exactCoverage = tokenScores.filter((score) => score === 1).length / Math.max(1, queryTokens.length);
  const phraseSimilarity = tokenSimilarity(queryTokens.join(' '), titleTokens.join(' '));
  return averageSimilarity * 0.62 + exactCoverage * 0.23 + phraseSimilarity * 0.15;
}

function meaningfulTokens(value: string): string[] {
  const tokens = value.split(' ').filter(Boolean);
  const meaningful = tokens.filter((token) => !stopWords.has(token));
  return meaningful.length ? meaningful : tokens;
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/['\u2019`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length >= 3 && right.startsWith(left)) return 0.92;
  if (right.length >= 3 && left.startsWith(right)) return 0.9;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      previous[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}
