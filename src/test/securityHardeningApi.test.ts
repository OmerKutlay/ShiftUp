/**
 * securityHardeningApi.test.ts — güvenlik denetimi düzeltmeleri.
 *
 *  - PATCH /api/employees/[id]: e-posta (= OTP ile giriş) yalnızca Müdür+ değiştirebilir; e-posta
 *    değişince / pasifleştirmede oturumlar revoke_employee_access ile gerçekten kapatılır.
 *  - POST /api/shift-swap/review: yönetici, kendinden yüksek yetkilinin takasına karar veremez.
 *  - POST /api/qr/generate: yönetici kendi adına QR üretemez (kiosk'u atlayarak giriş yapamaz).
 *  - POST /api/leave (weekly_rest): üst yetkiliye atanamaz; kendine ve geçmiş haftalara geriye dönük atanamaz.
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

import { PATCH as employeePATCH } from '@/app/api/employees/[id]/route'
import { POST as swapReview } from '@/app/api/shift-swap/review/route'
import { POST as qrGenerate } from '@/app/api/qr/generate/route'
import { POST as leavePOST } from '@/app/api/leave/route'
import { turkeyToday, addDaysToDateString, mondayOfDateString } from '@/lib/dateUtils'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const STORE = uuid(1)
const ROLE_SM = uuid(11)
const ROLE_MGR = uuid(12)
const ROLE_EMP = uuid(13)
const SM = uuid(21)
const MGR = uuid(22)
const EMP1 = uuid(23)
const EMP2 = uuid(24)
const SH_SM = uuid(30)
const SH_E1 = uuid(31)
const SH_E2 = uuid(32)
const SWAP_SM = uuid(40)
const SWAP_EMP = uuid(41)
const AUTH_EMP1 = uuid(90)
const FUTURE = '2099-01-05'

const roleRow = (id: string, level: string, name: string) => ({
  id, name, description: null, access_level: level, planning_group: null, sort_order: 1,
})
const emp = (id: string, name: string, roleId: string, level: string, authUserId: string | null = null) => ({
  id, full_name: name, email: `${name.toLowerCase().replace(/\s/g, '.')}@test.com`, role_id: roleId,
  active: true, store_id: STORE, employment_type: 'full_time', auth_user_id: authUserId,
  hire_date: null, birth_date: null, termination_date: null, roles: { access_level: level },
})
const shift = (id: string, employeeId: string) => ({
  id, employee_id: employeeId, store_id: STORE, work_date: FUTURE, start_time: '09:00', end_time: '17:00',
})
const swap = (id: string, requester: string, requesterShift: string, target: string, targetShift: string) => ({
  id, requester_id: requester, requester_shift_id: requesterShift, target_id: target, target_shift_id: targetShift,
  status: 'pending', target_accepted_at: '2099-01-01T00:00:00Z',
})

let revoked: string[][] = []

function seed(): FakeDb {
  return createFakeDb({
    stores: [{ id: STORE, name: 'A', active: true }],
    roles: [
      roleRow(ROLE_SM, ACCESS.STORE_MANAGER, 'Müdür'),
      roleRow(ROLE_MGR, ACCESS.MANAGER, 'Yönetici'),
      roleRow(ROLE_EMP, ACCESS.EMPLOYEE, 'Çalışan'),
    ],
    employees: [
      emp(SM, 'Müdür', ROLE_SM, ACCESS.STORE_MANAGER),
      emp(MGR, 'Yönetici', ROLE_MGR, ACCESS.MANAGER),
      emp(EMP1, 'Ali', ROLE_EMP, ACCESS.EMPLOYEE, AUTH_EMP1),
      emp(EMP2, 'Veli', ROLE_EMP, ACCESS.EMPLOYEE),
    ],
    shift_assignments: [shift(SH_SM, SM), shift(SH_E1, EMP1), shift(SH_E2, EMP2)],
    shift_swap_requests: [
      swap(SWAP_SM, SM, SH_SM, EMP1, SH_E1),
      swap(SWAP_EMP, EMP1, SH_E1, EMP2, SH_E2),
    ],
    attendance_records: [],
    audit_logs: [],
    notifications: [],
    leave_requests: [],
    qr_tokens: [],
    announcements: [],
    announcement_recipients: [],
  }, {
    rpc: {
      revoke_employee_access: (a: { p_ids: string[] }) => {
        revoked.push(a.p_ids)
        return { data: null }
      },
      rate_limit_hit: () => ({ data: [{ allowed: true, remaining: 10, reset_at: new Date(Date.now() + 60_000).toISOString() }] }),
    },
  })
}

const session = (id: string, name: string, level: string) => ({
  id, full_name: name, email: null, role_id: null, role_name: null, access_level: level,
  active: true, home_store_id: STORE, store_id: STORE,
})
const asStoreManager = () => (state.employee = session(SM, 'Müdür', ACCESS.STORE_MANAGER))
const asManager = () => (state.employee = session(MGR, 'Yönetici', ACCESS.MANAGER))

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const db = () => state.db as FakeDb

beforeEach(() => {
  state.db = seed()
  state.employee = null
  revoked = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('PATCH /api/employees/[id] — e-posta değişikliği (hesap devralma)', () => {
  it('Yönetici, astının e-postasını değiştiremez (403); e-posta aynı kalır', async () => {
    asManager()
    const res = await employeePATCH(json(`/api/employees/${EMP1}`, 'PATCH', { email: 'saldirgan@test.com' }), ctx(EMP1))
    expect(res.status).toBe(403)
    expect(db().tables.employees.find((e) => e.id === EMP1)?.email).toBe('ali@test.com')
    expect(revoked).toEqual([])
  })

  it('Yönetici aynı e-postayı göndererek diğer alanları güncelleyebilir', async () => {
    asManager()
    const res = await employeePATCH(
      json(`/api/employees/${EMP1}`, 'PATCH', { full_name: 'Ali Yeni', email: 'ali@test.com' }), ctx(EMP1))
    expect(res.status).toBe(200)
    expect(db().tables.employees.find((e) => e.id === EMP1)?.full_name).toBe('Ali Yeni')
  })

  it('Müdür e-postayı değiştirebilir; çalışanın oturumları revoke_employee_access ile kapatılır', async () => {
    asStoreManager()
    const res = await employeePATCH(json(`/api/employees/${EMP1}`, 'PATCH', { email: 'ali.yeni@test.com' }), ctx(EMP1))
    expect(res.status).toBe(200)
    expect(db().tables.employees.find((e) => e.id === EMP1)?.email).toBe('ali.yeni@test.com')
    expect(revoked).toEqual([[EMP1]])
  })

  it('pasifleştirmede oturumlar kapatılır', async () => {
    asStoreManager()
    const res = await employeePATCH(json(`/api/employees/${EMP1}`, 'PATCH', { active: false }), ctx(EMP1))
    expect(res.status).toBe(200)
    expect(revoked).toEqual([[EMP1]])
  })
})

describe('POST /api/shift-swap/review — yetki hiyerarşisi', () => {
  it('Yönetici, Müdürün tarafı olduğu takası reddedemez (403); talep değişmez', async () => {
    asManager()
    const res = await swapReview(json('/api/shift-swap/review', 'POST', { swap_id: SWAP_SM, status: 'rejected' }))
    expect(res.status).toBe(403)
    expect(db().tables.shift_swap_requests.find((s) => s.id === SWAP_SM)?.status).toBe('pending')
  })

  it('Yönetici, iki çalışan arasındaki takası reddedebilir', async () => {
    asManager()
    const res = await swapReview(json('/api/shift-swap/review', 'POST', { swap_id: SWAP_EMP, status: 'rejected' }))
    expect(res.status).toBe(200)
    expect(db().tables.shift_swap_requests.find((s) => s.id === SWAP_EMP)?.status).toBe('rejected')
  })
})

describe('POST /api/qr/generate — kendi adına kod', () => {
  it('yönetici kendi adına QR üretemez (403)', async () => {
    asManager()
    const res = await qrGenerate(json('/api/qr/generate', 'POST', { employee_id: MGR, action_type: 'clock_in' }))
    expect(res.status).toBe(403)
    expect(db().tables.qr_tokens).toHaveLength(0)
  })
})

describe('POST /api/leave — haftalık tatil (doğrudan onaylı, vardiyayı siler)', () => {
  const rest = (employeeId: string, date: string) =>
    leavePOST(json('/api/leave', 'POST', { employee_id: employeeId, leave_type: 'weekly_rest', start_date: date, end_date: date }))

  it('Yönetici, Müdüre haftalık tatil atayamaz (403); vardiyası silinmez', async () => {
    asManager()
    const res = await rest(SM, FUTURE)
    expect(res.status).toBe(403)
    expect(db().tables.leave_requests).toHaveLength(0)
    expect(db().tables.shift_assignments.some((s) => s.id === SH_SM)).toBe(true)
  })

  it('Yönetici kendine geçmiş tarihli haftalık tatil atayamaz (gelinmeyen günü tatile çevirme)', async () => {
    asManager()
    const res = await rest(MGR, addDaysToDateString(turkeyToday(), -1))
    expect(res.status).toBe(403)
    expect(db().tables.leave_requests).toHaveLength(0)
  })

  it('geçmiş haftalara haftalık tatil atanamaz (400)', async () => {
    asManager()
    const res = await rest(EMP1, addDaysToDateString(mondayOfDateString(turkeyToday()), -3))
    expect(res.status).toBe(400)
    expect(db().tables.leave_requests).toHaveLength(0)
  })

  it('Yönetici çalışana ileri tarihli haftalık tatil atayabilir; o günün vardiyası kaldırılır', async () => {
    asManager()
    const res = await rest(EMP2, FUTURE)
    expect(res.status).toBeLessThan(300)
    expect(db().tables.leave_requests[0]).toMatchObject({ employee_id: EMP2, status: 'approved' })
    expect(db().tables.shift_assignments.some((s) => s.id === SH_E2)).toBe(false)
  })

  it('planlayıcı kendi ileri tarihli haftalık tatilini işaretleyebilir', async () => {
    asManager()
    const res = await rest(MGR, FUTURE)
    expect(res.status).toBeLessThan(300)
  })
})

describe('mondayOfDateString', () => {
  it('haftanın pazartesisini verir', () => {
    expect(mondayOfDateString('2026-10-27')).toBe('2026-10-26') // salı
    expect(mondayOfDateString('2026-10-26')).toBe('2026-10-26') // pazartesi
    expect(mondayOfDateString('2026-11-01')).toBe('2026-10-26') // pazar
  })
})
