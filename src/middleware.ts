/**
 * Next.js Middleware (Edge runtime)
 *
 * Next 16 bu dosyayı proxy.ts olarak yeniden adlandırdı, ancak proxy yalnızca Node.js runtime'ında
 * çalışır. Cloudflare Workers'ta Node middleware deneyseldir ve Worker paketine Next sunucusunun
 * ikinci bir kopyasını ekleyerek 3 MB ücretsiz plan sınırını aşar; Next 16 dokümanı Edge için
 * middleware.ts'in kullanılmaya devam edilmesini söyler.
 *
 * 1. CSRF: başka origin'den gelen yazma istekleri (POST/PATCH/PUT/DELETE) /api'de reddedilir.
 * 2. Oturum: AUTH_MODE=development → imzalı dev_auth_session çerezi;
 *    AUTH_MODE=production → Supabase Auth session (token rotation burada yapılır).
 * 3. Sayfa yetkisi: oturumdaki çalışan aktif olmalı; yönetici sayfalarına yalnızca
 *    ilgili roller girebilir (diğerleri /my-schedule'a yönlendirilir).
 *    API route'ları kendi yetki kontrolünü yapar (requireAuth / requireMinRole).
 *
 * Public path'ler: /login, /api/auth/*, cron, static dosyalar
 */
import { NextRequest, NextResponse } from 'next/server'
import { DEV_SESSION_COOKIE, IS_DEV_AUTH } from '@/lib/authConfig'
import { verifyDevSessionEdge } from '@/lib/auth/devSessionEdge'
import { isKioskRole, roleAtLeast, ROLES, type RoleName } from '@/lib/auth/roles'

const PUBLIC_PATHS = ['/login', '/offline']
const PUBLIC_API_PREFIX = '/api/auth/'
// Cron çağrısı oturumsuz gelir; route kendi içinde CRON_SECRET / rol kontrolü yapar
const CRON_API_PATHS = ['/api/attendance/alerts/scan']

/** Sayfa → en düşük gerekli rol. Listede olmayan sayfalar tüm aktif çalışanlara açıktır. */
const PAGE_MIN_ROLE: Array<[prefix: string, minRole: RoleName]> = [
  ['/settings', ROLES.MAGAZA_MUDURU],
  ['/dashboard', ROLES.MUDUR_YARDIMCISI],
  ['/employees', ROLES.MUDUR_YARDIMCISI],
  ['/shift-templates', ROLES.MUDUR_YARDIMCISI],
  ['/workforce', ROLES.MUDUR_YARDIMCISI],
  ['/reports', ROLES.MUDUR_YARDIMCISI],
]
/** Çalışanların varsayılan sayfası (yönetici sayfasına girmeye çalışırlarsa) */
const EMPLOYEE_HOME = '/my-schedule'
/** Kiosk hesabının açabildiği tek sayfa; Müdür Yardımcısı+ da açabilir */
const KIOSK_PAGE = '/qr-kiosk'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true
  if (pathname.startsWith(PUBLIC_API_PREFIX)) return true
  if (CRON_API_PATHS.includes(pathname)) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname.startsWith('/favicon')) return true
  if (pathname === '/manifest.json') return true
  // PWA / favicon ikonları — tarayıcı oturumsuz da ister
  if (/^\/icon-[\w-]+\.(svg|png)$/.test(pathname)) return true
  if (pathname === '/apple-touch-icon.png') return true
  if (pathname === '/sw.js') return true
  return false
}

/** Sayfa için gereken en düşük rol (yoksa null). '/' Günlük Operasyon yönetici sayfasıdır. */
function requiredRole(pathname: string): RoleName | null {
  if (pathname === '/') return ROLES.MUDUR_YARDIMCISI
  for (const [prefix, role] of PAGE_MIN_ROLE) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return role
  }
  return null
}

/** Başka origin'den gelen yazma isteği mi? (Origin yoksa — ör. curl/cron — Referer'a bakılır) */
function isCrossOriginWrite(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  if (!source) return false
  try {
    return new URL(source).host !== request.nextUrl.host
  } catch {
    return true
  }
}

/** Oturumdaki çalışanın aktifliği ve rolü (service role ile; yalnızca sayfa isteklerinde) */
async function loadEmployee(by: { id?: string; authUserId?: string }): Promise<{ active: boolean; role: string | null } | null> {
  const { createAdminClient } = await import('@/lib/supabaseAdmin')
  const admin = createAdminClient()
  let query = admin.from('employees').select('active, roles ( name )')
  query = by.id ? query.eq('id', by.id) : query.eq('auth_user_id', by.authUserId!)
  const { data } = await query.maybeSingle()
  if (!data) return null
  const roles = data.roles as unknown as { name: string } | { name: string }[] | null
  const role = Array.isArray(roles) ? roles[0]?.name ?? null : roles?.name ?? null
  return { active: Boolean(data.active), role }
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  if (isApi && isCrossOriginWrite(request)) {
    return NextResponse.json({ error: 'Geçersiz istek kaynağı.', code: 'CSRF' }, { status: 403 })
  }

  // ── Oturum ────────────────────────────────────────────────
  let response = NextResponse.next({ request: { headers: request.headers } })
  let identity: { id?: string; authUserId?: string } | null = null

  if (IS_DEV_AUTH) {
    const session = await verifyDevSessionEdge(request.cookies.get(DEV_SESSION_COOKIE)?.value)
    if (session) identity = { id: session.employeeId }
  } else {
    const { createSupabaseMiddlewareClient } = await import('@/lib/supabase/middleware-client')
    const supabase = createSupabaseMiddlewareClient(request, response)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) identity = { authUserId: user.id }
  }

  if (pathname === '/login' && identity) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (isPublicPath(pathname)) return response
  if (!identity) {
    if (isApi) return response // API route kendi 401'ini döner
    return redirectToLogin(request)
  }
  if (isApi) return response

  // ── Sayfa yetkisi ─────────────────────────────────────────
  const employee = await loadEmployee(identity)
  if (!employee || !employee.active) {
    // Bağlı / aktif çalışan kaydı olmayan oturum (ör. pasifleştirilmiş hesap)
    response = redirectToLogin(request)
    response.cookies.delete(DEV_SESSION_COOKIE)
    return response
  }

  // Kiosk hesabı yalnızca kiosk ekranını görür; kiosk ekranı da yalnızca kiosk + yöneticilere açık
  if (isKioskRole(employee.role)) {
    return pathname === KIOSK_PAGE ? response : NextResponse.redirect(new URL(KIOSK_PAGE, request.url))
  }
  if (pathname === KIOSK_PAGE && !(employee.role && roleAtLeast(employee.role, ROLES.MUDUR_YARDIMCISI))) {
    return NextResponse.redirect(new URL(EMPLOYEE_HOME, request.url))
  }

  const minRole = requiredRole(pathname)
  if (minRole && !(employee.role && roleAtLeast(employee.role, minRole))) {
    return NextResponse.redirect(new URL(EMPLOYEE_HOME, request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
