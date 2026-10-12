/**
 * workingTimeService.test.ts
 *
 * Çalışma süresi kural testleri — pure fonksiyonlar, DB mock gerekmez.
 *
 * Kapsanan senaryolar:
 * 1. Çakışan vardiya (timesOverlap ile)
 * 2. Min rest ihlali
 * 3. Günlük max saat ihlali
 * 4. Haftalık max saat ihlali
 * 5. Availability ihlali (warning)
 * 6. Gece yarısını geçen vardiya — doğru süre hesabı
 * 7. Geçerli vardiya — tüm kontroller geçer
 * 8. Haftalık özet hesabı (buildWeekSummary)
 * 9. Workforce planning — çalışan rolü erişemez (authorization)
 */
import { describe, it, expect } from 'vitest'
import {
  shiftDurationMins,
  checkMinRest,
  checkDailyMax,
  checkWeeklyMax,
  checkAvailability,
  validateShiftAssignment,
  buildWeekSummary,
  calcWeeklyMins,
  timesOverlap,
} from '@/lib/workingTimeService'
import type { WorkingTimeConfig } from '@/lib/workingTimeConfig'
import { hasRole, MANAGER_ROLES, ROLES } from '@/lib/auth/roles'

const BASE_CONFIG: WorkingTimeConfig = {
  minRestHours: 11,
  maxDailyWorkHours: 11,
  maxWeeklyWorkHours: 45,
}

// ─── 6. Gece yarısını geçen vardiya süresi ─────────────────
describe('shiftDurationMins', () => {
  it('Normal vardiya: 08:00–16:00 = 480 dk', () => {
    expect(shiftDurationMins('08:00', '16:00')).toBe(480)
  })

  it('Gece yarısını geçen: 22:00–06:00 = 480 dk', () => {
    expect(shiftDurationMins('22:00', '06:00')).toBe(480)
  })

  it('Kısa: 09:00–09:30 = 30 dk', () => {
    expect(shiftDurationMins('09:00', '09:30')).toBe(30)
  })

  it('Tam gece: 00:00–08:00 = 480 dk', () => {
    expect(shiftDurationMins('00:00', '08:00')).toBe(480)
  })
})

// ─── timesOverlap (scheduleRepository'den re-export) ───────
describe('timesOverlap', () => {
  it('1. Çakışan vardiyalar reject edilir', () => {
    expect(timesOverlap('08:00', '16:00', '14:00', '22:00')).toBe(true)
  })

  it('Ardışık vardiyalar çakışmaz (08-16, 16-24)', () => {
    expect(timesOverlap('08:00', '16:00', '16:00', '24:00')).toBe(false)
  })

  it('Gece yarısını geçen: 22:00–06:00 ile 08:00–16:00 çakışmaz', () => {
    // A: 22:00=1320 → aE=360+1440=1800; B: 08:00=480, 16:00=960
    // aS(1320) < bE(960)? NO → false (doğru)
    expect(timesOverlap('22:00', '06:00', '08:00', '16:00')).toBe(false)
  })

  it('Aynı gün gece yarısını geçen çakışma: 20:00–02:00 ile 23:00–07:00', () => {
    // A: 20:00=1200, aE=120+1440=1560; B: 23:00=1380, bE=420+1440=1560
    // aS(1200)<bE(1560) ✓ AND bS(1380)<aE(1560) ✓ → true
    expect(timesOverlap('20:00', '02:00', '23:00', '07:00')).toBe(true)
  })

  it('Gece yarısını geçen vardiya çakışmayan case', () => {
    // 22:00–02:00 ile 08:00–16:00 çakışmaz
    expect(timesOverlap('22:00', '02:00', '08:00', '16:00')).toBe(false)
  })
})

