/**
 * securityHardening.test.ts — güvenlik taramasında kapatılan açıkların regresyon testleri.
 *
 *   - Hiyerarşi: yönetici kendinden yüksek yetkilinin izin/mesai kaydına karar veremez
 *   - Kişisel veri: standart çalışan iş arkadaşlarının özlük tarihlerini ve hastalık iznini görmez
 *   - Spam: talep oluşturma uçları kişi başına hız sınırlıdır
 *   - IP: rate limit anahtarı istemcinin yazabildiği x-forwarded-for'dan değil cf-connecting-ip'den gelir
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS, canReviewRole } from '@/lib/auth/roles'
import { clientIp } from '@/lib/rateLimiter'
import { addDaysToDateString, turkeyToday } from '@/lib/dateUtils'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/db', () => ({
  db: { from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t) },
}))

import { GET as employeesGET } from '@/app/api/employees/route'
import { GET as leaveGET, DELETE as leaveDELETE } from '@/app/api/leave/route'
import { POST as leaveReview } from '@/app/api/leave/review/route'
import { POST as tcPOST } from '@/app/api/time-correction/route'
import { POST as tcReview } from '@/app/api/time-correction/review/route'
import { POST as swapPOST } from '@/app/api/shift-swap/route'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const STORE = uuid(1)
const ADMIN = uuid(20)
const SM = uuid(21)
const MGR = uuid(22)
const EMP1 = uuid(23)
const EMP2 = uuid(24)
const LEAVE_SM = uuid(40)
const LEAVE_EMP2_SICK = uuid(41)
const LEAVE_EMP1_SICK = uuid(42)
const TC_SM = uuid(50)
const SHIFT_EMP1 = uuid(60)

const LEVELS: Record<string, string> = {
  [ADMIN]: ACCESS.ADMIN, [SM]: ACCESS.STORE_MANAGER, [MGR]: ACCESS.MANAGER, [EMP1]: ACCESS.EMPLOYEE, [EMP2]: ACCESS.EMPLOYEE,
}

const empRow = (id: string, name: string) => ({
  id, full_name: name, email: `${name}@test.com`, role_id: null, active: true, store_id: STORE,
  employment_type: 'full_time', auth_user_id: null, hire_date: '2020-01-01', birth_date: '1990-05-05',
  overtime_consent_at: '2024-01-01', roles: { access_level: LEVELS[id] },
})

const session = (id: string) => ({
  id, full_name: id, email: null, role_id: null, role_name: null, access_level: LEVELS[id],
  active: true, home_store_id: STORE, store_id: STORE,
})

const yesterday = addDaysToDateString(turkeyToday(), -1)

function seed(): FakeDb {
  return createFakeDb({
    stores: [{ id: STORE, name: 'A', active: true }],
    employees: [empRow(ADMIN, 'admin'), empRow(SM, 'mudur'), empRow(MGR, 'yonetici'), empRow(EMP1, 'calisan1'), empRow(EMP2, 'calisan2')],
    leave_requests: [
      { id: LEAVE_SM, employee_id: SM, leave_type: 'annual', start_date: '2099-01-05', end_date: '2099-01-06', status: 'pending', reason: null, reviewer_note: null, created_at: '2026-01-01T00:00:00Z' },
      { id: LEAVE_EMP2_SICK, employee_id: EMP2, leave_type: 'sick', start_date: '2099-02-05', end_date: '2099-02-06', status: 'approved', reason: 'grip', reviewer_note: null, created_at: '2026-01-01T00:00:00Z' },
      { id: LEAVE_EMP1_SICK, employee_id: EMP1, leave_type: 'sick', start_date: '2099-03-05', end_date: '2099-03-06', status: 'approved', reason: 'grip', reviewer_note: null, created_at: '2026-01-01T00:00:00Z' },
    ],
    manual_time_correction_requests: [
      { id: TC_SM, employee_id: SM, date: yesterday, requested_start_time: '09:00', requested_end_time: '17:00', reason: 'unuttum', status: 'pending' },
    ],
    shift_assignments: [
      { id: SHIFT_EMP1, employee_id: EMP1, store_id: STORE, work_date: '2099-01-05', start_time: '09:00', end_time: '17:00' },
    ],
    shift_swap_requests: [],
    attendance_records: [],
    notifications: [],
    audit_logs: [],
  })
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

beforeEach(() => {
  state.db = seed()
})

describe('canReviewRole', () => {
  it('admin herkese, diğerleri yalnızca kendi seviyesine ve altına karar verir', () => {
    expect(canReviewRole(ACCESS.ADMIN, ACCESS.ADMIN)).toBe(true)
    expect(canReviewRole(ACCESS.MANAGER, ACCESS.MANAGER)).toBe(true)
    expect(canReviewRole(ACCESS.MANAGER, ACCESS.EMPLOYEE)).toBe(true)
    expect(canReviewRole(ACCESS.MANAGER, ACCESS.STORE_MANAGER)).toBe(false)
    expect(canReviewRole(ACCESS.STORE_MANAGER, ACCESS.ADMIN)).toBe(false)
    expect(canReviewRole(ACCESS.EMPLOYEE, ACCESS.EMPLOYEE)).toBe(true)
    expect(canReviewRole(ACCESS.KIOSK, ACCESS.EMPLOYEE)).toBe(false)
  })
})

describe('hiyerarşi — yönetici üst yetkilinin kaydına karar veremez', () => {
  it('yönetici müdürün iznini onaylayamaz; admin onaylayabilir', async () => {
    state.employee = session(MGR)
    const denied = await leaveReview(req('/api/leave/review', 'POST', { request_id: LEAVE_SM, status: 'approved' }))
    expect(denied.status).toBe(403)

    state.employee = session(ADMIN)
    const ok = await leaveReview(req('/api/leave/review', 'POST', { request_id: LEAVE_SM, status: 'approved' }))
    expect(ok.status).toBe(200)
  })

  it('yönetici müdürün iznini silemez', async () => {
    state.employee = session(MGR)
    const res = await leaveDELETE(req(`/api/leave?id=${LEAVE_SM}`, 'DELETE'))
    expect(res.status).toBe(403)
    expect((state.db as FakeDb).tables.leave_requests.some((l) => l.id === LEAVE_SM)).toBe(true)
  })

  it('yönetici müdürün mesai düzeltmesini onaylayamaz', async () => {
    state.employee = session(MGR)
    const res = await tcReview(req('/api/time-correction/review', 'POST', { request_id: TC_SM, status: 'approved' }))
    expect(res.status).toBe(403)
    expect((state.db as FakeDb).tables.manual_time_correction_requests[0].status).toBe('pending')
  })

  it('yönetici müdür adına doğrudan mesai giremez', async () => {
    state.employee = session(MGR)
    const res = await tcPOST(req('/api/time-correction', 'POST', {
      direct: true, employee_id: SM, date: yesterday,
      requested_start_time: '09:00', requested_end_time: '17:00', reason: 'test',
    }))
    expect(res.status).toBe(403)
    expect((state.db as FakeDb).tables.attendance_records).toHaveLength(0)
  })
})

describe('kişisel veri — standart çalışan', () => {
  it('iş arkadaşlarının doğum / işe giriş / onay tarihlerini görmez', async () => {
    state.employee = session(EMP1)
    const res = await employeesGET(req('/api/employees'))
    const { employees } = (await res.json()) as { employees: Array<Record<string, unknown>> }
    expect(employees.length).toBeGreaterThan(0)
    for (const e of employees) {
      expect(e.birth_date).toBeNull()
      expect(e.hire_date).toBeNull()
      expect(e.overtime_consent_at).toBeNull()
      expect(e.email).toBeNull()
    }
  })

  it('başkasının hastalık iznini "diğer" olarak görür; kendisininkini olduğu gibi', async () => {
    state.employee = session(EMP1)
    const res = await leaveGET(req('/api/leave'))
    const { requests } = (await res.json()) as { requests: Array<{ id: string; leave_type: string; reason: string | null }> }
    const other = requests.find((r) => r.id === LEAVE_EMP2_SICK)!
    const own = requests.find((r) => r.id === LEAVE_EMP1_SICK)!
    expect(other.leave_type).toBe('other')
    expect(other.reason).toBeNull()
    expect(own.leave_type).toBe('sick')
  })
})

describe('spam — talep oluşturma hız sınırı', () => {
  it('takas teklifleri saatte 20 ile sınırlıdır', async () => {
    state.employee = session(EMP1)
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) {
      // Her denemede talep iptal edilmiş sayılsın (bekleyen talep kontrolüne takılmasın)
      ;(state.db as FakeDb).tables.shift_swap_requests.length = 0
      const res = await swapPOST(req('/api/shift-swap', 'POST', { requester_shift_id: SHIFT_EMP1, target_id: EMP2 }))
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true)
    expect(statuses[20]).toBe(429)
  })
})

describe('clientIp', () => {
  const headers = (h: Record<string, string>) => ({ headers: new Headers(h) })

  it('Cloudflare\'in yazdığı cf-connecting-ip, sahte x-forwarded-for\'a tercih edilir', () => {
    expect(clientIp(headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('Cloudflare dışında x-forwarded-for kullanılır', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1')
  })
})
