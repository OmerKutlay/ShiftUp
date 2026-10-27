/**
 * buildScheduleEntries — haftalık plan satırları: mağazanın aktif çalışanları + haftada vardiyası
 * olup artık mağazada olmayanlar (taşınan / pasif; salt okunur).
 */
import { describe, it, expect } from 'vitest'
import { buildScheduleEntries } from '@/components/schedule/scheduleHelpers'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'

const DAYS = ['2026-10-26', '2026-10-27', '2026-10-28']

const emp = (id: string, full_name: string, active = true) =>
  ({ id, full_name, active, roles: null, employment_type: 'full_time' }) as unknown as EmployeeWithRole

const shift = (employee: EmployeeWithRole, work_date: string) =>
  ({ id: `${employee.id}-${work_date}`, employee_id: employee.id, work_date, start_time: '09:00', end_time: '17:00', employees: employee }) as unknown as ShiftAssignmentWithDetails

describe('buildScheduleEntries', () => {
  const ayse = emp('e1', 'Ayşe')
  const moved = emp('e2', 'Berk')            // başka mağazaya taşındı (aktif)
  const left = emp('e3', 'Can', false)       // pasif

  it('aktif çalışanlar vardiyası olmasa da satır alır; formerLabel yoktur', () => {
    const rows = buildScheduleEntries([ayse], [], DAYS)
    expect(rows).toHaveLength(1)
    expect(rows[0].formerLabel).toBeUndefined()
    expect(Object.values(rows[0].dayAssignments).every((a) => a === null)).toBe(true)
  })

  it('listede olmayıp haftada vardiyası olanlar eklenir: aktifse "Başka mağazada", değilse "Pasif"', () => {
    const rows = buildScheduleEntries([ayse], [shift(moved, DAYS[0]), shift(left, DAYS[1]), shift(ayse, DAYS[2])], DAYS)
    expect(rows.map((r) => [r.employee.full_name, r.formerLabel])).toEqual([
      ['Ayşe', undefined],
      ['Berk', 'Başka mağazada'],
      ['Can', 'Pasif'],
    ])
    const berk = rows.find((r) => r.employee.id === 'e2')!
    expect(berk.dayAssignments[DAYS[0]]?.id).toBe('e2-2026-10-26')
    expect(berk.dayAssignments[DAYS[1]]).toBeNull()
  })

  it('haftada vardiyası olmayan eski çalışan satır almaz', () => {
    expect(buildScheduleEntries([ayse], [shift(ayse, DAYS[0])], DAYS)).toHaveLength(1)
  })
})
