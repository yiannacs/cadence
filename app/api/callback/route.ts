import { type NextRequest, NextResponse } from 'next/server'
import { exchangeCode } from '@/lib/spotify/auth'
import { originOf } from '@/lib/http'

const TOKEN_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const home = new URL('/', originOf(request))

  if (error) {
    home.searchParams.set('error', error)
    return NextResponse.redirect(home)
  }

  if (!code) {
    home.searchParams.set('error', 'missing_code')
    return NextResponse.redirect(home)
  }

  try {
    const tokens = await exchangeCode(code)

    const response = NextResponse.redirect(home)
    response.cookies.set('sp_at', tokens.accessToken, {
      ...TOKEN_COOKIE_OPTS,
      maxAge: Math.floor((tokens.expiresAt - Date.now()) / 1000),
    })
    response.cookies.set('sp_rt', tokens.refreshToken, {
      ...TOKEN_COOKIE_OPTS,
      maxAge: 60 * 60 * 24 * 60,
    })
    response.cookies.set('sp_exp', String(tokens.expiresAt), {
      ...TOKEN_COOKIE_OPTS,
      maxAge: 60 * 60 * 24 * 60,
    })

    return response
  } catch (err) {
    console.error('[callback] token exchange error:', err)
    home.searchParams.set('error', 'token_exchange_failed')
    return NextResponse.redirect(home)
  }
}