// ─── 2. Min rest ihlali ─────────────────────────────────────
describe('checkMinRest', () => {
  it('2. 11 saatten az dinlenme → min_rest ihlali', () => {
    const existing = [{ id: 's1', work_date: '2026-10-01', start_time: '22:00', end_time: '06:00' }]
    // Sonraki gün 07:00'da başlayan vardiya: 06:00→07:00 = 1 saat → ihlal
    const result = checkMinRest('2026-10-02', '07:00', '15:00', existing, BASE_CONFIG)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('min_rest')
    expect(result?.severity).toBe('error')
  })

  it('11 saat tam dinlenme → ihlal yok', () => {
    const existing = [{ id: 's1', work_date: '2026-10-01', start_time: '06:00', end_time: '14:00' }]
    // 14:00 + 11h = 01:00 → 01:30 başlangıçta sorun yok
    const result = checkMinRest('2026-10-02', '01:00', '09:00', existing, BASE_CONFIG)
    expect(result).toBeNull()
  })

  it('excludeId kendi kaydını hariç tutar', () => {
    // Güncellenen kaydın kendisiyle çakışması engellenmez
    const existing = [{ id: 'self', work_date: '2026-10-01', start_time: '22:00', end_time: '06:00' }]
    const result = checkMinRest('2026-10-02', '07:00', '15:00', existing, BASE_CONFIG, 'self')
    expect(result).toBeNull()
  })
})

// ─── 3. Günlük max ihlali ───────────────────────────────────
describe('checkDailyMax', () => {
  it('3. Günlük 11s NET aşımı → daily_max ihlali (İş K. Md. 63)', () => {
    const existing = [{ id: 's1', work_date: '2026-10-05', start_time: '08:00', end_time: '20:00' }] // 12s brüt → 10s net
    // +2s brüt (1s45dk net) = 11s45dk net > 11s
    const result = checkDailyMax('2026-10-05', '21:00', '23:00', existing, BASE_CONFIG)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('daily_max')
    expect(result?.severity).toBe('error')
  })

  it('Günlük 11s net altı → ihlal yok', () => {
    const existing = [{ id: 's1', work_date: '2026-10-05', start_time: '08:00', end_time: '14:00' }] // 6s brüt → 5s net
    // +6s brüt (5s net) = 10s net < 11s
    const result = checkDailyMax('2026-10-05', '15:00', '21:00', existing, BASE_CONFIG)
    expect(result).toBeNull()
  })
})

// ─── 4. Haftalık max ihlali ─────────────────────────────────
describe('checkWeeklyMax', () => {
  it('4. Haftalık 45s aşımı → weekly_max ihlali', () => {
    // 5 × 9s = 45s + 1s daha = 46s
    const existing = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      work_date: `2026-10-0${i + 1}`,
      start_time: '08:00',
      end_time: '17:00',  // 9h each
    }))
    const result = checkWeeklyMax(
      '2026-10-06', '09:00', '10:00',  // +1h = 46h
      existing, '2026-09-28', '2026-10-04', BASE_CONFIG
    )
    // Hafta dışında (06 > 04) olduğu için null döner
    expect(result).toBeNull()
  })

  it('Aynı haftada 45s NET aşımı → ihlal', () => {
    // 2026-09-28 (Mon) hafta: 28 Sep – 04 Oct
    // 5 × 10s brüt (8,5s net) = 42,5s; +4s brüt (3,75s net) = 46,25s > 45s
    const existing = [
      { id: 's0', work_date: '2026-09-28', start_time: '08:00', end_time: '18:00' }, // 10s brüt
      { id: 's1', work_date: '2026-09-29', start_time: '08:00', end_time: '18:00' }, // 10s brüt
      { id: 's2', work_date: '2026-09-30', start_time: '08:00', end_time: '18:00' }, // 10s brüt
      { id: 's3', work_date: '2026-10-01', start_time: '08:00', end_time: '18:00' }, // 10s brüt
      { id: 's4', work_date: '2026-10-02', start_time: '08:00', end_time: '18:00' }, // 10s brüt
    ]
    const result = checkWeeklyMax(
      '2026-10-03', '08:00', '12:00',  // net 46,25s > 45s
      existing, '2026-09-28', '2026-10-04', BASE_CONFIG
    )
    expect(result).not.toBeNull()
    expect(result?.type).toBe('weekly_max')
  })

  it('45s altı → ihlal yok', () => {
    const existing = [
      { id: 's1', work_date: '2026-09-28', start_time: '08:00', end_time: '16:00' }, // 8h
    ]
    const result = checkWeeklyMax(
      '2026-09-29', '08:00', '16:00',  // +8h = 16h
      existing, '2026-09-28', '2026-10-04', BASE_CONFIG
    )
    expect(result).toBeNull()
  })
})

