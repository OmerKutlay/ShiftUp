// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { type TimesheetShift, type TimesheetEmployee } from '@/lib/timesheet'
import { summarizeOvertime } from '@/lib/overtime'
import {
  buildPayrollTimesheet, employedSgkDays, sgkSummary, payrollToCsv, PAYROLL_CSV_HEADERS, SGK_MISSING_DAY_CODES,
} from '@/lib/payrollTimesheet'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const EMP: TimesheetEmployee = { id: 'e1', full_name: 'Ayşe', role_name: 'Kasiyer', employment_type: 'full_time', overtime_consent_at: null }

function worked(date: string, start = '09:00', end = '18:00', breakMins = 60): TimesheetShift {
  return {
    id: `s-${date}`, employee_id: 'e1', work_date: date, start_time: start, end_time: end,
    attendance: {
      clock_in_at: new Date(`${date}T${start}:00+03:00`).toISOString(),
      clock_out_at: new Date(`${date}T${end}:00+03:00`).toISOString(),
      break_start_at: null, break_end_at: null, completed_break_minutes: breakMins,
    },
  }
}
const planned = (date: string): TimesheetShift =>
  ({ id: `p-${date}`, employee_id: 'e1', work_date: date, start_time: '09:00', end_time: '18:00', attendance: null })

const base = { month: '2026-10', employees: [EMP], holidays: [], today: '2026-10-31' }
const leave = (type: string, start: string, end = start) => ({ employee_id: 'e1', leave_type: type, start_date: start, end_date: end })
const one = (p: Partial<Parameters<typeof buildPayrollTimesheet>[0]> & { shifts?: TimesheetShift[] }) =>
  buildPayrollTimesheet({ ...base, shifts: [], leaves: [], ...p }).rows[0]

describe('payroll — gün kodları', () => {
  it('hafta tatili, izinler, devamsızlık ve çalışılan gün bordro koduna çevrilir', () => {
    const r = one({
      shifts: [worked('2026-10-05'), planned('2026-10-08')],
      leaves: [leave('weekly_rest', '2026-10-11'), leave('annual', '2026-10-06'), leave('sick', '2026-10-07'),
        leave('unpaid', '2026-10-09'), leave('personal', '2026-10-10')],
    })
    expect(r.days['2026-10-05']).toBe('Ç')
    expect(r.days['2026-10-11']).toBe('HT')
    expect(r.days['2026-10-06']).toBe('Yİ')
    expect(r.days['2026-10-07']).toBe('R')
    expect(r.days['2026-10-09']).toBe('Üİ')
    expect(r.days['2026-10-10']).toBe('M')
    expect(r.days['2026-10-08']).toBe('D')
    expect(r.weeklyRestDays).toBe(1)
    expect(r.excuseDays).toBe(1)
  })

  it('genel tatilde çalışma GTÇ (saat ayrıca), çalışılmayan GT, yarım gün tatil normal gün', () => {
    const r = one({
      holidays: [
        { id: '1', date: '2026-10-29', name: 'Cumhuriyet', half_day: false, store_id: null },
        { id: '2', date: '2026-10-28', name: 'Arife', half_day: true, store_id: null },
        { id: '3', date: '2026-10-30', name: 'Köprü', half_day: false, store_id: null },
      ],
      shifts: [worked('2026-10-29')],
    })
    expect(r.days['2026-10-29']).toBe('GTÇ')
    expect(r.days['2026-10-30']).toBe('GT')
    expect(r.days['2026-10-28']).toBe('')
    expect(r.holidayWorkedDays).toBe(1)
    expect(r.holidayWorkedHours).toBe(8)
    expect(r.holidayRestDays).toBe(1)
  })

  it('ay içinde işe giriş: girişten önceki günler boş, prim günü kıdeme göre', () => {
    const r = one({ employees: [{ ...EMP, hire_date: '2026-10-10' }], shifts: [worked('2026-10-12')] })
    expect(r.days['2026-10-09']).toBe('')
    expect(r.days['2026-10-12']).toBe('Ç')
    expect(r.employedDays).toBe(22) // 31 günlük ay: min(30, 32 − 10)
    expect(r.sgkDays).toBe(22)
    expect(r.missingReasonCode).toBe('')
    expect(r.notes.join()).toContain('işe giriş')
  })
})

