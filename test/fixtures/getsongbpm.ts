// Fixtures for mocking GetSongBPM in tests, shaped like live responses.

export function respond(status: number, body: unknown, contentType = 'application/json'): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, { status, headers: { 'content-type': contentType } })
}

export function hit(title: string, artist: string, tempo: string, id = 'gsb1'): Response {
  return respond(200, {
    search: [{ id, title, tempo, artist: { id: 'a1', name: artist }, album: { title: 'Album' } }],
  })
}

export const noResult = () => respond(200, { search: { error: 'no result' } })
export const invalidKey = () => respond(401, { error: 'Invalid API Key, or inactive.' }, 'text/html')
export const htmlPage = () => respond(200, '<!DOCTYPE html><html><body>Just a moment…</body></html>', 'text/html')
