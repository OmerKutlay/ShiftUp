/**
 * storeNormApi.test.ts — /api/stores/norm: yetki, mağaza izolasyonu, kullanım hesabı, bildirim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/db', () => ({
  db: { from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t) },
}))

import { GET, PUT, DELETE } from '@/app/api/stores/norm/route'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const STORE_A = uuid(1)
const STORE_B = uuid(2)
const ADMIN = uuid(20)
const SM_A = uuid(21)
const MGR_A = uuid(22)
const EMP_A1 = uuid(23)
const KIOSK_A = uuid(24)
const EMP_B1 = uuid(25)
const MGR_B = uuid(26)

const e = (id: string, store: string, level: string) => ({
  id, full_name: id, store_id: store, active: true, hire_date: null, role_id: null, roles: { access_level: level },
})

function seed(): FakeDb {
  return createFakeDb({
    stores: [
      { id: STORE_A, name: 'A', active: true },
      { id: STORE_B, name: 'B', active: true },
    ],
    employees: [
      e(ADMIN, STORE_A, ACCESS.ADMIN),
      e(SM_A, STORE_A, ACCESS.STORE_MANAGER),
      e(MGR_A, STORE_A, ACCESS.MANAGER),
      e(EMP_A1, STORE_A, ACCESS.EMPLOYEE),
      e(KIOSK_A, STORE_A, ACCESS.KIOSK),
      e(EMP_B1, STORE_B, ACCESS.EMPLOYEE),
      e(MGR_B, STORE_B, ACCESS.MANAGER),
    ],
    shift_assignments: [
      // A mağazası: 8 sa net ×2 (biri izinli → sayılmaz), ay dışı ve B mağazası sayılmaz
      { id: uuid(40), employee_id: EMP_A1, store_id: STORE_A, work_date: '2026-11-02', start_time: '09:00', end_time: '18:00', is_on_leave: false },
      { id: uuid(41), employee_id: EMP_A1, store_id: STORE_A, work_date: '2026-11-03', start_time: '09:00', end_time: '18:00', is_on_leave: false },
      { id: uuid(42), employee_id: EMP_A1, store_id: STORE_A, work_date: '2026-11-04', start_time: '09:00', end_time: '18:00', is_on_leave: true },
      { id: uuid(43), employee_id: EMP_A1, store_id: STORE_A, work_date: '2026-10-30', start_time: '09:00', end_time: '18:00', is_on_leave: false },
      { id: uuid(44), employee_id: EMP_B1, store_id: STORE_B, work_date: '2026-11-02', start_time: '09:00', end_time: '18:00', is_on_leave: false },
    ],
    attendance_records: [],
    store_monthly_norms: [],
    audit_logs: [],
    notifications: [],
  })
}

const session = (id: string, level: string, home: string, active = home) => ({
  id, full_name: id, email: null, role_id: null, role_name: null, access_level: level,
  active: true, home_store_id: home, store_id: active,
})
const as = (id: string, level: string, home = STORE_A, active = home) => (state.employee = session(id, level, home, active))

const req = (method: string, qs = '', body?: unknown) =>
  new NextRequest(`http://localhost/api/stores/norm${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const tbl = (name: string) => (state.db as FakeDb).tables[name]

beforeEach(() => {
  state.db = seed()
  state.employee = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/stores/norm', () => {
  it('oturumsuz 401, çalışan 403', async () => {
    expect((await GET(req('GET', '?month=2026-11'))).status).toBe(401)
    as(EMP_A1, ACCESS.EMPLOYEE)
    expect((await GET(req('GET', '?month=2026-11'))).status).toBe(403)
  })

  it('geçersiz ay 400', async () => {
    as(MGR_A, ACCESS.MANAGER)
    expect((await GET(req('GET', '?month=2026-13'))).status).toBe(400)
    expect((await GET(req('GET'))).status).toBe(400)
  })

  it('yönetici yalnızca kendi mağazasını görür: varsayılan norm, izin ve başka mağaza hariç', async () => {
    as(MGR_A, ACCESS.MANAGER)
    const res = await GET(req('GET', '?month=2026-11'))
    expect(res.status).toBe(200)
    const { norm } = await res.json()
    // Aktif, kiosk olmayan 4 kişi × 45 × 30/7 = 771,4 → 780
    expect(norm).toMatchObject({ source: 'default', normHours: 780, employeeCount: 4, plannedHours: 16, remainingHours: 764 })
  })

  it('Admin aktif mağazaya göre B mağazasını görür', async () => {
    as(ADMIN, ACCESS.ADMIN, STORE_A, STORE_B)
    const { norm } = await (await GET(req('GET', '?month=2026-11'))).json()
    expect(norm.plannedHours).toBe(8)
    expect(norm.employeeCount).toBe(2)
  })

  it('girilmiş norm varsayılanı ezer', async () => {
    tbl('store_monthly_norms').push({ store_id: STORE_A, month: '2026-11-01', norm_hours: 1240, note: 'x', set_by: ADMIN })
    as(SM_A, ACCESS.STORE_MANAGER)
    const { norm } = await (await GET(req('GET', '?month=2026-11'))).json()
    expect(norm).toMatchObject({ source: 'set', normHours: 1240, note: 'x' })
  })

  it('scope=all yalnızca Admin', async () => {
    as(SM_A, ACCESS.STORE_MANAGER)
    expect((await GET(req('GET', '?month=2026-11&scope=all'))).status).toBe(403)
    as(ADMIN, ACCESS.ADMIN)
    const body = await (await GET(req('GET', '?month=2026-11&scope=all'))).json()
    expect(body.stores.map((s: { storeId: string }) => s.storeId).sort()).toEqual([STORE_A, STORE_B].sort())
  })
})

describe('PUT /api/stores/norm', () => {
  const body = { month: '2026-11', normHours: 1240, note: 'Kasım hakkı' }

  it('Admin dışı yazamaz', async () => {
    for (const [id, level] of [[SM_A, ACCESS.STORE_MANAGER], [MGR_A, ACCESS.MANAGER], [EMP_A1, ACCESS.EMPLOYEE]] as const) {
      as(id, level)
      expect((await PUT(req('PUT', '', body))).status).toBe(403)
    }
    expect(tbl('store_monthly_norms')).toHaveLength(0)
  })

  it('doğrulama: ay, saat, not, mağaza', async () => {
    as(ADMIN, ACCESS.ADMIN)
    expect((await PUT(req('PUT', '', { ...body, month: '2026-11-05' }))).status).toBe(400)
    expect((await PUT(req('PUT', '', { ...body, normHours: 0 }))).status).toBe(400)
    expect((await PUT(req('PUT', '', { ...body, normHours: -5 }))).status).toBe(400)
    expect((await PUT(req('PUT', '', { ...body, normHours: '100' }))).status).toBe(400)
    expect((await PUT(req('PUT', '', { ...body, note: 'x'.repeat(501) }))).status).toBe(400)
    expect((await PUT(req('PUT', '', { ...body, storeId: 'bad' }))).status).toBe(404)
  })

  it('upsert + audit + yalnızca o mağazanın yöneticilerine bildirim', async () => {
    as(ADMIN, ACCESS.ADMIN)
    const res = await PUT(req('PUT', '', body))
    expect(res.status).toBe(200)
    expect((await res.json()).norm).toMatchObject({ source: 'set', normHours: 1240 })
    // ikinci çağrı aynı satırı günceller
    await PUT(req('PUT', '', { ...body, normHours: 1300 }))
    const rows = tbl('store_monthly_norms')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ store_id: STORE_A, month: '2026-11-01', norm_hours: 1300, set_by: ADMIN })

    const audits = tbl('audit_logs')
    expect(audits.map((a) => a.action)).toEqual(['store_norm.set', 'store_norm.set'])
    expect(audits[1]).toMatchObject({ store_id: STORE_A, actor_id: ADMIN })

    const notes = tbl('notifications').filter((n) => n.type === 'store_norm_set')
    expect(new Set(notes.map((n) => n.employee_id))).toEqual(new Set([SM_A, MGR_A])) // B mağazası ve Admin yok
    expect(notes[0].message).toBe('Kasım 2026 norm saatiniz: 1.240 saat — Kasım hakkı')
  })

  it('Admin storeId ile başka mağazaya yazabilir', async () => {
    as(ADMIN, ACCESS.ADMIN)
    expect((await PUT(req('PUT', '', { ...body, storeId: STORE_B }))).status).toBe(200)
    expect(tbl('store_monthly_norms')[0].store_id).toBe(STORE_B)
    expect(tbl('notifications').map((n) => n.employee_id)).toEqual([MGR_B])
  })
})

describe('DELETE /api/stores/norm', () => {
  it('Admin dışı silemez; Admin siler ve varsayılana döner', async () => {
    tbl('store_monthly_norms').push({ store_id: STORE_A, month: '2026-11-01', norm_hours: 1240, note: null, set_by: ADMIN })
    as(SM_A, ACCESS.STORE_MANAGER)
    expect((await DELETE(req('DELETE', '?month=2026-11'))).status).toBe(403)
    expect(tbl('store_monthly_norms')).toHaveLength(1)

    as(ADMIN, ACCESS.ADMIN)
    const res = await DELETE(req('DELETE', '?month=2026-11'))
    expect(res.status).toBe(200)
    expect((await res.json()).norm.source).toBe('default')
    expect(tbl('store_monthly_norms')).toHaveLength(0)
    expect(tbl('audit_logs').map((a) => a.action)).toEqual(['store_norm.delete'])
    expect((await DELETE(req('DELETE', '?month=2026-11'))).status).toBe(404)
  })
})
