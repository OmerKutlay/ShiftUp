/**
 * recurringRestApi.test.ts — tekrarlayan haftalık tatil.
 *
 *  - POST /api/leave (weekly_rest, recurring): kural açılır, ilk gün yazılır, sonraki haftalar üretilir.
 *  - Aynı gün için ikinci süresiz kural açılmaz (409); süreli kural (recurring_until) dönemi çakışmayan
 *    bir kuralın yanında açılabilir.
 *  - Çalışanın izin talebi tekrarlayan tatil gününe denk gelirse tatil talebe yer açar; tek seferlik tatil açmaz.
 *  - DELETE /api/leave?scope=following: bu ve sonraki haftalar kalkar; scope yoksa yalnızca o gün.
 *  - Ret ve silmede yer açan tekrarlar geri yazılır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'
import { addDaysToDateString } from '@/lib/dateUtils'

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/db', () => ({
  db: { from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t) },
}))

import { POST as leavePOST, DELETE as leaveDELETE } from '@/app/api/leave/route'
import { POST as reviewPOST } from '@/app/api/leave/review/route'

const uuid = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`
const STORE = uuid(1)
const ROLE_MGR = uuid(12)
const ROLE_EMP = uuid(13)
const MGR = uuid(22)
const EMP = uuid(23)
const AUTH_EMP = uuid(90)
/** 2099-01-04 bir pazar */
const SUNDAY = '2099-01-04'

const roleRow = (id: string, level: string, name: string) => ({
  id, name, description: null, access_level: level, planning_group: null, sort_order: 1,
})
const emp = (id: string, name: string, roleId: string, level: string, authUserId: string | null = null) => ({
  id, full_name: name, email: `${name.toLowerCase()}@test.com`, role_id: roleId,
  active: true, store_id: STORE, employment_type: 'full_time', auth_user_id: authUserId,
  hire_date: null, birth_date: null, termination_date: null, roles: { access_level: level },
})

let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

function seed(): FakeDb {
  return createFakeDb({
    stores: [{ id: STORE, name: 'A', active: true }],
    roles: [roleRow(ROLE_MGR, ACCESS.MANAGER, 'Yönetici'), roleRow(ROLE_EMP, ACCESS.EMPLOYEE, 'Çalışan')],
    employees: [emp(MGR, 'Yönetici', ROLE_MGR, ACCESS.MANAGER), emp(EMP, 'Ali', ROLE_EMP, ACCESS.EMPLOYEE, AUTH_EMP)],
    shift_assignments: [],
    attendance_records: [],
    audit_logs: [],
    notifications: [],
    leave_requests: [],
    recurring_weekly_rests: [],
    holidays: [],
    public_holidays: [],
  }, {
    rpc: {
      // Sonraki iki haftayı yazar (gerçek SQL ufku 26 hafta)
      materialize_recurring_weekly_rests: (a: { p_rule_id: string }, db: FakeDb) => {
        rpcCalls.push({ name: 'materialize', args: a })
        const rule = db.tables.recurring_weekly_rests.find((r) => r.id === a.p_rule_id)!
        for (const n of [7, 14]) {
          const d = addDaysToDateString(rule.start_date, n)
          db.tables.leave_requests.push({
            id: `${a.p_rule_id.slice(0, 30)}${String(n).padStart(6, '0')}`, employee_id: rule.employee_id,
            leave_type: 'weekly_rest', start_date: d, end_date: d, status: 'approved', reason: 'Haftalık tatil (her hafta)',
            recurrence_id: rule.id,
          })
        }
        return { data: { created: 2, skipped: 1 } }
      },
      end_recurring_weekly_rest: (a: { p_rule_id: string; p_from: string }, db: FakeDb) => {
        rpcCalls.push({ name: 'end', args: a })
        const before = db.tables.leave_requests.length
        db.tables.leave_requests = db.tables.leave_requests.filter(
          (l) => !(l.recurrence_id === a.p_rule_id && l.start_date >= a.p_from))
        return { data: before - db.tables.leave_requests.length }
      },
      restore_recurring_weekly_rests: (a: Record<string, unknown>) => {
        rpcCalls.push({ name: 'restore', args: a })
        return { data: 1 }
      },
      rate_limit_hit: () => ({ data: [{ allowed: true, remaining: 10, reset_at: new Date(Date.now() + 60_000).toISOString() }] }),
    },
  })
}

const session = (id: string, name: string, level: string) => ({
  id, full_name: name, email: null, role_id: null, role_name: null, access_level: level,
  active: true, home_store_id: STORE, store_id: STORE,
})
const asManager = () => (state.employee = session(MGR, 'Yönetici', ACCESS.MANAGER))
const asEmployee = () => (state.employee = session(EMP, 'Ali', ACCESS.EMPLOYEE))

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const db = () => state.db as FakeDb

