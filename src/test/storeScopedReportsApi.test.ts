// @vitest-environment node
/**
 * storeScopedReportsApi.test.ts — çoklu mağaza: rapor, dashboard, denetim ve tatil uçlarının
 * aktif mağaza kapsamı + tatil yetkileri. getCurrentEmployee mock'lanır, veri bellek içi fake Supabase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { turkeyToday } from '@/lib/dateUtils'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const STORE_A = '00000000-0000-0000-0003-000000000001'
const STORE_B = '00000000-0000-0000-0003-000000000002'

const E_A1 = '00000000-0000-4000-8000-0000000000a1' // A mağazasının aktif çalışanı
const E_A2 = '00000000-0000-4000-8000-0000000000a2' // A mağazasının pasif çalışanı (A'da eski vardiyası var)
const E_B1 = '00000000-0000-4000-8000-0000000000b1' // B mağazasının çalışanı
const E_MOVED = '00000000-0000-4000-8000-0000000000c1' // A'dan B'ye geçti; Ekim'de A'da da çalıştı

const base = { email: null, role_id: null, role_name: null, active: true, home_store_id: STORE_A, store_id: STORE_A }
const asManager = { ...base, id: 'mgr-1', full_name: 'Müdür', access_level: ACCESS.STORE_MANAGER }
const asAdmin = { ...base, id: 'adm-1', full_name: 'Admin', access_level: ACCESS.ADMIN }
const asAdminInB = { ...asAdmin, store_id: STORE_B }

const emp = (id: string, name: string, store_id: string, active = true) => ({
  id, full_name: name, store_id, active, employment_type: 'full_time', overtime_consent_at: null, roles: { name: 'Kasiyer' },
})
const shift = (id: string, employee_id: string, store_id: string, work_date: string, extra: object = {}) => ({
  id, employee_id, store_id, work_date, start_time: '09:00', end_time: '18:00', is_on_leave: false,
  employees: { id: employee_id, full_name: employee_id, roles: { name: 'Kasiyer' } }, ...extra,
})

function tables() {
  return {
    stores: [
      { id: STORE_A, name: 'Kadıköy Şube', active: true },
      { id: STORE_B, name: 'Beşiktaş', active: true },
    ],
    employees: [
      emp(E_A1, 'Ayşe', STORE_A),
      emp(E_A2, 'Pasif Ali', STORE_A, false),
      emp(E_B1, 'Berk', STORE_B),
      emp(E_MOVED, 'Taşınan Can', STORE_B), // artık B mağazasında
    ],
    shift_assignments: [
      shift('s1', E_A1, STORE_A, '2026-10-05'),
      shift('s2', E_A2, STORE_A, '2026-10-06'),
      shift('s3', E_MOVED, STORE_A, '2026-10-07'), // eski mağazadaki geçmiş
      shift('s4', E_MOVED, STORE_B, '2026-10-20'), // yeni mağazadaki vardiya
      shift('s5', E_B1, STORE_B, '2026-10-08'),
    ],
    leave_requests: [
      { id: 'l1', employee_id: E_A1, status: 'pending', leave_type: 'annual', start_date: '2026-11-01', end_date: '2026-11-02', created_at: '2026-10-01' },
      { id: 'l2', employee_id: E_B1, status: 'pending', leave_type: 'annual', start_date: '2026-11-01', end_date: '2026-11-02', created_at: '2026-10-02' },
    ],
    attendance_records: [] as Array<Record<string, unknown>>,
    public_holidays: [
      { id: 'h-nat', store_id: null, date: '2026-10-29', name: 'Cumhuriyet Bayramı', half_day: false },
      { id: 'h-a', store_id: STORE_A, date: '2026-10-15', name: 'A yerel', half_day: false },
      { id: 'h-b', store_id: STORE_B, date: '2026-10-16', name: 'B yerel', half_day: false },
    ],
    audit_logs: [
      { id: 'a1', store_id: STORE_A, action: 'shift.create', entity_type: 'shift', entity_id: null, before: null, after: null, note: null, created_at: '2026-10-01T10:00:00Z' },
      { id: 'a2', store_id: STORE_B, action: 'shift.create', entity_type: 'shift', entity_id: null, before: null, after: null, note: null, created_at: '2026-10-02T10:00:00Z' },
      { id: 'a3', store_id: null, action: 'store.create', entity_type: 'store', entity_id: null, before: null, after: null, note: null, created_at: '2026-10-03T10:00:00Z' },
    ],
  }
}

let db: FakeDb

type Handler = (req: NextRequest) => Promise<Response>
type Mod = { GET: Handler; POST: Handler; DELETE: Handler }

// Dinamik import yolu sabit string olmalı (vite çözümlemesi); modüller her çağrıda taze yüklenir
const routes = {
  holidays: () => import('@/app/api/holidays/route'),
  audit: () => import('@/app/api/audit-logs/route'),
  timesheet: () => import('@/app/api/reports/timesheet/route'),
  attendance: () => import('@/app/api/reports/attendance/route'),
  overtime: () => import('@/app/api/reports/overtime/route'),
  dashboard: () => import('@/app/api/dashboard/route'),
}

/** Oturum + fake DB'yi bağlayıp route modülünü taze yükler */
async function mod(employee: unknown, name: keyof typeof routes): Promise<Mod> {
  vi.resetModules()
  vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(employee) }))
  vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
  vi.doMock('@/lib/db', () => ({ db }))
  return (await routes[name]()) as unknown as Mod
}

