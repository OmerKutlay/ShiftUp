/**
 * workingTimeService — Çalışma süresi hesaplama ve doğrulama
 *
 * Tüm fonksiyonlar saf (pure) veya yalnızca DB client'a bağımlı.
 * Hem server-side API route'larında hem de client-side hesaplamada kullanılabilir.
 *
 * Önemli: Gece yarısını geçen vardiyaları (22:00→06:00) doğru hesaplar.
 */
import type { WorkingTimeConfig } from './workingTimeConfig'
import type { DayOfWeek } from '@/types/workforce'
import type { EmploymentType } from '@/types/employee'
import { PART_TIME_RULES } from '@/types/employee'
import { statutoryMinBreakMins, nightWorkViolation, MAX_NIGHT_WORK_MINS } from './laborLaw'
import { dayOfWeekFromDateString } from './dateUtils'

// ─── Temel hesaplamalar ───────────────────────────────────────

/**
 * İki zaman stringinden vardiya süresini dakika cinsinden hesaplar.
 * Gece yarısını geçen vardiyaları doğru işler: 22:00→06:00 = 480 dk
 * Format: 'HH:MM' veya 'HH:MM:SS'
 */
export function shiftDurationMins(startTime: string, endTime: string): number {
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const s = toMins(startTime)
  let e = toMins(endTime)
  if (e <= s) e += 24 * 60   // gece yarısını geçen vardiya
  return e - s
}

/**
 * Vardiya için planlanan mola süresi (dakika).
 *
 *   ≤ 4 saat brüt   →  15 dk (Md. 68 yasal asgari — kısa part-time vardiyalar)
 *   ≥ 11 saat brüt  → 120 dk (mağaza politikası, full 12s vardiya)
 *   ≥ 9,5 saat brüt →  90 dk (mağaza politikası)
 *   diğer           →  60 dk (mağaza politikası; yasal asgarinin (30/60 dk) üstünde)
 *
 * Sonuç hiçbir zaman yasal asgarinin altına düşmez.
 */
export function plannedBreakMins(startTime: string, endTime: string): number {
  const brut = shiftDurationMins(startTime, endTime)
  let policy: number
  if (brut <= 4 * 60) policy = 15
  else if (brut >= 11 * 60) policy = 120
  else if (brut >= 9 * 60 + 30) policy = 90
  else policy = 60
  return Math.max(policy, statutoryMinBreakMins(brut))
}

/**
 * Vardiya brüt süresinden planlanan mola düşülerek NET çalışma süresi (dakika).
 * Mola süreleri çalışma süresinden sayılmaz (Md. 68); yasal günlük/haftalık
 * sınırlar ve fazla çalışma net süre üzerinden hesaplanır.
 */
export function netWorkMins(startTime: string, endTime: string): number {
  return Math.max(0, shiftDurationMins(startTime, endTime) - plannedBreakMins(startTime, endTime))
}

/** Dakikayı 'Xh Ym' formatında döner */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (m === 0) return `${h}s`
  return `${h}s ${m}dk`
}

/** Dakikayı saat cinsinden (ondalıklı) döner */
export function minsToHours(mins: number): number {
  return Math.round((mins / 60) * 100) / 100
}

// ─── Çakışma ve süre hesabı ───────────────────────────────────

/**
 * Bir shift listesinden belirli tarihteki toplam çalışma dakikasını döner.
 * Gece yarısını geçen vardiyaları doğru hesaplar.
 */
export function calcDailyMins(
  shifts: Array<{ work_date: string; start_time: string; end_time: string }>,
  date: string
): number {
  return shifts
    .filter((s) => s.work_date === date)
    .reduce((sum, s) => sum + netWorkMins(s.start_time, s.end_time), 0)
}

/**
 * Bir shift listesinden haftalık toplam çalışma dakikasını döner.
 * weekStart / weekEnd: 'YYYY-MM-DD' formatında Pazartesi ve Pazar.
 */
export function calcWeeklyMins(
  shifts: Array<{ work_date: string; start_time: string; end_time: string }>,
  weekStart: string,
  weekEnd: string
): number {
  return shifts
    .filter((s) => s.work_date >= weekStart && s.work_date <= weekEnd)
    .reduce((sum, s) => sum + netWorkMins(s.start_time, s.end_time), 0)
}

