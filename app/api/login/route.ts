import { NextResponse } from 'next/server'
import { buildAuthUrl } from '@/lib/spotify/auth'

export async function GET(): Promise<Response> {
  // state is required by Spotify but we don't validate it on return —
  // this is a single-user local tool so CSRF protection isn't needed
  const state = crypto.randomUUID()
  return NextResponse.redirect(buildAuthUrl(state))
}