const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  db = createFakeDb(tables())
})

describe('GET /api/holidays', () => {
  it('ulusal + aktif mağazanın yerel tatillerini döndürür, başka mağazanınkini değil', async () => {
    const { GET } = await mod(asManager, 'holidays')
    const res = await GET(req('http://localhost/api/holidays?from=2026-10-01&to=2026-10-31'))
    expect(res.status).toBe(200)
    const { holidays } = await res.json()
    expect(holidays.map((h: { id: string }) => h.id)).toEqual(['h-a', 'h-nat'])
    expect(holidays[0]).toMatchObject({ id: 'h-a', date: '2026-10-15', name: 'A yerel', half_day: false, store_id: STORE_A })
    expect(holidays[1].store_id).toBeNull()
  })

  it('admin başka mağazaya geçtiyse o mağazanın tatillerini görür', async () => {
    const { GET } = await mod(asAdminInB, 'holidays')
    const { holidays } = await (await GET(req('http://localhost/api/holidays?from=2026-10-01&to=2026-10-31'))).json()
    expect(holidays.map((h: { id: string }) => h.id)).toEqual(['h-b', 'h-nat'])
  })
})

describe('POST /api/holidays — yetkiler', () => {
  it('mağaza müdürü ulusal tatil ekleyemez (403) ve hiçbir şey yazılmaz', async () => {
    const { POST } = await mod(asManager, 'holidays')
    const res = await POST(req('http://localhost/api/holidays', 'POST', { date: '2026-12-31', name: 'Yılbaşı', scope: 'national' }))
    expect(res.status).toBe(403)
    expect(db.tables.public_holidays).toHaveLength(3)
    expect(db.tables.audit_logs).toHaveLength(3)
  })

  it('varsayılan kapsam mağazadır: store_id = aktif mağaza, denetim aynı mağazaya yazılır', async () => {
    const { POST } = await mod(asManager, 'holidays')
    const res = await POST(req('http://localhost/api/holidays', 'POST', { date: '2026-12-31', name: 'Mağaza günü', half_day: true }))
    expect(res.status).toBe(201)
    const { holiday } = await res.json()
    expect(holiday).toMatchObject({ date: '2026-12-31', store_id: STORE_A, half_day: true })
    const log = db.tables.audit_logs.find((l) => l.action === 'holiday.upsert')
    expect(log?.store_id).toBe(STORE_A)
  })

  it('aynı mağaza + tarih tekrar kaydedilince güncellenir', async () => {
    const { POST } = await mod(asManager, 'holidays')
    await POST(req('http://localhost/api/holidays', 'POST', { date: '2026-10-15', name: 'Yeni ad', scope: 'store' }))
    const rows = db.tables.public_holidays.filter((h) => h.date === '2026-10-15')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Yeni ad')
  })

  it('admin ulusal tatil ekleyebilir (store_id null)', async () => {
    const { POST } = await mod(asAdmin, 'holidays')
    const res = await POST(req('http://localhost/api/holidays', 'POST', { date: '2026-12-31', name: 'Yılbaşı', scope: 'national' }))
    expect(res.status).toBe(201)
    expect((await res.json()).holiday.store_id).toBeNull()
  })

  it('ulusal tatil gününe mağazaya özel tatil eklenemez (409) ve hiçbir şey yazılmaz', async () => {
    const { POST } = await mod(asManager, 'holidays')
    const res = await POST(req('http://localhost/api/holidays', 'POST', { date: '2026-10-29', name: 'Yarım gün', half_day: true }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('NATIONAL_HOLIDAY')
    expect(db.tables.public_holidays).toHaveLength(3)
  })

  it('aynı günde yerel kayıt kalmışsa ulusal tatil geçerlidir', async () => {
    db.tables.public_holidays.push({ id: 'h-old', store_id: STORE_A, date: '2026-10-29', name: 'Eski yerel', half_day: true })
    const { GET } = await mod(asManager, 'holidays')
    const { holidays } = await (await GET(req('http://localhost/api/holidays?from=2026-10-29&to=2026-10-29'))).json()
    expect(holidays).toHaveLength(1)
    expect(holidays[0]).toMatchObject({ id: 'h-nat', half_day: false, store_id: null })
  })

  it('geçersiz scope reddedilir (400)', async () => {
    const { POST } = await mod(asAdmin, 'holidays')
    const res = await POST(req('http://localhost/api/holidays', 'POST', { date: '2026-12-31', name: 'X', scope: 'global' }))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/holidays', () => {
  it('mağaza müdürü kendi mağazasının yerel tatilini siler', async () => {
    const { DELETE } = await mod(asManager, 'holidays')
    const res = await DELETE(req('http://localhost/api/holidays?date=2026-10-15', 'DELETE'))
    expect(res.status).toBe(200)
    expect(db.tables.public_holidays.some((h) => h.id === 'h-a')).toBe(false)
  })

  it('başka mağazanın yerel tatilini silemez (404); ulusalı da yerel kapsamla silemez', async () => {
    const { DELETE } = await mod(asManager, 'holidays')
    expect((await DELETE(req('http://localhost/api/holidays?date=2026-10-16', 'DELETE'))).status).toBe(404)
    expect((await DELETE(req('http://localhost/api/holidays?date=2026-10-29', 'DELETE'))).status).toBe(404)
    expect(db.tables.public_holidays).toHaveLength(3)
  })

  it('mağaza müdürü ulusal tatil silemez (403); admin silebilir', async () => {
    let m = await mod(asManager, 'holidays')
    expect((await m.DELETE(req('http://localhost/api/holidays?date=2026-10-29&scope=national', 'DELETE'))).status).toBe(403)
    expect(db.tables.public_holidays.some((h) => h.id === 'h-nat')).toBe(true)

    m = await mod(asAdmin, 'holidays')
    expect((await m.DELETE(req('http://localhost/api/holidays?date=2026-10-29&scope=national', 'DELETE'))).status).toBe(200)
    expect(db.tables.public_holidays.some((h) => h.id === 'h-nat')).toBe(false)
  })
})

describe('GET /api/audit-logs', () => {
  it('yalnızca aktif mağazanın kayıtlarını döndürür', async () => {
    const { GET } = await mod(asManager, 'audit')
    const { logs } = await (await GET(req('http://localhost/api/audit-logs'))).json()
    expect(logs.map((l: { id: string }) => l.id)).toEqual(['a1'])
  })

  it('admin mağaza değiştirince o mağazanın kayıtlarını görür', async () => {
    const { GET } = await mod(asAdminInB, 'audit')
    const { logs } = await (await GET(req('http://localhost/api/audit-logs'))).json()
    expect(logs.map((l: { id: string }) => l.id)).toEqual(['a2'])
  })
})

describe('GET /api/reports/timesheet', () => {
  type Body = { rows: Array<{ employee: { id: string }; days: Record<string, string> }>; holidays: Array<{ id: string }> }
  const bodyOf = async (employee: unknown) => {
    const { GET } = await mod(employee, 'timesheet')
    const res = await GET(req('http://localhost/api/reports/timesheet?month=2026-10'))
    expect(res.status).toBe(200)
    return (await res.json()) as Body
  }

  it('yalnızca aktif mağazanın vardiyaları; taşınan çalışan eski mağazada geçmişiyle görünür', async () => {
    const { rows, holidays } = await bodyOf(asManager)
    // A: aktif Ayşe + A'da Ekim'de vardiyası olan pasif Ali ve taşınan Can; Berk (B) yok
    expect(rows.map((r) => r.employee.id).sort()).toEqual([E_A1, E_A2, E_MOVED].sort())
    const moved = rows.find((r) => r.employee.id === E_MOVED)!
    expect(moved.days['2026-10-07']).toBeTruthy()      // A'daki vardiya var
    expect(moved.days['2026-10-20'] ?? '').not.toBe('Ç') // B'deki vardiya A'nın puantajında sayılmaz
    expect(moved.days['2026-10-20'] ?? '').not.toBe('P')
    // tatiller: ulusal + A yerel, B yerel yok
    expect(holidays.map((h) => h.id).sort()).toEqual(['h-a', 'h-nat'])
  })

  it('B mağazasında Can yeni vardiyasıyla görünür, A çalışanları görünmez', async () => {
    const { rows } = await bodyOf(asAdminInB)
    expect(rows.map((r) => r.employee.id).sort()).toEqual([E_B1, E_MOVED].sort())
    const moved = rows.find((r) => r.employee.id === E_MOVED)!
    expect(moved.days['2026-10-20']).toBeTruthy()
  })

  it('xlsx dosya adı mağaza slug içerir ve denetim mağazaya yazılır', { timeout: 30_000 }, async () => {
    const { GET } = await mod(asManager, 'timesheet')
    const res = await GET(req('http://localhost/api/reports/timesheet?month=2026-10&format=xlsx'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="puantaj-kadikoy-sube-2026-10.xlsx"')
    const log = db.tables.audit_logs.find((l) => l.action === 'report.timesheet.export')
    expect(log?.store_id).toBe(STORE_A)
  })
})

describe('GET /api/reports/attendance', () => {
  const get = async (employee: unknown, qs = '') => {
    const { GET } = await mod(employee, 'attendance')
    const res = await GET(req(`http://localhost/api/reports/attendance?date_from=2026-10-01&date_to=2026-10-31${qs}`))
    expect(res.status).toBe(200)
    return ((await res.json()) as { rows: Array<{ employee_id: string; work_date: string }> }).rows
  }

  it('yalnızca aktif mağazanın vardiyalarını listeler', async () => {
    const rows = await get(asManager)
    expect(rows.map((r) => r.work_date).sort()).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
  })

  it('employee_id filtresi mağaza dışı vardiyaları döndürmez', async () => {
    // Can: A'da 7 Ekim, B'de 20 Ekim → A raporunda yalnızca 7 Ekim
    expect((await get(asManager, `&employee_id=${E_MOVED}`)).map((r) => r.work_date)).toEqual(['2026-10-07'])
    // B çalışanı A raporunda boş
    expect(await get(asManager, `&employee_id=${E_B1}`)).toEqual([])
  })
})

describe('GET /api/reports/overtime', () => {
  it('çalışan listesi aktif mağaza kapsamındadır', async () => {
    const { GET } = await mod(asManager, 'overtime')
    const res = await GET(req('http://localhost/api/reports/overtime?year=2026'))
    expect(res.status).toBe(200)
    const { summaries } = (await res.json()) as { summaries: Array<{ employee_id: string }> }
    const ids = summaries.map((s) => s.employee_id)
    expect(ids).toContain(E_A1)
    expect(ids).not.toContain(E_B1)
    expect(ids).not.toContain(E_MOVED) // artık B'de ve A'da çalışılmış (kayıtlı) vardiyası yok
  })

  it('fazla çalışma çalışanın tüm mağazalardaki vardiyalarından hesaplanır (yasal sınır işveren düzeyinde)', async () => {
    // Can 5–10 Ekim haftasında 3 gün A'da, 3 gün B'de çalıştı: mağaza başına 45 saatin altında,
    // toplamda üstünde → A'nın raporunda da fazla çalışma görünür
    const att = (d: string) => ({
      attendance_records: {
        clock_in_at: `${d}T06:00:00Z`, clock_out_at: `${d}T15:00:00Z`,
        break_start_at: null, break_end_at: null, completed_break_minutes: 60,
      },
    })
    db.tables.shift_assignments = [
      ...['2026-10-05', '2026-10-06', '2026-10-07'].map((d, i) => shift(`ma${i}`, E_MOVED, STORE_A, d, att(d))),
      ...['2026-10-08', '2026-10-09', '2026-10-10'].map((d, i) => shift(`mb${i}`, E_MOVED, STORE_B, d, att(d))),
    ]
    const { GET } = await mod(asManager, 'overtime')
    const { summaries } = (await (await GET(req('http://localhost/api/reports/overtime?year=2026'))).json()) as {
      summaries: Array<{ employee_id: string; totalOvertimeMins: number }>
    }
    const can = summaries.find((s) => s.employee_id === E_MOVED)
    expect(can).toBeDefined()
    expect(can!.totalOvertimeMins).toBeGreaterThan(0)
  })
})

describe('GET /api/dashboard', () => {
  it('sayılar ve listeler aktif mağaza kapsamındadır', async () => {
    const today = turkeyToday()
    db.tables.shift_assignments.push(
      shift('t1', E_A1, STORE_A, today),
      shift('t2', E_B1, STORE_B, today),
      shift('t3', E_MOVED, STORE_B, today),
    )
    const { GET } = await mod(asManager, 'dashboard')
    const res = await GET(req('http://localhost/api/dashboard'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats.active_employees).toBe(1)         // yalnızca Ayşe (Ali pasif; diğerleri B)
    expect(body.stats.today_shifts).toBe(1)
    expect(body.today_roster.map((r: { employee_id: string }) => r.employee_id)).toEqual([E_A1])
    expect(body.stats.pending_leaves).toBe(1)           // yalnızca A çalışanının izni
    expect(body.pending_leaves.map((l: { id: string }) => l.id)).toEqual(['l1'])
  })

  it('admin B mağazasına geçince B verisini görür', async () => {
    const { GET } = await mod(asAdminInB, 'dashboard')
    const body = await (await GET(req('http://localhost/api/dashboard'))).json()
    expect(body.stats.active_employees).toBe(2)         // Berk + Can
    expect(body.pending_leaves.map((l: { id: string }) => l.id)).toEqual(['l2'])
  })
})