// ─── İhlal tipleri ────────────────────────────────────────────

export type ViolationType =
  | 'overlap'
  | 'min_rest'
  | 'daily_max'
  | 'weekly_max'
  | 'availability'
  | 'part_time_day_limit'
  | 'part_time_hour_limit'
  | 'night_work'

export interface WorkingTimeViolation {
  type: ViolationType
  message: string
  /** İhlal varsa HTTP 422 ile dönmek için severity: error = blokla, warning = sadece uyar */
  severity: 'error' | 'warning'
}

// ─── Kontrol fonksiyonları ────────────────────────────────────

/**
 * Önceki ve sonraki vardiyalarla minimum dinlenme ihlali kontrolü.
 *
 * Algoritma:
 *   - newDate+newEnd sonrasındaki en yakın vardiya başlangıcı arasındaki fark ≥ minRestHours?
 *   - newDate+newStart öncesindeki en yakın vardiya bitişi arasındaki fark ≥ minRestHours?
 *
 * existingShifts: aynı employee'ın TÜM vardiyaları (farklı günler dahil).
 * excludeId: güncelleme sırasında kendini hariç tut.
 */
export function checkMinRest(
  newDate: string,
  newStart: string,
  newEnd: string,
  existingShifts: Array<{ id?: string; work_date: string; start_time: string; end_time: string }>,
  config: WorkingTimeConfig,
  excludeId?: string
): WorkingTimeViolation | null {
  const minRestMins = config.minRestHours * 60

  // Yeni vardiyanın mutlak başlangıç/bitiş dakikaları (epoch-agnostic, gün bazlı)
  const dateToBaseMins = (date: string): number => {
    const d = new Date(date)
    // 2000-01-03 Pazartesi = 0 referans noktası (keyfi, tutarlı offset)
    const REF = new Date('2000-01-03')
    return Math.round((d.getTime() - REF.getTime()) / 60000)
  }

  const toAbsMins = (date: string, time: string): number => {
    const [h, m] = time.slice(0, 5).split(':').map(Number)
    return dateToBaseMins(date) + h * 60 + m
  }

  const newAbsStart = toAbsMins(newDate, newStart)
  let newAbsEnd = toAbsMins(newDate, newEnd)
  if (newAbsEnd <= newAbsStart) newAbsEnd += 24 * 60  // gece yarısını geçen

  for (const s of existingShifts) {
    if (excludeId && s.id === excludeId) continue

    const sAbsStart = toAbsMins(s.work_date, s.start_time)
    let sAbsEnd = toAbsMins(s.work_date, s.end_time)
    if (sAbsEnd <= sAbsStart) sAbsEnd += 24 * 60

    // Zaman aralıkları kesişiyor (ör. önceki günün gece vardiyası) → dinlenme negatif
    if (newAbsStart < sAbsEnd && sAbsStart < newAbsEnd) {
      return {
        type: 'overlap',
        message: `Vardiya, ${s.work_date} tarihli ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)} vardiyasıyla çakışıyor.`,
        severity: 'error',
      }
    }

    // Yeni vardiya mevcut vardiyadan SONRA başlıyorsa: mevcut bitiş → yeni başlangıç arası dinlenme
    const gapAfterExisting = newAbsStart - sAbsEnd
    if (gapAfterExisting >= 0 && gapAfterExisting < minRestMins) {
      const restH = Math.round(gapAfterExisting / 60 * 10) / 10
      return {
        type: 'min_rest',
        message: `Ardışık vardiyalar arası dinlenme süresi yetersiz (${restH}s < ${config.minRestHours}s).`,
        severity: 'error',
      }
    }

    // Yeni vardiya mevcut vardiyadan ÖNCE bitiyorsa: yeni bitiş → mevcut başlangıç arası dinlenme
    const gapBeforeExisting = sAbsStart - newAbsEnd
    if (gapBeforeExisting >= 0 && gapBeforeExisting < minRestMins) {
      const restH = Math.round(gapBeforeExisting / 60 * 10) / 10
      return {
        type: 'min_rest',
        message: `Ardışık vardiyalar arası dinlenme süresi yetersiz (${restH}s < ${config.minRestHours}s).`,
        severity: 'error',
      }
    }
  }

  return null
}

