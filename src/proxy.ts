/**
 * Next.js Proxy (eski adı: Middleware) — FAZ AUTH
 *
 * AUTH_MODE=development → dev_auth_session cookie kontrolü
 * AUTH_MODE=production  → Supabase Auth session token rotation + cookie kontrolü
 *
 * Public path'ler: /login, /api/auth/*, static dosyalar
 */
import { NextRequest, NextResponse } from 'next/server'
import { DEV_SESSION_COOKIE, IS_DEV_AUTH } from '@/lib/authConfig'

const PUBLIC_PATHS = ['/login']
const PUBLIC_API_PREFIX = '/api/auth/'
// Cron çağrısı oturumsuz gelir; route kendi içinde CRON_SECRET / rol kontrolü yapar
const CRON_API_PATHS = ['/api/attendance/alerts/scan']

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true
  if (pathname.startsWith(PUBLIC_API_PREFIX)) return true
  if (CRON_API_PATHS.includes(pathname)) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname.startsWith('/favicon')) return true
  if (pathname === '/manifest.json') return true
  if (pathname === '/sw.js') return true
  return false
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (IS_DEV_AUTH) {
    const devCookie = request.cookies.get(DEV_SESSION_COOKIE)?.value
    let isAuthenticated = false
    if (devCookie) {
      try {
        const parsed = JSON.parse(devCookie) as { employeeId?: string; createdAt?: number }
        isAuthenticated = !!parsed.employeeId
      } catch {
        isAuthenticated = false
      }
    }
    if (pathname === '/login' && isAuthenticated) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    if (!isPublicPath(pathname) && !isAuthenticated) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  // Production: Supabase session token rotation
  const response = NextResponse.next({
    request: { headers: request.headers },
  })
  const { createSupabaseMiddlewareClient } = await import('@/lib/supabase/middleware-client')
  const supabase = createSupabaseMiddlewareClient(request, response)
  const { data: { user } } = await supabase.auth.getUser()
  const isAuthenticated = !!user

  if (pathname === '/login' && isAuthenticated) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (!isPublicPath(pathname) && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
