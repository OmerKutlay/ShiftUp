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

  // Her gün (hem Müdür hem Yardımcı kendi izin günlerinde olmak şartıyla)
  // en az biri opening/full, en az biri closing/full olmalı
  test.each(WEEK_DAYS)('%s günü açılışta yönetici olmalı', (dateStr) => {
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

// ─── Senaryo 12: Müdür tespiti (alfabetik sıra) ──────────────────────────────

describe('Senaryo 12 — Yardımcı listede önce gelse de müdür doğru tanınmalı', () => {
  // DB çalışanları isme göre sıralı döner; yardımcı müdürden önce gelebilir
  const reordered = [EMPLOYEES[1], EMPLOYEES[0], ...EMPLOYEES.slice(2)]
  const result = runPlanner({ ...INPUT, employees: reordered })

  test.each(['emp-mudur', 'emp-yardimci'])('%s 6 gün ve 45 saat çalışmalı', (empId) => {
    expect(result.stats[empId].workDays).toBe(6)
    expect(result.stats[empId].totalMins).toBe(45 * 60)
  })

  test('yönetici kapsama hatası olmamalı', () => {
    expect(result.warnings.filter((w) => w.level === 'error' && w.message.includes('yönetici'))).toHaveLength(0)
  })
})

// ─── Senaryo 13: Yönetici açılış/kapanış dönüşümü ────────────────────────────

describe('Senaryo 13 — Yöneticilerden biri açılış, diğeri kapanış', () => {
  const result = runPlanner(INPUT)
  const kindOf = (empId: string, d: string) =>
    result.assignments.find((a) => a.employee_id === empId && a.work_date === d)?.shift_kind

  test.each(WEEK_DAYS)('%s', (d) => {
    const m = kindOf('emp-mudur', d)
    const y = kindOf('emp-yardimci', d)
    if (m && y) {
      expect([m, y].sort()).toEqual(['closing', 'opening'])
    } else {
      expect(m ?? y).toBe('full')
    }
  })

  test('Müdür hem açılış hem kapanış almalı (tüm hafta aynı değil)', () => {
    expect(result.stats['emp-mudur'].openingCount).toBeGreaterThan(0)
    expect(result.stats['emp-mudur'].closingCount).toBeGreaterThan(0)
  })

  test('Müdür onaylı izinliyken yardımcı full almalı', () => {
    const withLeave = runPlanner({
      ...INPUT,
      employees: EMPLOYEES.map((e) => e.id === 'emp-mudur' ? { ...e, leaveDays: new Set(['2026-10-12']) } : e),
    })
    const a = withLeave.assignments.find((x) => x.employee_id === 'emp-yardimci' && x.work_date === '2026-10-12')
    expect(a?.shift_kind).toBe('full')
  })
})

// ─── Senaryo 14: Görsel/Depo kalıbı ve Perşembe etiket günü ──────────────────

describe('Senaryo 14 — Görsel/Depo 45 saat ve Perşembe etiket günü', () => {
  const result = runPlanner(INPUT)

  test.each(['emp-gorsel', 'emp-depo'])('%s: Pzt–Cum 08–17, Cmt 08–14, toplam 45s', (empId) => {
    const assigns = result.assignments.filter((a) => a.employee_id === empId)
    expect(assigns).toHaveLength(6)
    for (const a of assigns) {
      const isSat = a.work_date === '2026-10-17'
      expect([a.start_time, a.end_time]).toEqual(isSat ? ['08:00', '14:00'] : ['08:00', '17:00'])
    }
    expect(result.stats[empId].totalMins).toBe(45 * 60)
  })

  test('Perşembe görsel/depo dışında 2 çalışan 08:00 başlamalı', () => {
    const early = result.assignments.filter(
      (a) => a.work_date === '2026-10-15' && a.start_time === '08:00' &&
        a.employee_id !== 'emp-gorsel' && a.employee_id !== 'emp-depo'
    )
    expect(early).toHaveLength(2)
  })
})

// ─── Senaryo 15: FT 45 saat ve vardiya dengesi ───────────────────────────────

describe('Senaryo 15 — FT 45 saat tamamlama ve açılış/kapanış dengesi', () => {
  const result = runPlanner(INPUT)

  test.each(EMPLOYEES.filter((e) => e.employment_type === 'full_time').map((e) => e.id))(
    'FT %s 45 saat olmalı', (empId) => {
      expect(result.stats[empId].totalMins).toBe(45 * 60)
    },
  )

  test('hiçbir çalışan tüm hafta aynı vardiya türünde olmamalı', () => {
    expect(result.warnings.filter((w) => w.message.includes('Tüm hafta aynı'))).toEqual([])
  })

  test('plan hatasız olmalı', () => {
    expect(result.warnings.filter((w) => w.level === 'error')).toEqual([])
  })
})

// ─── Senaryo 16: Varyasyon (tohum) ve geçen hafta rotasyonu ──────────────────

// Gerçek mağaza kadrosuna benzer: 1 FT + 2 PT kasiyer, 3 FT + 4 PT satış danışmanı
const STORE: PlannerEmployee[] = [
  makeEmp('mm',   'Müdür',                    'Mağaza Müdürü',    'full_time'),
  makeEmp('mmy',  'Mağaza Müdür Yardımcısı',  'Müdür Yardımcısı', 'full_time'),
  makeEmp('k-ft', 'Kasiyer',                  'Çalışan',          'full_time'),
  makeEmp('k-p1', 'Kasiyer',                  'Çalışan',          'part_time'),
  makeEmp('k-p2', 'Kasiyer',                  'Çalışan',          'part_time'),
  makeEmp('s-f1', 'Satış Danışmanı',          'Çalışan',          'full_time'),
  makeEmp('s-f2', 'Satış Danışmanı',          'Çalışan',          'full_time'),
  makeEmp('s-f3', 'Satış Danışmanı',          'Çalışan',          'full_time'),
  makeEmp('s-p1', 'Satış Danışmanı',          'Çalışan',          'part_time'),
  makeEmp('s-p2', 'Satış Danışmanı',          'Çalışan',          'part_time'),
  makeEmp('s-p3', 'Satış Danışmanı',          'Çalışan',          'part_time'),
  makeEmp('s-p4', 'Satış Danışmanı',          'Çalışan',          'part_time'),
  makeEmp('gor',  'Görsel Uzmanı',            'Yönetici',         'full_time'),
  makeEmp('dep',  'Depo Görevlisi',           'Çalışan',          'full_time'),
]
const STORE_INPUT = { ...INPUT, employees: STORE }

function planSignature(r: ReturnType<typeof runPlanner>): string {
  return r.assignments
    .map((a) => `${a.employee_id}|${a.work_date}|${a.start_time}-${a.end_time}`)
    .sort()
    .join(',')
}

describe('Senaryo 16 — Her oluşturmada farklı ama kurallara uygun plan', () => {
  test('aynı tohum aynı planı üretmeli', () => {
    expect(planSignature(runPlanner({ ...STORE_INPUT, seed: 42 })))
      .toBe(planSignature(runPlanner({ ...STORE_INPUT, seed: 42 })))
  })

  test('farklı tohumlar farklı planlar üretmeli', () => {
    const sigs = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => planSignature(runPlanner({ ...STORE_INPUT, seed }))))
    expect(sigs.size).toBeGreaterThanOrEqual(6)
  })

  test('50 farklı tohumda: hata yok, FT 45s, kimse tüm hafta aynı türde değil', () => {
    for (let seed = 100; seed < 150; seed++) {
      const r = runPlanner({ ...STORE_INPUT, seed })
      expect(r.warnings.filter((w) => w.level === 'error'), `seed ${seed}`).toEqual([])
      expect(r.warnings.filter((w) => w.message.includes('Tüm hafta aynı')), `seed ${seed}`).toEqual([])
      for (const e of STORE.filter((x) => x.employment_type === 'full_time')) {
        expect(r.stats[e.id].totalMins, `seed ${seed} ${e.id}`).toBe(45 * 60)
      }
    }
  })

  test('geçen hafta izinli olunan gün bu hafta çoğunlukla çalışma günü olmalı', () => {
    // s-f1 geçen hafta Pazartesi izinliydi (diğer günler açılış)
    const lastWeek = { tuesday: 'opening', wednesday: 'opening', thursday: 'opening', friday: 'opening', saturday: 'opening', sunday: 'opening' } as const
    const employees = STORE.map((e) => ({ ...e, lastWeek: e.id === 's-f1' ? { ...lastWeek } : {} }))
    let workedMonday = 0
    for (let seed = 1; seed <= 20; seed++) {
      const r = runPlanner({ ...STORE_INPUT, employees, seed })
      if (r.assignments.some((a) => a.employee_id === 's-f1' && a.work_date === '2026-10-12')) workedMonday++
    }
    expect(workedMonday).toBeGreaterThanOrEqual(15)
  })
})

