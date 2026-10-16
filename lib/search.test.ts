import { describe, expect, it } from 'vitest'
import { matchesQuery, normalizeForSearch } from './search'

describe('normalizeForSearch', () => {
  it('strips accents and lowercases', () => {
    expect(normalizeForSearch('Beyoncé ÅNGSTRÖM Ñu')).toBe('beyonce angstrom nu')
  })
})

describe('matchesQuery', () => {
  const song = "Don't Stop Me Now · Queen"

  it('matches when every word occurs, in any order', () => {
    expect(matchesQuery(song, 'queen stop')).toBe(true)
    expect(matchesQuery(song, '  stop   now ')).toBe(true)
    expect(matchesQuery(song, 'queen start')).toBe(false)
  })

  it('matches parts of words', () => {
    expect(matchesQuery(song, 'que sto')).toBe(true)
  })

  it('ignores case and accents on both sides', () => {
    expect(matchesQuery('Café del Mar', 'CAFE')).toBe(true)
    expect(matchesQuery('Cafe del Mar', 'café')).toBe(true)
  })

  it('matches everything with an empty or blank query', () => {
    expect(matchesQuery(song, '')).toBe(true)
    expect(matchesQuery(song, '   ')).toBe(true)
    expect(matchesQuery('', '')).toBe(true)
  })
})
