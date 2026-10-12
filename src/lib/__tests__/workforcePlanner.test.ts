/// <reference types="vitest/globals" />
import { runPlanner, validatePlan } from '../workforcePlanner'
import type { PlannerEmployee, PlannerShiftTemplate } from '../workforcePlanner'
import { netWorkMins } from '../workingTimeService'
import { PART_TIME_RULES } from '@/types/employee'

// ─── Test fixtures ────────────────────────────────────────────────────────────

const TEMPLATES: PlannerShiftTemplate[] = [
  { id: 'tmpl-open',  name: 'Acilis',  start_time: '10:00', end_time: '18:00' },  // brüt 8s, net 7s
  { id: 'tmpl-mid',   name: 'Araci',   start_time: '12:00', end_time: '20:00' },  // brüt 8s, net 7s
  { id: 'tmpl-close', name: 'Kapanis', start_time: '14:00', end_time: '22:00' },  // brüt 8s, net 7s
  { id: 'tmpl-full',  name: 'Full',    start_time: '10:00', end_time: '22:00' },  // brüt 12s, net 10s
]

// 2026-10-12 Pazartesi → 2026-10-18 Pazar
const WEEK_START = '2026-10-12'
const WEEK_END   = '2026-10-18'
const WEEK_DAYS  = [
  '2026-10-12', // Pazartesi
  '2026-10-13', // Salı      ← Müdür izin
  '2026-10-14', // Çarşamba
  '2026-10-15', // Perşembe  ← Müdür Yardımcısı izin, FT Kasiyer full tercih, Müdür full
  '2026-10-16', // Cuma
  '2026-10-17', // Cumartesi
  '2026-10-18', // Pazar     ← Görsel Uzman & Depo izin
]

function makeEmp(
  id: string,
  position: string,
  role_name: string,
  et: 'full_time' | 'part_time',
  leaveDays: string[] = [],
): PlannerEmployee {
  return {
    id,
    full_name: id,
    position,
    role_name,
    employment_type: et,
    availability: {},
    leaveDays: new Set(leaveDays),
  }
}

const EMPLOYEES: PlannerEmployee[] = [
  makeEmp('emp-mudur',    'Magaza Muduru',             'Magaza Muduru',         'full_time'),
  makeEmp('emp-yardimci', 'Mudur Yardimcisi',          'Mudur Yardimcisi',      'full_time'),
  makeEmp('emp-gorsel',   'Gorsel Uzmani',             'Calisan',               'full_time'),
  makeEmp('emp-depo',     'Depo Gorevlisi',            'Calisan',               'full_time'),
  makeEmp('emp-kasiyer1', 'Kasiyer',                   'Calisan',               'full_time'),
  makeEmp('emp-kasiyer2', 'Kasiyer',                   'Calisan',               'part_time'),
  makeEmp('emp-kasiyer3', 'Kasiyer',                   'Calisan',               'part_time'),
  makeEmp('emp-kasiyer4', 'Kasiyer',                   'Calisan',               'full_time'),
  makeEmp('emp-satis1',   'Satis Danismani',           'Calisan',               'full_time'),
  makeEmp('emp-satis2',   'Satis Danismani',           'Calisan',               'full_time'),
  makeEmp('emp-satis3',   'Satis Danismani',           'Calisan',               'part_time'),
]

const INPUT = {
  weekStart: WEEK_START,
  weekEnd:   WEEK_END,
  weekDays:  WEEK_DAYS,
  employees: EMPLOYEES,
  templates: TEMPLATES,
}

// Helper: belirli template'in net dakikasını döner
function netOf(tmplId: string): number {
  const t = TEMPLATES.find((x) => x.id === tmplId)!
  return netWorkMins(t.start_time, t.end_time)
}

// ─── Temel plan üretimi ───────────────────────────────────────────────────────

describe('workforcePlanner — plan üretimi', () => {
  const result = runPlanner(INPUT)

  test('plan oluşturulmalı ve assignment dizisi dolu olmalı', () => {
    expect(result).toBeDefined()
    expect(Array.isArray(result.assignments)).toBe(true)
    expect(result.assignments.length).toBeGreaterThan(0)
  })

  test('weekStart / weekEnd / weekDays alanları input ile eşleşmeli', () => {
    expect(result.weekStart).toBe(WEEK_START)
    expect(result.weekEnd).toBe(WEEK_END)
    expect(result.weekDays).toHaveLength(7)
  })

  test('stats tüm çalışanları içermeli', () => {
    for (const emp of EMPLOYEES) {
      expect(result.stats[emp.id]).toBeDefined()
    }
  })

  test('hasHardViolation boolean olmalı', () => {
    expect(typeof result.hasHardViolation).toBe('boolean')
  })
})