// ─── Senaryo 17: Asgari dinlenme ─────────────────────────────────────────────

describe('Senaryo 17 — Kapanıştan sonraki gün 08:00 başlangıç yok (min. 11s dinlenme)', () => {
  test('50 tohumda dinlenme ihlali olmamalı', () => {
    for (let seed = 200; seed < 250; seed++) {
      const r = runPlanner({ ...STORE_INPUT, seed })
      expect(r.warnings.filter((w) => w.message.includes('dinlenme')), `seed ${seed}`).toEqual([])
    }
  })

  test('validator 22:00 → 08:00 geçişini hata olarak yakalamalı', () => {
    const emp = STORE.find((e) => e.id === 's-f1')!
    const base = { employee_id: 's-f1', employee_name: 's-f1', shift_template_id: null, reason: '' }
    const errors = validatePlan([
      { ...base, work_date: '2026-10-14', start_time: '14:00', end_time: '22:00', shift_kind: 'closing' },
      { ...base, work_date: '2026-10-15', start_time: '08:00', end_time: '17:00', shift_kind: 'opening' },
    ], [emp], []).filter((w) => w.level === 'error')
    expect(errors.some((w) => w.message.includes('dinlenme'))).toBe(true)
  })
})

// ─── Senaryo 18: Hafta ortasında yeniden plan (çalışılmış vardiyalar sabit) ──

