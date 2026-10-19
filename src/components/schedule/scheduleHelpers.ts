/**
 * scheduleHelpers — haftalık plan ekranının saf yardımcıları (sabitler, özet ve müsaitlik hesapları).
 */
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import type { EmployeeAvailability, DayOfWeek } from '@/types/workforce'
import { shiftDurationMins, netWorkMins, checkMinRest } from '@/lib/workingTimeService'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { kindFromTimes, type ShiftKind } from '@/lib/workforcePlanner'

// ─── Sabitler ─────────────────────────────────────────────────
export const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

// Rol pozisyonlarına göre sıralama önceliği (küçük = üstte).
// Sıra önemli: 'Müdür Yardımcısı' 'müdür' de içerdiği için önce yardımcı kontrol edilir.
export const ROLE_SORT_ORDER: Array<{ keywords: string[]; order: number }> = [
  { keywords: ['yardımcı', 'yardimci'], order: 1 },
  { keywords: ['müdür', 'mudur', 'yönetici', 'yonetici'], order: 0 },
  { keywords: ['kasiyer', 'kasa'], order: 2 },
  { keywords: ['satış', 'satis', 'danışman', 'danisman', 'reyon'], order: 3 },
  { keywords: ['görsel', 'gorsel'], order: 4 },
  { keywords: ['depo'], order: 5 },
]

export function getRoleSortOrder(role: string): number {
  const normalized = role.toLocaleLowerCase('tr')
  for (const { keywords, order } of ROLE_SORT_ORDER) {
    if (keywords.some((k) => normalized.includes(k))) return order
  }
  return 99 // bilinmeyen roller en sona
}

/** Haftalık plandaki rol grupları (ROLE_SORT_ORDER sıralarına göre) */
export const ROLE_GROUPS = [
  { key: 'yonetim', label: 'Yönetim', orders: [0, 1] },
  { key: 'kasa', label: 'Kasa', orders: [2] },
  { key: 'satis', label: 'Satış', orders: [3] },
  { key: 'gorsel-depo', label: 'Görsel & Depo', orders: [4, 5] },
  { key: 'diger', label: 'Diğer', orders: [99] },
] as const

export type RoleGroupKey = (typeof ROLE_GROUPS)[number]['key']

export function roleGroupOf(role: string): RoleGroupKey {
  const order = getRoleSortOrder(role)
  return ROLE_GROUPS.find((g) => (g.orders as readonly number[]).includes(order))?.key ?? 'diger'
}

/** Vardiyanın türü (renk için): şablon adı Açılış/Ortacı/Kapanış/Full ise o, değilse saatlerden */
export function shiftKindOf(templateName: string | undefined, start: string, end: string): ShiftKind {
  const byName: Record<string, ShiftKind> = { 'açılış': 'opening', 'ortacı': 'mid', 'kapanış': 'closing', 'full': 'full' }
  const named = templateName ? byName[templateName.trim().toLocaleLowerCase('tr')] : undefined
  return named ?? kindFromTimes(start, end)
}

/** Dakikayı '7,5 s' biçiminde (Türkçe ondalık) döner */
export function fmtHoursTr(mins: number): string {
  return `${(Math.round((mins / 60) * 10) / 10).toLocaleString('tr-TR')} s`
}

/** Dakikayı '7s' / '8.5s' biçiminde saat olarak döner */
export function fmtHours(mins: number): string {
  return `${Math.round(mins / 60 * 10) / 10}s`
}

/** Vardiyanın mola hakkı (brüt − net) */
export function breakMinsOf(start: string, end: string): number {
  return shiftDurationMins(start, end) - netWorkMins(start, end)
}

/** Şablonsuz (planlayıcının ürettiği) vardiyalar için saatlerden ad türet */
export function shiftDisplayName(templateName: string | undefined, start: string, end: string): string {
  if (templateName) return templateName
  const s = start.slice(0, 5)
  const e = end.slice(0, 5)
  if (s <= '10:00' && e >= '22:00') return 'Full'
  if (s < '12:00') return 'Açılış'
  if (e >= '21:30') return 'Kapanış'
  return 'Ortacı'
}

export const JS_DAY_TO_KEY: Record<number, DayOfWeek> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
}

// ─── Yardımcı tipler ──────────────────────────────────────────
/** Çalışan bazında availability map: employeeId → DayOfWeek → kayıtlar */
export type AvailabilityMap = Map<string, Map<DayOfWeek, EmployeeAvailability[]>>