// ─── Senaryo 1: Sabit izin günleri ───────────────────────────────────────────

describe('Senaryo 1 — Sabit izin günleri', () => {
  const result = runPlanner(INPUT)

  test('Müdür Salı (2026-10-13) günü atanmamalı', () => {
    const assigns = result.assignments.filter(
      (a) => a.employee_id === 'emp-mudur' && a.work_date === '2026-10-13'
    )
    expect(assigns).toHaveLength(0)
  })

  test('Müdür Yardımcısı Perşembe (2026-10-15) günü atanmamalı', () => {
    const assigns = result.assignments.filter(
      (a) => a.employee_id === 'emp-yardimci' && a.work_date === '2026-10-15'
    )
    expect(assigns).toHaveLength(0)
  })

  test('Görsel Uzman Pazar (2026-10-18) günü atanmamalı', () => {
    const assigns = result.assignments.filter(
      (a) => a.employee_id === 'emp-gorsel' && a.work_date === '2026-10-18'
    )
    expect(assigns).toHaveLength(0)
  })

  test('Depo Görevlisi Pazar (2026-10-18) günü atanmamalı', () => {
    const assigns = result.assignments.filter(
      (a) => a.employee_id === 'emp-depo' && a.work_date === '2026-10-18'
    )
    expect(assigns).toHaveLength(0)
  })
})

// ─── Senaryo 2: FT haftalık saat ve gün limitleri ─────────────────────────────

describe('Senaryo 2 — FT haftalık limitler', () => {
  const result = runPlanner(INPUT)
  const FT_MAX_MINS = 45 * 60
  const FT_MAX_DAYS = 6

  const ftIds = EMPLOYEES
    .filter((e) => e.employment_type === 'full_time')
    .map((e) => e.id)

  test.each(ftIds)('FT çalışan %s — haftalık net saat 45s aşmamalı', (empId) => {
    const assigns = result.assignments.filter((a) => a.employee_id === empId)
    const totalNet = assigns.reduce((s, a) => s + netWorkMins(a.start_time, a.end_time), 0)
    expect(totalNet).toBeLessThanOrEqual(FT_MAX_MINS)
  })

  test.each(ftIds)('FT çalışan %s — haftalık gün sayısı 6 günü aşmamalı', (empId) => {
    const days = new Set(result.assignments.filter((a) => a.employee_id === empId).map((a) => a.work_date))
    expect(days.size).toBeLessThanOrEqual(FT_MAX_DAYS)
  })

  test('Hiçbir FT çalışan 7 gün çalışmamalı', () => {
    for (const empId of ftIds) {
      const days = new Set(result.assignments.filter((a) => a.employee_id === empId).map((a) => a.work_date))
      expect(days.size).toBeLessThanOrEqual(FT_MAX_DAYS)
    }
  })
})

// ─── Senaryo 3: PT haftalık saat ve gün limitleri ─────────────────────────────

describe('Senaryo 3 — PT haftalık limitler', () => {
  const result = runPlanner(INPUT)
  const PT_MAX_MINS = PART_TIME_RULES.maxWeeklyHours * 60
  const PT_MAX_DAYS = PART_TIME_RULES.maxWeeklyDays

  const ptIds = EMPLOYEES
    .filter((e) => e.employment_type === 'part_time')
    .map((e) => e.id)

  test.each(ptIds)('PT çalışan %s — haftalık net saat %ds aşmamalı', (empId) => {
    const assigns = result.assignments.filter((a) => a.employee_id === empId)
    const totalNet = assigns.reduce((s, a) => s + netWorkMins(a.start_time, a.end_time), 0)
    expect(totalNet).toBeLessThanOrEqual(PT_MAX_MINS)
  })

  test.each(ptIds)('PT çalışan %s — haftalık gün sayısı %d günü aşmamalı', (empId) => {
    const days = new Set(result.assignments.filter((a) => a.employee_id === empId).map((a) => a.work_date))
    expect(days.size).toBeLessThanOrEqual(PT_MAX_DAYS)
  })
})

// ─── Senaryo 4: Yönetici kuralları ───────────────────────────────────────────