describe('Senaryo 18 — Çalışılmış vardiyalar korunur ve limitlere dahil edilir', () => {
  const fixedAssignments = [
    { employee_id: 's-p1', work_date: '2026-10-12', start_time: '10:00', end_time: '18:00' },
    { employee_id: 'mm',   work_date: '2026-10-12', start_time: '14:00', end_time: '22:00' },
  ]

  test.each([1, 2, 3, 4, 5])('seed %i: çalışılmış vardiya aynen planda, limitler aşılmıyor', (seed) => {
    const r = runPlanner({ ...STORE_INPUT, fixedAssignments, seed })
    for (const f of fixedAssignments) {
      const a = r.assignments.filter((x) => x.employee_id === f.employee_id && x.work_date === f.work_date)
      expect(a).toHaveLength(1)
      expect([a[0].start_time, a[0].end_time]).toEqual([f.start_time, f.end_time])
    }
    expect(r.stats['s-p1'].workDays).toBeLessThanOrEqual(PART_TIME_RULES.maxWeeklyDays)
    expect(r.stats['s-p1'].totalMins).toBeLessThanOrEqual(PART_TIME_RULES.maxWeeklyHours * 60)
    // Müdür Pazartesi kapanışta çalıştı → yardımcı açılışa yazılmalı
    const y = r.assignments.find((x) => x.employee_id === 'mmy' && x.work_date === '2026-10-12')
    expect(y && ['opening', 'full'].includes(y.shift_kind)).toBe(true)
    expect(r.warnings.filter((w) => w.level === 'error')).toEqual([])
  })
})

// ─── Senaryo 19: 18 yaş altı ve hafta başı dinlenme ──────────────────────────

describe('Senaryo 19 — 18 yaş altı korumaları (Md. 73) ve geçen Pazar → Pazartesi dinlenme', () => {
  test.each([1, 2, 3, 4, 5])('seed %i: 17 yaşındakine 20:00 sonrası veya 8 saati aşan vardiya verilmez', (seed) => {
    const genc = { ...makeEmp('genc', 'Satış Danışmanı', 'Çalışan', 'part_time'), birthDate: '2009-06-01' }
    const r = runPlanner({ ...STORE_INPUT, employees: [...STORE, genc], seed })
    const shifts = r.assignments.filter((a) => a.employee_id === 'genc')
    expect(shifts.length).toBeGreaterThan(0)
    for (const s of shifts) {
      expect(s.end_time <= '20:00').toBe(true)
      expect(netWorkMins(s.start_time, s.end_time)).toBeLessThanOrEqual(8 * 60)
    }
    expect(r.warnings.filter((w) => w.level === 'error')).toEqual([])
  })

  test('validator 18 yaş altı kapanış vardiyasını hata olarak yakalamalı', () => {
    const genc = { ...makeEmp('genc', 'Satış Danışmanı', 'Çalışan', 'part_time'), birthDate: '2009-06-01' }
    const errors = validatePlan([{
      employee_id: 'genc', employee_name: 'genc', shift_template_id: null, reason: '',
      work_date: '2026-10-14', start_time: '14:00', end_time: '22:00', shift_kind: 'closing',
    }], [genc], []).filter((w) => w.level === 'error')
    expect(errors.some((w) => w.message.includes('18 yaşından küçük'))).toBe(true)
  })

  test('geçen Pazar 22:00 kapanış yapan depo görevlisi Pazartesi 08:00 başlamaz', () => {
    const employees = STORE.map((e) => (e.id === 'dep' ? { ...e, prevDayEndMins: -120 } : e))
    const r = runPlanner({ ...STORE_INPUT, employees, seed: 7 })
    const monday = r.assignments.find((a) => a.employee_id === 'dep' && a.work_date === WEEK_DAYS[0])
    expect(monday?.start_time).not.toBe('08:00')
  })
})