/** Çalışan bazında haftalık özet */
export interface EmployeeWeekStats {
  /** Net çalışma (mola düşülmüş) */
  totalMins: number
  dailyMins: Record<string, number>      // dateStr → net dakika
  /** Haftalık toplam mola hakkı */
  totalBreakMins: number
  restViolations: Array<{ between: string; restMins: number }> // ihlal açıklaması
  employment_type: import('@/types/employee').EmploymentType
}

// ─── Özet hesaplama ───────────────────────────────────────────
export function calcEmployeeStats(
  assignments: ShiftAssignmentWithDetails[],
  weekDays: string[],
  employment_type: import('@/types/employee').EmploymentType = 'full_time'
): EmployeeWeekStats {
  const config = getWorkingTimeConfig()
  const dailyMins: Record<string, number> = {}
  let totalMins = 0
  let totalBreakMins = 0

  for (const d of weekDays) {
    const dayShifts = assignments.filter((a) => a.work_date === d && !a.is_on_leave)
    const mins = dayShifts.reduce((sum, a) => sum + netWorkMins(a.start_time, a.end_time), 0)
    dailyMins[d] = mins
    totalMins += mins
    totalBreakMins += dayShifts.reduce((sum, a) => sum + breakMinsOf(a.start_time, a.end_time), 0)
  }

  // Min rest ihlalleri — tüm haftayı kronolojik sırala
  const allShifts = assignments
    .filter((a) => !a.is_on_leave)
    .sort((a, b) => {
      const dc = a.work_date.localeCompare(b.work_date)
      return dc !== 0 ? dc : a.start_time.localeCompare(b.start_time)
    })

  const restViolations: EmployeeWeekStats['restViolations'] = []
  for (let i = 0; i < allShifts.length - 1; i++) {
    const curr = allShifts[i]
    const next = allShifts[i + 1]
    const violation = checkMinRest(
      next.work_date, next.start_time, next.end_time,
      [{ work_date: curr.work_date, start_time: curr.start_time, end_time: curr.end_time }],
      config
    )
    if (violation) {
      // İki vardiya arası gerçek dinlenme dakikasını hesapla
      const toAbsMins = (date: string, time: string) => {
        const REF = new Date('2000-01-03')
        const d = new Date(date)
        const [h, m] = time.slice(0, 5).split(':').map(Number)
        return Math.round((d.getTime() - REF.getTime()) / 60000) + h * 60 + m
      }
      let prevEnd = toAbsMins(curr.work_date, curr.end_time)
      const nextStart = toAbsMins(next.work_date, next.start_time)
      // gece yarısını geçen
      const prevStart = toAbsMins(curr.work_date, curr.start_time)
      if (prevEnd <= prevStart) prevEnd += 24 * 60
      const gapMins = nextStart - prevEnd
      restViolations.push({
        between: `${curr.work_date.slice(5)} ${curr.end_time.slice(0, 5)} → ${next.work_date.slice(5)} ${next.start_time.slice(0, 5)}`,
        restMins: Math.max(0, gapMins),
      })
    }
  }

  return { totalMins, dailyMins, totalBreakMins, restViolations, employment_type }
}

// ─── Availability helpers ─────────────────────────────────────
/**
 * Belirli bir tarih için çalışanın availability durumunu döner.
 * Çıktı: 'off' | 'partial' | 'full' | 'none'
 * - 'off': is_available=false kayıt var
 * - 'partial': pencere dışında shift oluşturulabilir uyarısı
 * - 'full': tam olarak müsait
 * - 'none': kayıt yok
 */
export type AvailStatus = 'off' | 'partial' | 'full' | 'none'

export function getAvailStatus(
  employeeId: string,
  dateStr: string,
  availMap: AvailabilityMap,
  shiftStart?: string,
  shiftEnd?: string
): AvailStatus {
  const dayKey = JS_DAY_TO_KEY[new Date(dateStr).getDay()]
  const empMap = availMap.get(employeeId)
  if (!empMap) return 'none'
  const records = empMap.get(dayKey)
  if (!records || records.length === 0) return 'none'

  const hasOff = records.some((r) => !r.is_available)
  if (hasOff) return 'off'

  if (!shiftStart || !shiftEnd) return 'full'

  // Shift pencere kontrolü
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const ss = toMins(shiftStart)
  const se = toMins(shiftEnd)

  const inWindow = records.some((r) => {
    const rs = toMins(r.start_time)
    const re = toMins(r.end_time)
    return ss >= rs && se <= re
  })

  return inWindow ? 'full' : 'partial'
}