describe('payroll — SGK prim günü ve eksik gün kodu', () => {
  it('tam ay = 30 (28/31 günlük aylarda da)', () => {
    expect(employedSgkDays('2026-10', null)).toBe(30)
    expect(employedSgkDays('2026-02', '2025-01-01')).toBe(30)
  })
  it('ay içi giriş: 31 günlük, 30 günlük ve Şubat', () => {
    expect(employedSgkDays('2026-10', '2026-10-01')).toBe(30)
    expect(employedSgkDays('2026-10', '2026-10-02')).toBe(30)
    expect(employedSgkDays('2026-10', '2026-10-31')).toBe(1)
    expect(employedSgkDays('2026-11', '2026-11-10')).toBe(21)
    expect(employedSgkDays('2026-02', '2026-02-10')).toBe(21)
  })
  it('tek neden → kendi kodu', () => {
    expect(sgkSummary(30, { rest: 3, unpaid: 0, absent: 0 })).toEqual({ missingDays: 3, missingReasonCode: '01', sgkDays: 27 })
    expect(sgkSummary(30, { rest: 0, unpaid: 2, absent: 0 }).missingReasonCode).toBe('21')
    expect(sgkSummary(30, { rest: 0, unpaid: 0, absent: 1 }).missingReasonCode).toBe('15')
    expect(sgkSummary(30, { rest: 0, unpaid: 0, absent: 0 }).missingReasonCode).toBe('')
  })
  it('birden fazla neden → 12; prim günü sıfırın altına inmez', () => {
    expect(sgkSummary(30, { rest: 1, unpaid: 0, absent: 1 }).missingReasonCode).toBe('12')
    expect(sgkSummary(3, { rest: 5, unpaid: 0, absent: 0 }).sgkDays).toBe(0)
  })
  it('rapor + ücretsiz izin + devamsızlık birleşir; ücretli izinler eksik gün değil', () => {
    const r = one({
      shifts: [planned('2026-10-14')],
      leaves: [leave('sick', '2026-10-05', '2026-10-06'), leave('unpaid', '2026-10-07'), leave('annual', '2026-10-20', '2026-10-22'),
        leave('weekly_rest', '2026-10-11')],
    })
    expect(r.sickDays).toBe(2)
    expect(r.missingDays).toBe(4) // 2 rapor + 1 ücretsiz + 1 devamsız
    expect(r.missingReasonCode).toBe('12')
    expect(r.sgkDays).toBe(26)
  })
  it('31 günlük ayda 31. gün eksik gün sayılmaz', () => {
    const r = one({ leaves: [leave('unpaid', '2026-10-31')] })
    expect(r.unpaidDays).toBe(1)
    expect(r.missingDays).toBe(0)
    expect(r.sgkDays).toBe(30)
  })
  it('SGK kod listesi 01, 07, 12, 15, 21 içerir', () => {
    const codes = SGK_MISSING_DAY_CODES.map((c) => c.code)
    expect(codes).toEqual(expect.arrayContaining(['01', '07', '12', '15', '21']))
  })
})

describe('payroll — fazla mesai mevcut hesapla tutarlı', () => {
  it('aylık fazla mesai saati overtime.ts toplamıyla aynı; normal = net − fazla', () => {
    // Pzt–Cmt 6 gün × 9 saat net = 54 saat → 9 saat fazla (5–10 Ekim haftası)
    const shifts = ['05', '06', '07', '08', '09', '10'].map((d) => worked(`2026-10-${d}`, '09:00', '19:00'))
    const r = one({ shifts })
    const ot = summarizeOvertime(2026, [{ id: 'e1', full_name: 'Ayşe' }], shifts)[0]
    expect(r.overtimeHours).toBe(ot.totalOvertimeMins / 60)
    expect(r.overtimeHours).toBeGreaterThan(0)
    expect(r.normalHours).toBe(45)
    expect(r.workedDays).toBe(6)
  })
})

