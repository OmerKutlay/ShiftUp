// @vitest-environment node
/**
 * attendanceStoreScope.test.ts — çoklu mağaza izolasyonu: günlük liste, durum sorgusu,
 * override, okutulmamış giriş/çıkış bildirimleri ve mağaza konumu API'si.
 * Oturum mock'lanır; veri bellek içi fake Supabase ile çalışır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const STORE_A = '00000000-0000-0000-0003-00000000000a'
const STORE_B = '00000000-0000-0000-0003-00000000000b'

const base = { email: null, role_id: null, role_name: null, active: true }
const managerA = { ...base, id: 'mgr-a', full_name: 'Ayşe', access_level: ACCESS.MANAGER, home_store_id: STORE_A, store_id: STORE_A }
const storeManagerA = { ...managerA, id: 'sm-a', access_level: ACCESS.STORE_MANAGER }

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))
const logAudit = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/db', () => ({ db: new Proxy({}, { get: (_t, p) => (state.db as Record<string | symbol, unknown>)[p] }) }))
vi.mock('@/lib/auditLog', () => ({ logAudit }))

let db: FakeDb
function useDb(tables: Record<string, Record<string, unknown>[]>, options = {}) {
  db = createFakeDb(tables, options)
  state.db = db
}

beforeEach(() => {
  vi.clearAllMocks()
  state.employee = managerA
})

// ============================================================
// Günlük operasyon
// ============================================================
describe('GET /api/attendance/daily — mağaza filtresi', () => {
  it('yalnızca aktif mağazanın vardiyalarını listeler', async () => {
    const date = '2026-10-26'
    useDb({
      shift_assignments: [
        { id: 's-a', employee_id: 'e-a', store_id: STORE_A, work_date: date, start_time: '09:00', end_time: '17:00', employees: { id: 'e-a', full_name: 'A Çalışanı' } },
        { id: 's-b', employee_id: 'e-b', store_id: STORE_B, work_date: date, start_time: '09:00', end_time: '17:00', employees: { id: 'e-b', full_name: 'B Çalışanı' } },
      ],
      attendance_records: [],
    })
    const { GET } = await import('@/app/api/attendance/daily/route')
    const res = await GET(new NextRequest(`http://localhost/api/attendance/daily?date=${date}`))
    const body = (await res.json()) as { entries: { shiftAssignment: { id: string } }[] }
    expect(res.status).toBe(200)
    expect(body.entries.map((e) => e.shiftAssignment.id)).toEqual(['s-a'])
  })

  it('admin başka mağazayı aktif seçtiyse o mağazanın vardiyalarını görür', async () => {
    const date = '2026-10-26'
    state.employee = { ...managerA, access_level: ACCESS.ADMIN, store_id: STORE_B }
    useDb({
      shift_assignments: [
        { id: 's-a', employee_id: 'e-a', store_id: STORE_A, work_date: date, start_time: '09:00', end_time: '17:00', employees: {} },
        { id: 's-b', employee_id: 'e-b', store_id: STORE_B, work_date: date, start_time: '09:00', end_time: '17:00', employees: {} },
      ],
      attendance_records: [],
    })
    const { GET } = await import('@/app/api/attendance/daily/route')
    const res = await GET(new NextRequest(`http://localhost/api/attendance/daily?date=${date}`))
    const body = (await res.json()) as { entries: { shiftAssignment: { id: string } }[] }
    expect(body.entries.map((e) => e.shiftAssignment.id)).toEqual(['s-b'])
  })
})

// ============================================================
// Durum sorgusu (başka çalışan)
// ============================================================
describe('GET /api/attendance/current-status — employee_id mağaza doğrulaması', () => {
  const EMP_A = '00000000-0000-4000-8000-0000000000a1'
  const EMP_B = '00000000-0000-4000-8000-0000000000b1'
  const call = async (employeeId: string) => {
    const { GET } = await import('@/app/api/attendance/current-status/route')
    return GET(new NextRequest(`http://localhost/api/attendance/current-status?employee_id=${employeeId}`))
  }

  beforeEach(() => {
    useDb({
      employees: [
        { id: EMP_A, store_id: STORE_A, active: true },
        { id: EMP_B, store_id: STORE_B, active: true },
      ],
      shift_assignments: [],
      attendance_records: [],
    })
  })

  it('başka mağazanın çalışanı için 404 döner', async () => {
    const res = await call(EMP_B)
    expect(res.status).toBe(404)
  })

  it('aynı mağazanın çalışanı için durum döner', async () => {
    const res = await call(EMP_A)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ has_shift: false })
  })
})

// ============================================================
// Override
// ============================================================
describe('POST /api/attendance/override — mağaza doğrulaması', () => {
  const REC_A = '00000000-0000-4000-8000-0000000000c1'
  const REC_B = '00000000-0000-4000-8000-0000000000c2'
  const stamp = '2026-10-26T06:00:00.000Z'

  const record = (id: string, shiftId: string, employeeId: string) => ({
    id, employee_id: employeeId, shift_assignment_id: shiftId, status: 'working',
    clock_in_at: stamp, break_start_at: null, break_end_at: null, clock_out_at: null,
    completed_break_minutes: 0, exception_note: null, updated_at: stamp,
  })
  const post = async (recordId: string) => {
    const { POST } = await import('@/app/api/attendance/override/route')
    return POST(new NextRequest('http://localhost/api/attendance/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record_id: recordId, status: 'clocked_out', clock_out_at: '2026-10-26T14:00:00.000Z', exception_note: 'Çıkış unutuldu',
      }),
    }))
  }

  beforeEach(() => {
    useDb({
      shift_assignments: [
        { id: 'shift-a', employee_id: 'e-a', store_id: STORE_A },
        { id: 'shift-b', employee_id: 'e-b', store_id: STORE_B },
      ],
      attendance_records: [record(REC_A, 'shift-a', 'e-a'), record(REC_B, 'shift-b', 'e-b')],
      notifications: [],
    })
  })

  it('başka mağazanın kaydı 404 döner ve değişmez', async () => {
    const res = await post(REC_B)
    expect(res.status).toBe(404)
    expect(db.tables.attendance_records.find((r) => r.id === REC_B)?.status).toBe('working')
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('aktif mağazanın kaydı düzeltilir; denetim kaydı mağaza kimliğini taşır', async () => {
    const res = await post(REC_A)
    expect(res.status).toBe(200)
    expect(db.tables.attendance_records.find((r) => r.id === REC_A)?.status).toBe('clocked_out')
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ storeId: STORE_A, entityId: REC_A }))
  })
})

// ============================================================
// Okutulmamış giriş/çıkış bildirimleri
// ============================================================
describe('scanMissedAttendance / notifyIfLateAttendance — bildirim yalnızca aynı mağazanın yöneticilerine', () => {
  const NOW = new Date('2026-10-26T10:00:00+03:00')
  const manager = (id: string, storeId: string, level: string) => ({
    id, store_id: storeId, active: true, roles: { access_level: level },
  })
  const shift = (id: string, employeeId: string, storeId: string) => ({
    id, employee_id: employeeId, store_id: storeId, work_date: '2026-10-26', start_time: '09:00:00', end_time: '17:00:00',
    is_on_leave: false, employees: { full_name: `Çalışan ${employeeId}`, active: true },
  })
  const recipients = (relatedId: string) =>
    db.tables.notifications.filter((n) => n.related_id === relatedId).map((n) => n.employee_id).sort()

  beforeEach(() => {
    useDb({
      employees: [
        manager('mgr-a', STORE_A, 'manager'),
        manager('mgr-b', STORE_B, 'store_manager'),
        manager('adm', STORE_A, 'admin'),
        { id: 'emp-a', store_id: STORE_A, active: true, roles: { access_level: 'employee' } },
      ],
      shift_assignments: [shift('s-a', 'emp-a', STORE_A), shift('s-b', 'emp-b', STORE_B)],
      attendance_records: [],
      notifications: [],
    })
  })

  it('her vardiya için yalnızca kendi mağazasının yöneticileri + adminler bilgilendirilir', async () => {
    const { scanMissedAttendance } = await import('@/lib/attendanceAlerts')
    const result = await scanMissedAttendance(db as never, NOW)

    expect(result).toEqual({ checked: 2, notified: 2 })
    expect(recipients('s-a')).toEqual(['adm', 'mgr-a'])
    expect(recipients('s-b')).toEqual(['adm', 'mgr-b'])
  })

  it('geç okutma bildirimi vardiyanın mağazasının yöneticilerine gider', async () => {
    const { notifyIfLateAttendance } = await import('@/lib/attendanceAlerts')
    await notifyIfLateAttendance(db as never, {
      storeId: STORE_B,
      employeeId: 'emp-b',
      employeeName: 'Çalışan emp-b',
      shift: { id: 's-b', work_date: '2026-10-26', start_time: '09:00:00', end_time: '17:00:00' },
      action: 'clock_in',
      at: NOW,
    })
    expect(recipients('s-b')).toEqual(['adm', 'mgr-b'])
  })
})

// ============================================================
// Mağaza konumu API
// ============================================================
describe('/api/store-location — mağaza kapsamı', () => {
  const LOC_A = '00000000-0000-4000-8000-0000000000d1'
  const LOC_B = '00000000-0000-4000-8000-0000000000d2'
  const loc = (id: string, storeId: string, active: boolean) => ({
    id, store_id: storeId, name: `Konum ${id.slice(-2)}`, latitude: 41, longitude: 29,
    allowed_radius_meters: 150, max_accuracy_meters: 50, active, created_at: '2026-10-01T00:00:00Z',
  })
  const payload = (extra: Record<string, unknown> = {}) => ({
    name: 'Yeni konum', latitude: 41.01, longitude: 29.02, allowed_radius_meters: 120, max_accuracy_meters: 40, active: true, ...extra,
  })
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/store-location/route')
    return POST(new NextRequest('http://localhost/api/store-location', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  }

  beforeEach(() => {
    state.employee = storeManagerA
    useDb({ store_locations: [loc(LOC_A, STORE_A, true), loc(LOC_B, STORE_B, true)] })
  })

  it('GET yalnızca aktif mağazanın konumlarını döner', async () => {
    const { GET } = await import('@/app/api/store-location/route')
    const res = await GET(new NextRequest('http://localhost/api/store-location'))
    const body = (await res.json()) as { locations: { id: string }[] }
    expect(body.locations.map((l) => l.id)).toEqual([LOC_A])
  })

  it('yeni aktif konum store_id ile eklenir; mağazanın önceki aktif konumu pasifleşir, diğer mağaza etkilenmez', async () => {
    const res = await post(payload())
    expect(res.status).toBe(201)
    const created = ((await res.json()) as { location: { id: string; store_id: string } }).location
    expect(created.store_id).toBe(STORE_A)

    const rows = db.tables.store_locations
    expect(rows.find((r) => r.id === LOC_A)?.active).toBe(false)
    expect(rows.find((r) => r.id === created.id)?.active).toBe(true)
    expect(rows.find((r) => r.id === LOC_B)?.active).toBe(true)
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ storeId: STORE_A, action: 'store_location.create' }))
  })

  it('pasif konum eklenirken mevcut aktif konum korunur', async () => {
    await post(payload({ active: false }))
    expect(db.tables.store_locations.find((r) => r.id === LOC_A)?.active).toBe(true)
  })

  it('başka mağazanın konumunu güncelleme 404 döner ve değişmez', async () => {
    const res = await post(payload({ id: LOC_B, name: 'Ele geçirildi' }))
    expect(res.status).toBe(404)
    const b = db.tables.store_locations.find((r) => r.id === LOC_B)
    expect(b?.name).not.toBe('Ele geçirildi')
    expect(b?.active).toBe(true)
  })

  it('kendi mağazasının konumunu günceller', async () => {
    const res = await post(payload({ id: LOC_A, name: 'Güncel' }))
    expect(res.status).toBe(200)
    expect(db.tables.store_locations.find((r) => r.id === LOC_A)?.name).toBe('Güncel')
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ storeId: STORE_A, action: 'store_location.update' }))
  })
})