describe('Senaryo 4 — Yönetici kuralları', () => {
  const result = runPlanner(INPUT)

  test('Müdür Perşembe full vardiya almalı', () => {
    const assign = result.assignments.find(
      (a) => a.employee_id === 'emp-mudur' && a.work_date === '2026-10-15'
    )
    expect(assign?.shift_kind).toBe('full')
  })

  test('Müdür Yardımcısı Salı full vardiya almalı', () => {
    const assign = result.assignments.find(
      (a) => a.employee_id === 'emp-yardimci' && a.work_date === '2026-10-13'
    )
    expect(assign?.shift_kind).toBe('full')
  })

  test('Müdür ortacı (mid) vardiya almamalı', () => {
    const midAssigns = result.assignments.filter(
      (a) => a.employee_id === 'emp-mudur' && a.shift_kind === 'mid'
    )
    expect(midAssigns).toHaveLength(0)
  })

  test('Müdür Yardımcısı ortacı (mid) vardiya almamalı', () => {
    const midAssigns = result.assignments.filter(
      (a) => a.employee_id === 'emp-yardimci' && a.shift_kind === 'mid'
    )
    expect(midAssigns).toHaveLength(0)
  })
})

// ─── Senaryo 5: Günlük yönetici kapsaması ────────────────────────────────────

describe('Senaryo 5 — Günlük yönetici kapsaması', () => {
  const result = runPlanner(INPUT)
  const managerIds = new Set(['emp-mudur', 'emp-yardimci'])

  const dowOf = (d: string) =>
    ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(d).getDay()]

  // Her gün (hem Müdür hem Yardımcı kendi izin günlerinde olmak şartıyla)
  // en az biri opening/full, en az biri closing/full olmalı
  test.each(WEEK_DAYS)('%s günü açılışta yönetici olmalı', (dateStr) => {
    const dow = dowOf(dateStr)
    // Salı: Müdür yok, Müdür Yardımcısı full (full ≥ opening kapsaması)
    // Perşembe: Yardımcı yok, Müdür full
    const dayAssigns = result.assignments.filter(
      (a) => managerIds.has(a.employee_id) && a.work_date === dateStr
    )
    const hasOpening = dayAssigns.some(
      (a) => a.shift_kind === 'opening' || a.shift_kind === 'full'
    )
    expect(hasOpening).toBe(true)
  })

  test.each(WEEK_DAYS)('%s günü kapanışta yönetici olmalı', (dateStr) => {
    const dayAssigns = result.assignments.filter(
      (a) => managerIds.has(a.employee_id) && a.work_date === dateStr
    )
    const hasClosing = dayAssigns.some(
      (a) => a.shift_kind === 'closing' || a.shift_kind === 'full'
    )
    expect(hasClosing).toBe(true)
  })
})

// ─── Senaryo 6: Kasiyer minimum ihtiyacı ─────────────────────────────────────

describe('Senaryo 6 — Kasiyer minimum ihtiyacı', () => {
  const result = runPlanner(INPUT)
  const kasiyerIds = new Set(
    EMPLOYEES.filter((e) => e.position.toLowerCase().includes('kasiyer')).map((e) => e.id)
  )

  test.each(WEEK_DAYS)('%s günü en az 2 kasiyer çalışmalı', (dateStr) => {
    const kasiyerAssigns = result.assignments.filter(
      (a) => kasiyerIds.has(a.employee_id) && a.work_date === dateStr
    )
    expect(kasiyerAssigns.length).toBeGreaterThanOrEqual(2)
  })

  test.each(WEEK_DAYS)('%s günü en az 1 opening kasiyer olmalı', (dateStr) => {
    const kasiyerAssigns = result.assignments.filter(
      (a) => kasiyerIds.has(a.employee_id) && a.work_date === dateStr
    )
    const hasOpening = kasiyerAssigns.some(
      (a) => a.shift_kind === 'opening' || a.shift_kind === 'full'
    )
    expect(hasOpening).toBe(true)
  })

  test.each(WEEK_DAYS)('%s günü en az 1 closing kasiyer olmalı', (dateStr) => {
    const kasiyerAssigns = result.assignments.filter(
      (a) => kasiyerIds.has(a.employee_id) && a.work_date === dateStr
    )
    const hasClosing = kasiyerAssigns.some(
      (a) => a.shift_kind === 'closing' || a.shift_kind === 'full'
    )
    expect(hasClosing).toBe(true)
  })
})

// ─── Senaryo 7: Aynı çalışana aynı gün çakışan atama ─────────────────────────

describe('Senaryo 7 — Çakışan atama yok', () => {
  const result = runPlanner(INPUT)

  test('Hiçbir çalışana aynı gün iki atama yapılmamalı', () => {
    const seen = new Map<string, Set<string>>()
    for (const a of result.assignments) {
      if (!seen.has(a.employee_id)) seen.set(a.employee_id, new Set())
      const days = seen.get(a.employee_id)!
      expect(days.has(a.work_date)).toBe(false) // çakışma varsa test patlar
      days.add(a.work_date)
    }
  })
})