// ─── 5. Availability ihlali ─────────────────────────────────
describe('checkAvailability', () => {
  it('5. Müsait olmayan gün → availability warning', () => {
    const avail = [{ day_of_week: 'monday' as const, start_time: '08:00', end_time: '16:00', is_available: false }]
    // 2026-09-28 = Pazartesi
    const result = checkAvailability('2026-09-28', '08:00', '16:00', avail)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('availability')
    expect(result?.severity).toBe('warning')
  })

  it('Müsaitlik penceresi dışı → warning', () => {
    const avail = [{ day_of_week: 'monday' as const, start_time: '09:00', end_time: '17:00', is_available: true }]
    // 07:00'da başlayan vardiya pencere dışı
    const result = checkAvailability('2026-09-28', '07:00', '15:00', avail)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('availability')
  })

  it('Müsaitlik penceresi içi → ihlal yok', () => {
    const avail = [{ day_of_week: 'monday' as const, start_time: '07:00', end_time: '19:00', is_available: true }]
    const result = checkAvailability('2026-09-28', '08:00', '16:00', avail)
    expect(result).toBeNull()
  })

  it('Kayıt yoksa kontrol yapılmaz', () => {
    const result = checkAvailability('2026-09-28', '08:00', '16:00', [])
    expect(result).toBeNull()
  })
})