const recurringRest = (date = SUNDAY, extra: Record<string, unknown> = {}) =>
  leavePOST(json('/api/leave', 'POST', {
    employee_id: EMP, leave_type: 'weekly_rest', start_date: date, end_date: date, recurring: true, ...extra,
  }))

beforeEach(() => {
  state.db = seed()
  state.employee = null
  rpcCalls = []
})

describe('POST /api/leave — her hafta tatil', () => {
  it('kural açılır, ilk gün kurala bağlı yazılır, sonraki haftalar üretilir', async () => {
    asManager()
    const res = await recurringRest()
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.recurring).toEqual({ created: 2, skipped: 1 })

    const [rule] = db().tables.recurring_weekly_rests
    expect(rule).toMatchObject({ employee_id: EMP, store_id: STORE, weekday: 0, start_date: SUNDAY, created_by: MGR })
    expect(rpcCalls).toEqual([{ name: 'materialize', args: { p_rule_id: rule.id } }])
    const rests = db().tables.leave_requests.filter((l) => l.recurrence_id === rule.id).map((l) => l.start_date).sort()
    expect(rests).toEqual([SUNDAY, '2099-01-11', '2099-01-18'])
    expect(db().tables.audit_logs.some((a) => a.action === 'leave.weekly_rest.recurring')).toBe(true)
    expect(db().tables.notifications[0].message).toContain('Her pazar')
  })

  it('aynı gün için açık kural varken ikincisi açılmaz (409)', async () => {
    asManager()
    db().tables.recurring_weekly_rests.push({
      id: uuid(70), store_id: STORE, employee_id: EMP, weekday: 0, start_date: '2098-12-07', end_date: null,
      materialized_until: '2099-06-01',
    })
    const res = await recurringRest('2099-01-25')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('RECURRING_REST_EXISTS')
    expect(db().tables.recurring_weekly_rests).toHaveLength(1)
    expect(db().tables.leave_requests).toHaveLength(0)
  })

  it('süreli kural: recurring_until kuralın bitiş günü olur', async () => {
    asManager()
    const res = await recurringRest(SUNDAY, { recurring_until: '2099-03-28' })
    expect(res.status).toBe(201)
    const [rule] = db().tables.recurring_weekly_rests
    expect(rule).toMatchObject({ start_date: SUNDAY, end_date: '2099-03-28' })
    const audit = db().tables.audit_logs.find((a) => a.action === 'leave.weekly_rest.recurring')!
    expect((audit.after as Record<string, unknown>).until).toBe('2099-03-28')
  })

  it('süre belirtilmezse kural süresizdir', async () => {
    asManager()
    expect((await recurringRest()).status).toBe(201)
    expect(db().tables.recurring_weekly_rests[0].end_date ?? null).toBeNull()
  })

  it('geçersiz bitiş reddedilir: biçim, başlangıçtan önce, 2 yıldan uzun, tekrarsız tatilde (400)', async () => {
    asManager()
    expect((await recurringRest(SUNDAY, { recurring_until: '28.03.2099' })).status).toBe(400)
    expect((await recurringRest(SUNDAY, { recurring_until: '2099-01-03' })).status).toBe(400)
    expect((await recurringRest(SUNDAY, { recurring_until: '2101-01-10' })).status).toBe(400)
    expect((await recurringRest(SUNDAY, { recurring: false, recurring_until: '2099-03-28' })).status).toBe(400)
    expect(db().tables.recurring_weekly_rests).toHaveLength(0)
    expect(db().tables.leave_requests).toHaveLength(0)
  })

  it('süreli kural, dönemi çakışmayan kuralın yanında açılır; çakışan dönemde açılmaz', async () => {
    asManager()
    // Mart'ta başlayacak süresiz kural
    db().tables.recurring_weekly_rests.push({
      id: uuid(71), store_id: STORE, employee_id: EMP, weekday: 0, start_date: '2099-03-01', end_date: null,
      materialized_until: '2099-03-01',
    })
    const clash = await recurringRest(SUNDAY, { recurring_until: '2099-03-01' })
    expect(clash.status).toBe(409)
    expect((await recurringRest(SUNDAY, { recurring_until: '2099-02-22' })).status).toBe(201)
    expect(db().tables.recurring_weekly_rests).toHaveLength(2)
  })

  it('yalnızca tek günlük haftalık tatil tekrarlanabilir (400)', async () => {
    asManager()
    const annual = await leavePOST(json('/api/leave', 'POST', {
      employee_id: EMP, leave_type: 'annual', start_date: SUNDAY, end_date: SUNDAY, recurring: true,
    }))
    expect(annual.status).toBe(400)
    const multi = await recurringRest(SUNDAY, { end_date: '2099-01-05' })
    expect(multi.status).toBe(400)
    expect(db().tables.recurring_weekly_rests).toHaveLength(0)
  })

  it('ilk gün başka bir izinle çakışırsa kural açılmaz', async () => {
    asManager()
    db().tables.leave_requests.push({
      id: uuid(80), employee_id: EMP, leave_type: 'annual', start_date: SUNDAY, end_date: SUNDAY, status: 'approved',
    })
    const res = await recurringRest()
    expect(res.status).toBe(409)
    expect(db().tables.recurring_weekly_rests).toHaveLength(0)
  })
})

