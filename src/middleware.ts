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

const PUBLIC_PATHS = ['/login', '/offline', '/dev-preview'] // TEMP-PREVIEW
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

type EmployeeLookup =
  | { status: 'ok'; active: boolean; role: string | null }
  | { status: 'missing' }
  | { status: 'error' }

/** Oturumdaki çalışanın aktifliği ve rolü (service role ile; yalnızca sayfa isteklerinde) */
async function loadEmployee(by: { id?: string; authUserId?: string }): Promise<EmployeeLookup> {
  try {
    const { createAdminClient } = await import('@/lib/supabaseAdmin')
    const admin = createAdminClient()
    let query = admin.from('employees').select('active, roles ( name )')
    query = by.id ? query.eq('id', by.id) : query.eq('auth_user_id', by.authUserId!)
    const { data, error } = await query.maybeSingle()
    if (error) return { status: 'error' }
    if (!data) return { status: 'missing' }
    const roles = data.roles as unknown as { name: string } | { name: string }[] | null
    const role = Array.isArray(roles) ? roles[0]?.name ?? null : roles?.name ?? null
    return { status: 'ok', active: Boolean(data.active), role }
  } catch {
    return { status: 'error' }
  }
}

/** Geçersiz kalmış oturum çerezlerini sil (Supabase sb-*-auth-token parçaları + dev çerezi) */
function clearSessionCookies(request: NextRequest, response: NextResponse) {
  for (const { name } of request.cookies.getAll()) {
    if (name === DEV_SESSION_COOKIE || (name.startsWith('sb-') && name.includes('-auth-token'))) {
      response.cookies.delete(name)
    }
  }
  return response
}

function homeFor(role: string | null): string {
  return isKioskRole(role) ? KIOSK_PAGE : '/'
}

/**
 * Yönlendirme yanıtı — middleware'de yenilenen oturum çerezlerini (session.cookies) taşır.
 * NextResponse.redirect yeni bir yanıt üretir; çerezler kopyalanmazsa tarayıcı eski
 * (Supabase'in döndürüp geçersiz kıldığı) refresh token'ı kullanmaya devam eder, oturum
 * düşer ve yönlendirme döngüsü oluşur.
 */
function redirectWithSession(url: URL, session: NextResponse | null) {
  const res = NextResponse.redirect(url)
  for (const cookie of session?.cookies.getAll() ?? []) res.cookies.set(cookie)
  return res
}

function redirectToLogin(request: NextRequest, session: NextResponse | null, clearCookies = false) {
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', request.nextUrl.pathname)
  if (clearCookies) return clearSessionCookies(request, NextResponse.redirect(loginUrl))
  return redirectWithSession(loginUrl, session)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  if (isApi) {
    if (isCrossOriginWrite(request)) {
      return NextResponse.json({ error: 'Geçersiz istek kaynağı.', code: 'CSRF' }, { status: 403 })
    }
    // API route'ları oturumu kendileri doğrular (requireAuth → getUser, token yenileme dahil);
    // burada ikinci kez Supabase'e gitmek her API çağrısında CPU/istek maliyetini ikiye katlar.
    return NextResponse.next()
  }
  if (pathname !== '/login' && isPublicPath(pathname)) return NextResponse.next()

  // ── Oturum ────────────────────────────────────────────────
  const response = NextResponse.next({ request: { headers: request.headers } })
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

  // /login ve korumalı sayfalar AYNI ölçütü kullanır: geçerli oturum + aktif çalışan kaydı.
  // (Önceden /login yalnızca oturuma bakıyordu; çalışan kaydı doğrulanamayan oturumda
  //  "/" → /login → "/" sonsuz yönlendirme döngüsü oluşuyordu.)
  const lookup = identity ? await loadEmployee(identity) : null

  if (pathname === '/login') {
    if (lookup?.status === 'ok' && lookup.active) {
      return redirectWithSession(new URL(homeFor(lookup.role), request.url), response)
    }
    // Çalışan kaydı olmayan / pasif oturum: çerezleri temizle, giriş formunu göster
    return lookup?.status === 'missing' || (lookup?.status === 'ok' && !lookup.active)
      ? clearSessionCookies(request, response)
      : response
  }

  if (!identity) return redirectToLogin(request, response)

  // Geçici veritabanı hatası: oturumu düşürme, isteği geçir (sayfa verisi API'lerden yetkiyle gelir)
  if (lookup?.status === 'error') return response

  // Bağlı / aktif çalışan kaydı olmayan oturum (ör. pasifleştirilmiş hesap)
  if (lookup?.status !== 'ok' || !lookup.active) return redirectToLogin(request, null, true)
  const employee = lookup

  // Kiosk hesabı yalnızca kiosk ekranını görür; kiosk ekranı da yalnızca kiosk + yöneticilere açık
  if (isKioskRole(employee.role)) {
    return pathname === KIOSK_PAGE ? response : redirectWithSession(new URL(KIOSK_PAGE, request.url), response)
  }
  if (pathname === KIOSK_PAGE && !(employee.role && roleAtLeast(employee.role, ROLES.MUDUR_YARDIMCISI))) {
    return redirectWithSession(new URL(EMPLOYEE_HOME, request.url), response)
  }

  const minRole = requiredRole(pathname)
  if (minRole && !(employee.role && roleAtLeast(employee.role, minRole))) {
    return redirectWithSession(new URL(EMPLOYEE_HOME, request.url), response)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