// ─── 7. Geçerli vardiya — tüm kontroller geçer ──────────────
describe('validateShiftAssignment — geçerli', () => {
  it('7. Temiz vardiya → valid:true, sıfır ihlal', () => {
    const result = validateShiftAssignment({
      newDate: '2026-09-28',
      newStart: '08:00',
      newEnd: '16:00',
      existingShifts: [],
      weekStart: '2026-09-28',
      weekEnd: '2026-10-04',
      config: BASE_CONFIG,
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('Gece vardiyasından 11+ saat sonra yeni vardiya → geçerli', () => {
    const existing = [{ id: 's1', work_date: '2026-09-28', start_time: '22:00', end_time: '06:00' }]
    const result = validateShiftAssignment({
      newDate: '2026-09-29',
      newStart: '17:30',   // 06:00 + 11.5h = 17:30
      newEnd: '22:30',
      existingShifts: existing,
      weekStart: '2026-09-28',
      weekEnd: '2026-10-04',
      config: BASE_CONFIG,
    })
    expect(result.valid).toBe(true)
  })
})

// ─── 8. Haftalık özet hesabı ────────────────────────────────
describe('buildWeekSummary', () => {
  const WEEK_DAYS = [
    '2026-09-28','2026-09-29','2026-09-30',
    '2026-10-01','2026-10-02','2026-10-03','2026-10-04',
  ]

  it('8. Haftalık saatleri doğru hesaplar', () => {
    const assignments = [
      { id: 'a1', employee_id: 'emp-1', work_date: '2026-09-28', start_time: '08:00', end_time: '16:00', is_on_leave: false,
        employees: { id: 'emp-1', full_name: 'Test Kişi' } },
      { id: 'a2', employee_id: 'emp-1', work_date: '2026-09-29', start_time: '08:00', end_time: '16:00', is_on_leave: false,
        employees: { id: 'emp-1', full_name: 'Test Kişi' } },
    ]
    const summaries = buildWeekSummary(assignments, WEEK_DAYS, BASE_CONFIG)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].totalWeeklyMins).toBe(840)  // 2 × (8h brüt − 1h mola) = 2 × 7h = 840 dk
    expect(summaries[0].violations).toHaveLength(0)
  })

  it('İzinli günler toplam saate dahil edilmez', () => {
    const assignments = [
      { id: 'a1', employee_id: 'emp-1', work_date: '2026-09-28', start_time: '08:00', end_time: '16:00', is_on_leave: true,
        employees: { id: 'emp-1', full_name: 'Test Kişi' } },
    ]
    const summaries = buildWeekSummary(assignments, WEEK_DAYS, BASE_CONFIG)
    expect(summaries[0].totalWeeklyMins).toBe(0)
    expect(summaries[0].days['2026-09-28'].isLeave).toBe(true)
  })

  it('Haftalık max aşımı ihlal üretir', () => {
    // 7 × (8h brüt − 1h mola) = 7 × 7h net = 49h > 45h → ihlal
    const assignments = Array.from({ length: 7 }, (_, i) => ({
      id: `a${i}`, employee_id: 'emp-1',
      work_date: WEEK_DAYS[i],
      start_time: '08:00', end_time: '16:00', is_on_leave: false,
      employees: { id: 'emp-1', full_name: 'Test Kişi' },
    }))
    const summaries = buildWeekSummary(assignments, WEEK_DAYS, BASE_CONFIG)
    const weeklyViolation = summaries[0].violations.find((v) => v.type === 'weekly_max')
    expect(weeklyViolation).toBeDefined()
  })
})

// ─── 9. Workforce Planning — authorization ──────────────────
describe('hasRole — workforce planning authorization', () => {
  it('9. Çalışan rolü MANAGER_ROLES içinde değil', () => {
    expect(hasRole(ROLES.CALISAN, MANAGER_ROLES)).toBe(false)
  })

  it('Mağaza Müdürü MANAGER_ROLES içinde', () => {
    expect(hasRole(ROLES.MAGAZA_MUDURU, MANAGER_ROLES)).toBe(true)
  })

  it('Müdür Yardımcısı MANAGER_ROLES içinde', () => {
    expect(hasRole(ROLES.MUDUR_YARDIMCISI, MANAGER_ROLES)).toBe(true)
  })
})

// ─── calcWeeklyMins ─────────────────────────────────────────
describe('calcWeeklyMins', () => {
  it('Hafta içi vardiyaları toplar', () => {
    const shifts = [
      { work_date: '2026-09-28', start_time: '08:00', end_time: '16:00' },  // 480
      { work_date: '2026-09-29', start_time: '10:00', end_time: '18:00' },  // 480
      { work_date: '2026-10-05', start_time: '08:00', end_time: '16:00' },  // farklı hafta
    ]
    expect(calcWeeklyMins(shifts, '2026-09-28', '2026-10-04')).toBe(840) // net: 2 × (8s brüt − 60dk mola)
  })
})

// ─── Part-Time kuralları ──────────────────────────────────────
describe('validateShiftAssignment — part-time rules', () => {
  const PT_WEEK_START = '2026-09-28'
  const PT_WEEK_END   = '2026-10-04'

  it('PT-1. Part-time çalışan 5. güne atanamaz', () => {
    // 4 farklı günde zaten vardiyası var
    const existing = [
      { id: 's1', work_date: '2026-09-28', start_time: '08:00', end_time: '14:00' },
      { id: 's2', work_date: '2026-09-29', start_time: '08:00', end_time: '14:00' },
      { id: 's3', work_date: '2026-09-30', start_time: '08:00', end_time: '14:00' },
      { id: 's4', work_date: '2026-10-01', start_time: '08:00', end_time: '14:00' },
    ]
    const result = validateShiftAssignment({
      newDate: '2026-10-02',   // 5. gün
      newStart: '08:00',
      newEnd: '14:00',
      existingShifts: existing,
      weekStart: PT_WEEK_START,
      weekEnd: PT_WEEK_END,
      config: BASE_CONFIG,
      employment_type: 'part_time',
    })
    expect(result.valid).toBe(false)
    const violation = result.errors.find((e) => e.type === 'part_time_day_limit')
    expect(violation).toBeDefined()
    expect(violation?.severity).toBe('error')
  })

  it('PT-2. Part-time çalışan 30 saati aşamaz', () => {
    // 4 × 7s brüt (6s net) = 24s net zaten var
    const existing = [
      { id: 's1', work_date: '2026-09-28', start_time: '08:00', end_time: '15:00' }, // 7h
      { id: 's2', work_date: '2026-09-29', start_time: '08:00', end_time: '15:00' }, // 7h
      { id: 's3', work_date: '2026-09-30', start_time: '08:00', end_time: '15:00' }, // 7h
      { id: 's4', work_date: '2026-10-01', start_time: '08:00', end_time: '15:00' }, // 7h = 28h
    ]
    const result = validateShiftAssignment({
      newDate: '2026-10-02',
      newStart: '08:00',
      newEnd: '16:00',  // +8s brüt (7s net) = 31s net > 30s
      existingShifts: existing,
      weekStart: PT_WEEK_START,
      weekEnd: PT_WEEK_END,
      config: BASE_CONFIG,
      employment_type: 'part_time',
    })
    expect(result.valid).toBe(false)
    const violation = result.errors.find((e) => e.type === 'part_time_hour_limit')
    expect(violation).toBeDefined()
    expect(violation?.severity).toBe('error')
  })

  it('PT-3. Part-time 4 gün ve 30s altında → geçerli', () => {
    // 3 × 6s = 18s
    const existing = [
      { id: 's1', work_date: '2026-09-28', start_time: '08:00', end_time: '14:00' },
      { id: 's2', work_date: '2026-09-29', start_time: '08:00', end_time: '14:00' },
      { id: 's3', work_date: '2026-09-30', start_time: '08:00', end_time: '14:00' },
    ]
    const result = validateShiftAssignment({
      newDate: '2026-10-01',
      newStart: '08:00',
      newEnd: '14:00',   // +6h = 24h < 30h, 4. gün ≤ 4
      existingShifts: existing,
      weekStart: PT_WEEK_START,
      weekEnd: PT_WEEK_END,
      config: BASE_CONFIG,
      employment_type: 'part_time',
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('PT-4. Full-time çalışan mevcut kurallara göre çalışır (part-time kuralları uygulanmaz)', () => {
    // 5 gün, her biri 8h = 40h → full-time için OK (< 45h), 5 gün sınırı yok
    const existing = [
      { id: 's1', work_date: '2026-09-28', start_time: '08:00', end_time: '16:00' },
      { id: 's2', work_date: '2026-09-29', start_time: '08:00', end_time: '16:00' },
      { id: 's3', work_date: '2026-09-30', start_time: '08:00', end_time: '16:00' },
      { id: 's4', work_date: '2026-10-01', start_time: '08:00', end_time: '16:00' },
    ]
    const result = validateShiftAssignment({
      newDate: '2026-10-02',   // 5. gün — full-time için izin
      newStart: '08:00',
      newEnd: '16:00',         // +8h = 40h < 45h
      existingShifts: existing,
      weekStart: PT_WEEK_START,
      weekEnd: PT_WEEK_END,
      config: BASE_CONFIG,
      employment_type: 'full_time',
    })
    expect(result.valid).toBe(true)
    expect(result.errors.filter((e) => e.type === 'part_time_day_limit')).toHaveLength(0)
    expect(result.errors.filter((e) => e.type === 'part_time_hour_limit')).toHaveLength(0)
  })
})

// ─── buildWeekSummary — part-time ───────────────────────────
describe('buildWeekSummary — part-time', () => {
  const WEEK_DAYS = [
    '2026-09-28','2026-09-29','2026-09-30',
    '2026-10-01','2026-10-02','2026-10-03','2026-10-04',
  ]

  it('PT-5. Part-time gün ve saat toplamları doğru gösterilir', () => {
    const assignments = [
      { id: 'a1', employee_id: 'pt-1', work_date: '2026-09-28', start_time: '08:00', end_time: '14:00',
        is_on_leave: false, employment_type: 'part_time' as const,
        employees: { id: 'pt-1', full_name: 'Ayşe Part' } },
      { id: 'a2', employee_id: 'pt-1', work_date: '2026-09-29', start_time: '08:00', end_time: '14:00',
        is_on_leave: false, employment_type: 'part_time' as const,
        employees: { id: 'pt-1', full_name: 'Ayşe Part' } },
      { id: 'a3', employee_id: 'pt-1', work_date: '2026-09-30', start_time: '08:00', end_time: '14:00',
        is_on_leave: false, employment_type: 'part_time' as const,
        employees: { id: 'pt-1', full_name: 'Ayşe Part' } },
    ]
    const summaries = buildWeekSummary(assignments, WEEK_DAYS, BASE_CONFIG)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].employment_type).toBe('part_time')
    expect(summaries[0].totalWeeklyMins).toBe(3 * 300)  // 3 × (6h brüt − 1h mola) = 3 × 5h net = 900 dk
    expect(summaries[0].weeklyWorkDays).toBe(3)
    expect(summaries[0].violations).toHaveLength(0)  // 18h < 30h, 3 gün < 4 gün
  })

  it('PT-6. Part-time 5 günde ihlal üretir', () => {
    const assignments = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`, employee_id: 'pt-2',
      work_date: WEEK_DAYS[i],
      start_time: '08:00', end_time: '14:00', is_on_leave: false,
      employment_type: 'part_time' as const,
      employees: { id: 'pt-2', full_name: 'Mehmet Part' },
    }))
    const summaries = buildWeekSummary(assignments, WEEK_DAYS, BASE_CONFIG)
    const dayViolation = summaries[0].violations.find((v) => v.type === 'part_time_day_limit')
    expect(dayViolation).toBeDefined()
    expect(summaries[0].weeklyWorkDays).toBe(5)
  })
})
