import { type NextRequest, NextResponse } from 'next/server'
import { originOf } from '@/lib/http'

export async function GET(request: NextRequest): Promise<Response> {
  const response = NextResponse.redirect(new URL('/', originOf(request)))
  response.cookies.delete('sp_at')
  response.cookies.delete('sp_rt')
  response.cookies.delete('sp_exp')
  return response
}
