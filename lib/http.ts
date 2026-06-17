import { type NextRequest } from 'next/server'

// In Next dev, request.url reports the server's bound hostname (localhost),
// ignoring the Host header — so a request made to 127.0.0.1 would redirect to
// localhost, splitting cookies across origins. Derive the origin from the Host
// header the browser actually sent instead.
export function originOf(request: NextRequest): string {
  const host = request.headers.get('host') ?? '127.0.0.1:3000'
  const proto = request.headers.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}
