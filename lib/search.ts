// Free-text matching for the search boxes (playlist picker, song lists). Pure
// and client-safe.

/** Decomposes, strips combining marks and lowercases, so "Beyoncé" matches "beyonce". */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * True when every whitespace-separated word of `query` occurs somewhere in
 * `haystack`, case- and accent-insensitive. An empty query matches everything.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = normalizeForSearch(haystack)
  return words.every((w) => text.includes(w))
}