/**
 * Günlük maksimum çalışma saati kontrolü.
 * existingShifts: aynı gun & employee vardiyeleri.
 * excludeId: güncelleme için kendi ID'yi hariç tut.
 */
export function checkDailyMax(
  newDate: string,
  newStart: string,
  newEnd: string,
  existingShifts: Array<{ id?: string; work_date: string; start_time: string; end_time: string }>,
  config: WorkingTimeConfig,
  excludeId?: string
): WorkingTimeViolation | null {
  const maxMins = config.maxDailyWorkHours * 60
  const existing = existingShifts
    .filter((s) => s.work_date === newDate && s.id !== excludeId)
    .reduce((sum, s) => sum + netWorkMins(s.start_time, s.end_time), 0)
  const newDuration = netWorkMins(newStart, newEnd)
  const total = existing + newDuration

  if (total > maxMins) {
    return {
      type: 'daily_max',
      message: `Günlük maksimum çalışma saati aşılıyor (${formatDuration(total)} > ${config.maxDailyWorkHours}s).`,
      severity: 'error',
    }
  }
  return null
}

/**
 * Haftalık maksimum çalışma saati kontrolü.
 * existingShifts: aynı hafta & employee vardiyeleri.
 */
export function checkWeeklyMax(
  newDate: string,
  newStart: string,
  newEnd: string,
  existingShifts: Array<{ id?: string; work_date: string; start_time: string; end_time: string }>,
  weekStart: string,
  weekEnd: string,
  config: WorkingTimeConfig,
  excludeId?: string
): WorkingTimeViolation | null {
  // Yeni vardiya bu haftaya ait mi?
  if (newDate < weekStart || newDate > weekEnd) return null

  const maxMins = config.maxWeeklyWorkHours * 60
  const existing = existingShifts
    .filter((s) => s.work_date >= weekStart && s.work_date <= weekEnd && s.id !== excludeId)
    .reduce((sum, s) => sum + netWorkMins(s.start_time, s.end_time), 0)
  const newDuration = netWorkMins(newStart, newEnd)
  const total = existing + newDuration

  if (total > maxMins) {
    return {
      type: 'weekly_max',
      message: `Haftalık maksimum çalışma saati aşılıyor (${formatDuration(total)} > ${config.maxWeeklyWorkHours}s).`,
      severity: 'error',
    }
  }
  return null
}

/**
 * Availability ihlali kontrolü.
 * Employee'ın belirli günde kayıtlı availability'si varsa,
 * vardiya bu aralığın dışına çıkıyorsa uyarı döner.
 *
 * Önemli: availability advisory; error değil warning üretir.
 */
export function checkAvailability(
  newDate: string,
  newStart: string,
  newEnd: string,
  availability: Array<{
    day_of_week: DayOfWeek
    start_time: string
    end_time: string
    is_available: boolean
  }>
): WorkingTimeViolation | null {
  const DAY_MAP: Record<number, DayOfWeek> = {
    0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
    4: 'thursday', 5: 'friday', 6: 'saturday',
  }
  const jsDay = dayOfWeekFromDateString(newDate)
  const dayKey = DAY_MAP[jsDay]

  const dayAvailability = availability.filter((a) => a.day_of_week === dayKey)
  if (dayAvailability.length === 0) return null  // kayıt yoksa kontrol yapma

  // Müsait olmayan bir kayıt varsa blokla
  const unavailable = dayAvailability.find((a) => !a.is_available)
  if (unavailable) {
    return {
      type: 'availability',
      message: `Çalışan ${DAY_LABELS[dayKey]} günü müsait değil olarak işaretlemiş.`,
      severity: 'warning',
    }
  }

  // Müsaitlik penceresi dışında mı?
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const shiftStart = toMins(newStart)
  let shiftEnd = toMins(newEnd)
  if (shiftEnd <= shiftStart) shiftEnd += 24 * 60  // gece yarısını geçen vardiya

  for (const a of dayAvailability) {
    const avStart = toMins(a.start_time)
    let avEnd = toMins(a.end_time)
    if (avEnd <= avStart) avEnd += 24 * 60
    if (shiftStart >= avStart && shiftEnd <= avEnd) return null  // tam içinde
  }

  return {
    type: 'availability',
    message: `Vardiya çalışanın müsaitlik penceresinin dışında (${newStart}–${newEnd}).`,
    severity: 'warning',
  }
}

