/**
 * workforcePlanner.ts – ShiftUp Kural Tabanlı Haftalık Vardiya Planlayıcı
 *
 * Deterministik, AI içermeyen planlama motoru.
 * Mevcut verilerden (employees, availability, leaves, shift templates) hareketle
 * bir hafta için taslak (draft) plan üretir.
 *
 * Algoritma fazları:
 *   1. Zorunlu sabitleri ve izin günlerini belirle (Müdür Salı, YardMüd Perşembe, Görsel/Depo Pazar)
 *   2. Yönetici kapsamasını sağla (her gün opening + closing'de Müdür veya Yardımcı)
 *   3. Kasiyer minimum ihtiyacını karşıla (her gün ≥1 opening + ≥1 closing kasiyer)
 *   4. Satış danışmanı zorunlu atamalarını yap
 *   5. FT çalışanları 45 saate yaklaştır (hard limit: 45s ve max 6 gün)
 *   6. PT çalışanları 30 saate yaklaştır (hard limit: 30s ve max 4 gün)
 *   7. Bağımsız validator ile planın tamamını kontrol et
 *
 * HARD CONSTRAINTS (ihlal → hasHardViolation = true, plan onaylanamaz):
 *   - FT çalışan haftalık net saat ≤ 45s
 *   - FT çalışan haftalık gün ≤ 6 (en az 1 izin)
 *   - PT çalışan haftalık net saat ≤ 30s
 *   - PT çalışan haftalık gün ≤ 4
 *   - Müdür Salı izinli (atama yapılmaz)
 *   - Müdür Yardımcısı Perşembe izinli (atama yapılmaz)
 *   - Her gün ≥1 opening kasiyer, ≥1 closing kasiyer, toplam ≥2 kasiyer
 *   - Her gün opening + closing'de yönetici (Müdür veya Müdür Yardımcısı) bulunmalı
 *   - İzin/availability çakışması yok
 *   - Aynı çalışana aynı gün çakışan iki vardiya yok
 */

import { netWorkMins } from './workingTimeService'
import { PART_TIME_RULES } from '@/types/employee'

// ─── Tipler ─────────────────────────────────────────────────────────────────

export type ShiftKind = 'opening' | 'mid' | 'closing' | 'full' | 'custom'

export interface PlannerShiftTemplate {
  id: string
  name: string
  start_time: string  // 'HH:MM'
  end_time: string
}

export interface PlannerEmployee {
  id: string
  full_name: string
  /** Serbest metin pozisyon (Kasiyer, Satış Danışmanı, Görsel Uzmanı vs.) */
  position: string
  /** DB roles.name – Yönetici / Mağaza Müdürü / Müdür Yardımcısı / Çalışan */
  role_name: string
  employment_type: 'full_time' | 'part_time'
  /** Gün → [availability kayıtları] */
  availability: Record<string, Array<{ start_time: string; end_time: string; is_available: boolean }>>
  /** Bu hafta izinli günler: 'YYYY-MM-DD' set */
  leaveDays: Set<string>
}

export interface DraftAssignment {
  employee_id: string
  employee_name: string
  work_date: string
  start_time: string
  end_time: string
  shift_template_id: string | null
  shift_kind: ShiftKind
  reason: string
}

export interface EmployeeDraftStats {
  employeeId: string
  employeeName: string
  employment_type: 'full_time' | 'part_time'
  totalMins: number
  workDays: number
  openingCount: number
  closingCount: number
  fullCount: number
  assignments: DraftAssignment[]
}

export interface PlanWarning {
  level: 'error' | 'warning' | 'info'
  message: string
}

export interface PlannerResult {
  weekStart: string
  weekEnd: string
  weekDays: string[]
  assignments: DraftAssignment[]
  stats: Record<string, EmployeeDraftStats>
  warnings: PlanWarning[]
  /** Hard constraint ihlali var mı (plan onaylanamaz) */
  hasHardViolation: boolean
}

export interface PlannerInput {
  weekStart: string   // 'YYYY-MM-DD' Pazartesi
  weekEnd: string     // 'YYYY-MM-DD' Pazar
  weekDays: string[]  // 7 eleman
  employees: PlannerEmployee[]
  templates: PlannerShiftTemplate[]
}

// ─── Sabitler ────────────────────────────────────────────────────────────────

const FT_MAX_MINS = 45 * 60      // 2700 dk — hard limit
const FT_MAX_DAYS = 6            // FT haftada en fazla 6 gün
const PT_MAX_MINS = PART_TIME_RULES.maxWeeklyHours * 60   // 1800 dk
const PT_MAX_DAYS = PART_TIME_RULES.maxWeeklyDays         // 4

// Gün → DayOfWeek key
const DATE_TO_DOW: Record<number, string> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
}

// Sabit izin günleri
const MUDUR_OFF_DOW = 'tuesday'            // Müdür Salı izinli
const MUDUR_Y_OFF_DOW = 'thursday'         // Müdür Yardımcısı Perşembe izinli
const GORSEL_DEPO_OFF_DOW = 'sunday'       // Görsel Uzman & Depo Pazar izinli

// Yoğun günler (personel planlama önceliği)
const HEAVY_DAYS = new Set(['thursday', 'friday', 'saturday', 'sunday'])

// Pozisyon eşleştirme listeleri
const POS_MUDUR           = ['mudur', 'magaza muduru', 'mağaza müdürü', 'store manager']
const POS_MUDUR_YARDIMCISI = ['yardimci', 'mudur yardimcisi', 'müdür yardımcısı', 'muduru yardimcisi', 'assistant manager']
const POS_GORSEL_UZMAN    = ['gorsel', 'görsel', 'visual']
const POS_DEPO            = ['depo', 'storage', 'warehouse']
const POS_KASIYER         = ['kasiyer', 'kasa', 'cashier']
const POS_SATIS           = ['satis', 'satış', 'danisman', 'danışman', 'sales']

