// Query building and result matching for GetSongBPM. Pure functions, no I/O.
//
// The bias throughout: a miss is better than a confident wrong number. A miss
// can be fixed by dragging the track into a stage; a wrong BPM silently puts it
// in the wrong one.

/** NFKC, typographic quotes and dashes folded to ASCII, whitespace collapsed. */
export function cleanText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// Words that mark a variant with the same tempo as the original recording.
const TEMPO_PRESERVING =
  /\b(remaster(ed)?|version|edit|mono|stereo|feat\.?|ft\.?|with|from|bonus|deluxe|explicit|live)\b/i

// Words that mark a variant whose tempo may differ. Never stripped: inheriting
// the original's BPM would be wrong, and a miss is the honest answer.
const TEMPO_CHANGING = /\b(re)?mix(es|ed)?\b|\bsped up\b|\bslowed\b|\bnightcore\b/i

function strippable(text: string): boolean {
  return TEMPO_PRESERVING.test(text) && !TEMPO_CHANGING.test(text)
}

/** Cuts a " - …" suffix such as " - Remastered 2011", if it only names a same-tempo variant. */
function cutSuffix(title: string): string {
  const at = title.indexOf(' - ')
  if (at <= 0) return title
  return strippable(title.slice(at + 3)) ? title.slice(0, at) : title
}

/** Drops "( … )" / "[ … ]" groups that only name a same-tempo variant. */
function stripGroups(title: string): string {
  return title
    .replace(/\s*[([]([^()[\]]*)[)\]]/g, (group, inner: string) => (strippable(inner) ? '' : group))
    .replace(/\s+/g, ' ')
    .trim()
}

/** The title variant matched against results: same-tempo decorations removed. */
export function baseTitle(title: string): string {
  return stripGroups(cutSuffix(cleanText(title)))
}

/**
 * Titles to search for, in order — at most two. The second keeps the
 * parentheticals, for catalogue entries that include e.g. "(feat. …)".
 * No title-only fallback: common titles return dozens of wrong artists.
 */
export function searchTitles(title: string): string[] {
  const first = baseTitle(title)
  const second = cutSuffix(cleanText(title))
  return first === second ? [first] : [first, second]
}

/** Lookup string for GetSongBPM's `type=both` search. */
export function lookupQuery(artist: string, title: string): string {
  return `song:${title} artist:${cleanText(artist)}`
}

/**
 * Comparison key: lowercase, accents stripped (the server ignores them, so we
 * must too), "&" as "and", punctuation dropped, no leading "the".
 */
export function matchKey(s: string): string {
  return cleanText(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/['.]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '')
}

export interface Candidate {
  id: string
  title: string
  artist: string
  tempo: string
}

export interface Match {
  bpm: number
  match: { id: string; title: string; artist: string }
}

const MIN_BPM = 40
const MAX_BPM = 250
// Passing candidates whose tempos differ by more than this are a conflict.
const AGREEMENT_BPM = 3

function parseTempo(tempo: string): number | null {
  const bpm = Number(tempo)
  return tempo.trim() !== '' && Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : null
}

function artistMatches(wanted: string, candidate: string): boolean {
  const w = matchKey(wanted)
  const c = matchKey(candidate)
  // Whole-word containment covers "Queen & David Bowie" for "Queen".
  return w !== '' && (c === w || ` ${c} `.includes(` ${w} `))
}

function titleMatches(wanted: string, candidate: string): boolean {
  const w = matchKey(baseTitle(wanted))
  return w !== '' && w === matchKey(baseTitle(candidate))
}

function agrees(a: number, b: number): boolean {
  // Half/double-time duplicates are the same song counted differently.
  return Math.abs(a - b) <= AGREEMENT_BPM || a === 2 * b || b === 2 * a
}

/**
 * Picks the BPM from search results, or null when nothing is trustworthy:
 * a candidate must match both artist and title, carry a plausible tempo, and
 * agree with every other passing candidate.
 */
export function pickMatch(artist: string, title: string, candidates: Candidate[]): Match | null {
  const passing: Match[] = []
  for (const c of candidates) {
    const bpm = parseTempo(c.tempo)
    if (bpm === null || !artistMatches(artist, c.artist) || !titleMatches(title, c.title)) continue
    passing.push({ bpm, match: { id: c.id, title: c.title, artist: c.artist } })
  }
  if (passing.length === 0) return null
  const conflict = passing.some((a) => passing.some((b) => !agrees(a.bpm, b.bpm)))
  return conflict ? null : passing[0]
}
