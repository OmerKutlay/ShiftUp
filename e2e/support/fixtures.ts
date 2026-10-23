/**
 * e2e ortak yardımcıları: sahte oturum çerezi, /api/* taklitleri ve test fixture'ı.
 *
 * Oturum: middleware Supabase `auth.getUser()` + employees sorgusu → e2e/support/fake-supabase.mjs.
 * Çerez @supabase/ssr biçimindedir (`base64-` + base64url(JSON session)); depolama anahtarı
 * NEXT_PUBLIC_SUPABASE_URL host'unun ilk parçasından türetilir (127.0.0.1 → "sb-127-auth-token").
 *
 * API: context.route() — sayfanın ve (izin verilmişse) Service Worker'ın istekleri yakalanır.
 * Taklit edilmeyen /api/* uçları 404 döner ve `unmockedApiCalls` listesine yazılır.
 * context.setOffline(true) iken taklitler de ağ hatası verir (bkz. mockApi).
 */
import { test as base, expect, type BrowserContext, type Route } from '@playwright/test'

export type RoleName = 'Çalışan' | 'Mağaza Müdürü'

export const EMPLOYEE_ID = 'emp-e2e-calisan'
export const MANAGER_ID = 'emp-e2e-mudur'

/** /api/auth/me yanıtındaki çalışan (AuthEmployee) */
export function makeEmployee(role: RoleName) {
  const isManager = role === 'Mağaza Müdürü'
  return {
    id: isManager ? MANAGER_ID : EMPLOYEE_ID,
    full_name: isManager ? 'Mehmet Müdür' : 'Ayşe Yılmaz',
    email: isManager ? 'mudur@example.com' : 'ayse@example.com',
    role_id: isManager ? 'role-2' : 'role-4',
    active: true,
    employment_type: 'full_time',
    auth_user_id: PERSONA_BY_ROLE[role].userId,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    roles: {
      id: isManager ? 'role-2' : 'role-4',
      name: isManager ? 'Mağaza Müdürü' : 'Kasiyer',
      description: null,
      access_level: isManager ? 'store_manager' : 'employee',
      planning_group: isManager ? 'store_manager' : 'cashier',
      sort_order: isManager ? 20 : 60,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** /api/reports/my satırları: istenen aralıktaki her gün için 09:00–17:00 vardiya (geçmiş günler tamamlanmış) */
export function makeScheduleRows(dateFrom: string, dateTo: string) {
  const rows = []
  const start = new Date(`${dateFrom}T00:00:00`)
  const end = new Date(`${dateTo}T00:00:00`)
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const past = date < todayStr
    rows.push({
      work_date: date,
      start_time: '09:00:00',
      end_time: '17:00:00',
      shift_name: 'Sabah',
      status: past ? 'clocked_out' : 'shift_waiting',
      clock_in_at: past ? `${date}T06:00:00.000Z` : null,
      clock_out_at: past ? `${date}T14:00:00.000Z` : null,
      break_start_at: null,
      break_end_at: null,
      worked_minutes: past ? 450 : null,
      break_minutes: past ? 30 : null,
      is_on_leave: false,
    })
  }
  return rows
}

export interface MockApiOptions {
  role?: RoleName
  /** current-status yanıtı (QR Tara) */
  currentStatus?: Record<string, unknown>
  /** Ek/özel uçlar: pathname → JSON gövde ya da handler */
  overrides?: Record<string, unknown | ((route: Route) => Promise<void> | void)>
}

export const DEFAULT_CURRENT_STATUS = {
  has_shift: true,
  shift_id: 'shift-1',
  shift_start: '09:00:00',
  shift_end: '17:00:00',
  current_status: 'shift_waiting',
  suggested_action: 'clock_in',
  allowed_actions: ['clock_in'],
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

/** Tüm /api/* isteklerini taklit eder. Dönen dizi taklit edilmemiş çağrıları toplar. */
export async function mockApi(context: BrowserContext, opts: MockApiOptions = {}): Promise<string[]> {
  const role = opts.role ?? 'Çalışan'
  const employee = makeEmployee(role)
  const unmocked: string[] = []

  // route() ağ emülasyonundan önce çalışır: context.setOffline(true) iken de taklit yanıt dönerdi.
  // Gerçek çevrimdışı davranış için setOffline sarılır ve taklitler ağ hatasıyla düşer.
  let offline = false
  const setOffline = context.setOffline.bind(context)
  context.setOffline = async (value: boolean) => {
    offline = value
    await setOffline(value)
  }

  await context.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      if (offline) return route.abort('internetdisconnected')
      const url = new URL(route.request().url())
      const path = url.pathname
      const override = opts.overrides?.[path]
      if (override !== undefined) {
        if (typeof override === 'function') return (override as (r: Route) => Promise<void> | void)(route)
        return json(route, override)
      }
      switch (path) {
        case '/api/auth/me':
          return json(route, { employee })
        case '/api/auth/logout':
          // Gerçek uç oturum çerezlerini siler; aksi halde /login middleware'de ana sayfaya döner
          await context.clearCookies()
          return json(route, { ok: true })
        case '/api/reports/my':
          return json(route, {
            rows: makeScheduleRows(url.searchParams.get('date_from')!, url.searchParams.get('date_to')!),
          })
        case '/api/push/config':
          return json(route, { enabled: false, publicKey: null })
        case '/api/attendance/current-status':
          return json(route, opts.currentStatus ?? DEFAULT_CURRENT_STATUS)
        case '/api/attendance/daily':
          return json(route, { date: new Date().toISOString().slice(0, 10), entries: [] })
        case '/api/notifications':
          return json(route, { notifications: [] })
        case '/api/store-location/name':
          return json(route, { name: 'Kadıköy mağazası' })
        default:
          unmocked.push(`${route.request().method()} ${path}`)
          return json(route, { error: 'e2e: taklit edilmedi' }, 404)
      }
    }
  )
  return unmocked
}

/** fake-supabase.mjs PERSONAS ile aynı: access token → Supabase kullanıcısı → çalışan rolü */
const PERSONA_BY_ROLE: Record<RoleName, { token: string; userId: string }> = {
  'Çalışan': { token: 'e2e-employee', userId: '00000000-0000-4000-8000-0000000000e1' },
  'Mağaza Müdürü': { token: 'e2e-manager', userId: '00000000-0000-4000-8000-0000000000e2' },
}

/** @supabase/ssr biçiminde sahte oturum çerezi (fake-supabase "Bearer e2e-<persona>" kabul eder) */
export async function addSessionCookie(context: BrowserContext, baseURL: string, role: RoleName = 'Çalışan') {
  const persona = PERSONA_BY_ROLE[role]
  const session = {
    access_token: persona.token,
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    // Uzak gelecek: middleware token yenilemeye (refresh) çalışmasın
    expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    user: {
      id: persona.userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'e2e@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  await context.addCookies([{ name: 'sb-127-auth-token', value, url: baseURL, sameSite: 'Lax' }])
}

type Fixtures = {
  /** Taklit edilmemiş /api çağrıları (test sonunda boş olmalı) */
  unmockedApiCalls: string[]
  role: RoleName
  /** Kurulum önerisi kartı kapatılmış sayılsın mı (varsayılan: evet) */
  installPromptDismissed: boolean
}

/**
 * Oturum açmış, API'leri taklit edilmiş bağlam. Rol `test.use({ role })` ile seçilir.
 * Kurulum önerisi kartı (InstallPrompt) varsayılan olarak kapatılmış sayılır: alt bar üstünde
 * durup tıklamaları/ölçümleri etkilemesin.
 */
export const test = base.extend<Fixtures>({
  role: ['Çalışan', { option: true }],
  installPromptDismissed: [true, { option: true }],
  // İkinci parametre `use` yerine `provide`: react-hooks/rules-of-hooks yanlış alarm vermesin
  unmockedApiCalls: async ({ context, baseURL, role, installPromptDismissed }, provide) => {
    await addSessionCookie(context, baseURL!, role)
    const unmocked = await mockApi(context, { role })
    if (installPromptDismissed) {
      await context.addInitScript(() => {
        try {
          window.localStorage.setItem('shiftup.installPrompt.dismissedAt', String(Date.now()))
        } catch {
          /* yok say */
        }
      })
    }
    await provide(unmocked)
  },
  // Fixture'ın her testte (kullanılmasa da) kurulması için page'e bağla
  page: async ({ page, unmockedApiCalls }, provide) => {
    void unmockedApiCalls
    await provide(page)
  },
})

export { expect }

/** Alt menü (MobileBottomNav) */
export function bottomNav(page: import('@playwright/test').Page) {
  return page.getByRole('navigation', { name: 'Alt menü' })
}
