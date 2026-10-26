import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { WeekPrintSheet, dayHeadcount } from '@/components/schedule/print/WeekPrintSheet'
import { formatWeekRangeTr, parseWeekParam, formatPrintedAt } from '@/components/schedule/print/printHelpers'
import { calcEmployeeStats } from '@/components/schedule/scheduleHelpers'

const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']

const emp = (id: string, name: string): EmployeeWithRole => ({
  id, full_name: name, email: null, role_id: null, active: true, store_id: 's1', employment_type: 'full_time',
  auth_user_id: null, created_at: '', updated_at: '', roles: null,
} as EmployeeWithRole)

const shift = (employee_id: string, work_date: string, start: string, end: string, name?: string) => ({
  id: `${employee_id}-${work_date}`, employee_id, work_date, start_time: start, end_time: end, is_on_leave: false,
  shift_templates: name ? { name } : null, employees: null,
}) as unknown as ShiftAssignmentWithDetails

const ali = emp('e1', 'Ali Yılmaz')
const ayse = emp('e2', 'Ayşe Demir')
const assignments = [
  shift('e1', days[0], '09:00:00', '18:00:00', 'Açılış'),
  shift('e1', days[1], '09:00:00', '18:00:00'),
  shift('e2', days[0], '12:00:00', '21:00:00'),
]

function entries(): WeeklyScheduleEntry[] {
  return [ali, ayse].map((employee) => ({
    employee,
    dayAssignments: Object.fromEntries(days.map((d) => [d, assignments.find((a) => a.employee_id === employee.id && a.work_date === d) ?? null])),
  }))
}

const renderSheet = (over: Partial<Parameters<typeof WeekPrintSheet>[0]> = {}) => {
  const e = entries()
  const statsMap = new Map(e.map((x) => [x.employee.id, calcEmployeeStats(assignments.filter((a) => a.employee_id === x.employee.id), days)]))
  return render(
    <WeekPrintSheet
      storeName="Kadıköy" weekDays={days} entries={e} holidayMap={new Map()} statsMap={statsMap}
      approvedLeaveMap={new Set()} restDayMap={new Set()} printedAt="26 Ekim 2026 14:05" {...over}
    />
  )
}

describe('WeekPrintSheet', () => {
  it('başlık, hafta aralığı, basım damgası, satırlar ve vardiya saatlerini gösterir', () => {
    renderSheet()
    expect(screen.getByText(/Kadıköy · Haftalık vardiya planı/)).toBeInTheDocument()
    expect(screen.getByText('26 Ekim – 1 Kasım 2026')).toBeInTheDocument()
    expect(screen.getByText('Basım: 26 Ekim 2026 14:05')).toBeInTheDocument()
    expect(screen.getByText('Ali Yılmaz')).toBeInTheDocument()
    expect(screen.getAllByText('09:00–18:00')).toHaveLength(2)
    expect(screen.getByText('Açılış')).toBeInTheDocument()
    expect(screen.getByText('Pzt 26.10')).toBeInTheDocument()
    expect(screen.getByText('Paz 1.11')).toBeInTheDocument()
  })

  it('izin, haftalık tatil ve resmi tatil işaretlerini yazar; izinli kişi sayıya girmez', () => {
    const holidayMap = new Map<string, PublicHoliday>([[days[2], { date: days[2], name: 'Cumhuriyet Bayramı', half_day: false } as PublicHoliday]])
    renderSheet({ approvedLeaveMap: new Set([`e1:${days[0]}`]), restDayMap: new Set([`e2:${days[1]}`]), holidayMap })
    expect(screen.getByText('İzinli')).toBeInTheDocument()
    expect(screen.getByText('Haftalık tatil')).toBeInTheDocument()
    expect(screen.getByText(/Resmi tatil: Cumhuriyet Bayramı/)).toBeInTheDocument()
    const footer = screen.getByText('Mağazada (kişi)').closest('tr')!
    // Pzt: Ali izinli, Ayşe çalışıyor → 1 ; Sal: Ali çalışıyor, Ayşe tatilde → 1
    expect(within(footer).getAllByRole('cell').slice(1, 3).map((c) => c.textContent)).toEqual(['1', '1'])
  })

  it('haftalık saat toplamları (net, mola düşülmüş) satır ve altbilgide görünür', () => {
    renderSheet()
    const stats = (id: string) => calcEmployeeStats(assignments.filter((a) => a.employee_id === id), days).totalMins
    const rows = screen.getAllByRole('row')
    const aliRow = rows.find((r) => r.textContent?.includes('Ali Yılmaz'))!
    const fmt = (m: number) => (Math.round(m / 6) / 10).toLocaleString('tr-TR')
    expect(aliRow.lastElementChild?.textContent).toBe(fmt(stats('e1')))
    const footer = screen.getByText('Mağazada (kişi)').closest('tr')!
    expect(footer.lastElementChild?.textContent).toBe(fmt(stats('e1') + stats('e2')))
    expect(stats('e1')).toBeGreaterThan(stats('e2'))
  })

  it('dayHeadcount izin ve tatili hariç tutar', () => {
    const e = entries()
    expect(dayHeadcount(e, days[0], new Set(), new Set())).toBe(2)
    expect(dayHeadcount(e, days[0], new Set([`e1:${days[0]}`]), new Set())).toBe(1)
    expect(dayHeadcount(e, days[0], new Set(), new Set([`e1:${days[0]}`, `e2:${days[0]}`]))).toBe(0)
    expect(dayHeadcount(e, days[3], new Set(), new Set())).toBe(0)
  })
})

describe('printHelpers', () => {
  it('Türkçe hafta aralığı ay ve yıl geçişlerini doğru yazar', () => {
    expect(formatWeekRangeTr('2026-10-27', '2026-11-02')).toBe('27 Ekim – 2 Kasım 2026')
    expect(formatWeekRangeTr('2026-10-19', '2026-10-25')).toBe('19 – 25 Ekim 2026')
    expect(formatWeekRangeTr('2026-12-28', '2027-01-03')).toBe('28 Aralık 2026 – 3 Ocak 2027')
  })

  it('week parametresi doğrulanır', () => {
    expect(parseWeekParam('2026-10-26')).toBeInstanceOf(Date)
    expect(parseWeekParam('2026-02-31')).toBeNull()
    expect(parseWeekParam('bugün')).toBeNull()
    expect(parseWeekParam(undefined)).toBeNull()
  })

  it('basım zamanı Türkiye saatiyle yazılır', () => {
    expect(formatPrintedAt(new Date('2026-10-26T21:30:00Z'))).toMatch(/27 Ekim 2026.*00:30/)
  })
})
