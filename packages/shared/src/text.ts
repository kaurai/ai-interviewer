/**
 * Deterministic text helpers shared by the question validator and the lexical
 * retriever. No locale-dependent behavior, randomness, or external models.
 */

/**
 * English function words plus interview boilerplate ("tell me about a time",
 * "how would you") that would otherwise make unrelated questions look similar.
 */
const STOPWORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'been', 'before', 'being', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'doing', 'each', 'even', 'for', 'from', 'had', 'has', 'have', 'having', 'he', 'her', 'here',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'might',
  'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'on', 'once', 'one', 'only', 'or',
  'other', 'our', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
  // interview boilerplate
  'tell', 'time', 'describe', 'walk', 'give', 'example', 'suppose', 'situation', 'please',
  'yourself', 'something', 'someone', 're', 've', 's', 't', 'll', 'd',
]);

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Very small suffix stripper so "orders"/"order" and "queries"/"query" match. */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Content tokens: normalized, stopwords removed, lightly stemmed, in order. */
export function contentTokens(text: string): string[] {
  const normalized = normalizeText(text);
  if (normalized === '') return [];
  return normalized
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

export function tokenSet(text: string): Set<string> {
  return new Set(contentTokens(text));
}

/** Jaccard similarity of two token sets; 0 when both are empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** Jaccard similarity over content tokens of two strings, in [0, 1]. */
export function tokenSimilarity(a: string, b: string): number {
  return jaccard(tokenSet(a), tokenSet(b));
}

/** Whitespace-delimited word count, as a speaker would perceive it. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
