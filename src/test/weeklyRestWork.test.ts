/**
 * weeklyRestWork.test.ts — hafta tatilinde çalışma: yönetici haftalık tatil gününe vardiya verebilir
 * (onay ister, tatil kaydı kalır); diğer izin türleri hâlâ engeldir. Puantaj bu günü HTÇ olarak ayrı sayar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'
import { buildTimesheet } from '@/lib/timesheet'
import { toPayrollRows } from '@/lib/payrollTimesheet'
import { buildExportTable } from '@/lib/timesheetExport'

const STORE = '00000000-0000-0000-0003-000000000001'
const EMP = '00000000-0000-4000-9000-000000000001'
const MGR = '00000000-0000-4000-9000-000000000010'
/** Gelecek bir Pazar — geçmiş gün korumaları devreye girmesin */
const SUN = '2030-03-10'

const session = {
  id: MGR, full_name: 'Müdür', email: 'm@example.com', role_id: null, role_name: null,
  active: true, access_level: ACCESS.STORE_MANAGER, home_store_id: STORE, store_id: STORE,
}

function seed(leaveType: string) {
  return {
    employees: [
      { id: EMP, full_name: 'Ali', store_id: STORE, active: true, employment_type: 'full_time', birth_date: null, termination_date: null },
      { id: MGR, full_name: 'Müdür', store_id: STORE, active: true, employment_type: 'full_time', birth_date: null, termination_date: null },
    ],
    shift_templates: [],
    shift_assignments: [],
    leave_requests: [
      { id: 'lv-1', employee_id: EMP, leave_type: leaveType, status: 'approved', start_date: SUN, end_date: SUN, store_id: STORE },
    ],
    attendance_records: [],
    notifications: [],
    audit_logs: [],
  }
}

function setup(db: FakeDb) {
  vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(session) }))
  vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
  vi.doMock('@/lib/db', () => ({ db }))
}

