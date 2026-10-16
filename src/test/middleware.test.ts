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

function asEmployee(role: string, active = true) {
  employeeRow = { data: { active, roles: { name: role } }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ user: { id: 'auth-1' }, refreshed: false })
  asEmployee('Çalışan')
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
    asEmployee('Çalışan', false)
    expect(location(await middleware(req('/schedule', { cookie: OLD_COOKIE })))).toBe('/login?next=%2Fschedule')
    expect((await middleware(req('/login', { cookie: OLD_COOKIE }))).status).toBe(200)
  })

  it('geçerli oturum: /login → "/" ; kiosk → /qr-kiosk', async () => {
    expect(location(await middleware(req('/login', { cookie: OLD_COOKIE })))).toBe('/')
    asEmployee('Kiosk')
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
    asEmployee('Kiosk')
    getUser.mockResolvedValue({ user: { id: 'auth-1' }, refreshed: true })
    const res = await middleware(req('/schedule', { cookie: OLD_COOKIE }))
    expect(location(res)).toBe('/qr-kiosk')
    expect(res.headers.get('set-cookie')).toContain('sb-proj-auth-token=NEW_TOKEN')
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
