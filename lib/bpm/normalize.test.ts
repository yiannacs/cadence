import { describe, expect, it } from 'vitest'
import { baseTitle, cleanText, lookupQuery, matchKey, pickMatch, searchTitles, type Candidate } from './normalize'

function candidate(title: string, artist: string, tempo: string, id = 'x'): Candidate {
  return { id, title, artist, tempo }
}

describe('cleanText', () => {
  it('folds curly quotes and dashes and collapses whitespace', () => {
    expect(cleanText('Don’t  Stop “Me” – Now — ')).toBe('Don\'t Stop "Me" - Now -')
  })

  it('applies NFKC', () => {
    expect(cleanText('ﬁre Ｓong')).toBe('fire Song')
  })
})

describe('baseTitle', () => {
  it('cuts a remaster suffix', () => {
    expect(baseTitle("Don't Stop Me Now - Remastered 2011")).toBe("Don't Stop Me Now")
  })

  it('strips feat. groups in either bracket style', () => {
    expect(baseTitle('Song (feat. Someone)')).toBe('Song')
    expect(baseTitle('Song [ft. Someone] (Deluxe Edition)')).toBe('Song')
    expect(baseTitle('Song (with Other)')).toBe('Song')
  })

  it('strips live and version suffixes', () => {
    expect(baseTitle('Song - Live at Wembley')).toBe('Song')
    expect(baseTitle('Song - Mono Version')).toBe('Song')
    expect(baseTitle('Song - Radio Edit')).toBe('Song')
  })

  it('keeps remix, mix, sped up, slowed and nightcore', () => {
    expect(baseTitle('Song - Purple Disco Machine Remix')).toBe('Song - Purple Disco Machine Remix')
    expect(baseTitle('Song (Extended Mix)')).toBe('Song (Extended Mix)')
    expect(baseTitle('Song (Sped Up)')).toBe('Song (Sped Up)')
    expect(baseTitle('Song - Slowed + Reverb')).toBe('Song - Slowed + Reverb')
    expect(baseTitle('Song (Nightcore Version)')).toBe('Song (Nightcore Version)')
    expect(baseTitle('Song - 2015 Remastered Remix')).toBe('Song - 2015 Remastered Remix')
  })

  it('keeps groups without keywords', () => {
    expect(baseTitle('Song (Part II)')).toBe('Song (Part II)')
    expect(baseTitle('Hey - You')).toBe('Hey - You')
  })
})

describe('searchTitles', () => {
  it('adds a second query that keeps the parentheticals', () => {
    expect(searchTitles('Song (feat. X) - Remastered')).toEqual(['Song', 'Song (feat. X)'])
  })

  it('skips the second query when identical', () => {
    expect(searchTitles('Song - Remastered 2011')).toEqual(['Song'])
    expect(searchTitles('Plain')).toEqual(['Plain'])
  })
})

describe('lookupQuery', () => {
  it('builds the song/artist lookup', () => {
    expect(lookupQuery('Queen', "Don't Stop Me Now")).toBe("song:Don't Stop Me Now artist:Queen")
  })
})

describe('matchKey', () => {
  it('lowercases, strips accents, & → and, drops punctuation and a leading "the"', () => {
    expect(matchKey('Beyoncé')).toBe('beyonce')
    expect(matchKey('Simon & Garfunkel')).toBe(matchKey('Simon and Garfunkel'))
    expect(matchKey('The Weeknd')).toBe('weeknd')
    expect(matchKey('Don’t Stop Me Now!')).toBe('dont stop me now')
  })
})

describe('pickMatch', () => {
  it('accepts an exact artist and title match with a string tempo', () => {
    const found = pickMatch('Queen', "Don't Stop Me Now", [candidate("Don't Stop Me Now", 'Queen', '156', 'q1')])
    expect(found).toEqual({ bpm: 156, match: { id: 'q1', title: "Don't Stop Me Now", artist: 'Queen' } })
  })

  it('matches across curly quotes, accents and a remaster suffix', () => {
    expect(pickMatch('Beyonce', 'Halo - Remastered', [candidate('Halo', 'Beyoncé', '80')])?.bpm).toBe(80)
    expect(pickMatch('Queen', 'Don’t Stop Me Now', [candidate("Don't Stop Me Now", 'Queen', '156')])?.bpm).toBe(156)
  })

  it('accepts whole-word artist containment only', () => {
    expect(pickMatch('Queen', 'Under Pressure', [candidate('Under Pressure', 'Queen & David Bowie', '114')])?.bpm).toBe(
      114
    )
    expect(pickMatch('Queen', 'Song', [candidate('Song', 'Queensryche', '120')])).toBeNull()
  })

  it('rejects a cover version by another artist', () => {
    expect(pickMatch('Metallica', 'Nothing Else Matters', [candidate('Nothing Else Matters', 'Apocalyptica', '70')])).toBeNull()
  })

  it('rejects a substring title match', () => {
    expect(pickMatch('Metallica', 'Sandman', [candidate('Enter Sandman', 'Metallica', '123')])).toBeNull()
  })

  it('does not match a remix to the original', () => {
    expect(pickMatch('Dua Lipa', 'Levitating - Remix', [candidate('Levitating', 'Dua Lipa', '103')])).toBeNull()
  })

  it('treats implausible or non-numeric tempos as non-matching', () => {
    expect(pickMatch('A', 'B', [candidate('B', 'A', '0')])).toBeNull()
    expect(pickMatch('A', 'B', [candidate('B', 'A', '300')])).toBeNull()
    expect(pickMatch('A', 'B', [candidate('B', 'A', '')])).toBeNull()
    expect(pickMatch('A', 'B', [candidate('B', 'A', 'n/a'), candidate('B', 'A', '120')])?.bpm).toBe(120)
  })

  it('returns a miss when passing candidates disagree', () => {
    expect(pickMatch('A', 'B', [candidate('B', 'A', '120'), candidate('B', 'A', '130')])).toBeNull()
  })

  it('tolerates small differences and exact half/double time', () => {
    expect(pickMatch('A', 'B', [candidate('B', 'A', '120'), candidate('B', 'A', '122')])?.bpm).toBe(120)
    expect(pickMatch('A', 'B', [candidate('B', 'A', '80'), candidate('B', 'A', '160')])?.bpm).toBe(80)
  })
})
