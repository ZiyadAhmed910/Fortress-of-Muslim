// Some Ask users already know the exact reference they want (e.g. "Bukhari 52") rather than a
// natural-language question -- for those, full RAG retrieval (embeddings + lexical + synonym
// expansion) is slower and less precise than a direct collection+number lookup. This module only
// recognizes questions that are essentially just a reference on their own; anything with extra
// words around a number falls through to normal retrieval instead of risking a wrong fast-path
// match on an ordinary question that happens to contain a number.
const REFERENCE_PATTERN = /^(?:hadith\s+)?([a-z][a-z .'’-]{1,40}?)[\s,:#-]+(?:no\.?\s*|number\s*|#\s*)?(\d{1,5})$/i;

export type ExactHadithReference = { collectionHint: string; number: string };

export function parseExactHadithReference(question: string): ExactHadithReference | null {
  const match = REFERENCE_PATTERN.exec(question.trim());
  if (!match) return null;
  const collectionHint = match[1]!.trim();
  const number = match[2]!;
  if (collectionHint.length < 3) return null;
  return { collectionHint, number };
}