// ─── Yardımcı fonksiyonlar ───────────────────────────────────────────────────

function normTR(s: string): string {
  return s
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function positionIs(pos: string, list: string[]): boolean {
  const n = normTR(pos)
  return list.some((p) => n.includes(normTR(p)))
}

function dowKey(dateStr: string): string {
  return DATE_TO_DOW[new Date(dateStr).getDay()]
}

function toMins(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

/** Şablona veya saate göre vardiya türünü belirle */
function classifyShift(start: string, end: string, templates: PlannerShiftTemplate[]): ShiftKind {
  const tmpl = templates.find(
    (t) => t.start_time.slice(0, 5) === start.slice(0, 5) && t.end_time.slice(0, 5) === end.slice(0, 5)
  )
  if (tmpl) {
    const n = normTR(tmpl.name)
    if (n.includes('acilis') || n.includes('opening') || n.includes('sabah')) return 'opening'
    if (n.includes('kapanis') || n.includes('closing') || n.includes('aksam')) return 'closing'
    if (n.includes('full') || n.includes('tam gun') || n.includes('tam gün')) return 'full'
    if (n.includes('araci') || n.includes('aracı') || n.includes('orta') || n.includes('mid')) return 'mid'
  }
  // Saat bazlı tahmin
  const startM = toMins(start)
  const endM   = toMins(end) <= toMins(start) ? toMins(end) + 1440 : toMins(end)
  const dur    = endM - startM
  if (startM <= 600 && dur >= 660) return 'full'    // ≤10:00 başlayıp ≥11s
  if (startM <= 660) return 'opening'               // ≤11:00
  if (startM >= 780) return 'closing'               // ≥13:00
  return 'mid'
}

/** Çalışanın o gün availability'si var mı */
function isAvailableOnDay(emp: PlannerEmployee, dateStr: string): boolean {
  const dow = dowKey(dateStr)
  const avList = emp.availability[dow] ?? []
  if (avList.length === 0) return true
  if (avList.some((a) => !a.is_available)) return false
  return true
}

/** Vardiya saati çalışanın availability penceresine uyuyor mu */
function fitsAvailabilityWindow(
  emp: PlannerEmployee,
  dateStr: string,
  startTime: string,
  endTime: string,
): boolean {
  const dow = dowKey(dateStr)
  const avList = emp.availability[dow] ?? []
  if (avList.length === 0) return true
  const sM = toMins(startTime)
  const eM = toMins(endTime) <= toMins(startTime) ? toMins(endTime) + 1440 : toMins(endTime)
  return avList.some((a) => {
    if (!a.is_available) return false
    const aS = toMins(a.start_time)
    const aE = toMins(a.end_time)
    return sM >= aS && eM <= aE
  })
}

/** Şablonu ada göre bul */
function findTemplate(
  templates: PlannerShiftTemplate[],
  ...nameParts: string[]
): PlannerShiftTemplate | null {
  for (const namePart of nameParts) {
    const found = templates.find((t) => normTR(t.name).includes(normTR(namePart)))
    if (found) return found
  }
  return null
}

/** Rol adına göre yönetici mi */
function isManagerRole(emp: PlannerEmployee): boolean {
  return (
    positionIs(emp.role_name, POS_MUDUR) ||
    positionIs(emp.role_name, POS_MUDUR_YARDIMCISI) ||
    positionIs(emp.position, POS_MUDUR) ||
    positionIs(emp.position, POS_MUDUR_YARDIMCISI) ||
    normTR(emp.role_name).includes('yonetici') ||
    normTR(emp.role_name).includes('mudur')
  )
}

// ─── Ana Planlayıcı ──────────────────────────────────────────────────────────

export function runPlanner(input: PlannerInput): PlannerResult {
  const { weekStart, weekEnd, weekDays, employees, templates } = input

  const warnings: PlanWarning[] = []

  // Atama haritası: employee_id → date → DraftAssignment
  const assignMap = new Map<string, Map<string, DraftAssignment>>()
  for (const emp of employees) {
    assignMap.set(emp.id, new Map())
  }

  // ─── Şablonları bul ─────────────────────────────────────────────────────

  const tOpening = findTemplate(templates, 'acilis', 'açılış', 'opening', 'sabah')
  const tClosing = findTemplate(templates, 'kapanis', 'kapanış', 'closing', 'aksam', 'akşam')
  const tMid     = findTemplate(templates, 'araci', 'aracı', 'mid', 'orta', 'oglen', 'öğlen')
  const tFull    = findTemplate(templates, 'full', 'tam gun', 'tam gün')

  if (!tOpening) warnings.push({ level: 'error', message: 'Açılış vardiya şablonu bulunamadı.' })
  if (!tClosing) warnings.push({ level: 'error', message: 'Kapanış vardiya şablonu bulunamadı.' })
  if (!tFull)    warnings.push({ level: 'warning', message: 'Full (tam gün) vardiya şablonu bulunamadı.' })

  // ─── Çalışan kategorileri ────────────────────────────────────────────────

  const mudur = employees.find(
    (e) => positionIs(e.role_name, POS_MUDUR) || positionIs(e.position, POS_MUDUR)
  )
  const mudurY = employees.find(
    (e) => positionIs(e.role_name, POS_MUDUR_YARDIMCISI) || positionIs(e.position, POS_MUDUR_YARDIMCISI)
  )
  const gorsel = employees.find((e) => positionIs(e.position, POS_GORSEL_UZMAN))
  const depo   = employees.find((e) => positionIs(e.position, POS_DEPO))
  const kasiyerler = employees.filter((e) => positionIs(e.position, POS_KASIYER))
  const satisDanismanlari = employees.filter((e) => positionIs(e.position, POS_SATIS))

  if (!mudur)  warnings.push({ level: 'warning', message: 'Mağaza Müdürü bulunamadı.' })
  if (!mudurY) warnings.push({ level: 'warning', message: 'Müdür Yardımcısı bulunamadı.' })

  // ─── Yardımcı fonksiyonlar ───────────────────────────────────────────────

  function getEmpMins(empId: string): number {
    return [...(assignMap.get(empId)?.values() ?? [])].reduce(
      (s, a) => s + netWorkMins(a.start_time, a.end_time), 0
    )
  }

  function getEmpDays(empId: string): number {
    return assignMap.get(empId)?.size ?? 0
  }

  /** FT veya PT hard limit kontrolü */
  function wouldExceedLimit(emp: PlannerEmployee, addMins: number): boolean {
    const currMins = getEmpMins(emp.id)
    const currDays = getEmpDays(emp.id)
    if (emp.employment_type === 'full_time') {
      if (currDays >= FT_MAX_DAYS) return true
      if (currMins + addMins > FT_MAX_MINS) return true
    } else {
      if (currDays >= PT_MAX_DAYS) return true
      if (currMins + addMins > PT_MAX_MINS) return true
    }
    return false
  }

  /** Pozisyona göre o çalışanın o günde çalışıp çalışamayacağını belirle (sabit izinler dahil) */
  function isFixedDayOff(emp: PlannerEmployee, dateStr: string): boolean {
    const dow = dowKey(dateStr)

    // Önce daha özgün eşleşme: Müdür Yardımcısı
    // NOT: positionIs('Mudur Yardimcisi', POS_MUDUR) da true döner çünkü 'mudur' içeriyor.
    // Bu nedenle önce yardımcı kontrolü yapılmalı.
    const isYardimci =
      positionIs(emp.position, POS_MUDUR_YARDIMCISI) ||
      positionIs(emp.role_name, POS_MUDUR_YARDIMCISI)

    // Sadece Müdür (yardımcı değil)
    const isMudurOnly =
      !isYardimci &&
      (positionIs(emp.position, POS_MUDUR) || positionIs(emp.role_name, POS_MUDUR))

    // Müdür: Salı izinli
    if (isMudurOnly && dow === MUDUR_OFF_DOW) return true

    // Müdür Yardımcısı: Perşembe izinli
    if (isYardimci && dow === MUDUR_Y_OFF_DOW) return true

    // Görsel Uzman + Depo: Pazar izinli
    if (positionIs(emp.position, POS_GORSEL_UZMAN) || positionIs(emp.position, POS_DEPO)) {
      if (dow === GORSEL_DEPO_OFF_DOW) return true
    }

    return false
  }

  /**
   * Atama ekleme — tüm hard constraint'leri kontrol eder.
   * Başarılıysa true, herhangi bir kural ihlalinde false döner.
   */
  function addAssignment(
    emp: PlannerEmployee,
    dateStr: string,
    tmpl: PlannerShiftTemplate,
    reason: string,
  ): boolean {
    const dayMap = assignMap.get(emp.id)!
    // Aynı gün zaten atanmış
    if (dayMap.has(dateStr)) return false
    // İzin günü
    if (emp.leaveDays.has(dateStr)) return false
    // Availability yok
    if (!isAvailableOnDay(emp, dateStr)) return false
    // Sabit izin günü
    if (isFixedDayOff(emp, dateStr)) return false
    // Hard saat/gün limiti
    const addMins = netWorkMins(tmpl.start_time, tmpl.end_time)
    if (wouldExceedLimit(emp, addMins)) return false
    // Availability penceresi (soft: pencere tanımlıysa kısıtla)
    if (!fitsAvailabilityWindow(emp, dateStr, tmpl.start_time, tmpl.end_time)) {
      const dow = dowKey(dateStr)
      const avList = emp.availability[dow] ?? []
      if (avList.length > 0 && avList.every((a) => a.is_available)) return false
    }

    const kind = classifyShift(tmpl.start_time, tmpl.end_time, templates)
    dayMap.set(dateStr, {
      employee_id:        emp.id,
      employee_name:      emp.full_name,
      work_date:          dateStr,
      start_time:         tmpl.start_time.slice(0, 5),
      end_time:           tmpl.end_time.slice(0, 5),
      shift_template_id:  tmpl.id,
      shift_kind:         kind,
      reason,
    })
    return true
  }

  /**
   * Custom atama ekleme — şablon olmayan saatler için.
   */
  function addCustomAssignment(
    emp: PlannerEmployee,
    dateStr: string,
    startTime: string,
    endTime: string,
    kind: ShiftKind,
    reason: string,
  ): boolean {
    const dayMap = assignMap.get(emp.id)!
    if (dayMap.has(dateStr)) return false
    if (emp.leaveDays.has(dateStr)) return false
    if (!isAvailableOnDay(emp, dateStr)) return false
    if (isFixedDayOff(emp, dateStr)) return false
    const addMins = netWorkMins(startTime, endTime)
    if (wouldExceedLimit(emp, addMins)) return false
    if (!fitsAvailabilityWindow(emp, dateStr, startTime, endTime)) {
      const dow = dowKey(dateStr)
      const avList = emp.availability[dow] ?? []
      if (avList.length > 0 && avList.every((a) => a.is_available)) return false
    }

    dayMap.set(dateStr, {
      employee_id:        emp.id,
      employee_name:      emp.full_name,
      work_date:          dateStr,
      start_time:         startTime,
      end_time:           endTime,
      shift_template_id:  null,
      shift_kind:         kind,
      reason,
    })
    return true
  }

  function getShiftKindCount(empId: string, kind: ShiftKind): number {
    return [...(assignMap.get(empId)?.values() ?? [])].filter((a) => a.shift_kind === kind).length
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 1: Müdür & Müdür Yardımcısı — sabit kurallar
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Müdür:
  //   - Salı: izin (atama yapılmaz)
  //   - Perşembe: Full (yönetici Perşembe full kuralı)
  //   - Diğer: Opening
  //
  // Müdür Yardımcısı:
  //   - Perşembe: izin
  //   - Salı: Full
  //   - Diğer: Closing (denge için; Müdür opening'de, Yardımcı closing'de)
  //
  // Not: İkisi de ortacı alamaz.

  if (mudur) {
    for (const dateStr of weekDays) {
      const dow = dowKey(dateStr)
      if (dow === MUDUR_OFF_DOW) continue  // Salı izin

      if (dow === 'thursday' && tFull) {
        addAssignment(mudur, dateStr, tFull, 'Müdür Perşembe full vardiya kuralı')
      } else if (tOpening) {
        addAssignment(mudur, dateStr, tOpening, 'Müdür açılış kuralı')
      }
    }
  }

  if (mudurY) {
    for (const dateStr of weekDays) {
      const dow = dowKey(dateStr)
      if (dow === MUDUR_Y_OFF_DOW) continue  // Perşembe izin

      if (dow === 'tuesday' && tFull) {
        addAssignment(mudurY, dateStr, tFull, 'Müdür Yardımcısı Salı full vardiya kuralı')
      } else if (tClosing) {
        // Müdür izin günü (Salı) yoksa Yardımcı closing alabilir; diğer günlerde closing ile denge
        addAssignment(mudurY, dateStr, tClosing, 'Müdür Yardımcısı kapanış (yönetici kapsaması dengesi)')
      } else if (tOpening) {
        addAssignment(mudurY, dateStr, tOpening, 'Müdür Yardımcısı açılış (kapanış şablonu yok)')
      }
    }
  }

  // FAZ 1b: Görsel Uzman & Depo — Pazar izin, diğer günler 08:00 açılış
  if (gorsel) {
    for (const dateStr of weekDays) {
      if (dowKey(dateStr) === GORSEL_DEPO_OFF_DOW) continue
      addCustomAssignment(gorsel, dateStr, '08:00', '16:00', 'opening',
        'Görsel Uzman açılış kuralı (08:00–16:00)')
    }
  }
  if (depo) {
    for (const dateStr of weekDays) {
      if (dowKey(dateStr) === GORSEL_DEPO_OFF_DOW) continue
      addCustomAssignment(depo, dateStr, '08:00', '16:00', 'opening',
        'Depo Görevlisi açılış kuralı (08:00–16:00)')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 2: FT Kasiyer — Perşembe full tercih
  // ═══════════════════════════════════════════════════════════════════════════

  const ftKasiyerler = kasiyerler.filter((e) => e.employment_type === 'full_time')
  for (const kFT of ftKasiyerler) {
    const persembe = weekDays.find((d) => dowKey(d) === 'thursday')
    if (persembe && tFull) {
      addAssignment(kFT, persembe, tFull, 'FT kasiyer Perşembe full vardiya tercihi')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 3: Kasiyer minimum ihtiyacı — her gün ≥1 opening + ≥1 closing kasiyer
  // ═══════════════════════════════════════════════════════════════════════════

  for (const dateStr of weekDays) {
    const dow = dowKey(dateStr)

    // O güne ait kasiyer atamalarını hesapla
    const todayKasiyerKinds = (): ShiftKind[] =>
      kasiyerler
        .map((e) => assignMap.get(e.id)?.get(dateStr)?.shift_kind)
        .filter((k): k is ShiftKind => !!k)

    // Aday sıralaması: opening/closing sayısı az olanı önce ver (denge)
    const sortedByOpenCount = (list: PlannerEmployee[]) =>
      [...list].sort((a, b) => getShiftKindCount(a.id, 'opening') - getShiftKindCount(b.id, 'opening'))

    const sortedByCloseCount = (list: PlannerEmployee[]) =>
      [...list].sort((a, b) => getShiftKindCount(a.id, 'closing') - getShiftKindCount(b.id, 'closing'))

    // Müsait ve atanmamış kasiyerler
    const freeKasiyerler = (neededMins: number) =>
      kasiyerler.filter(
        (e) =>
          !assignMap.get(e.id)?.has(dateStr) &&
          !e.leaveDays.has(dateStr) &&
          isAvailableOnDay(e, dateStr) &&
          !isFixedDayOff(e, dateStr) &&
          !wouldExceedLimit(e, neededMins)
      )

    // Opening kasiyer
    if (!todayKasiyerKinds().some((k) => k === 'opening' || k === 'full')) {
      if (tOpening) {
        const neededMins = netWorkMins(tOpening.start_time, tOpening.end_time)
        // Availability penceresine uyanlar önce
        const withWindow = sortedByOpenCount(
          freeKasiyerler(neededMins).filter((e) =>
            fitsAvailabilityWindow(e, dateStr, tOpening.start_time, tOpening.end_time)
          )
        )
        const fallback = sortedByOpenCount(freeKasiyerler(neededMins))
        const candidate = withWindow[0] ?? fallback[0]
        if (candidate) {
          addAssignment(candidate, dateStr, tOpening, `Günlük minimum kasiyer opening (${dow})`)
        } else {
          warnings.push({ level: 'error', message: `${dateStr} tarihinde opening kasiyer atanamadı (yetersiz müsait kasiyer).` })
        }
      }
    }

    // Closing kasiyer (opening'den farklı biri)
    if (!todayKasiyerKinds().some((k) => k === 'closing' || k === 'full')) {
      if (tClosing) {
        const neededMins = netWorkMins(tClosing.start_time, tClosing.end_time)
        const withWindow = sortedByCloseCount(
          freeKasiyerler(neededMins).filter((e) =>
            fitsAvailabilityWindow(e, dateStr, tClosing.start_time, tClosing.end_time)
          )
        )
        const fallback = sortedByCloseCount(freeKasiyerler(neededMins))
        const candidate = withWindow[0] ?? fallback[0]
        if (candidate) {
          addAssignment(candidate, dateStr, tClosing, `Günlük minimum kasiyer closing (${dow})`)
        } else {
          const total = kasiyerler.filter((e) => assignMap.get(e.id)?.has(dateStr)).length
          if (total < 2) {
            warnings.push({ level: 'error', message: `${dateStr} tarihinde minimum 2 kasiyer şartı karşılanamıyor.` })
          } else {
            warnings.push({ level: 'error', message: `${dateStr} tarihinde closing kasiyer atanamadı.` })
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 4: Yönetici kapsaması — her gün opening + closing'de Müdür veya Yardımcı
  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 1 zaten Müdür'ü opening'e, Yardımcı'yı closing'e koyuyor.
  // Burada sadece eksik kapsamayı kontrol edip uyarı üretiyoruz.

  for (const dateStr of weekDays) {
    const dayAssigns = [...assignMap.values()]
      .map((dm) => dm.get(dateStr))
      .filter((a): a is DraftAssignment => !!a)

    const managerHasOpening = dayAssigns.some((a) => {
      const emp = employees.find((e) => e.id === a.employee_id)
      return emp && isManagerRole(emp) && (a.shift_kind === 'opening' || a.shift_kind === 'full')
    })

    const managerHasClosing = dayAssigns.some((a) => {
      const emp = employees.find((e) => e.id === a.employee_id)
      return emp && isManagerRole(emp) && (a.shift_kind === 'closing' || a.shift_kind === 'full')
    })

    if (!managerHasOpening) {
      warnings.push({ level: 'error', message: `${dateStr} tarihinde açılışta Müdür/Müdür Yardımcısı bulunamıyor.` })
    }
    if (!managerHasClosing) {
      warnings.push({ level: 'error', message: `${dateStr} tarihinde kapanışta Müdür/Müdür Yardımcısı bulunamıyor.` })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 5: Satış Danışmanları
  // ═══════════════════════════════════════════════════════════════════════════
  // Hafta içi: ≥1 opening SD
  // Hafta sonu: mid tercih, closing gerekli
  // Yoğun günler (Per/Cum/Cmt/Paz): daha fazla closing SD

  function getSDOnDay(dateStr: string): DraftAssignment[] {
    return satisDanismanlari
      .map((e) => assignMap.get(e.id)?.get(dateStr))
      .filter((a): a is DraftAssignment => !!a)
  }

  // Hafta içi opening SD
  for (const dateStr of weekDays) {
    const dow = dowKey(dateStr)
    if (['saturday', 'sunday'].includes(dow)) continue

    const sdOnDay = getSDOnDay(dateStr)
    const hasOpeningSD = sdOnDay.some((a) => a.shift_kind === 'opening' || a.shift_kind === 'full')
    if (hasOpeningSD) continue

    if (tOpening) {
      const neededMins = netWorkMins(tOpening.start_time, tOpening.end_time)
      const candidate = satisDanismanlari
        .filter(
          (e) =>
            !assignMap.get(e.id)?.has(dateStr) &&
            !e.leaveDays.has(dateStr) &&
            isAvailableOnDay(e, dateStr) &&
            !isFixedDayOff(e, dateStr) &&
            !wouldExceedLimit(e, neededMins)
        )
        .sort((a, b) => getShiftKindCount(a.id, 'opening') - getShiftKindCount(b.id, 'opening'))[0]

      if (candidate) {
        addAssignment(candidate, dateStr, tOpening, `Hafta içi opening Satış Danışmanı zorunluluğu (${dow})`)
      } else {
        warnings.push({ level: 'error', message: `${dateStr} tarihinde hafta içi opening Satış Danışmanı şartı karşılanamadı.` })
      }
    }
  }

  // Closing SD (hafta içi 2, yoğun günler 3, hafta sonu 2)
  for (const dateStr of weekDays) {
    const dow = dowKey(dateStr)
    const isWeekend = ['saturday', 'sunday'].includes(dow)
    const isHeavy   = HEAVY_DAYS.has(dow)
    const targetClosing = isHeavy ? 3 : 2

    const existingClosingSD = getSDOnDay(dateStr).filter(
      (a) => a.shift_kind === 'closing' || a.shift_kind === 'full'
    ).length

    const needed = targetClosing - existingClosingSD
    if (needed <= 0 || !tClosing) continue

    const neededMins = netWorkMins(tClosing.start_time, tClosing.end_time)
    const candidates = satisDanismanlari
      .filter(
        (e) =>
          !assignMap.get(e.id)?.has(dateStr) &&
          !e.leaveDays.has(dateStr) &&
          isAvailableOnDay(e, dateStr) &&
          !isFixedDayOff(e, dateStr) &&
          !wouldExceedLimit(e, neededMins)
      )
      .sort((a, b) => getShiftKindCount(a.id, 'closing') - getShiftKindCount(b.id, 'closing'))

    for (let i = 0; i < needed && i < candidates.length; i++) {
      addAssignment(candidates[i], dateStr, tClosing,
        `${isWeekend ? 'Hafta sonu' : 'Hafta içi'} Satış Danışmanı closing${isHeavy ? ' (yoğun gün)' : ''}`)
    }
  }

  // Hafta sonu mid SD (12:00–20:00 tercih)
  for (const dateStr of weekDays) {
    const dow = dowKey(dateStr)
    if (!['saturday', 'sunday'].includes(dow) || !tMid) continue

    const neededMins = netWorkMins(tMid.start_time, tMid.end_time)
    const candidate = satisDanismanlari
      .filter(
        (e) =>
          !assignMap.get(e.id)?.has(dateStr) &&
          !e.leaveDays.has(dateStr) &&
          isAvailableOnDay(e, dateStr) &&
          !isFixedDayOff(e, dateStr) &&
          !wouldExceedLimit(e, neededMins)
      )[0]

    if (candidate) {
      addAssignment(candidate, dateStr, tMid, 'Hafta sonu Satış Danışmanı ortacı tercihi')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 6: FT çalışanları 45 saate yaklaştır (max 6 gün, max 45s net)
  // ═══════════════════════════════════════════════════════════════════════════

  const ftEmployees = employees.filter((e) => e.employment_type === 'full_time')
  // Yoğun günleri önce işle (hafta içi + hafta sonu)
  const orderedDays = [
    ...weekDays.filter((d) => HEAVY_DAYS.has(dowKey(d))),
    ...weekDays.filter((d) => !HEAVY_DAYS.has(dowKey(d))),
  ]

  for (const emp of ftEmployees) {
    for (const dateStr of orderedDays) {
      // Limit kontrolü
      if (getEmpMins(emp.id) >= FT_MAX_MINS) break
      if (getEmpDays(emp.id) >= FT_MAX_DAYS) break
      // Zaten bu güne atanmış
      if (assignMap.get(emp.id)?.has(dateStr)) continue
      // İzin/availability
      if (emp.leaveDays.has(dateStr)) continue
      if (!isAvailableOnDay(emp, dateStr)) continue
      if (isFixedDayOff(emp, dateStr)) continue

      const stillNeeded = FT_MAX_MINS - getEmpMins(emp.id)

      // Vardiya seç: kalan saate göre en uygun şablon
      let selectedTmpl: PlannerShiftTemplate | null = null
      let reason = 'FT 45 saat hedefi'

      if (stillNeeded >= 10 * 60 && tFull) {
        // full: 12s brüt - 2s mola = 10s net
        selectedTmpl = tFull
        reason = 'FT 45 saat hedefi için full vardiya'
      } else if (stillNeeded >= 7 * 60 && tOpening) {
        // opening: 8s brüt - 1s mola = 7s net
        selectedTmpl = tOpening
        reason = 'FT 45 saat hedefi için açılış vardiyası'
      } else if (stillNeeded >= 7 * 60 && tClosing) {
        selectedTmpl = tClosing
        reason = 'FT 45 saat hedefi için kapanış vardiyası'
      } else if (tClosing) {
        // Kalan süreye en yakın kapanış
        const closingMins = netWorkMins(tClosing.start_time, tClosing.end_time)
        if (stillNeeded >= closingMins * 0.5) {
          selectedTmpl = tClosing
          reason = 'FT 45 saat hedefi için kapanış vardiyası'
        }
      } else if (tOpening) {
        const openingMins = netWorkMins(tOpening.start_time, tOpening.end_time)
        if (stillNeeded >= openingMins * 0.5) {
          selectedTmpl = tOpening
          reason = 'FT 45 saat hedefi için açılış vardiyası'
        }
      }

      if (selectedTmpl) {
        addAssignment(emp, dateStr, selectedTmpl, reason)
      }
    }

    const finalMins = getEmpMins(emp.id)
    const finalDays = getEmpDays(emp.id)
    if (finalMins < FT_MAX_MINS - 60) {
      warnings.push({
        level: 'info',
        message: `${emp.full_name}: 45 saat hedefine ulaşılamadı (${Math.round(finalMins / 60 * 10) / 10}s, ${finalDays} gün). Availability veya izin kısıtlaması olabilir.`,
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 7: PT çalışanları 30 saate yaklaştır (max 4 gün, max 30s net)
  // ═══════════════════════════════════════════════════════════════════════════

  const ptEmployees = employees.filter((e) => e.employment_type === 'part_time')

  for (const emp of ptEmployees) {
    for (const dateStr of orderedDays) {
      if (getEmpMins(emp.id) >= PT_MAX_MINS) break
      if (getEmpDays(emp.id) >= PT_MAX_DAYS) break
      if (assignMap.get(emp.id)?.has(dateStr)) continue
      if (emp.leaveDays.has(dateStr)) continue
      if (!isAvailableOnDay(emp, dateStr)) continue
      if (isFixedDayOff(emp, dateStr)) continue

      const dow = dowKey(dateStr)
      const isWeekend = ['saturday', 'sunday'].includes(dow)

      let selectedTmpl: PlannerShiftTemplate | null = null

      if (isWeekend && tMid) {
        const newMins = getEmpMins(emp.id) + netWorkMins(tMid.start_time, tMid.end_time)
        if (newMins <= PT_MAX_MINS) selectedTmpl = tMid
      }
      if (!selectedTmpl && tClosing) {
        const newMins = getEmpMins(emp.id) + netWorkMins(tClosing.start_time, tClosing.end_time)
        if (newMins <= PT_MAX_MINS) selectedTmpl = tClosing
      }
      if (!selectedTmpl && tOpening) {
        const newMins = getEmpMins(emp.id) + netWorkMins(tOpening.start_time, tOpening.end_time)
        if (newMins <= PT_MAX_MINS) selectedTmpl = tOpening
      }

      if (selectedTmpl) {
        addAssignment(emp, dateStr, selectedTmpl, `PT çalışan 30 saat hedefi (${dow})`)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 8: Sonuçları derle
  // ═══════════════════════════════════════════════════════════════════════════

  const allAssignments: DraftAssignment[] = []
  const stats: Record<string, EmployeeDraftStats> = {}

  for (const emp of employees) {
    const dayMap = assignMap.get(emp.id)!
    const empAssignments = [...dayMap.values()]
    allAssignments.push(...empAssignments)

    const totalMins    = empAssignments.reduce((s, a) => s + netWorkMins(a.start_time, a.end_time), 0)
    const openingCount = empAssignments.filter((a) => a.shift_kind === 'opening').length
    const closingCount = empAssignments.filter((a) => a.shift_kind === 'closing').length
    const fullCount    = empAssignments.filter((a) => a.shift_kind === 'full').length

    stats[emp.id] = {
      employeeId:      emp.id,
      employeeName:    emp.full_name,
      employment_type: emp.employment_type,
      totalMins,
      workDays:        empAssignments.length,
      openingCount,
      closingCount,
      fullCount,
      assignments:     empAssignments,
    }
  }

  // Bağımsız validator
  const validationWarnings = validatePlan(allAssignments, employees, weekDays)
  for (const w of validationWarnings) {
    // Zaten aynı mesaj yoksa ekle
    if (!warnings.some((x) => x.message === w.message)) {
      warnings.push(w)
    }
  }

  // Tekrar eden uyarıları kaldır
  const uniqueWarnings = warnings.filter(
    (w, i, arr) => arr.findIndex((x) => x.message === w.message) === i
  )

  // Hard violation: herhangi bir 'error' uyarısı varsa plan geçersiz
  const hasHardViolation = uniqueWarnings.some((w) => w.level === 'error')

  return {
    weekStart,
    weekEnd,
    weekDays,
    assignments: allAssignments,
    stats,
    warnings: uniqueWarnings,
    hasHardViolation,
  }
}

// ─── Bağımsız Validator ──────────────────────────────────────────────────────

/**
 * validatePlan — Planın tamamını bağımsız olarak kontrol eder.
 *
 * runPlanner() çalıştıktan sonra çağrılır.
 * Planlama mantığından bağımsız olarak tüm hard constraint'leri doğrular.
 *
 * Kontroller:
 *   1. FT çalışan haftalık net saat ≤ 45s
 *   2. FT çalışan haftalık gün ≤ 6
 *   3. PT çalışan haftalık net saat ≤ 30s
 *   4. PT çalışan haftalık gün ≤ 4
 *   5. Sabit izin günü ihlali (Müdür Salı, Yardımcı Perşembe, Görsel/Depo Pazar)
 *   6. Onaylı izin günü ihlali
 *   7. Aynı çalışana aynı gün çakışan iki atama
 *   8. Her gün ≥1 opening kasiyer, ≥1 closing kasiyer, toplam ≥2 kasiyer
 *   9. Her gün opening + closing'de yönetici
 *  10. Müdür/Yardımcı ortacı alma yasağı
 */
export function validatePlan(
  assignments: DraftAssignment[],
  employees: PlannerEmployee[],
  weekDays: string[],
): PlanWarning[] {
  const warnings: PlanWarning[] = []

  // Çalışan lookup
  const empById = new Map(employees.map((e) => [e.id, e]))

  // Employee → atamalar
  const byEmp = new Map<string, DraftAssignment[]>()
  for (const a of assignments) {
    const list = byEmp.get(a.employee_id) ?? []
    list.push(a)
    byEmp.set(a.employee_id, list)
  }

  for (const [empId, empAssigns] of byEmp) {
    const emp = empById.get(empId)
    if (!emp) continue

    const workDays = new Set(empAssigns.map((a) => a.work_date))
    const totalMins = empAssigns.reduce((s, a) => s + netWorkMins(a.start_time, a.end_time), 0)
    const totalHours = Math.round(totalMins / 60 * 10) / 10

    // 1. FT saat limiti
    if (emp.employment_type === 'full_time' && totalMins > FT_MAX_MINS) {
      warnings.push({
        level: 'error',
        message: `${emp.full_name}: FT haftalık saat limiti aşıldı (${totalHours}s > 45s).`,
      })
    }

    // 2. FT gün limiti
    if (emp.employment_type === 'full_time' && workDays.size > FT_MAX_DAYS) {
      warnings.push({
        level: 'error',
        message: `${emp.full_name}: FT haftalık gün limiti aşıldı (${workDays.size} gün > 6 gün).`,
      })
    }

    // 3. PT saat limiti
    if (emp.employment_type === 'part_time' && totalMins > PT_MAX_MINS) {
      warnings.push({
        level: 'error',
        message: `${emp.full_name}: PT haftalık saat limiti aşıldı (${totalHours}s > ${PART_TIME_RULES.maxWeeklyHours}s).`,
      })
    }

    // 4. PT gün limiti
    if (emp.employment_type === 'part_time' && workDays.size > PT_MAX_DAYS) {
      warnings.push({
        level: 'error',
        message: `${emp.full_name}: PT haftalık gün limiti aşıldı (${workDays.size} gün > ${PART_TIME_RULES.maxWeeklyDays} gün).`,
      })
    }

    // 5. Sabit izin günü ihlali
    for (const a of empAssigns) {
      const dow = dowKey(a.work_date)

      // Önce yardımcı kontrolü (positionIs mudur_yardimcisi aynı zamanda 'mudur' içerir)
      const isYardimci =
        positionIs(emp.position, POS_MUDUR_YARDIMCISI) ||
        positionIs(emp.role_name, POS_MUDUR_YARDIMCISI)

      const isMudurOnly =
        !isYardimci &&
        (positionIs(emp.position, POS_MUDUR) || positionIs(emp.role_name, POS_MUDUR))

      if (isMudurOnly && dow === MUDUR_OFF_DOW) {
        warnings.push({ level: 'error', message: `${emp.full_name}: Müdür Salı günü çalışamaz (${a.work_date}).` })
      }
      if (isYardimci && dow === MUDUR_Y_OFF_DOW) {
        warnings.push({ level: 'error', message: `${emp.full_name}: Müdür Yardımcısı Perşembe günü çalışamaz (${a.work_date}).` })
      }
      if ((positionIs(emp.position, POS_GORSEL_UZMAN) || positionIs(emp.position, POS_DEPO)) && dow === GORSEL_DEPO_OFF_DOW) {
        warnings.push({ level: 'error', message: `${emp.full_name}: ${a.work_date} Pazar günü çalışamaz.` })
      }
    }

    // 6. Onaylı izin günü ihlali
    for (const a of empAssigns) {
      if (emp.leaveDays.has(a.work_date)) {
        warnings.push({ level: 'error', message: `${emp.full_name}: İzin günü (${a.work_date}) vardiyaya atanmış.` })
      }
    }

    // 7. Aynı gün çakışan iki atama
    const dateCount = new Map<string, number>()
    for (const a of empAssigns) {
      dateCount.set(a.work_date, (dateCount.get(a.work_date) ?? 0) + 1)
    }
    for (const [date, count] of dateCount) {
      if (count > 1) {
        warnings.push({ level: 'error', message: `${emp.full_name}: ${date} tarihinde çakışan ${count} atama var.` })
      }
    }

    // 10. Müdür/Yardımcı ortacı alma yasağı
    if (isManagerRoleById(emp)) {
      for (const a of empAssigns) {
        if (a.shift_kind === 'mid') {
          warnings.push({ level: 'error', message: `${emp.full_name}: Yönetici ortacı (mid) vardiya alamaz (${a.work_date}).` })
        }
      }
    }
  }

  // 8. Her gün kasiyer minimum ihtiyacı
  for (const dateStr of weekDays) {
    const kasiyerIds = new Set(
      employees.filter((e) => positionIs(e.position, POS_KASIYER)).map((e) => e.id)
    )
    const kasiyerAssigns = assignments.filter((a) => kasiyerIds.has(a.employee_id) && a.work_date === dateStr)

    const total   = kasiyerAssigns.length
    const opening = kasiyerAssigns.filter((a) => a.shift_kind === 'opening' || a.shift_kind === 'full').length
    const closing = kasiyerAssigns.filter((a) => a.shift_kind === 'closing' || a.shift_kind === 'full').length

    if (total < 2) {
      warnings.push({ level: 'error', message: `${dateStr}: Günlük minimum 2 kasiyer şartı karşılanmıyor (${total} kasiyer).` })
    }
    if (opening < 1) {
      warnings.push({ level: 'error', message: `${dateStr}: Açılışta kasiyer yok.` })
    }
    if (closing < 1) {
      warnings.push({ level: 'error', message: `${dateStr}: Kapanışta kasiyer yok.` })
    }
  }

  // 9. Her gün yönetici kapsaması
  for (const dateStr of weekDays) {
    const dayAssigns = assignments.filter((a) => a.work_date === dateStr)
    const managerIds = new Set(
      employees
        .filter((e) => isManagerRoleById(e))
        .map((e) => e.id)
    )

    const mgrOpening = dayAssigns.some(
      (a) => managerIds.has(a.employee_id) && (a.shift_kind === 'opening' || a.shift_kind === 'full')
    )
    const mgrClosing = dayAssigns.some(
      (a) => managerIds.has(a.employee_id) && (a.shift_kind === 'closing' || a.shift_kind === 'full')
    )

    if (!mgrOpening) {
      warnings.push({ level: 'error', message: `${dateStr}: Açılışta yönetici (Müdür/Müdür Yardımcısı) yok.` })
    }
    if (!mgrClosing) {
      warnings.push({ level: 'error', message: `${dateStr}: Kapanışta yönetici (Müdür/Müdür Yardımcısı) yok.` })
    }
  }

  return warnings
}

function isManagerRoleById(emp: PlannerEmployee): boolean {
  return (
    positionIs(emp.role_name, POS_MUDUR) ||
    positionIs(emp.role_name, POS_MUDUR_YARDIMCISI) ||
    positionIs(emp.position, POS_MUDUR) ||
    positionIs(emp.position, POS_MUDUR_YARDIMCISI) ||
    normTR(emp.role_name).includes('yonetici') ||
    normTR(emp.role_name).includes('mudur')
  )
}