/**
 * Md. 69 — gece çalışması (20:00–06:00) 7,5 saati aşamaz.
 */
export function checkNightWork(newStart: string, newEnd: string): WorkingTimeViolation | null {
  if (!nightWorkViolation(newStart, newEnd, netWorkMins(newStart, newEnd))) return null
  return {
    type: 'night_work',
    message: `Gece çalışması (20:00–06:00) ${MAX_NIGHT_WORK_MINS / 60} saati aşamaz (İş Kanunu Md. 69): ${newStart.slice(0, 5)}–${newEnd.slice(0, 5)}.`,
    severity: 'error',
  }
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: 'Pazartesi', tuesday: 'Salı', wednesday: 'Çarşamba',
  thursday: 'Perşembe', friday: 'Cuma', saturday: 'Cumartesi', sunday: 'Pazar',
}

// ─── Birleşik doğrulama ───────────────────────────────────────

export interface ShiftValidationInput {
  newDate: string
  newStart: string
  newEnd: string
  /** Aynı employee'ın varolan tüm shift_assignments (bu hafta + yakın günler) */
  existingShifts: Array<{ id?: string; work_date: string; start_time: string; end_time: string }>
  weekStart: string
  weekEnd: string
  config: WorkingTimeConfig
  availability?: Array<{ day_of_week: DayOfWeek; start_time: string; end_time: string; is_available: boolean }>
  excludeId?: string
  /** Çalışma tipi — part_time ise ek günlük/haftalık sınırlar uygulanır */
  employment_type?: EmploymentType
}

export interface ShiftValidationResult {
  valid: boolean
  /** error varsa işlem bloklanır */
  errors: WorkingTimeViolation[]
  /** warning varsa işlem devam eder ama uyarı gösterilir */
  warnings: WorkingTimeViolation[]
}

/**
 * Tüm çalışma süresi kurallarını tek çağrıda kontrol eder.
 * Overlap kontrolü scheduleRepository.checkConflict tarafından ayrıca yapılır;
 * bu servis sadece duration/rest/availability kurallarını kontrol eder.
 */
export function validateShiftAssignment(input: ShiftValidationInput): ShiftValidationResult {
  const violations: WorkingTimeViolation[] = []

  const restViolation = checkMinRest(
    input.newDate, input.newStart, input.newEnd,
    input.existingShifts, input.config, input.excludeId
  )
  if (restViolation) violations.push(restViolation)

  const dailyViolation = checkDailyMax(
    input.newDate, input.newStart, input.newEnd,
    input.existingShifts, input.config, input.excludeId
  )
  if (dailyViolation) violations.push(dailyViolation)

  const weeklyViolation = checkWeeklyMax(
    input.newDate, input.newStart, input.newEnd,
    input.existingShifts, input.weekStart, input.weekEnd,
    input.config, input.excludeId
  )
  if (weeklyViolation) violations.push(weeklyViolation)

  const nightViolation = checkNightWork(input.newStart, input.newEnd)
  if (nightViolation) violations.push(nightViolation)

  if (input.availability) {
    const availViolation = checkAvailability(
      input.newDate, input.newStart, input.newEnd, input.availability
    )
    if (availViolation) violations.push(availViolation)
  }

  // ── Part-time ek kurallar ─────────────────────────────────
  if (input.employment_type === 'part_time') {
    // Haftalık saat limiti (30s)
    const ptWeeklyMins = PART_TIME_RULES.maxWeeklyHours * 60
    const existingWeeklyMins = input.existingShifts
      .filter((s) =>
        s.work_date >= input.weekStart &&
        s.work_date <= input.weekEnd &&
        s.id !== input.excludeId
      )
      .reduce((sum, s) => sum + netWorkMins(s.start_time, s.end_time), 0)
    const newMins = netWorkMins(input.newStart, input.newEnd)
    if (
      input.newDate >= input.weekStart &&
      input.newDate <= input.weekEnd &&
      existingWeeklyMins + newMins > ptWeeklyMins
    ) {
      violations.push({
        type: 'part_time_hour_limit',
        message: `Yarı zamanlı çalışan haftalık ${PART_TIME_RULES.maxWeeklyHours} saat limitini aşıyor (${formatDuration(existingWeeklyMins + newMins)} > ${PART_TIME_RULES.maxWeeklyHours}s).`,
        severity: 'error',
      })
    }

    // Haftalık gün limiti (4 gün)
    if (
      input.newDate >= input.weekStart &&
      input.newDate <= input.weekEnd
    ) {
      const existingDays = new Set(
        input.existingShifts
          .filter((s) =>
            s.work_date >= input.weekStart &&
            s.work_date <= input.weekEnd &&
            s.id !== input.excludeId
          )
          .map((s) => s.work_date)
      )
      // Yeni günü ekle (zaten varsa set boyutu değişmez)
      const isNewDay = !existingDays.has(input.newDate)
      if (isNewDay && existingDays.size >= PART_TIME_RULES.maxWeeklyDays) {
        violations.push({
          type: 'part_time_day_limit',
          message: `Yarı zamanlı çalışan haftada en fazla ${PART_TIME_RULES.maxWeeklyDays} gün çalışabilir (${existingDays.size + 1}. gün).`,
          severity: 'error',
        })
      }
    }
  }

  const errors = violations.filter((v) => v.severity === 'error')
  const warnings = violations.filter((v) => v.severity === 'warning')

  return { valid: errors.length === 0, errors, warnings }
}