describe('payroll — CSV', () => {
  const rows = buildPayrollTimesheet({
    ...base, employees: [{ ...EMP, full_name: '=HYPERLINK("x")' }, { ...EMP, id: 'e2', full_name: 'Veli; "Can"' }],
    shifts: [worked('2026-10-05', '09:00', '17:30', 30)], leaves: [leave('sick', '2026-10-06')],
  }).rows
  const csv = payrollToCsv(rows)

  it('BOM, ; ayracı, CRLF', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const [head, first] = csv.slice(1).split('\r\n')
    expect(head).toBe(PAYROLL_CSV_HEADERS.join(';'))
    expect(first.split(';').length).toBeGreaterThanOrEqual(PAYROLL_CSV_HEADERS.length)
  })
  it('ondalık virgül (7,5 saat)', () => {
    expect(csv).toContain(';7,5;')
  })
  it('formül enjeksiyonu kaçışlanır, ; ve tırnak içeren hücre tırnaklanır', () => {
    expect(csv).toContain("'=HYPERLINK(")
    expect(csv).toContain('"Veli; ""Can"""')
  })
  it('eksik gün nedeni kodu 01 yazılır', () => {
    expect(csv).toContain(';01;')
  })
})

// ── API ──
const STORE_A = '00000000-0000-0000-0003-000000000001'
const STORE_B = '00000000-0000-0000-0003-000000000002'
const sess = { email: null, role_id: null, role_name: null, active: true, home_store_id: STORE_A, store_id: STORE_A }
const asManager = { ...sess, id: 'mgr-1', full_name: 'Müdür', access_level: ACCESS.MANAGER }
const asEmployee = { ...sess, id: 'emp-1', full_name: 'Çalışan', access_level: ACCESS.EMPLOYEE }
const asAdminInB = { ...sess, id: 'adm-1', full_name: 'Admin', access_level: ACCESS.ADMIN, store_id: STORE_B }

let db: FakeDb
beforeEach(() => {
  const emp = (id: string, name: string, store_id: string) => ({
    id, full_name: name, store_id, active: true, employment_type: 'full_time', overtime_consent_at: null, hire_date: null, roles: { name: 'Kasiyer' },
  })
  const shift = (id: string, employee_id: string, store_id: string, work_date: string) => ({
    id, employee_id, store_id, work_date, start_time: '09:00', end_time: '18:00', is_on_leave: false,
  })
  db = createFakeDb({
    stores: [{ id: STORE_A, name: 'Kadıköy Şube' }, { id: STORE_B, name: 'Beşiktaş' }],
    employees: [emp('a1', 'Ayşe', STORE_A), emp('b1', 'Berk', STORE_B)],
    shift_assignments: [shift('s1', 'a1', STORE_A, '2026-09-10'), shift('s2', 'b1', STORE_B, '2026-09-10')],
    leave_requests: [],
    attendance_records: [],
    public_holidays: [],
    audit_logs: [],
  })
})

async function call(employee: unknown, qs: string) {
  vi.resetModules()
  vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(employee) }))
  vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
  vi.doMock('@/lib/db', () => ({ db }))
  const { GET } = await import('@/app/api/reports/payroll/route')
  return GET(new NextRequest(`http://localhost/api/reports/payroll?${qs}`))
}

describe('GET /api/reports/payroll', () => {
  it('oturumsuz 401, çalışan 403', { timeout: 30_000 }, async () => {
    expect((await call(null, 'month=2026-09')).status).toBe(401)
    expect((await call(asEmployee, 'month=2026-09')).status).toBe(403)
  })
  it('geçersiz ay / format 400', { timeout: 30_000 }, async () => {
    expect((await call(asManager, 'month=2026-13')).status).toBe(400)
    expect((await call(asManager, 'month=2026-09&format=pdf')).status).toBe(400)
  })
  it('yalnızca aktif mağaza çalışanları (store isolation)', { timeout: 30_000 }, async () => {
    const a = await (await call(asManager, 'month=2026-09')).json()
    expect(a.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual(['a1'])
    const b = await (await call(asAdminInB, 'month=2026-09')).json()
    expect(b.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual(['b1'])
  })
  it('csv: başlıklar, dosya adı, denetim kaydı mağazaya yazılır', { timeout: 30_000 }, async () => {
    const res = await call(asManager, 'month=2026-09&format=csv')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="bordro-puantaji-kadikoy-sube-2026-09.csv"')
    const text = await res.text()
    expect(text).toContain('Ayşe')
    expect(text).not.toContain('Berk')
    const log = db.tables.audit_logs.find((l) => l.action === 'report.payroll.export')
    expect(log?.store_id).toBe(STORE_A)
  })
  it('xlsx üretir', { timeout: 30_000 }, async () => {
    const res = await call(asManager, 'month=2026-09&format=xlsx')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml')
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000)
  })
})
