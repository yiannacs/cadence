import { type NextRequest, NextResponse } from 'next/server'
import { originOf } from '@/lib/http'
import { clearTokenCookies } from '@/lib/spotify/session'

export async function GET(request: NextRequest): Promise<Response> {
  const response = NextResponse.redirect(new URL('/', originOf(request)))
  clearTokenCookies(response.cookies)
  return response
}