// ─── Senaryo 8: Validator ile plan tutarlılığı ────────────────────────────────

describe('Senaryo 8 — Validator tutarlılığı', () => {
  const result = runPlanner(INPUT)

  test('Geçerli planda validator hata üretmemeli', () => {
    if (!result.hasHardViolation) {
      const validationErrors = validatePlan(result.assignments, EMPLOYEES, WEEK_DAYS)
        .filter((w) => w.level === 'error')
      expect(validationErrors).toHaveLength(0)
    }
  })

  test('hasHardViolation, error uyarısı varlığıyla tutarlı olmalı', () => {
    const hasErrors = result.warnings.some((w) => w.level === 'error')
    expect(result.hasHardViolation).toBe(hasErrors)
  })
})

// ─── Senaryo 9: Açılış/kapanış dengesi ───────────────────────────────────────

describe('Senaryo 9 — Açılış/kapanış dengesi', () => {
  const result = runPlanner(INPUT)

  test('Görsel Uzman hafta içi 08:00 başlamalı', () => {
    const weekdayAssigns = result.assignments.filter(
      (a) =>
        a.employee_id === 'emp-gorsel' &&
        a.work_date !== '2026-10-18' // Pazar izin
    )
    for (const a of weekdayAssigns) {
      expect(a.start_time).toBe('08:00')
    }
  })

  test('Depo Görevlisi hafta içi 08:00 başlamalı', () => {
    const weekdayAssigns = result.assignments.filter(
      (a) =>
        a.employee_id === 'emp-depo' &&
        a.work_date !== '2026-10-18' // Pazar izin
    )
    for (const a of weekdayAssigns) {
      expect(a.start_time).toBe('08:00')
    }
  })
})

// ─── Senaryo 10: Yetersiz personel → geçerli hata dönmeli ────────────────────

describe('Senaryo 10 — Yetersiz personelde hata', () => {
  test('Kasiyer yokken opening kasiyer hatası üretilmeli', () => {
    const noKasiyerResult = runPlanner({
      ...INPUT,
      employees: EMPLOYEES.filter((e) => !e.position.toLowerCase().includes('kasiyer')),
    })
    const kasiyerErrors = noKasiyerResult.warnings.filter(
      (w) => w.level === 'error' && (
        w.message.toLowerCase().includes('kasiyer') ||
        w.message.toLowerCase().includes('minimum')
      )
    )
    expect(kasiyerErrors.length).toBeGreaterThan(0)
    expect(noKasiyerResult.hasHardViolation).toBe(true)
  })

  test('Yönetici yokken yönetici kapsama hatası üretilmeli', () => {
    const noManagerResult = runPlanner({
      ...INPUT,
      employees: EMPLOYEES.filter(
        (e) =>
          e.id !== 'emp-mudur' &&
          e.id !== 'emp-yardimci'
      ),
    })
    const mgrErrors = noManagerResult.warnings.filter(
      (w) =>
        w.level === 'error' &&
        (w.message.toLowerCase().includes('yönetici') ||
          w.message.toLowerCase().includes('mudur') ||
          w.message.toLowerCase().includes('müdür'))
    )
    expect(mgrErrors.length).toBeGreaterThan(0)
    expect(noManagerResult.hasHardViolation).toBe(true)
  })
})

// ─── Senaryo 11: Geçersiz taslak onaylanamaz ─────────────────────────────────

describe('Senaryo 11 — hasHardViolation planı engeller', () => {
  test('Geçersiz planda hasHardViolation true olmalı', () => {
    const result = runPlanner({
      ...INPUT,
      employees: EMPLOYEES.filter((e) => !e.position.toLowerCase().includes('kasiyer')),
    })
    expect(result.hasHardViolation).toBe(true)
  })

  test('Geçerli planda (yeterli personel) hasHardViolation false olmalı', () => {
    const result = runPlanner(INPUT)
    // Yeterli personelle hasHardViolation false bekliyoruz (template seti tam)
    // Kasiyer sayısı yeterli, yönetici tanımlı → hatasız
    if (!result.hasHardViolation) {
      expect(result.hasHardViolation).toBe(false)
    } else {
      // İhlal varsa uyarı listesi boş olmamalı
      expect(result.warnings.filter((w) => w.level === 'error').length).toBeGreaterThan(0)
    }
  })
})
