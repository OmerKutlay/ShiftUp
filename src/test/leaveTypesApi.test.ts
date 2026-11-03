/**
 * leaveTypesApi.test.ts — yönetilebilir izin türleri.
 *
 *  - /api/leave-types: herkes okur; yalnızca Admin ekler / günceller; puantaj kodu değişmez; aynı ad 409.
 *  - POST /api/leave: tür tanımdan gelir (leave_type = tanımın temel türü); pasif tür ve çalışan talebine
 *    kapalı tür reddedilir; approve=true ile yönetici planda doğrudan onaylı izin verir (kendine değil).
 *  - GET /api/leave: başkasının hastalık raporunun tür adı (tanımı) da gizlenir.
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

import { GET as typesGET, POST as typesPOST } from '@/app/api/leave-types/route'
import { PATCH as typePATCH } from '@/app/api/leave-types/[id]/route'
import { GET as leaveGET, POST as leavePOST } from '@/app/api/leave/route'

const uuid = (n: number) => `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`
const STORE = uuid(1)
const ADMIN = uuid(20)
const MGR = uuid(22)
const EMP = uuid(23)
const EMP2 = uuid(24)
const T_ANNUAL = uuid(50)
const T_SICK = uuid(51)
const T_PAID = uuid(52)
const T_HOLIDAY = uuid(53)
const T_OLD = uuid(54)
const FUTURE = '2099-03-02'

const def = (id: string, name: string, base: string, over: Record<string, unknown> = {}) => ({
  id, name, base_type: base, employee_requestable: true, active: true, sort_order: 10, system_key: null, ...over,
})
const emp = (id: string, name: string, level: string) => ({
  id, full_name: name, email: `${id}@test.com`, role_id: null, active: true, store_id: STORE,
  employment_type: 'full_time', auth_user_id: null, hire_date: null, birth_date: null, termination_date: null,
  roles: { access_level: level },
})

function seed(): FakeDb {
  return createFakeDb({
    stores: [{ id: STORE, name: 'A', active: true }],
    employees: [
      emp(ADMIN, 'Admin', ACCESS.ADMIN), emp(MGR, 'Yönetici', ACCESS.MANAGER),
      emp(EMP, 'Ali', ACCESS.EMPLOYEE), emp(EMP2, 'Veli', ACCESS.EMPLOYEE),
    ],
    leave_type_definitions: [
      def(T_ANNUAL, 'Yıllık izin', 'annual', { system_key: 'annual' }),
      def(T_SICK, 'Hastalık raporu', 'sick', { system_key: 'sick' }),
      def(T_PAID, 'Ücretli izin', 'personal', { system_key: 'personal' }),
      def(T_HOLIDAY, 'Resmi tatil', 'public_holiday', { system_key: 'public_holiday', employee_requestable: false }),
      def(T_OLD, 'Eski tür', 'personal', { active: false }),
    ],
    shift_assignments: [{ id: uuid(60), employee_id: EMP, store_id: STORE, work_date: FUTURE, start_time: '09:00', end_time: '17:00' }],
    attendance_records: [],
    audit_logs: [],
    notifications: [],
    leave_requests: [],
    holidays: [],
    public_holidays: [],
  }, {
    unique: { leave_type_definitions: [['name']] },
    rpc: {
      rate_limit_hit: () => ({ data: [{ allowed: true, remaining: 10, reset_at: new Date(Date.now() + 60_000).toISOString() }] }),
      restore_recurring_weekly_rests: () => ({ data: 0 }),
    },
  })
}

const session = (id: string, level: string) => ({
  id, full_name: id, email: null, role_id: null, role_name: null, access_level: level,
  active: true, home_store_id: STORE, store_id: STORE,
})
const as = (id: string, level: string) => (state.employee = session(id, level))

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
})

describe('/api/leave-types', () => {
  it('oturumdaki herkes türleri okur (pasifler dahil)', async () => {
    as(EMP, ACCESS.EMPLOYEE)
    const res = await typesGET(json('/api/leave-types', 'GET'))
    expect(res.status).toBe(200)
    expect((await res.json()).types).toHaveLength(5)
  })

  it('yalnızca Admin tür ekler; resmi tatil varsayılan olarak çalışan talebine kapalı', async () => {
    as(MGR, ACCESS.MANAGER)
    expect((await typesPOST(json('/api/leave-types', 'POST', { name: 'Doğum izni', base_type: 'personal' }))).status).toBe(403)

    as(ADMIN, ACCESS.ADMIN)
    const ok = await typesPOST(json('/api/leave-types', 'POST', { name: '  Doğum   izni ', base_type: 'personal' }))
    expect(ok.status).toBe(201)
    expect((await ok.json()).type).toMatchObject({ name: 'Doğum izni', base_type: 'personal', employee_requestable: true })

    const holiday = await typesPOST(json('/api/leave-types', 'POST', { name: 'Bayram', base_type: 'public_holiday' }))
    expect((await holiday.json()).type.employee_requestable).toBe(false)
    expect(db().tables.audit_logs.filter((a) => a.action === 'leave_type.create')).toHaveLength(2)
  })

  it('geçersiz kod, boş ad ve aynı ad reddedilir', async () => {
    as(ADMIN, ACCESS.ADMIN)
    expect((await typesPOST(json('/api/leave-types', 'POST', { name: 'X', base_type: 'weekly_rest' }))).status).toBe(400)
    expect((await typesPOST(json('/api/leave-types', 'POST', { name: '  ', base_type: 'annual' }))).status).toBe(400)
    expect((await typesPOST(json('/api/leave-types', 'POST', { name: 'Ücretli izin', base_type: 'personal' }))).status).toBe(409)
  })

  it('Admin adı, talep ayarını ve durumu günceller; puantaj kodu değiştirilemez', async () => {
    as(ADMIN, ACCESS.ADMIN)
    const res = await typePATCH(json(`/api/leave-types/${T_PAID}`, 'PATCH', { name: 'Mazeret izni', active: false }), ctx(T_PAID))
    expect(res.status).toBe(200)
    expect(db().tables.leave_type_definitions.find((t) => t.id === T_PAID)).toMatchObject({ name: 'Mazeret izni', active: false })

    const base = await typePATCH(json(`/api/leave-types/${T_PAID}`, 'PATCH', { base_type: 'unpaid' }), ctx(T_PAID))
    expect(base.status).toBe(400)
    expect(db().tables.leave_type_definitions.find((t) => t.id === T_PAID)!.base_type).toBe('personal')

    as(MGR, ACCESS.MANAGER)
    expect((await typePATCH(json(`/api/leave-types/${T_PAID}`, 'PATCH', { active: true }), ctx(T_PAID))).status).toBe(403)
  })
})

describe('POST /api/leave — izin türü', () => {
  const request = (body: Record<string, unknown>) =>
    leavePOST(json('/api/leave', 'POST', { employee_id: EMP, start_date: FUTURE, end_date: FUTURE, ...body }))

  it('tanımlı tür: kayıt tanımın temel türünü ve id’sini taşır, onay bekler', async () => {
    as(EMP, ACCESS.EMPLOYEE)
    const res = await request({ leave_type_def_id: T_PAID })
    expect(res.status).toBe(201)
    expect(db().tables.leave_requests[0]).toMatchObject({ leave_type: 'personal', leave_type_def_id: T_PAID, status: 'pending' })
  })

  it('eski istemcinin temel türü sistem tanımına bağlanır', async () => {
    as(EMP, ACCESS.EMPLOYEE)
    expect((await request({ leave_type: 'sick' })).status).toBe(201)
    expect(db().tables.leave_requests[0]).toMatchObject({ leave_type: 'sick', leave_type_def_id: T_SICK })
  })

  it('pasif tür ve çalışan talebine kapalı tür reddedilir', async () => {
    as(EMP, ACCESS.EMPLOYEE)
    expect((await request({ leave_type_def_id: T_OLD })).status).toBe(400)
    expect((await request({ leave_type_def_id: T_HOLIDAY })).status).toBe(403)
    expect((await request({ leave_type: 'public_holiday' })).status).toBe(403)
    expect(db().tables.leave_requests).toHaveLength(0)
  })

  it('yönetici planda doğrudan onaylı izin verir; o günün vardiyası kalkar, çalışana bildirim gider', async () => {
    as(MGR, ACCESS.MANAGER)
    const res = await request({ leave_type_def_id: T_HOLIDAY, approve: true })
    expect(res.status).toBe(201)
    expect(db().tables.leave_requests[0]).toMatchObject({
      leave_type: 'public_holiday', leave_type_def_id: T_HOLIDAY, status: 'approved', reviewed_by: MGR,
    })
    expect(db().tables.shift_assignments).toHaveLength(0)
    expect(db().tables.audit_logs.some((a) => a.action === 'leave.assign')).toBe(true)
    expect(db().tables.notifications[0]).toMatchObject({ employee_id: EMP, title: 'İzin atandı' })
  })

  it('yönetici kendine doğrudan izin veremez; çalışan approve gönderemez', async () => {
    as(MGR, ACCESS.MANAGER)
    const self = await leavePOST(json('/api/leave', 'POST', {
      employee_id: MGR, leave_type_def_id: T_PAID, start_date: FUTURE, end_date: FUTURE, approve: true,
    }))
    expect(self.status).toBe(403)

    as(EMP, ACCESS.EMPLOYEE)
    expect((await request({ leave_type_def_id: T_PAID, approve: true })).status).toBe(403)
    expect(db().tables.leave_requests).toHaveLength(0)
  })
})

describe('GET /api/leave — hastalık raporu gizliliği', () => {
  it('başkasının raporu "diğer" görünür ve tür adı (tanım) gizlenir', async () => {
    db().tables.leave_requests.push({
      id: uuid(70), employee_id: EMP2, leave_type: 'sick', leave_type_def_id: T_SICK, start_date: FUTURE, end_date: FUTURE,
      status: 'approved', reason: 'grip', reviewer_note: null, created_at: '2099-01-01',
    })
    as(EMP, ACCESS.EMPLOYEE)
    const res = await leaveGET(json('/api/leave?status=approved', 'GET'))
    const [r] = (await res.json()).requests
    expect(r).toMatchObject({ leave_type: 'other', leave_type_def_id: null, reason: null })
  })
})
