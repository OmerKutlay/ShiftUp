/// <reference types="vitest/globals" />
import { runPlanner } from '../workforcePlanner'
import type { PlannerEmployee, PlannerShiftTemplate } from '../workforcePlanner'
import { buildPlan, toPayloadEmployee, type PlanPayload } from '../workforcePlanPayload'
import type { PlanningGroup } from '@/lib/auth/roles'

const TEMPLATES: PlannerShiftTemplate[] = [
  { id: 'tmpl-open',  name: 'Acilis',  start_time: '10:00', end_time: '18:00' },
  { id: 'tmpl-close', name: 'Kapanis', start_time: '14:00', end_time: '22:00' },
  { id: 'tmpl-full',  name: 'Full',    start_time: '10:00', end_time: '22:00' },
]
const WEEK_DAYS = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']

const emp = (id: string, planning_group: PlanningGroup, et: 'full_time' | 'part_time', extra: Partial<PlannerEmployee> = {}): PlannerEmployee => ({
  id, full_name: id, planning_group, employment_type: et, availability: {}, leaveDays: new Set(), ...extra,
})

const EMPLOYEES: PlannerEmployee[] = [
  emp('mudur', 'store_manager', 'full_time', { leaveDays: new Set(['2026-10-13']), paidLeaveDays: new Set(['2026-10-13']) }),
  emp('yardimci', 'assistant_manager', 'full_time', { pendingLeaveDays: new Set(['2026-10-15']), prevStreak: 3 }),
  emp('kasiyer1', 'cashier', 'full_time', { lastWeek: { monday: 'opening' } }),
  emp('kasiyer2', 'cashier', 'part_time'),
  emp('satis1', 'sales', 'full_time', { prevDayEndMins: -120 }),
  emp('satis2', 'sales', 'part_time'),
]

const payloadOf = (holidays: PlanPayload['holidays'] = []): PlanPayload =>
  // Sunucudan gelen paket gibi: JSON gidiş-dönüşünden geçer (Set → dizi)
  JSON.parse(JSON.stringify({
    weekStart: WEEK_DAYS[0], weekEnd: WEEK_DAYS[6], weekDays: WEEK_DAYS, today: WEEK_DAYS[0],
    employees: EMPLOYEES.map(toPayloadEmployee), templates: TEMPLATES, fixedAssignments: [], holidays,
  }))

describe('buildPlan — tarayıcıda plan üretimi', () => {
  it('JSON paketinden üretilen plan, aynı tohumla sunucudaki runPlanner sonucuyla aynı', () => {
    const direct = runPlanner({
      weekStart: WEEK_DAYS[0], weekEnd: WEEK_DAYS[6], weekDays: WEEK_DAYS, today: WEEK_DAYS[0],
      employees: EMPLOYEES, templates: TEMPLATES, fixedAssignments: [], seed: 42,
    })
    const fromPayload = buildPlan(payloadOf(), 42)
    expect(fromPayload.assignments).toEqual(direct.assignments)
    expect(fromPayload.stats).toEqual(direct.stats)
    expect(fromPayload.hasHardViolation).toBe(direct.hasHardViolation)
  })

  it('izin günü pakette de bloklanır', () => {
    const plan = buildPlan(payloadOf(), 7)
    expect(plan.assignments.some((a) => a.employee_id === 'mudur' && a.work_date === '2026-10-13')).toBe(false)
  })

  it('resmi tatilde planlanan çalışanlar için uyarı ekler', () => {
    const plan = buildPlan(payloadOf([{ date: '2026-10-14', name: 'Test Bayramı', half_day: false }]), 1)
    const names = plan.assignments.filter((a) => a.work_date === '2026-10-14')
    expect(names.length).toBeGreaterThan(0)
    const w = plan.warnings.find((x) => x.message.includes('Test Bayramı'))
    expect(w).toMatchObject({ level: 'warning' })
    expect(w!.message).toContain(`resmi tatilde ${names.length} çalışan`)
  })

  it('arife: yalnızca 13:00 sonrasına taşan vardiyalar sayılır', () => {
    const plan = buildPlan(payloadOf([{ date: '2026-10-16', name: 'Arife', half_day: true }]), 1)
    const late = plan.assignments.filter((a) => a.work_date === '2026-10-16' && a.end_time.slice(0, 5) > '13:00')
    const w = plan.warnings.find((x) => x.message.includes('Arife'))
    if (late.length === 0) expect(w).toBeUndefined()
    else expect(w!.message).toContain('(arife, 13:00 sonrası)')
  })

  it('bekleyen izin gününe atama yapılırsa bilgi uyarısı ekler', () => {
    const plan = buildPlan(payloadOf(), 3)
    const onPending = plan.assignments.some((a) => a.employee_id === 'yardimci' && a.work_date === '2026-10-15')
    const info = plan.warnings.some((w) => w.level === 'info' && w.message.startsWith('yardimci: 2026-10-15 için bekleyen izin'))
    expect(info).toBe(onPending)
  })
})
