/**
 * multiStorePeopleApi.test.ts — çoklu mağaza: çalışan ve talep API'lerinin mağaza izolasyonu.
 *
 * Route'lar, storeScope ve yetki katmanı gerçek haliyle çalışır; yalnızca oturum ve Supabase
 * (bellek içi fake) değiştirilir. Service role RLS'yi bypass ettiğinden her sorgu aktif mağazayla
 * sınırlanmalı ve istemciden gelen her id mağazaya ait olduğu doğrulanmalıdır (başka mağaza → 404).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { addDaysToDateString, turkeyToday } from '@/lib/dateUtils'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/db', () => ({
  db: { from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t) },
}))

import { GET as employeesGET, POST as employeesPOST } from '@/app/api/employees/route'
import { PATCH as employeePATCH, DELETE as employeeDELETE } from '@/app/api/employees/[id]/route'
import { GET as leaveGET, POST as leavePOST } from '@/app/api/leave/route'
import { POST as leaveReview } from '@/app/api/leave/review/route'
import { GET as balanceGET } from '@/app/api/leave/balance/route'
import { GET as tcGET, POST as tcPOST } from '@/app/api/time-correction/route'
import { POST as tcReview } from '@/app/api/time-correction/review/route'
import { POST as swapPOST } from '@/app/api/shift-swap/route'
import { POST as swapReview } from '@/app/api/shift-swap/review/route'
import { GET as availabilityGET, POST as availabilityPOST } from '@/app/api/availability/route'

// ── Sabit id'ler (UUID biçiminde) ────────────────────────────
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const STORE_A = uuid(1)
const STORE_B = uuid(2)
const STORE_OFF = uuid(3) // pasif mağaza
const ROLE_ADMIN = uuid(10)
const ROLE_SM = uuid(11)
const ROLE_MGR = uuid(12)
const ROLE_EMP = uuid(13)
const ADMIN = uuid(20)
const SM_A = uuid(21)
const EMP_A1 = uuid(22)
const EMP_A2 = uuid(23)
const EMP_B1 = uuid(24)
const SH_A1 = uuid(30)
const SH_A2 = uuid(31)
const SH_B1 = uuid(32)
const LEAVE_A = uuid(40)
const LEAVE_B = uuid(41)
const TC_A = uuid(50)
const TC_B = uuid(51)
const SWAP_B = uuid(60)

const FUTURE = '2099-01-05'
const PAST = '2020-01-06'

const roleRow = (id: string, level: string, name: string) => ({
  id, name, description: null, access_level: level, planning_group: null, sort_order: 1,
})
const emp = (id: string, name: string, store: string, roleId: string, level: string) => ({
  id, full_name: name, email: `${name.toLowerCase().replace(/\s/g, '.')}@test.com`, role_id: roleId,
  active: true, store_id: store, employment_type: 'full_time', auth_user_id: null,
  hire_date: null, birth_date: null, roles: { access_level: level },
})

function seed(): FakeDb {
  return createFakeDb({
    stores: [
      { id: STORE_A, name: 'A', active: true },
      { id: STORE_B, name: 'B', active: true },
      { id: STORE_OFF, name: 'Kapalı', active: false },
    ],
    roles: [
      roleRow(ROLE_ADMIN, ACCESS.ADMIN, 'Admin'),
      roleRow(ROLE_SM, ACCESS.STORE_MANAGER, 'Müdür'),
      roleRow(ROLE_MGR, ACCESS.MANAGER, 'Yönetici'),
      roleRow(ROLE_EMP, ACCESS.EMPLOYEE, 'Çalışan'),
    ],
    employees: [
      emp(ADMIN, 'Admin Kişi', STORE_A, ROLE_ADMIN, ACCESS.ADMIN),
      emp(SM_A, 'Müdür A', STORE_A, ROLE_SM, ACCESS.STORE_MANAGER),
      emp(EMP_A1, 'Ali A1', STORE_A, ROLE_EMP, ACCESS.EMPLOYEE),
      emp(EMP_A2, 'Veli A2', STORE_A, ROLE_EMP, ACCESS.EMPLOYEE),
      emp(EMP_B1, 'Berk B1', STORE_B, ROLE_EMP, ACCESS.EMPLOYEE),
    ],
    shift_assignments: [
      { id: SH_A1, employee_id: EMP_A1, store_id: STORE_A, work_date: FUTURE, start_time: '09:00', end_time: '17:00' },
      { id: SH_A2, employee_id: EMP_A2, store_id: STORE_A, work_date: FUTURE, start_time: '09:00', end_time: '17:00' },
      { id: SH_B1, employee_id: EMP_B1, store_id: STORE_B, work_date: FUTURE, start_time: '09:00', end_time: '17:00' },
    ],
    leave_requests: [
      { id: LEAVE_A, employee_id: EMP_A1, leave_type: 'personal', start_date: FUTURE, end_date: FUTURE, status: 'pending' },
      { id: LEAVE_B, employee_id: EMP_B1, leave_type: 'personal', start_date: FUTURE, end_date: FUTURE, status: 'pending' },
    ],
    manual_time_correction_requests: [
      { id: TC_A, employee_id: EMP_A1, date: PAST, requested_start_time: '09:00', requested_end_time: '17:00', reason: 'x', status: 'pending' },
      { id: TC_B, employee_id: EMP_B1, date: PAST, requested_start_time: '09:00', requested_end_time: '17:00', reason: 'x', status: 'pending' },
    ],
    shift_swap_requests: [
      { id: SWAP_B, requester_id: EMP_B1, requester_shift_id: SH_B1, target_id: uuid(99), target_shift_id: null, status: 'pending', target_accepted_at: null },
    ],
    employee_availability: [
      { id: uuid(70), employee_id: EMP_A1, day_of_week: 'monday', start_time: '09:00', end_time: '17:00', is_available: true },
      { id: uuid(71), employee_id: EMP_B1, day_of_week: 'monday', start_time: '09:00', end_time: '17:00', is_available: true },
    ],
    audit_logs: [],
    notifications: [],
    attendance_records: [],
    public_holidays: [],
  })
}

const session = (id: string, name: string, level: string, home: string, active = home) => ({
  id, full_name: name, email: null, role_id: null, role_name: null, access_level: level,
  active: true, home_store_id: home, store_id: active,
})
const asAdmin = (active = STORE_A) => (state.employee = session(ADMIN, 'Admin Kişi', ACCESS.ADMIN, STORE_A, active))
const asStoreManager = () => (state.employee = session(SM_A, 'Müdür A', ACCESS.STORE_MANAGER, STORE_A))
const asEmployeeA1 = () => (state.employee = session(EMP_A1, 'Ali A1', ACCESS.EMPLOYEE, STORE_A))

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
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ============================================================
// Çalışanlar
// ============================================================
describe('GET /api/employees — mağaza kapsamı', () => {
  it('yalnızca aktif mağazanın çalışanlarını döner; satırlarda store_id vardır', async () => {
    asStoreManager()
    const res = await employeesGET(json('/api/employees', 'GET'))
    expect(res.status).toBe(200)
    const { employees } = await res.json()
    const ids = employees.map((e: { id: string }) => e.id)
    expect(ids).toContain(EMP_A1)
    expect(ids).not.toContain(EMP_B1)
    expect(employees.every((e: { store_id: string }) => e.store_id === STORE_A)).toBe(true)
  })

  it('admin aktif mağazayı değiştirince o mağazanın çalışanlarını görür', async () => {
    asAdmin(STORE_B)
    const { employees } = await (await employeesGET(json('/api/employees', 'GET'))).json()
    expect(employees.map((e: { id: string }) => e.id)).toEqual([EMP_B1])
  })

  it('standart çalışan için e-posta maskelenir', async () => {
    asEmployeeA1()
    const { employees } = await (await employeesGET(json('/api/employees', 'GET'))).json()
    expect(employees.every((e: { email: string | null }) => e.email === null)).toBe(true)
  })
})

describe('POST /api/employees — mağaza atama', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    full_name: 'Yeni Kişi', role_id: ROLE_EMP, employment_type: 'full_time', ...extra,
  })

  it('store_id yoksa çalışan aktif mağazaya eklenir', async () => {
    asStoreManager()
    const res = await employeesPOST(json('/api/employees', 'POST', body()))
    expect(res.status).toBe(201)
    expect((await res.json()).employee.store_id).toBe(STORE_A)
  })

  it('admin olmayan başka mağazanın store_id değerini gönderirse 403', async () => {
    asStoreManager()
    const res = await employeesPOST(json('/api/employees', 'POST', body({ store_id: STORE_B })))
    expect(res.status).toBe(403)
    expect(db().tables.employees).toHaveLength(5)
  })

  it('admin olmayan kendi mağazasının store_id değerini gönderebilir', async () => {
    asStoreManager()
    const res = await employeesPOST(json('/api/employees', 'POST', body({ store_id: STORE_A })))
    expect(res.status).toBe(201)
  })

  it('admin başka (aktif) mağazaya çalışan ekleyebilir', async () => {
    asAdmin(STORE_A)
    const res = await employeesPOST(json('/api/employees', 'POST', body({ store_id: STORE_B })))
    expect(res.status).toBe(201)
    expect((await res.json()).employee.store_id).toBe(STORE_B)
  })

  it('admin pasif veya olmayan mağazaya çalışan ekleyemez (404)', async () => {
    asAdmin()
    expect((await employeesPOST(json('/api/employees', 'POST', body({ store_id: STORE_OFF })))).status).toBe(404)
    expect((await employeesPOST(json('/api/employees', 'POST', body({ store_id: uuid(999) })))).status).toBe(404)
  })

  it('geçersiz store_id biçimi 400', async () => {
    asAdmin()
    expect((await employeesPOST(json('/api/employees', 'POST', body({ store_id: 'x' })))).status).toBe(400)
  })
})

describe('PATCH/DELETE /api/employees/[id] — mağaza kapsamı ve transfer', () => {
  it('başka mağazanın çalışanını güncelleme 404', async () => {
    asStoreManager()
    const res = await employeePATCH(json(`/api/employees/${EMP_B1}`, 'PATCH', { full_name: 'Hack' }), ctx(EMP_B1))
    expect(res.status).toBe(404)
    expect(db().tables.employees.find((e) => e.id === EMP_B1)?.full_name).toBe('Berk B1')
  })

  it('başka mağazanın çalışanını silme 404', async () => {
    asStoreManager()
    const res = await employeeDELETE(json(`/api/employees/${EMP_B1}`, 'DELETE'), ctx(EMP_B1))
    expect(res.status).toBe(404)
    expect(db().tables.employees.some((e) => e.id === EMP_B1)).toBe(true)
  })

  it('kendi mağazasının çalışanını güncelleyebilir (store_id audit kaydında)', async () => {
    asStoreManager()
    const res = await employeePATCH(json(`/api/employees/${EMP_A1}`, 'PATCH', { full_name: 'Ali Yeni' }), ctx(EMP_A1))
    expect(res.status).toBe(200)
    expect(db().tables.audit_logs[0]).toMatchObject({ action: 'employee.update', store_id: STORE_A })
  })

  it('admin olmayan transfer yapamaz (403)', async () => {
    asStoreManager()
    const res = await employeePATCH(json(`/api/employees/${EMP_A2}`, 'PATCH', { store_id: STORE_B }), ctx(EMP_A2))
    expect(res.status).toBe(403)
    expect(db().tables.employees.find((e) => e.id === EMP_A2)?.store_id).toBe(STORE_A)
  })

  it('admin, gelecek vardiyası olmayan çalışanı taşıyabilir ve audit yazılır', async () => {
    // EMP_A2'nin vardiyası geçmişte
    db().tables.shift_assignments.find((s) => s.id === SH_A2)!.work_date = PAST
    asAdmin()
    const res = await employeePATCH(json(`/api/employees/${EMP_A2}`, 'PATCH', { store_id: STORE_B }), ctx(EMP_A2))
    expect(res.status).toBe(200)
    expect((await res.json()).employee.store_id).toBe(STORE_B)
    expect(db().tables.audit_logs.map((a) => a.action)).toContain('employee.transfer')
  })

  it('gelecek vardiyası olan çalışanın transferi 409 HAS_FUTURE_SHIFTS', async () => {
    asAdmin()
    const res = await employeePATCH(json(`/api/employees/${EMP_A1}`, 'PATCH', { store_id: STORE_B }), ctx(EMP_A1))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('HAS_FUTURE_SHIFTS')
    expect(db().tables.employees.find((e) => e.id === EMP_A1)?.store_id).toBe(STORE_A)
  })

  it('pasif veya olmayan mağazaya transfer 404', async () => {
    db().tables.shift_assignments.find((s) => s.id === SH_A2)!.work_date = PAST
    asAdmin()
    const res = await employeePATCH(json(`/api/employees/${EMP_A2}`, 'PATCH', { store_id: STORE_OFF }), ctx(EMP_A2))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('STORE_NOT_FOUND')
  })

  it('admin kendi mağazasını değiştiremez', async () => {
    asAdmin()
    const res = await employeePATCH(json(`/api/employees/${ADMIN}`, 'PATCH', { store_id: STORE_B }), ctx(ADMIN))
    expect(res.status).toBe(403)
  })
})

// ============================================================
// İzin
// ============================================================
describe('/api/leave — mağaza kapsamı', () => {
  it('GET yalnızca aktif mağazanın çalışanlarının izinlerini listeler', async () => {
    asStoreManager()
    const { requests } = await (await leaveGET(json('/api/leave', 'GET'))).json()
    expect(requests.map((r: { id: string }) => r.id)).toEqual([LEAVE_A])
  })

  it('başka mağazanın talebini onaylama 404 ve talep değişmez', async () => {
    asStoreManager()
    const res = await leaveReview(json('/api/leave/review', 'POST', { request_id: LEAVE_B, status: 'approved' }))
    expect(res.status).toBe(404)
    expect(db().tables.leave_requests.find((r) => r.id === LEAVE_B)?.status).toBe('pending')
  })

  it('kendi mağazasının talebini onaylayabilir (audit store_id ile)', async () => {
    asStoreManager()
    const res = await leaveReview(json('/api/leave/review', 'POST', { request_id: LEAVE_A, status: 'approved' }))
    expect(res.status).toBe(200)
    expect(db().tables.audit_logs.find((a) => a.action === 'leave.approved')?.store_id).toBe(STORE_A)
  })

  it('yönetici başka mağazanın çalışanı adına izin açamaz (404)', async () => {
    asStoreManager()
    const res = await leavePOST(
      json('/api/leave', 'POST', { employee_id: EMP_B1, leave_type: 'personal', start_date: FUTURE, end_date: FUTURE })
    )
    expect(res.status).toBe(404)
  })

  it('yönetici başka mağazanın çalışanının bakiyesini göremez (404)', async () => {
    asStoreManager()
    const res = await balanceGET(json(`/api/leave/balance?employee_id=${EMP_B1}`, 'GET'))
    expect(res.status).toBe(404)
  })

  it('yönetici kendi mağazasının çalışanının bakiyesini görür', async () => {
    asStoreManager()
    const res = await balanceGET(json(`/api/leave/balance?employee_id=${EMP_A1}`, 'GET'))
    expect(res.status).toBe(200)
  })
})

// ============================================================
// Mesai düzeltme
// ============================================================
describe('/api/time-correction — mağaza kapsamı', () => {
  it('GET yönetici için yalnızca aktif mağazanın taleplerini döner', async () => {
    asStoreManager()
    const { requests } = await (await tcGET(json('/api/time-correction', 'GET'))).json()
    expect(requests.map((r: { id: string }) => r.id)).toEqual([TC_A])
  })

  it('başka mağazanın talebini incelemek 404', async () => {
    asStoreManager()
    const res = await tcReview(json('/api/time-correction/review', 'POST', { request_id: TC_B, status: 'rejected' }))
    expect(res.status).toBe(404)
    expect(db().tables.manual_time_correction_requests.find((r) => r.id === TC_B)?.status).toBe('pending')
  })

  it('doğrudan mesai girişi başka mağazanın çalışanı için 404', async () => {
    asStoreManager()
    const res = await tcPOST(
      json('/api/time-correction', 'POST', {
        direct: true, employee_id: EMP_B1, date: addDaysToDateString(turkeyToday(), -1), requested_start_time: '09:00',
        requested_end_time: '17:00', reason: 'test',
      })
    )
    expect(res.status).toBe(404)
  })

  it('onayda plansız gün için oluşturulan vardiya çalışanın mağazasını taşır', async () => {
    asStoreManager()
    const res = await tcReview(
      json('/api/time-correction/review', 'POST', { request_id: TC_A, status: 'approved', acknowledge_violations: true })
    )
    expect(res.status).toBe(200)
    const created = db().tables.shift_assignments.find((s) => s.employee_id === EMP_A1 && s.work_date === PAST)
    expect(created?.store_id).toBe(STORE_A)
  })
})

// ============================================================
// Vardiya takası
// ============================================================
describe('/api/shift-swap — mağaza kapsamı', () => {
  const swapBody = (extra: Record<string, unknown>) => ({
    requester_shift_id: SH_A1, target_id: EMP_A2, target_shift_id: SH_A2, ...extra,
  })

  it('aynı mağazadaki çalışanla takas talebi açılabilir', async () => {
    // fake .or() uygulamaz; bekleyen-talep çakışma kontrolü başka mağazanın satırını yakalamasın
    db().tables.shift_swap_requests = []
    asEmployeeA1()
    const res = await swapPOST(json('/api/shift-swap', 'POST', swapBody({})))
    expect(res.status).toBe(201)
  })

  it('başka mağazadaki hedef çalışanla takas reddedilir', async () => {
    asEmployeeA1()
    const res = await swapPOST(json('/api/shift-swap', 'POST', swapBody({ target_id: EMP_B1, target_shift_id: SH_B1 })))
    expect(res.status).toBe(404)
    expect(db().tables.shift_swap_requests).toHaveLength(1)
  })

  it('hedef vardiya başka mağazadaysa takas reddedilir', async () => {
    asEmployeeA1()
    const res = await swapPOST(json('/api/shift-swap', 'POST', swapBody({ target_shift_id: SH_B1 })))
    expect(res.status).toBe(404)
  })

  it('yönetici başka mağazanın takas talebini işleyemez (404)', async () => {
    asStoreManager()
    const res = await swapReview(json('/api/shift-swap/review', 'POST', { swap_id: SWAP_B, status: 'rejected' }))
    expect(res.status).toBe(404)
    expect(db().tables.shift_swap_requests.find((s) => s.id === SWAP_B)?.status).toBe('pending')
  })
})

// ============================================================
// Müsaitlik
// ============================================================
describe('/api/availability — mağaza kapsamı', () => {
  it('all=true yalnızca aktif mağazanın çalışanlarını döner', async () => {
    asStoreManager()
    const { availability } = await (await availabilityGET(json('/api/availability?all=true', 'GET'))).json()
    expect(availability.map((a: { employee_id: string }) => a.employee_id)).toEqual([EMP_A1])
  })

  it('yönetici başka mağazanın çalışanı için employee_id ile sorgulayamaz (404)', async () => {
    asStoreManager()
    const res = await availabilityGET(json(`/api/availability?employee_id=${EMP_B1}`, 'GET'))
    expect(res.status).toBe(404)
  })

  it('yönetici başka mağazanın çalışanı adına müsaitlik ekleyemez (404)', async () => {
    asStoreManager()
    const res = await availabilityPOST(
      json('/api/availability', 'POST', {
        employee_id: EMP_B1, day_of_week: 'tuesday', start_time: '09:00', end_time: '12:00',
      })
    )
    expect(res.status).toBe(404)
  })
})
