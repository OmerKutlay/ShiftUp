// @vitest-environment node
/**
 * middleware.test.ts — oturum yönlendirmeleri (prod auth modu).
 *
 * Gerilemeler:
 *   - "/" ↔ /login sonsuz döngüsü: /login yalnızca oturuma, "/" ise çalışan kaydına bakıyordu.
 *   - Middleware'de yenilenen Supabase çerezleri yönlendirme yanıtlarında kayboluyordu.
 *   - API isteklerinde gereksiz ikinci getUser çağrısı.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'

const getUser = vi.fn()
const signOut = vi.fn(async () => ({ error: null }))
let accessToken: string | null = null
let employeeRow: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@/lib/authConfig', () => ({ IS_DEV_AUTH: false, DEV_SESSION_COOKIE: 'dev_auth_session' }))
vi.mock('@/lib/supabase/middleware-client', () => ({
  createSupabaseMiddlewareClient: (_req: NextRequest, res: NextResponse) => ({
    auth: {
      getUser: async () => {
        const r = await getUser()
        // Token yenilendiyse @supabase/ssr yeni çerezi middleware yanıtına yazar
        if (r.refreshed) res.cookies.set('sb-proj-auth-token', 'NEW_TOKEN', { path: '/' })
        return { data: { user: r.user } }
      },
      getSession: async () => ({ data: { session: accessToken ? { access_token: accessToken } : null } }),
      signOut,
    },
  }),
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => employeeRow }
      return q
    },
  }),
}))

import { middleware } from '@/middleware'

const BASE = 'https://shiftup.test'
function req(path: string, init: { method?: string; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {}
  if (init.cookie) headers.cookie = init.cookie
  if (init.origin) headers.origin = init.origin
  return new NextRequest(BASE + path, { method: init.method ?? 'GET', headers })
}
const OLD_COOKIE = 'sb-proj-auth-token=OLD_TOKEN'
const location = (res: Response) => res.headers.get('location')?.replace(BASE, '') ?? null

function asEmployee(accessLevel: string, active = true) {
  employeeRow = { data: { active, roles: { access_level: accessLevel } }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  accessToken = null
  getUser.mockResolvedValue({ user: { id: 'auth-1' }, refreshed: false })
  asEmployee('employee')
})

describe('middleware — /login ile korumalı sayfalar aynı ölçütü kullanır', () => {
  it('çalışan kaydı olmayan oturum: "/" → /login (çerezler temizlenir), /login giriş formunu gösterir', async () => {
    employeeRow = { data: null, error: null }
    const home = await middleware(req('/', { cookie: OLD_COOKIE }))
    expect(location(home)).toBe('/login?next=%2F')
    expect(home.headers.get('set-cookie')).toMatch(/sb-proj-auth-token=;/)

    const login = await middleware(req('/login', { cookie: OLD_COOKIE }))
    expect(login.status).toBe(200) // döngü yok: /login tekrar "/"ye göndermez
    expect(login.headers.get('set-cookie')).toMatch(/sb-proj-auth-token=;/)
  })

  it('pasif çalışan oturumu da döngüye girmez', async () => {
    asEmployee('employee', false)
    expect(location(await middleware(req('/schedule', { cookie: OLD_COOKIE })))).toBe('/login?next=%2Fschedule')
    expect((await middleware(req('/login', { cookie: OLD_COOKIE }))).status).toBe(200)
  })

  it('geçerli oturum: /login → "/" ; kiosk → /qr-kiosk', async () => {
    expect(location(await middleware(req('/login', { cookie: OLD_COOKIE })))).toBe('/')
    asEmployee('kiosk')
    expect(location(await middleware(req('/login', { cookie: OLD_COOKIE })))).toBe('/qr-kiosk')
  })

  it('oturum yok: korumalı sayfa → /login, /login formu gösterir', async () => {
    getUser.mockResolvedValue({ user: null })
    expect(location(await middleware(req('/my-schedule')))).toBe('/login?next=%2Fmy-schedule')
    expect((await middleware(req('/login'))).status).toBe(200)
  })

  it('geçici veritabanı hatasında oturum düşürülmez, istek geçer', async () => {
    employeeRow = { data: null, error: { message: 'timeout' } }
    const res = await middleware(req('/my-schedule', { cookie: OLD_COOKIE }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/sb-proj-auth-token=;/)
  })
})

describe('middleware — KVKK aydınlatma sayfası (/gizlilik) herkese açık', () => {
  it('oturumsuz isteği /login a yönlendirmez ve oturum sorgusu yapmaz', async () => {
    getUser.mockResolvedValue({ user: null })
    const res = await middleware(req('/gizlilik'))
    expect(res.status).toBe(200)
    expect(location(res)).toBeNull()
    expect(getUser).not.toHaveBeenCalled()
  })
})

describe('middleware — mobil "Daha fazla" sayfası', () => {
  it('Çalışan /more, /notifications ve /workforce (Müsaitlik ve takas) sayfalarını açabilir', async () => {
    for (const path of ['/more', '/notifications', '/workforce']) {
      const res = await middleware(req(path, { cookie: OLD_COOKIE }))
      expect(res.status).toBe(200)
      expect(location(res)).toBeNull()
    }
  })
})

describe('middleware — yenilenen oturum çerezleri yönlendirmede korunur', () => {
  it('Çalışan "/" → /my-schedule yönlendirmesi yeni token çerezini taşır', async () => {
    getUser.mockResolvedValue({ user: { id: 'auth-1' }, refreshed: true })
    const res = await middleware(req('/', { cookie: OLD_COOKIE }))
    expect(location(res)).toBe('/my-schedule')
    expect(res.headers.get('set-cookie')).toContain('sb-proj-auth-token=NEW_TOKEN')
  })

  it('/login → "/" yönlendirmesi yeni token çerezini taşır', async () => {
    getUser.mockResolvedValue({ user: { id: 'auth-1' }, refreshed: true })
    const res = await middleware(req('/login', { cookie: OLD_COOKIE }))
    expect(location(res)).toBe('/')
    expect(res.headers.get('set-cookie')).toContain('sb-proj-auth-token=NEW_TOKEN')
  })

  it('kiosk hesabı başka sayfaya giderse /qr-kiosk yönlendirmesi çerezi taşır', async () => {
    asEmployee('kiosk')
    getUser.mockResolvedValue({ user: { id: 'auth-1' }, refreshed: true })
    const res = await middleware(req('/schedule', { cookie: OLD_COOKIE }))
    expect(location(res)).toBe('/qr-kiosk')
    expect(res.headers.get('set-cookie')).toContain('sb-proj-auth-token=NEW_TOKEN')
  })
})

describe('middleware — Günlük operasyon', () => {
  it('çalışanın ana sayfası Vardiyam kalır; Günlük operasyonu /daily\'de açar', async () => {
    expect(location(await middleware(req('/', { cookie: OLD_COOKIE })))).toBe('/my-schedule')
    expect(location(await middleware(req('/daily', { cookie: OLD_COOKIE })))).toBeNull()
  })

  it('yönetici "/"de Günlük operasyonu görür', async () => {
    asEmployee('manager')
    expect(location(await middleware(req('/', { cookie: OLD_COOKIE })))).toBeNull()
  })
})

describe('middleware — API istekleri', () => {
  it('API isteklerinde Supabase oturum çağrısı yapılmaz (route kendi doğrular)', async () => {
    const res = await middleware(req('/api/auth/me', { cookie: OLD_COOKIE }))
    expect(res.status).toBe(200)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('başka origin\'den yazma isteği 403 (CSRF)', async () => {
    const res = await middleware(req('/api/qr/process', { method: 'POST', origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
  })
})

describe('middleware — PWA dosyaları oturumsuz erişilebilir', () => {
  it('/sw.js, /sw-push.js ve /manifest.json oturum kontrolüne girmez', async () => {
    getUser.mockResolvedValue({ user: null })
    for (const path of ['/sw.js', '/sw-push.js', '/manifest.json']) {
      const res = await middleware(req(path))
      expect(location(res)).toBeNull()
    }
    expect(getUser).not.toHaveBeenCalled()
  })
})

describe('middleware — oturum girişten 30 gün sonra kesin kapanır', () => {
  const DAY = 24 * 60 * 60
  /** amr claim'inde giriş anı taşıyan (imzasız) test token'ı */
  const tokenLoggedInDaysAgo = (days: number) => {
    const payload = { amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) - days * DAY }] }
    return `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`
  }

  it('29 günlük oturum geçerli kalır', async () => {
    accessToken = tokenLoggedInDaysAgo(29)
    const res = await middleware(req('/my-schedule', { cookie: OLD_COOKIE }))
    expect(location(res)).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('31 günlük oturum: /login\'e yönlendirilir, çerezler silinir, refresh token iptal edilir', async () => {
    accessToken = tokenLoggedInDaysAgo(31)
    const res = await middleware(req('/my-schedule', { cookie: OLD_COOKIE }))
    expect(location(res)).toBe('/login?next=%2Fmy-schedule')
    expect(res.headers.get('set-cookie')).toMatch(/sb-proj-auth-token=;/)
    expect(signOut).toHaveBeenCalledOnce()

    const login = await middleware(req('/login', { cookie: OLD_COOKIE }))
    expect(login.status).toBe(200) // döngü yok: giriş formu gösterilir
  })

  it('amr yoksa last_sign_in_at kullanılır', async () => {
    getUser.mockResolvedValue({
      user: { id: 'auth-1', last_sign_in_at: new Date(Date.now() - 31 * DAY * 1000).toISOString() },
    })
    expect(location(await middleware(req('/my-schedule', { cookie: OLD_COOKIE })))).toBe('/login?next=%2Fmy-schedule')
  })
})
