/**
 * planValidation — plan aktarımı öncesi sunucu tarafı yasal kontroller (saf).
 *
 *   - Çalışma süresi: günlük/haftalık net, dinlenme, gece, part-time (buildWeekSummary)
 *   - Md. 46 hafta tatili: önceki haftanın sonuyla birlikte 6 günden fazla ardışık çalışma olamaz
 */
import { buildWeekSummary } from '@/lib/workingTimeService'
import type { WorkingTimeConfig } from '@/lib/workingTimeConfig'
import { addDaysToDateString } from '@/lib/dateUtils'
import type { EmploymentType } from '@/types/employee'

export interface PlanShift {
  id?: string
  employee_id: string
  work_date: string
  start_time: string
  end_time: string
}

export interface PlanEmployee {
  id: string
  full_name: string
  employment_type: EmploymentType
}

/** Tarih kümesindeki en uzun ardışık gün serisi */
export function maxConsecutiveDays(dates: Iterable<string>): { length: number; start: string | null; end: string | null } {
  const sorted = [...new Set(dates)].sort()
  let best = { length: 0, start: null as string | null, end: null as string | null }
  let runStart: string | null = null
  let prev: string | null = null
  let len = 0
  for (const d of sorted) {
    if (prev && addDaysToDateString(prev, 1) === d) {
      len++
    } else {
      len = 1
      runStart = d
    }
    if (len > best.length) best = { length: len, start: runStart, end: d }
    prev = d
  }
  return best
}

/**
 * @param weekShifts   bu haftanın (yeni + korunan) vardiyaları
 * @param neighborShifts önceki 6 gün ve sonraki gün (dinlenme / ardışık gün kontrolü için)
 */
export function validateWeekPlan(
  weekShifts: PlanShift[],
  neighborShifts: PlanShift[],
  employees: PlanEmployee[],
  weekDays: string[],
  config: WorkingTimeConfig
): string[] {
  const empById = new Map(employees.map((e) => [e.id, e]))
  const all = [...weekShifts, ...neighborShifts]
  // Dinlenme kontrolü için yalnızca haftaya bitişik günler (eski haftaların kendi ihlalleri raporlanmasın)
  const dayBefore = addDaysToDateString(weekDays[0], -1)
  const dayAfter = addDaysToDateString(weekDays[6], 1)
  const forSummary = [
    ...weekShifts,
    ...neighborShifts.filter((s) => s.work_date === dayBefore || s.work_date === dayAfter),
  ]

  const summaries = buildWeekSummary(
    forSummary.map((s, i) => {
      const emp = empById.get(s.employee_id)
      return {
        id: s.id ?? `new-${i}`,
        employee_id: s.employee_id,
        work_date: s.work_date,
        start_time: s.start_time,
        end_time: s.end_time,
        is_on_leave: false,
        employment_type: emp?.employment_type ?? 'full_time',
        employees: { id: s.employee_id, full_name: emp?.full_name ?? s.employee_id },
      }
    }),
    weekDays,
    config
  )

  const messages: string[] = []
  for (const s of summaries) {
    // Komşu günler yalnızca dinlenme için listede; komşu-komşu ihlallerini bu plana yazma
    for (const v of s.violations) messages.push(`${s.employeeName}: ${v.message}`)
  }

  // Md. 46 — 7 günlük dilimde en az 24 saat kesintisiz dinlenme ≈ en fazla 6 ardışık iş günü
  const byEmp = new Map<string, string[]>()
  for (const sh of all) {
    const list = byEmp.get(sh.employee_id) ?? []
    list.push(sh.work_date)
    byEmp.set(sh.employee_id, list)
  }
  for (const [empId, dates] of byEmp) {
    const run = maxConsecutiveDays(dates)
    // Yalnızca bu haftaya değen seriler raporlanır
    if (run.length > 6 && run.end! >= weekDays[0] && run.start! <= weekDays[6]) {
      const name = empById.get(empId)?.full_name ?? empId
      messages.push(
        `${name}: ${run.start} – ${run.end} arası ${run.length} gün ardışık çalışma; 7 günde en az bir hafta tatili gerekli (İş Kanunu Md. 46).`
      )
    }
  }

  return [...new Set(messages)]
}