const post = (body: unknown) => new NextRequest('http://localhost/api/shifts', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const shift = { employee_id: EMP, work_date: SUN, start_time: '10:00', end_time: '18:00' }

beforeEach(() => vi.resetModules())

describe('/api/shifts — haftalık tatil gününe vardiya', () => {
  it('onay ister (422 weekly_rest_work); onaylanınca kaydeder, tatil kaydı kalır', async () => {
    const db = createFakeDb(seed('weekly_rest'))
    setup(db)
    const { POST } = await import('@/app/api/shifts/route')

    const first = await POST(post(shift))
    expect(first.status).toBe(422)
    const body = (await first.json()) as { code: string; violation_types: string[]; violations: string[] }
    expect(body.code).toBe('WORKING_TIME_VIOLATION')
    expect(body.violation_types).toEqual(['weekly_rest_work'])
    expect(body.violations[0]).toContain('haftalık tatil günü')
    expect(body.violations[0]).toContain('10 Mart Pazar')   // ISO tarih değil, okunur tarih
    expect(db.tables.shift_assignments).toHaveLength(0)

    const ok = await POST(post({ ...shift, acknowledge_violations: true }))
    expect(ok.status).toBe(201)
    expect(db.tables.shift_assignments).toHaveLength(1)
    expect(db.tables.leave_requests).toHaveLength(1)
    expect(db.tables.audit_logs[0].note).toContain('haftalık tatil günü')
  })

  it('"Bu gün çalışsın" (weekly_rest_work: true) ayrıca onay istemeden kaydeder', async () => {
    const db = createFakeDb(seed('weekly_rest'))
    setup(db)
    const { POST } = await import('@/app/api/shifts/route')
    const res = await POST(post({ ...shift, weekly_rest_work: true }))
    expect(res.status).toBe(201)
    expect(db.tables.shift_assignments).toHaveLength(1)
    expect(db.tables.leave_requests).toHaveLength(1)
    expect(db.tables.audit_logs[0].note).toContain('haftalık tatil günü')
  })

  it('weekly_rest_work bayrağı diğer günlerde ihlal onayının yerine geçmez', async () => {
    const db = createFakeDb(seed('weekly_rest'))
    db.tables.shift_assignments.push(
      { id: 'sa-prev', employee_id: EMP, work_date: SUN, start_time: '00:00', end_time: '08:00', store_id: STORE },
    )
    setup(db)
    const { POST } = await import('@/app/api/shifts/route')
    // 10:00–18:00 + aynı gün 00:00–08:00: günlük 11 saat sınırı / dinlenme ihlali → yine 422
    const res = await POST(post({ ...shift, weekly_rest_work: true }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { violation_types: string[] }
    expect(body.violation_types).not.toContain('weekly_rest_work')
    expect(body.violation_types.length).toBeGreaterThan(0)
  })

  it('yıllık izin günü hâlâ engeldir (409)', async () => {
    const db = createFakeDb(seed('annual'))
    setup(db)
    const { POST } = await import('@/app/api/shifts/route')
    const res = await POST(post({ ...shift, acknowledge_violations: true }))
    expect(res.status).toBe(409)
    expect(db.tables.shift_assignments).toHaveLength(0)
  })
})

describe('puantaj — hafta tatilinde çalışma', () => {
  const EMP_ROW = { id: 'e1', full_name: 'Ayşe', role_name: 'Kasiyer', employment_type: 'full_time' as const }
  const worked = (date: string, start = '09:00', end = '19:00') => ({
    id: `s-${date}`, employee_id: 'e1', work_date: date, start_time: start, end_time: end,
    attendance: { clock_in_at: `${date}T${start}:00+03:00`, clock_out_at: `${date}T${end}:00+03:00`, break_start_at: null, break_end_at: null },
  })
  // 5–11 Ekim 2026: 09–19 vardiyası net 8,5 s (planlı mola 90 dk). Pzt–Cmt 6 gün = 51 s → 6 s fazla;
  // Pazar (11) haftalık tatil ama çalışıldı (8,5 s)
  const days = ['05', '06', '07', '08', '09', '10', '11'].map((d) => worked(`2026-10-${d}`))
  const [row] = buildTimesheet({
    month: '2026-10', employees: [EMP_ROW], holidays: [], today: '2026-10-31', shifts: days,
    leaves: [{ employee_id: 'e1', leave_type: 'weekly_rest', start_date: '2026-10-11', end_date: '2026-10-11' }],
  })

  it('gün HTÇ; saatleri 45 saat hesabına girmez, haftanın HT saati olur', () => {
    expect(row.days['2026-10-11']).toBe('HTÇ')
    expect(row.restWorkedDays).toBe(1)
    expect(row.leaveDays['HT']).toBe(0)
    expect(row.restWorkByWeek['2026-10-11']).toBe(8.5 * 60)
    expect(row.restWorkMins).toBe(8.5 * 60)
    expect(row.overtimeByWeek['2026-10-11']).toBe(6 * 60)   // 51 − 45 (Pazar hariç)
    expect(row.overtimeMins).toBe(6 * 60)
    expect(row.workedDays).toBe(7)
  })

  it('bordro: HT saati ayrı sütunda, normal saatten düşülür', () => {
    const [p] = toPayrollRows('2026-10', [row])
    expect(p.days['2026-10-11']).toBe('HTÇ')
    expect(p.restWorkedDays).toBe(1)
    expect(p.restWorkedHours).toBe(8.5)
    expect(p.overtimeHours).toBe(6)
    expect(p.normalHours).toBe(59.5 - 6 - 8.5)
  })

  it('çizelge: haftalık %50 ve HT sütunları; TOPLAM %50 ikisinin toplamı', () => {
    const t = buildExportTable('2026-10', [row], 'Kadıköy')
    const col = (h: string) => t.header.indexOf(h)
    expect(t.header).toContain('II. HAFTA HT')
    expect(t.body[0][col('II. HAFTA %50 (05.10–11.10)')]).toBe(6)
    expect(t.body[0][col('II. HAFTA HT')]).toBe(8.5)
    expect(t.body[0][col('TOPLAM %50')]).toBe(14.5)
    expect(t.body[0][t.firstDayCol + 10]).toBe(8.5)   // 11 Ekim hücresi: net saat
  })
})