describe('izin talebi ve tekrarlayan tatil', () => {
  const restRow = (id: string, date: string, recurrenceId: string | null) => ({
    id, employee_id: EMP, leave_type: 'weekly_rest', start_date: date, end_date: date, status: 'approved',
    reason: 'Haftalık tatil', recurrence_id: recurrenceId,
  })

  it('tekrarlayan tatil günü izin talebine yer açar; talep reddedilince geri yazılır', async () => {
    db().tables.leave_requests.push(restRow(uuid(81), SUNDAY, uuid(70)))
    asEmployee()
    const res = await leavePOST(json('/api/leave', 'POST', {
      employee_id: EMP, leave_type: 'personal', start_date: '2099-01-02', end_date: '2099-01-06',
    }))
    expect(res.status).toBe(201)
    const { request } = await res.json()
    expect(db().tables.leave_requests.some((l) => l.id === uuid(81))).toBe(false)

    asManager()
    const rev = await reviewPOST(json('/api/leave/review', 'POST', { request_id: request.id, status: 'rejected' }))
    expect(rev.status).toBe(200)
    expect(rpcCalls).toContainEqual({
      name: 'restore', args: { p_employee_id: EMP, p_from: '2099-01-02', p_to: '2099-01-06' },
    })
  })

  it('tek seferlik tatil izin talebine engel olmaya devam eder (409)', async () => {
    db().tables.leave_requests.push(restRow(uuid(82), SUNDAY, null))
    asEmployee()
    const res = await leavePOST(json('/api/leave', 'POST', {
      employee_id: EMP, leave_type: 'personal', start_date: '2099-01-02', end_date: '2099-01-06',
    }))
    expect(res.status).toBe(409)
    expect(db().tables.leave_requests).toHaveLength(1)
  })

  it('izin silinince aralıktaki tekrarlar geri yazılır', async () => {
    db().tables.leave_requests.push({
      id: uuid(83), employee_id: EMP, leave_type: 'personal', start_date: '2099-01-02', end_date: '2099-01-06', status: 'approved',
    })
    asManager()
    const res = await leaveDELETE(json(`/api/leave?id=${uuid(83)}`, 'DELETE'))
    expect(res.status).toBe(200)
    expect(rpcCalls).toContainEqual({
      name: 'restore', args: { p_employee_id: EMP, p_from: '2099-01-02', p_to: '2099-01-06' },
    })
  })
})

describe('DELETE /api/leave — tekrarlayan tatil', () => {
  beforeEach(async () => {
    asManager()
    expect((await recurringRest()).status).toBe(201)
    rpcCalls = []
  })
  const ruleId = () => db().tables.recurring_weekly_rests[0].id as string
  const restOn = (d: string) => db().tables.leave_requests.find((l) => l.recurrence_id === ruleId() && l.start_date === d)!

  it('scope yoksa yalnızca o gün kalkar', async () => {
    const res = await leaveDELETE(json(`/api/leave?id=${restOn('2099-01-11').id}`, 'DELETE'))
    expect(res.status).toBe(200)
    expect(rpcCalls).toEqual([])
    const left = db().tables.leave_requests.filter((l) => l.recurrence_id === ruleId()).map((l) => l.start_date).sort()
    expect(left).toEqual([SUNDAY, '2099-01-18'])
  })

  it('scope=following bu ve sonraki haftaları kaldırır', async () => {
    const res = await leaveDELETE(json(`/api/leave?id=${restOn('2099-01-11').id}&scope=following`, 'DELETE'))
    expect(res.status).toBe(200)
    expect((await res.json()).removed).toBe(2)
    expect(rpcCalls).toEqual([{ name: 'end', args: { p_rule_id: ruleId(), p_from: '2099-01-11' } }])
    const left = db().tables.leave_requests.filter((l) => l.recurrence_id === ruleId()).map((l) => l.start_date)
    expect(left).toEqual([SUNDAY])
    expect(db().tables.audit_logs.some((a) => a.action === 'leave.weekly_rest.recurring_end')).toBe(true)
  })

  it('geçersiz kapsam reddedilir (400)', async () => {
    const res = await leaveDELETE(json(`/api/leave?id=${restOn(SUNDAY).id}&scope=all`, 'DELETE'))
    expect(res.status).toBe(400)
  })
})