// ─── Workforce Planning hesaplamaları ────────────────────────

export interface EmployeeWeekSummary {
  employeeId: string
  employeeName: string
  /** Çalışma tipi — part-time'a özel limitler için UI tarafından kullanılır */
  employment_type: EmploymentType
  /** Gün → vardiya bilgisi */
  days: Record<string, DaySummary>
  totalWeeklyMins: number
  /** İzinsiz fiilen çalışılan (vardiyalı) gün sayısı */
  weeklyWorkDays: number
  violations: WorkingTimeViolation[]
}

export interface DaySummary {
  date: string
  shifts: Array<{ id: string; start_time: string; end_time: string; is_on_leave: boolean }>
  totalMins: number
  isLeave: boolean
}

/**
 * Haftalık workforce özeti hesaplar.
 * UI ve /api/workforce/planning route'u tarafından kullanılır.
 */
export function buildWeekSummary(
  assignments: Array<{
    id: string
    employee_id: string
    work_date: string
    start_time: string
    end_time: string
    is_on_leave: boolean
    employment_type?: EmploymentType | null
    employees?: { id: string; full_name: string } | null
  }>,
  weekDays: string[],
  config: WorkingTimeConfig
): EmployeeWeekSummary[] {
  // Employee bazında grupla
  const byEmployee = new Map<string, typeof assignments>()
  for (const a of assignments) {
    const list = byEmployee.get(a.employee_id) ?? []
    list.push(a)
    byEmployee.set(a.employee_id, list)
  }

  const weekStart = weekDays[0]
  const weekEnd = weekDays[weekDays.length - 1]

  const summaries: EmployeeWeekSummary[] = []

  for (const [empId, shifts] of byEmployee) {
    const empName = shifts[0]?.employees?.full_name ?? empId
    const employment_type: EmploymentType = shifts[0]?.employment_type ?? 'full_time'
    const days: Record<string, DaySummary> = {}

    for (const day of weekDays) {
      const dayShifts = shifts.filter((s) => s.work_date === day)
      const totalMins = dayShifts
        .filter((s) => !s.is_on_leave)
        .reduce((sum, s) => sum + netWorkMins(s.start_time, s.end_time), 0)
      const isLeave = dayShifts.some((s) => s.is_on_leave)

      days[day] = {
        date: day,
        shifts: dayShifts.map((s) => ({
          id: s.id,
          start_time: s.start_time,
          end_time: s.end_time,
          is_on_leave: s.is_on_leave,
        })),
        totalMins,
        isLeave,
      }
    }

    const totalWeeklyMins = shifts
      .filter((s) => !s.is_on_leave && s.work_date >= weekStart && s.work_date <= weekEnd)
      .reduce((sum, s) => sum + netWorkMins(s.start_time, s.end_time), 0)

    // Fiilen çalışılan gün sayısı (izinsiz, vardiyalı)
    const weeklyWorkDays = new Set(
      shifts
        .filter((s) => !s.is_on_leave && s.work_date >= weekStart && s.work_date <= weekEnd)
        .map((s) => s.work_date)
    ).size

    // İhlal kontrolü (mevcut atanmış vardiyalar için)
    const violations: WorkingTimeViolation[] = []

    if (employment_type === 'part_time') {
      // Part-time: haftalık saat limiti
      if (totalWeeklyMins > PART_TIME_RULES.maxWeeklyHours * 60) {
        violations.push({
          type: 'part_time_hour_limit',
          message: `Yarı zamanlı çalışan haftalık ${PART_TIME_RULES.maxWeeklyHours}s limitini aşıyor (${formatDuration(totalWeeklyMins)}).`,
          severity: 'error',
        })
      }
      // Part-time: haftalık gün limiti
      if (weeklyWorkDays > PART_TIME_RULES.maxWeeklyDays) {
        violations.push({
          type: 'part_time_day_limit',
          message: `Yarı zamanlı çalışan haftada en fazla ${PART_TIME_RULES.maxWeeklyDays} gün çalışabilir (${weeklyWorkDays} gün).`,
          severity: 'error',
        })
      }
    } else {
      // Full-time: mevcut haftalık max kontrolü
      if (totalWeeklyMins > config.maxWeeklyWorkHours * 60) {
        violations.push({
          type: 'weekly_max',
          message: `Haftalık ${formatDuration(totalWeeklyMins)} — maks. ${config.maxWeeklyWorkHours}s aşıldı.`,
          severity: 'error',
        })
      }
    }

    // Günlük max ve min rest kontrolü (her iki tip için)
    for (const day of weekDays) {
      const dayShifts = shifts.filter((s) => s.work_date === day && !s.is_on_leave)
      const dayMins = dayShifts.reduce((sum, s) => sum + netWorkMins(s.start_time, s.end_time), 0)
      if (dayMins > config.maxDailyWorkHours * 60) {
        violations.push({
          type: 'daily_max',
          message: `${day}: Günlük ${formatDuration(dayMins)} — maks. ${config.maxDailyWorkHours}s aşıldı.`,
          severity: 'error',
        })
      }
    }

    // Gece çalışması (Md. 69)
    for (const s of shifts) {
      if (s.is_on_leave || s.work_date < weekStart || s.work_date > weekEnd) continue
      const night = checkNightWork(s.start_time, s.end_time)
      if (night) violations.push({ ...night, message: `${s.work_date}: ${night.message}` })
    }

    // Min rest — tüm vardiyaları kronolojik sırala, ardışıkları kontrol et
    const allSorted = [...shifts]
      .filter((s) => !s.is_on_leave)
      .sort((a, b) => {
        const cmp = a.work_date.localeCompare(b.work_date)
        return cmp !== 0 ? cmp : a.start_time.localeCompare(b.start_time)
      })

    for (let i = 0; i < allSorted.length - 1; i++) {
      const curr = allSorted[i]
      const next = allSorted[i + 1]
      const violation = checkMinRest(
        next.work_date, next.start_time, next.end_time,
        [curr], config
      )
      if (violation) violations.push(violation)
    }

    summaries.push({ employeeId: empId, employeeName: empName, employment_type, days, totalWeeklyMins, weeklyWorkDays, violations })
  }

  return summaries.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'tr'))
}

/**
 * timesOverlap — scheduleRepository.timesOverlap ile aynı algoritmayı expose eder.
 * Test ve client kodu için; server validation'da validateShiftAssignment kullanılır.
 */
export function timesOverlap(
  aStart: string, aEnd: string, bStart: string, bEnd: string
): boolean {
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const aS = toMins(aStart)
  let aE = toMins(aEnd)
  const bS = toMins(bStart)
  let bE = toMins(bEnd)
  if (aE <= aS) aE += 24 * 60
  if (bE <= bS) bE += 24 * 60
  return aS < bE && bS < aE
}
