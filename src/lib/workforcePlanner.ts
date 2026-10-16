/**
 * workforcePlanner.ts – ShiftUp Kural Tabanlı Haftalık Vardiya Planlayıcı
 *
 * Deterministik, AI içermeyen planlama motoru.
 * Mevcut verilerden (employees, availability, leaves) hareketle bir hafta için
 * taslak (draft) plan üretir. Vardiya saatleri mağaza saatlerine (10:00–22:00)
 * göre sabit katalogdan (SHIFTS) gelir; aynı saatlere sahip bir şablon varsa
 * shift_template_id olarak bağlanır.
 *
 * Yönetici kadrosu: tek Mağaza Müdürü + birden fazla olabilen Müdür Yardımcısı.
 * DB'deki "Yönetici" rolü sistem yetkisidir, mağaza kademesi değildir; bu roldeki
 * çalışan pozisyonuna göre (Görsel Uzmanı, Şef Kasiyer…) planlanır.
 *
 * Algoritma fazları:
 *   1. Yöneticiler: Müdür Salı izinli; yardımcıların izin gününü algoritma seçer
 *      (her gün en az bir yönetici kalacak şekilde). İki+ yöneticili günde biri açılış,
 *      biri kapanış; tek yöneticili günde o kişi full (10:00–22:00). Ortacı yok.
 *   2. Görsel Uzman & Depo: Pzt–Cum 08:00–17:00, Cmt 08:00–14:00, Pazar izin (= 45s)
 *   3. Perşembe etiket yenileme: 2 çalışan daha 08:00–17:00
 *   4. FT kasiyer Perşembe full tercihi
 *   5. Günlük minimum kapsama (kasiyer opening/closing, satış danışmanı)
 *   6. Kalan günleri doldur: FT 6 gün, PT 4 gün; gün yükü ve açılış/kapanış dengesine göre
 *   7. FT saat tamamlama: mevcut vardiyalar katalogdaki uzun/kısa varyantlarla
 *      değiştirilerek haftalık hedefe (45s; her kayıp gün için 7,5s düşülür) en yakın
 *      kombinasyon aranır
 *   8. Bağımsız validator ile planın tamamını kontrol et
 *
 * HARD CONSTRAINTS (ihlal → hasHardViolation = true, plan onaylanamaz):
 *   - FT çalışan haftalık net saat ≤ 45s
 *   - FT çalışan haftalık gün ≤ 6 (en az 1 izin)
 *   - PT çalışan haftalık net saat ≤ 30s
 *   - PT çalışan haftalık gün ≤ 4
 *   - Geçen haftanın sonuyla birlikte en fazla 6 ardışık iş günü (İş K. Md. 46)
 *   - Müdür Salı izinli (atama yapılmaz)
 *   - Her gün ≥1 opening kasiyer, ≥1 closing kasiyer, toplam ≥2 kasiyer
 *   - Her gün opening + closing'de yönetici (Müdür veya Müdür Yardımcısı) bulunmalı
 *   - Yönetici ortacı (mid) almaz
 *   - İzin/availability çakışması yok
 *   - Aynı çalışana aynı gün çakışan iki vardiya yok
 *
 * Zaten çalışılmış (giriş/çıkış kaydı olan) vardiyalar değiştirilemediği için yalnızca
 * onlardan kaynaklanan ihlaller planı engellemez; uyarı olarak raporlanır.
 */

import { netWorkMins } from './workingTimeService'
import { getWorkingTimeConfig } from './workingTimeConfig'
import { completedYears, minorWorkViolations } from './laborLaw'
import { PART_TIME_RULES } from '@/types/employee'
import { addDaysToDateString } from './dateUtils'

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
  /**
   * Geçen haftanın vardiya türleri: dow ('monday'…) → tür. Listede olmayan gün = izinliydi.
   * Verilmezse (undefined) geçen hafta bilinmiyor kabul edilir.
   */
  lastWeek?: Partial<Record<string, ShiftKind>>
  /** Doğum tarihi — 18 yaş altı korumaları (gece yasağı, günlük 8 saat) için */
  birthDate?: string | null
  /**
   * Haftadan önceki gün (Pazar) çalıştıysa vardiya bitişi, Pazartesi 00:00'a göre dakika
   * (ör. Pazar 22:00 → -120). Pazartesi vardiyasının dinlenme kontrolü için.
   */
  prevDayEndMins?: number
  /**
   * Haftadan hemen önce kesintisiz çalışılan gün sayısı (Pazar'dan geriye).
   * Md. 46 ardışık gün sınırı bu hafta bununla birlikte hesaplanır.
   */
  prevStreak?: number
  /** Bekleyen (henüz onaylanmamış) izin günleri — mümkünse bu günlere atama yapılmaz */
  pendingLeaveDays?: Set<string>
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
  /** Giriş/çıkış kaydı olan, değiştirilemeyen vardiya */
  worked?: boolean
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
  /** Planı üreten tohum — aynı tohum + aynı veri = aynı plan */
  seed: number
}

export interface PlannerInput {
  weekStart: string   // 'YYYY-MM-DD' Pazartesi
  weekEnd: string     // 'YYYY-MM-DD' Pazar
  weekDays: string[]  // 7 eleman
  employees: PlannerEmployee[]
  templates: PlannerShiftTemplate[]
  /**
   * Rastgelelik tohumu. Kurallar aynı kalır; eşit derecede uygun seçenekler
   * (kim, hangi gün izinli, açılış mı kapanış mı) bu tohuma göre seçilir.
   * Verilmezse haftanın tarihinden türetilir.
   */
  seed?: number
  /**
   * Bu hafta zaten çalışılmış (giriş/çıkış kaydı olan) vardiyalar. Değiştirilmez;
   * saat/gün limitleri ve kapsama bunlar hesaba katılarak doldurulur.
   */
  fixedAssignments?: Array<{
    employee_id: string
    work_date: string
    start_time: string
    end_time: string
    shift_template_id?: string | null
  }>
}

// ─── Sabitler ────────────────────────────────────────────────────────────────

const FT_MAX_MINS = 45 * 60      // 2700 dk — hard limit
const FT_MAX_DAYS = 6            // FT haftada en fazla 6 gün
const PT_MAX_MINS = PART_TIME_RULES.maxWeeklyHours * 60   // 1800 dk
const PT_MAX_DAYS = PART_TIME_RULES.maxWeeklyDays         // 4
const MAX_CONSECUTIVE_DAYS = 6   // Md. 46: 7 günlük dilimde en az 24 saat kesintisiz dinlenme
/** Haftalık tatil dışındaki her kayıp gün (izin, müsait değil) FT hedefinden düşülür: 45s / 6 */
const LOST_DAY_MINS = FT_MAX_MINS / FT_MAX_DAYS

// Gün → DayOfWeek key
const DATE_TO_DOW: Record<number, string> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
}

// Sabit izin günleri
const MUDUR_OFF_DOW = 'tuesday'            // Müdür Salı izinli (yardımcıların izin gününü algoritma seçer)
const GORSEL_DEPO_OFF_DOW = 'sunday'       // Görsel Uzman & Depo Pazar izinli
const GORSEL_DEPO_SHORT_DOW = 'saturday'   // Görsel Uzman & Depo Cumartesi kısa (08:00–14:00)

// Perşembe etiket yenileme: görsel/depo dışında 08:00'de başlayan ek çalışan sayısı
const LABEL_DAY_DOW = 'thursday'
const LABEL_DAY_EXTRA_STAFF = 2

// Yoğun günler (personel planlama önceliği)
const HEAVY_DAYS = new Set(['thursday', 'friday', 'saturday', 'sunday'])

// Pozisyon eşleştirme listeleri
const POS_MUDUR           = ['mudur', 'magaza muduru', 'mağaza müdürü', 'store manager']
const POS_MUDUR_YARDIMCISI = ['yardimci', 'mudur yardimcisi', 'müdür yardımcısı', 'muduru yardimcisi', 'assistant manager']
const POS_GORSEL_UZMAN    = ['gorsel', 'görsel', 'visual']
const POS_DEPO            = ['depo', 'storage', 'warehouse']
const POS_KASIYER         = ['kasiyer', 'kasa', 'cashier']
const POS_SATIS           = ['satis', 'satış', 'danisman', 'danışman', 'sales', 'reyon']
// Kısaltmalar (tam eşleşme): M.M = Mağaza Müdürü, M.M.Y = Müdür Yardımcısı
const ABBR_MUDUR            = ['mm']
const ABBR_MUDUR_YARDIMCISI = ['mmy']

// ─── Vardiya kataloğu (mağaza 10:00–22:00) ───────────────────────────────────

type ShiftKey =
  | 'opening' | 'mid' | 'closing' | 'full'
  | 'closingShort' | 'closingLong'
  | 'early' | 'earlyShort'

interface ShiftDef {
  start: string
  end: string
  kind: ShiftKind
  label: string
}

const SHIFTS: Record<ShiftKey, ShiftDef> = {
  opening:      { start: '10:00', end: '18:00', kind: 'opening', label: 'Açılış' },          // net 7s
  mid:          { start: '12:00', end: '20:00', kind: 'mid',     label: 'Ortacı' },          // net 7s
  closing:      { start: '14:00', end: '22:00', kind: 'closing', label: 'Kapanış' },         // net 7s
  full:         { start: '10:00', end: '22:00', kind: 'full',    label: 'Full' },            // net 10s
  closingShort: { start: '15:00', end: '22:00', kind: 'closing', label: 'Kısa kapanış' },    // net 6s
  closingLong:  { start: '12:00', end: '22:00', kind: 'closing', label: 'Uzun kapanış' },    // net 8.5s
  early:        { start: '08:00', end: '17:00', kind: 'opening', label: 'Erken (08:00)' },   // net 8s
  earlyShort:   { start: '08:00', end: '14:00', kind: 'opening', label: 'Erken kısa' },      // net 5s
}

/** 45 saat tamamlamada bir vardiyanın yerine geçebilecek varyantlar (kapsamayı bozmaz) */
const TOPUP_VARIANTS: Partial<Record<ShiftKey, ShiftKey[]>> = {
  opening: ['opening', 'full'],
  closing: ['closing', 'closingShort', 'closingLong', 'full'],
}

const SHIFT_NET: Record<ShiftKey, number> = Object.fromEntries(
  (Object.keys(SHIFTS) as ShiftKey[]).map((k) => [k, netWorkMins(SHIFTS[k].start, SHIFTS[k].end)])
) as Record<ShiftKey, number>

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
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function positionIs(pos: string, list: string[]): boolean {
  const n = normTR(pos)
  return list.some((p) => n.includes(normTR(p)))
}

function abbrIs(pos: string, list: string[]): boolean {
  const n = normTR(pos).replace(/[\s.]/g, '')
  return list.includes(n)
}

function hasRole(emp: PlannerEmployee, list: string[], abbrs: string[]): boolean {
  return (
    positionIs(emp.position, list) || positionIs(emp.role_name, list) ||
    abbrIs(emp.position, abbrs) || abbrIs(emp.role_name, abbrs)
  )
}

/** Müdür Yardımcısı. Önce bu kontrol edilmeli: 'Müdür Yardımcısı' metni 'mudur' da içerir. */
function isAssistantManager(emp: PlannerEmployee): boolean {
  return hasRole(emp, POS_MUDUR_YARDIMCISI, ABBR_MUDUR_YARDIMCISI)
}

/** Mağaza Müdürü (yardımcı değil) — pozisyon veya DB rolü */
function isStoreManager(emp: PlannerEmployee): boolean {
  return !isAssistantManager(emp) && hasRole(emp, POS_MUDUR, ABBR_MUDUR)
}

/** Mağaza kademesinde yönetici mi (Müdür veya Müdür Yardımcısı). "Yönetici" sistem rolü sayılmaz. */
function isManagerRole(emp: PlannerEmployee): boolean {
  return isStoreManager(emp) || isAssistantManager(emp)
}

export interface ManagerRoster {
  /** Planlanan tek Mağaza Müdürü (Salı izinli) */
  storeManager: PlannerEmployee | undefined
  /** Müdür Yardımcıları + fazladan tanımlı müdürler; izin günlerini algoritma seçer */
  assistants: PlannerEmployee[]
  /** Birden fazla müdür tanımlıysa müdür olarak planlanmayanlar (assistants içinde de yer alır) */
  extraStoreManagers: PlannerEmployee[]
}

/**
 * Yönetici kadrosunu ayırır. Mağazada tek müdür olur; birden fazla müdür eşleşirse
 * hem DB rolü hem pozisyonu müdür olan öncelikli seçilir, diğerleri yardımcı gibi planlanır.
 */
export function classifyManagers(employees: PlannerEmployee[]): ManagerRoster {
  const byRole = (e: PlannerEmployee) => positionIs(e.role_name, POS_MUDUR) || abbrIs(e.role_name, ABBR_MUDUR)
  const byPosition = (e: PlannerEmployee) => positionIs(e.position, POS_MUDUR) || abbrIs(e.position, ABBR_MUDUR)
  const [storeManager, ...extraStoreManagers] = employees
    .filter(isStoreManager)
    .map((e, i) => ({ e, i, rank: (byRole(e) ? 0 : 2) + (byPosition(e) ? 0 : 1) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.e)
  return {
    storeManager,
    assistants: [...employees.filter(isAssistantManager), ...extraStoreManagers],
    extraStoreManagers,
  }
}

/** Görsel Uzman veya Depo — sabit 08:00 kalıbıyla çalışır */
function isFixedCrew(emp: PlannerEmployee): boolean {
  return positionIs(emp.position, POS_GORSEL_UZMAN) || positionIs(emp.position, POS_DEPO)
}

function dowKey(dateStr: string): string {
  return DATE_TO_DOW[new Date(dateStr).getDay()]
}

function toMins(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
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

/** 18 yaş altı korumalarını (İş K. Md. 73) ihlal eden vardiya ihlal mesajları */
function minorViolations(emp: PlannerEmployee, dateStr: string, start: string, end: string): string[] {
  const age = emp.birthDate ? completedYears(emp.birthDate, dateStr) : null
  return minorWorkViolations(age, start, end, netWorkMins(start, end))
}

/** Pozisyona göre sabit izin günü mü (Müdür Salı, Görsel/Depo Pazar) */
function isFixedDayOff(emp: PlannerEmployee, dateStr: string, storeManagerId: string | undefined): boolean {
  const dow = dowKey(dateStr)
  if (emp.id === storeManagerId && dow === MUDUR_OFF_DOW) return true
  if (!isManagerRole(emp) && isFixedCrew(emp) && dow === GORSEL_DEPO_OFF_DOW) return true
  return false
}

/** Haftanın günlerinde (geçen haftadan gelen seriyle birlikte) en uzun ardışık çalışma serisi */
function longestRun(
  weekDays: string[],
  works: (dateStr: string) => boolean,
  prevStreak = 0,
): { length: number; startIdx: number; endIdx: number } {
  let best = { length: 0, startIdx: 0, endIdx: -1 }
  let run = prevStreak
  let startIdx = -prevStreak
  weekDays.forEach((d, i) => {
    if (!works(d)) {
      run = 0
      startIdx = i + 1
      return
    }
    run++
    if (run > best.length) best = { length: run, startIdx, endIdx: i }
  })
  return best
}

/** idx günü dahil olduğu ardışık çalışma serisinin uzunluğu (geçen haftanın serisi dahil) */
function runAt(weekDays: string[], works: (dateStr: string) => boolean, idx: number, prevStreak = 0): number {
  let start = idx
  while (start > 0 && works(weekDays[start - 1])) start--
  let end = idx
  while (end < weekDays.length - 1 && works(weekDays[end + 1])) end++
  return end - start + 1 + (start === 0 ? prevStreak : 0)
}

function isOpeningKind(k: ShiftKind): boolean {
  return k === 'opening' || k === 'full'
}

function isClosingKind(k: ShiftKind): boolean {
  return k === 'closing' || k === 'full'
}

/** Kayıtlı bir vardiyanın türünü saatlerinden çıkar (geçen hafta verisi için) */
export function kindFromTimes(start: string, end: string): ShiftKind {
  const s = start.slice(0, 5)
  const e = end.slice(0, 5)
  if (s <= '10:00' && e >= '22:00') return 'full'
  if (s < '12:00') return 'opening'
  if (e >= '21:30') return 'closing'
  return 'mid'
}

/** Tohumlu sözde-rastgele üreteç (mulberry32) — [0, 1) */
function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Fisher–Yates; yeni dizi döner */
function shuffle<T>(list: T[], rng: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ─── Ana Planlayıcı ──────────────────────────────────────────────────────────

interface Slot {
  /** Katalog vardiyası; 'fixed' = dışarıdan gelen, zaten çalışılmış vardiya */
  key: ShiftKey | 'fixed'
  def: ShiftDef
  net: number
  /** Tamamlama fazında değiştirilemez (görsel/depo, etiket günü, çalışılmış vardiya) */
  locked: boolean
  assignment: DraftAssignment
}

/** Kaç deneme yapılacağı (en iyi plan seçilir) */
const PLAN_ATTEMPTS = 12

/**
 * Haftalık taslak plan üretir.
 * Tohumdan türetilen farklı varyasyonlarla birkaç deneme yapar ve
 * en iyisini döner: önce hata (error) sayısı, sonra FT'lerin haftalık hedefe
 * toplam eksiği, sonra uyarı sayısı en az olan.
 */
export function runPlanner(input: PlannerInput): PlannerResult {
  const baseSeed = input.seed ?? hashString(input.weekStart)
  const score = (r: PlannerResult, ftDeficit: number, rosterWarnings: number) => {
    const errors = r.warnings.filter((w) => w.level === 'error').length
    const warns = r.warnings.filter((w) => w.level === 'warning').length - rosterWarnings
    return errors * 1_000_000 + ftDeficit * 10 + warns
  }

  let best: PlannerResult | null = null
  let bestScore = Infinity
  for (let i = 0; i < PLAN_ATTEMPTS; i++) {
    const { result, ftDeficit, rosterWarnings } = planOnce(input, (baseSeed + i * 0x9e3779b1) >>> 0)
    const s = score(result, ftDeficit, rosterWarnings)
    if (s < bestScore) {
      best = result
      bestScore = s
    }
    if (s === 0) break
  }
  return best!
}

function planOnce(input: PlannerInput, seed: number): { result: PlannerResult; ftDeficit: number; rosterWarnings: number } {
  const { weekStart, weekEnd, weekDays, employees, templates } = input

  const minRestMins = getWorkingTimeConfig().minRestHours * 60
  const rng = createRng(seed)
  const shuffled = <T,>(list: T[]) => shuffle(list, rng)

  const warnings: PlanWarning[] = []

  // Atama haritası: employee_id → date → Slot
  const slotMap = new Map<string, Map<string, Slot>>()
  for (const emp of employees) {
    slotMap.set(emp.id, new Map())
  }

  // ─── Çalışan kategorileri ────────────────────────────────────────────────

  const roster = classifyManagers(employees)
  const mudur = roster.storeManager
  // Müdür önce (izin günü sabit), yardımcılar karışık sırayla izin günü seçer
  const managers = [...(mudur ? [mudur] : []), ...shuffled(roster.assistants)]
  const managerIds = new Set(managers.map((e) => e.id))
  const fixedCrew = employees.filter((e) => !managerIds.has(e.id) && isFixedCrew(e))
  const flexible = employees.filter((e) => !managerIds.has(e.id) && !isFixedCrew(e))
  const kasiyerler = flexible.filter((e) => positionIs(e.position, POS_KASIYER))
  const satisDanismanlari = flexible.filter(
    (e) => !positionIs(e.position, POS_KASIYER) && positionIs(e.position, POS_SATIS)
  )

  // Zaten çalışılmış vardiyalar (giriş/çıkış kaydı olan) sabit olarak yerleşir
  for (const f of input.fixedAssignments ?? []) {
    const dayMap = slotMap.get(f.employee_id)
    const emp = employees.find((e) => e.id === f.employee_id)
    if (!dayMap || !emp || !weekDays.includes(f.work_date) || dayMap.has(f.work_date)) continue
    const start = f.start_time.slice(0, 5)
    const end   = f.end_time.slice(0, 5)
    const def: ShiftDef = { start, end, kind: kindFromTimes(start, end), label: 'Çalışılmış' }
    dayMap.set(f.work_date, {
      key: 'fixed',
      def,
      net: netWorkMins(start, end),
      locked: true,
      assignment: {
        employee_id:       emp.id,
        employee_name:     emp.full_name,
        work_date:         f.work_date,
        start_time:        start,
        end_time:          end,
        shift_template_id: f.shift_template_id ?? null,
        shift_kind:        def.kind,
        reason:            'Giriş/çıkış kaydı var — mevcut vardiya korunuyor',
        worked:            true,
      },
    })
  }

  if (!mudur) warnings.push({ level: 'warning', message: 'Mağaza Müdürü bulunamadı.' })
  if (roster.assistants.length === 0) warnings.push({ level: 'warning', message: 'Müdür Yardımcısı bulunamadı.' })
  if (mudur && roster.extraStoreManagers.length > 0) {
    warnings.push({
      level: 'warning',
      message: `Birden fazla Mağaza Müdürü tanımlı (${[mudur, ...roster.extraStoreManagers].map((e) => e.full_name).join(', ')}). `
        + `${mudur.full_name} müdür olarak planlandı; ${roster.extraStoreManagers.map((e) => e.full_name).join(', ')} müdür yardımcısı gibi planlandı.`,
    })
  }
  // Kadro uyarıları her denemede aynıdır; plan kalitesi skoruna katılmaz
  const rosterWarnings = warnings.length

  // ─── Yardımcı fonksiyonlar ───────────────────────────────────────────────

  function getEmpMins(empId: string): number {
    return [...(slotMap.get(empId)?.values() ?? [])].reduce((s, x) => s + x.net, 0)
  }

  function getEmpDays(empId: string): number {
    return slotMap.get(empId)?.size ?? 0
  }

  function maxDays(emp: PlannerEmployee): number {
    return emp.employment_type === 'full_time' ? FT_MAX_DAYS : PT_MAX_DAYS
  }

  function maxMins(emp: PlannerEmployee): number {
    return emp.employment_type === 'full_time' ? FT_MAX_MINS : PT_MAX_MINS
  }

  function getKindCount(empId: string, kind: ShiftKind): number {
    return [...(slotMap.get(empId)?.values() ?? [])].filter((x) => x.def.kind === kind).length
  }

  /** Çalışan o gün çalışabilir mi (atanmamış, izinsiz, müsait, sabit izin değil) */
  function canWork(emp: PlannerEmployee, dateStr: string): boolean {
    return (
      !slotMap.get(emp.id)!.has(dateStr) &&
      !emp.leaveDays.has(dateStr) &&
      isAvailableOnDay(emp, dateStr) &&
      !isFixedDayOff(emp, dateStr, mudur?.id)
    )
  }

  function hasPendingLeave(emp: PlannerEmployee, dateStr: string): boolean {
    return emp.pendingLeaveDays?.has(dateStr) ?? false
  }

  /**
   * Bu güne atama yapılırsa (geçen haftayla birlikte) ardışık gün sınırı aşılmıyor mu.
   * Yalnızca bu günün dahil olduğu seri sayılır; çalışılmış vardiyalardaki eski bir
   * ihlal, araya izin girdikten sonraki günleri engellemez.
   */
  function streakOk(emp: PlannerEmployee, dateStr: string): boolean {
    const dayMap = slotMap.get(emp.id)!
    const works = (d: string) => d === dateStr || dayMap.has(d)
    return runAt(weekDays, works, weekDays.indexOf(dateStr), emp.prevStreak) <= MAX_CONSECUTIVE_DAYS
  }

  /**
   * FT haftalık saat hedefi: 45s. Haftalık tatil dışındaki her kayıp gün
   * (onaylı izin, müsait değil, sabit izin günü) için 7,5s düşülür.
   */
  function weeklyTargetMins(emp: PlannerEmployee): number {
    if (emp.employment_type !== 'full_time') return 0
    const blocked = weekDays.filter(
      (d) => emp.leaveDays.has(d) || !isAvailableOnDay(emp, d) || isFixedDayOff(emp, d, mudur?.id)
    ).length
    return Math.max(0, FT_MAX_MINS - LOST_DAY_MINS * Math.max(0, blocked - 1))
  }

  /** Vardiya hard limitleri ve availability penceresiyle birlikte yerleştirilebilir mi */
  function canPlace(emp: PlannerEmployee, dateStr: string, key: ShiftKey): boolean {
    return blockReason(emp, dateStr, key) === null
  }

  /** Vardiya neden yerleştirilemez (yerleştirilebiliyorsa null) — hata mesajlarında gösterilir */
  function blockReason(emp: PlannerEmployee, dateStr: string, key: ShiftKey): string | null {
    const existing = slotMap.get(emp.id)!.get(dateStr)
    if (existing) return existing.key === 'fixed' ? 'çalışılmış vardiyası var' : `zaten ${existing.def.label.toLowerCase()} vardiyasında`
    if (emp.leaveDays.has(dateStr)) return 'izinli'
    if (!isAvailableOnDay(emp, dateStr)) return 'müsait değil'
    if (isFixedDayOff(emp, dateStr, mudur?.id)) return 'sabit izin günü'
    if (getEmpDays(emp.id) >= maxDays(emp)) return 'haftalık gün limiti dolu'
    if (getEmpMins(emp.id) + SHIFT_NET[key] > maxMins(emp)) return 'haftalık saat limiti dolu'
    const def = SHIFTS[key]
    if (!fitsAvailabilityWindow(emp, dateStr, def.start, def.end)) return 'müsaitlik saatleri dışında'
    if (!restOk(emp, dateStr, def)) return `${minRestMins / 60} saat dinlenme sağlanmıyor`
    if (!streakOk(emp, dateStr)) return 'Md. 46: 6 gün üst üste çalışmış'
    if (minorViolations(emp, dateStr, def.start, def.end).length > 0) return '18 yaş altı sınırı'
    return null
  }

  /** "Ad (sebep), …" — gruptaki kimsenin bu vardiyaya neden atanamadığı */
  function explain(list: PlannerEmployee[], dateStr: string, key: ShiftKey): string {
    if (list.length === 0) return 'bu pozisyonda çalışan yok'
    return list.map((e) => `${e.full_name} (${blockReason(e, dateStr, key) ?? 'uygun'})`).join(', ')
  }

  /** Önceki/sonraki gün vardiyasıyla arada en az minRestHours dinlenme kalıyor mu */
  function restOk(emp: PlannerEmployee, dateStr: string, def: ShiftDef): boolean {
    const dayMap = slotMap.get(emp.id)!
    const idx = weekDays.indexOf(dateStr)
    // Haftanın ilk günü: geçen haftanın son vardiyasıyla arası
    if (idx === 0 && emp.prevDayEndMins !== undefined && toMins(def.start) - emp.prevDayEndMins < minRestMins) return false
    const prev = idx > 0 ? dayMap.get(weekDays[idx - 1]) : undefined
    const next = idx < weekDays.length - 1 ? dayMap.get(weekDays[idx + 1]) : undefined
    if (prev && 1440 - toMins(prev.def.end) + toMins(def.start) < minRestMins) return false
    if (next && 1440 - toMins(def.end) + toMins(next.def.start) < minRestMins) return false
    return true
  }

  function templateIdFor(def: ShiftDef): string | null {
    return templates.find(
      (t) => t.start_time.slice(0, 5) === def.start && t.end_time.slice(0, 5) === def.end
    )?.id ?? null
  }

  /** Atama ekleme — tüm hard constraint'leri kontrol eder. */
  function place(
    emp: PlannerEmployee,
    dateStr: string,
    key: ShiftKey,
    reason: string,
    locked = false,
  ): boolean {
    if (!canPlace(emp, dateStr, key)) return false
    const def = SHIFTS[key]
    slotMap.get(emp.id)!.set(dateStr, {
      key,
      def,
      net: SHIFT_NET[key],
      locked,
      assignment: {
        employee_id:       emp.id,
        employee_name:     emp.full_name,
        work_date:         dateStr,
        start_time:        def.start,
        end_time:          def.end,
        shift_template_id: templateIdFor(def),
        shift_kind:        def.kind,
        reason,
      },
    })
    return true
  }

  /** Mevcut atamayı başka bir vardiyayla değiştir; olmazsa eskisini geri koy */
  function replace(emp: PlannerEmployee, dateStr: string, key: ShiftKey, reason: string): boolean {
    const dayMap = slotMap.get(emp.id)!
    const prev = dayMap.get(dateStr)
    dayMap.delete(dateStr)
    if (place(emp, dateStr, key, reason, prev?.locked ?? false)) return true
    if (prev) dayMap.set(dateStr, prev)
    return false
  }

  /** O gün belirli bir gruptaki atamaların vardiya türleri */
  function kindsOnDay(list: PlannerEmployee[], dateStr: string): ShiftKind[] {
    return list
      .map((e) => slotMap.get(e.id)!.get(dateStr))
      .filter((x): x is Slot => !!x)
      .map((x) => x.def.kind)
  }

  /**
   * Gruptan o gün için en uygun adayı seç:
   * bekleyen izni olmayan → kalan gün kapasitesi en fazla olan → bu türden en az almış olan → FT önce
   */
  function pickCandidate(list: PlannerEmployee[], dateStr: string, key: ShiftKey): PlannerEmployee | null {
    const kind = SHIFTS[key].kind
    // Eşitlikler rastgele kırılsın diye önce karıştırılır (sort stabildir)
    const candidates = shuffled(list.filter((e) => canPlace(e, dateStr, key)))
      .sort((a, b) =>
        Number(hasPendingLeave(a, dateStr)) - Number(hasPendingLeave(b, dateStr)) ||
        (maxDays(b) - getEmpDays(b.id)) - (maxDays(a) - getEmpDays(a.id)) ||
        Number(wasOffLastWeek(b, dateStr)) - Number(wasOffLastWeek(a, dateStr)) ||
        getKindCount(a.id, kind) - getKindCount(b.id, kind) ||
        Number(sameAsLastWeek(a, dateStr, kind)) - Number(sameAsLastWeek(b, dateStr, kind)) ||
        (a.employment_type === 'full_time' ? -1 : 0) - (b.employment_type === 'full_time' ? -1 : 0)
      )
    return candidates[0] ?? null
  }

  /** Geçen hafta aynı gün aynı türü almış mı */
  function sameAsLastWeek(emp: PlannerEmployee, dateStr: string, kind: ShiftKind): boolean {
    return emp.lastWeek?.[dowKey(dateStr)] === kind
  }

  /** Geçen hafta bu gün izinli miydi (veri yoksa false) */
  function wasOffLastWeek(emp: PlannerEmployee, dateStr: string): boolean {
    return emp.lastWeek !== undefined && emp.lastWeek[dowKey(dateStr)] === undefined
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 1: Yöneticiler (1 Müdür + N Müdür Yardımcısı)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // 1a. Çalışma günleri. Müdür Salı sabit izinli. Her yönetici sırayla, gerekli en az
  //     sayıda izin gününü seçer (6 gün ve Md. 46 ardışık gün sınırı). İzin günü tercihi:
  //     başka yöneticinin çalışmadığı gün asla (kapsama deliği) → başka yöneticiyi full'e
  //     zorlamayan (≥2 yöneticili) gün → bekleyen izin günü → geçen hafta izinli olunan gün.
  // 1b. Vardiya türleri. Tek yöneticili günler önce (full), sonra ≥2 yöneticili günlerde
  //     açılış/kapanış dengesi en çok bozulmuş olan karşı tarafa yazılır. Ortacı yok.

  const managerDays = new Map<string, Set<string>>()
  for (const m of managers) {
    const dayMap = slotMap.get(m.id)!
    const workedDays = weekDays.filter((d) => dayMap.has(d))
    const open = weekDays.filter((d) => canWork(m, d))
    const restCost = new Map(open.map((d) => {
      const others = managers.filter((o) => o !== m && managerDays.get(o.id)?.has(d)).length
      return [d,
        (others === 0 ? 1000 : others === 1 ? 10 : 0) -
        (hasPendingLeave(m, d) ? 5 : 0) -
        (wasOffLastWeek(m, d) ? 2 : 0) +
        rng()]
    }))

    let best: { days: Set<string>; cost: number } | null = null
    for (let mask = 0; mask < 1 << open.length; mask++) {
      const rest = open.filter((_, i) => mask & (1 << i))
      const days = new Set([...workedDays, ...open.filter((_, i) => !(mask & (1 << i)))])
      if (days.size > maxDays(m)) continue
      // Yeni atanacak her gün için seri sınırı (çalışılmış günlerin eski ihlali hesaba katılmaz)
      if (open.some((d) => days.has(d) &&
        runAt(weekDays, (x) => days.has(x), weekDays.indexOf(d), m.prevStreak) > MAX_CONSECUTIVE_DAYS)) continue
      // Önce en az izin günü, sonra en düşük maliyet
      const cost = rest.length * 100_000 + rest.reduce((s, d) => s + restCost.get(d)!, 0)
      if (!best || cost < best.cost) best = { days, cost }
    }
    managerDays.set(m.id, best?.days ?? new Set(workedDays))
  }

  const managersOn = (dateStr: string) => managers.filter((m) => managerDays.get(m.id)!.has(dateStr))
  const lean = (m: PlannerEmployee) => getKindCount(m.id, 'opening') - getKindCount(m.id, 'closing')

  for (const dateStr of shuffled(weekDays).sort((a, b) => managersOn(a).length - managersOn(b).length)) {
    const dayKinds = () => managers
      .map((m) => slotMap.get(m.id)!.get(dateStr))
      .filter((x): x is Slot => !!x)
      .map((x) => x.def.kind)
    // Çalışılmış (sabit) vardiyalar zaten yerinde; kalanlar eksik tarafı tamamlar
    const present = shuffled(managersOn(dateStr).filter((m) => !slotMap.get(m.id)!.has(dateStr)))
    const needOpen  = !dayKinds().some(isOpeningKind)
    const needClose = !dayKinds().some(isClosingKind)
    if (present.length === 0) {
      if ((needOpen || needClose) && managers.length > 0) {
        warnings.push({ level: 'error', message: `${dateStr} tarihinde yönetici atanamadı: ${explain(managers, dateStr, 'full')}.` })
      }
      continue
    }

    if (present.length === 1) {
      const m = present[0]
      const keys: ShiftKey[] = needOpen && needClose ? ['full', 'opening', 'closing']
        : needOpen ? ['opening', 'full']
        : needClose ? ['closing', 'full']
        : lean(m) > 0 ? ['closing', 'opening'] : ['opening', 'closing']
      const reason = needOpen && needClose ? 'Tek yönetici — full vardiya' : 'Yönetici kapsaması (diğer yönetici bu gün çalıştı)'
      keys.some((k) => place(m, dateStr, k, reason))
      continue
    }

    // Açılışa en çok kapanış almış olan, kapanışa en çok açılış almış olan; aradakiler dengeye göre
    const sorted = [...present].sort((a, b) =>
      lean(a) - lean(b) ||
      Number(sameAsLastWeek(a, dateStr, 'opening')) - Number(sameAsLastWeek(b, dateStr, 'opening'))
    )
    sorted.forEach((m, i) => {
      const key: ShiftKey =
        i === 0 && needOpen ? 'opening'
        : i === sorted.length - 1 && needClose ? 'closing'
        : lean(m) > 0 ? 'closing' : 'opening'
      const reason = key === 'opening' ? 'Yönetici açılış' : 'Yönetici kapanış'
      if (!place(m, dateStr, key, reason)) {
        const alt: ShiftKey = key === 'opening' ? 'closing' : 'opening'
        place(m, dateStr, alt, alt === 'opening' ? 'Yönetici açılış' : 'Yönetici kapanış')
      }
    })
    // Saat limiti yüzünden bir taraf boş kaldıysa biri full'e çıkar
    if (!dayKinds().some(isOpeningKind) || !dayKinds().some(isClosingKind)) {
      present.some((m) => slotMap.get(m.id)!.has(dateStr) &&
        replace(m, dateStr, 'full', 'Diğer yönetici saat limitinde — full vardiya'))
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 2: Görsel Uzman & Depo — Pzt–Cum 08:00–17:00, Cmt 08:00–14:00, Pazar izin
  // ═══════════════════════════════════════════════════════════════════════════

  for (const emp of fixedCrew) {
    for (const dateStr of weekDays) {
      if (dowKey(dateStr) === GORSEL_DEPO_SHORT_DOW) {
        place(emp, dateStr, 'earlyShort', 'Görsel/Depo Cumartesi kısa mesai (08:00–14:00)', true)
      } else {
        place(emp, dateStr, 'early', 'Görsel/Depo mesaisi (08:00–17:00)', true)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 3: Perşembe etiket yenileme — 2 çalışan daha 08:00'de başlar
  // ═══════════════════════════════════════════════════════════════════════════

  const labelDay = weekDays.find((d) => dowKey(d) === LABEL_DAY_DOW)
  if (labelDay) {
    // Öncelik: FT satış/reyon → PT satış/reyon → diğerleri → kasiyerler en son
    const rank = (e: PlannerEmployee) =>
      (hasPendingLeave(e, labelDay) ? 10 : 0) +
      (satisDanismanlari.includes(e) ? 0 : kasiyerler.includes(e) ? 4 : 2) +
      (e.employment_type === 'full_time' ? 0 : 1)
    const crew = shuffled(flexible.filter((e) => canPlace(e, labelDay, 'early')))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, LABEL_DAY_EXTRA_STAFF)
    for (const emp of crew) {
      place(emp, labelDay, 'early', 'Perşembe etiket yenileme (08:00)', true)
    }
    if (crew.length < LABEL_DAY_EXTRA_STAFF) {
      warnings.push({
        level: 'warning',
        message: `${labelDay}: Etiket yenileme için ${LABEL_DAY_EXTRA_STAFF} ek çalışan 08:00'e atanamadı (${crew.length} atandı).`,
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 4: FT Kasiyer — Perşembe full tercih
  // ═══════════════════════════════════════════════════════════════════════════

  if (labelDay) {
    for (const kFT of kasiyerler.filter((e) => e.employment_type === 'full_time')) {
      place(kFT, labelDay, 'full', 'FT kasiyer Perşembe full vardiya tercihi')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 5: Günlük minimum kapsama
  // ═══════════════════════════════════════════════════════════════════════════
  // Kasiyer: her gün ≥1 opening + ≥1 closing, toplam ≥2
  // Satış danışmanı: hafta içi ≥1 opening, her gün ≥1 closing, hafta sonu ≥1 ortacı
  // Günler karışık sırayla işlenir; sabit sıra, az kişili gruplarda (ör. tek FT kasiyer)
  // izin gününü her hafta aynı güne düşürür.

  for (const dateStr of shuffled(weekDays)) {
    const dow = dowKey(dateStr)
    const isWeekend = dow === 'saturday' || dow === 'sunday'

    if (!kindsOnDay(kasiyerler, dateStr).some(isOpeningKind)) {
      const c = pickCandidate(kasiyerler, dateStr, 'opening')
      if (c) place(c, dateStr, 'opening', `Günlük minimum kasiyer açılış (${dow})`)
      else warnings.push({ level: 'error', message: `${dateStr} tarihinde açılış kasiyeri atanamadı: ${explain(kasiyerler, dateStr, 'opening')}.` })
    }

    if (!kindsOnDay(kasiyerler, dateStr).some(isClosingKind)) {
      const c = pickCandidate(kasiyerler, dateStr, 'closing')
      if (c) place(c, dateStr, 'closing', `Günlük minimum kasiyer kapanış (${dow})`)
      else warnings.push({ level: 'error', message: `${dateStr} tarihinde kapanış kasiyeri atanamadı: ${explain(kasiyerler, dateStr, 'closing')}.` })
    }

    if (kindsOnDay(kasiyerler, dateStr).length < 2) {
      const c = pickCandidate(kasiyerler, dateStr, 'closing') ?? pickCandidate(kasiyerler, dateStr, 'opening')
      if (c) {
        const key: ShiftKey = getKindCount(c.id, 'closing') > getKindCount(c.id, 'opening') ? 'opening' : 'closing'
        if (!place(c, dateStr, key, `Günlük minimum 2 kasiyer (${dow})`)) {
          place(c, dateStr, key === 'opening' ? 'closing' : 'opening', `Günlük minimum 2 kasiyer (${dow})`)
        }
      } else {
        warnings.push({ level: 'error', message: `${dateStr} tarihinde minimum 2 kasiyer şartı karşılanamıyor: ${explain(kasiyerler, dateStr, 'opening')}.` })
      }
    }

    if (!isWeekend && !kindsOnDay(satisDanismanlari, dateStr).some(isOpeningKind)) {
      const c = pickCandidate(satisDanismanlari, dateStr, 'opening')
      if (c) place(c, dateStr, 'opening', `Hafta içi açılış Satış Danışmanı (${dow})`)
      else if (satisDanismanlari.length > 0) {
        warnings.push({ level: 'error', message: `${dateStr} tarihinde hafta içi açılış Satış Danışmanı atanamadı: ${explain(satisDanismanlari, dateStr, 'opening')}.` })
      }
    }

    if (!kindsOnDay(satisDanismanlari, dateStr).some(isClosingKind)) {
      const c = pickCandidate(satisDanismanlari, dateStr, 'closing')
      if (c) place(c, dateStr, 'closing', `Günlük minimum kapanış Satış Danışmanı (${dow})`)
    }

    if (isWeekend && !kindsOnDay(satisDanismanlari, dateStr).includes('mid')) {
      const c = pickCandidate(satisDanismanlari, dateStr, 'mid')
      if (c) place(c, dateStr, 'mid', 'Hafta sonu Satış Danışmanı ortacı tercihi')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 6: Kalan günleri doldur (FT 6 gün, PT 4 gün)
  // ═══════════════════════════════════════════════════════════════════════════
  // Çalışanlar sırayla birer gün alır (round-robin) ki izin günleri yayılsın.
  // Gün seçimi: en az personelli gün (yoğun günler 1 kişi fazlasını hedefler).
  // Tür seçimi: çalışanın açılış/kapanış farkı ≥2 ise dengeleyen tür;
  //             değilse o gün hangi tarafta daha az kişi varsa o tür.

  function dayLoad(dateStr: string): number {
    return kindsOnDay(flexible, dateStr).length - (HEAVY_DAYS.has(dowKey(dateStr)) ? 1 : 0)
  }

  function kindOrder(emp: PlannerEmployee, dateStr: string): ShiftKey[] {
    const dow = dowKey(dateStr)
    const isWeekend = dow === 'saturday' || dow === 'sunday'
    const dayKinds = kindsOnDay(flexible, dateStr)
    const dayOpen  = dayKinds.filter(isOpeningKind).length
    const dayClose = dayKinds.filter(isClosingKind).length
    const ownOpen  = getKindCount(emp.id, 'opening')
    const ownClose = getKindCount(emp.id, 'closing')

    let order: ShiftKey[]
    if (ownOpen - ownClose >= 2)      order = ['closing', 'opening']
    else if (ownClose - ownOpen >= 2) order = ['opening', 'closing']
    else if (dayOpen !== dayClose) order = dayOpen < dayClose ? ['opening', 'closing'] : ['closing', 'opening']
    // Eşitlikte geçen haftanın tersi; o da yoksa rastgele
    else if (emp.lastWeek?.[dow] === 'opening') order = ['closing', 'opening']
    else if (emp.lastWeek?.[dow] === 'closing') order = ['opening', 'closing']
    else order = rng() < 0.5 ? ['opening', 'closing'] : ['closing', 'opening']

    if (isWeekend && satisDanismanlari.includes(emp) && !dayKinds.includes('mid')) {
      order = ['mid', ...order]
    }
    return order
  }

  function fillOneDay(emp: PlannerEmployee): boolean {
    // Geçen hafta izinli olunan gün bu hafta çalışmaya yatkın → izin günü kayar
    // Bekleyen izin günü en sona kalır (onaylanırsa vardiya düşer)
    const score = (d: string) =>
      dayLoad(d) - (wasOffLastWeek(emp, d) ? 0.5 : 0) + (hasPendingLeave(emp, d) ? 100 : 0)
    const days = shuffled(weekDays.filter((d) => canWork(emp, d)))
      .sort((a, b) => score(a) - score(b))
    for (const dateStr of days) {
      for (const key of kindOrder(emp, dateStr)) {
        const reason = emp.employment_type === 'full_time'
          ? `FT haftalık plan (${SHIFTS[key].label})`
          : `PT haftalık plan (${SHIFTS[key].label})`
        if (place(emp, dateStr, key, reason)) return true
      }
    }
    return false
  }

  const pending = new Set(flexible)
  while (pending.size > 0) {
    for (const emp of shuffled([...pending])) {
      if (getEmpDays(emp.id) >= maxDays(emp) || !fillOneDay(emp)) pending.delete(emp)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 7: FT haftalık hedef saat tamamlama
  // ═══════════════════════════════════════════════════════════════════════════
  // Her FT için günlerin vardiyası katalogdaki varyantlarla
  // (açılış → full; kapanış → kısa/uzun kapanış veya full) değiştirilerek
  // haftalık hedefi (weeklyTargetMins) aşmayan en yüksek toplam aranır. Eşitlikte en az
  // değişiklik, sonra full'lerin yoğun günlere düşmesi tercih edilir.
  // İzin günleri hedeften düşüldüğü için izinli hafta kalan günlere yığılmaz.

  for (const emp of [...managers, ...flexible]) {
    if (emp.employment_type !== 'full_time') continue
    const dayMap = slotMap.get(emp.id)!
    const target = weeklyTargetMins(emp)
    if (getEmpMins(emp.id) >= target) continue

    const entries = [...dayMap.entries()]
    // Kilitli (ve 'fixed') vardiyalar tek seçenek olarak kalır
    const options: Array<Array<{ key: Slot['key']; net: number }>> = entries.map(([dateStr, slot]) => {
      if (slot.locked || slot.key === 'fixed') return [{ key: slot.key, net: slot.net }]
      const variants = TOPUP_VARIANTS[slot.key] ?? [slot.key]
      // Karıştırma: eşit derecede iyi kombinasyonlardan (hangi gün full vb.) rastgele biri seçilir
      return shuffled(variants.filter((k) =>
        k === slot.key || fitsAvailabilityWindow(emp, dateStr, SHIFTS[k].start, SHIFTS[k].end)
      )).map((k) => ({ key: k, net: SHIFT_NET[k] }))
    })

    let best = { total: -1, changes: Infinity, lightFulls: Infinity, keys: [] as Array<Slot['key']> }
    const current: Array<Slot['key']> = []
    const search = (i: number, total: number, changes: number, lightFulls: number) => {
      if (total > target) return
      if (i === entries.length) {
        if (
          total > best.total ||
          (total === best.total && changes < best.changes) ||
          (total === best.total && changes === best.changes && lightFulls < best.lightFulls)
        ) {
          best = { total, changes, lightFulls, keys: [...current] }
        }
        return
      }
      const [dateStr, slot] = entries[i]
      for (const { key: k, net } of options[i]) {
        current.push(k)
        search(
          i + 1,
          total + net,
          changes + (k === slot.key ? 0 : 1),
          lightFulls + (k === 'full' && k !== slot.key && !HEAVY_DAYS.has(dowKey(dateStr)) ? 1 : 0),
        )
        current.pop()
      }
    }
    search(0, 0, 0, 0)

    // Saati azaltan değişiklikler önce uygulanır; aksi halde ara toplam 45s'i aşıp reddedilir
    // Değişen günler hep kilitsiz katalog vardiyalarıdır ('fixed' tek seçenekli)
    entries
      .map(([dateStr, slot], i) => ({ dateStr, from: slot.key as ShiftKey, to: best.keys[i] as ShiftKey }))
      .filter((c) => c.to && c.to !== c.from)
      .sort((a, b) => (SHIFT_NET[a.to] - SHIFT_NET[a.from]) - (SHIFT_NET[b.to] - SHIFT_NET[b.from]))
      .forEach(({ dateStr, to }) => {
        replace(emp, dateStr, to, `FT 45 saat tamamlama (${SHIFTS[to].label} ${SHIFTS[to].start}–${SHIFTS[to].end})`)
      })
  }

  let ftDeficit = 0
  for (const emp of employees) {
    if (emp.employment_type !== 'full_time') continue
    const finalMins = getEmpMins(emp.id)
    const target = weeklyTargetMins(emp)
    ftDeficit += Math.max(0, target - finalMins)
    if (finalMins < target - 60) {
      const h = (mins: number) => Math.round(mins / 60 * 10) / 10
      warnings.push({
        level: 'info',
        message: `${emp.full_name}: ${h(target)} saat hedefine ulaşılamadı (${h(finalMins)}s, ${getEmpDays(emp.id)} gün)`
          + `${target < FT_MAX_MINS ? ' — izin/müsait olmayan günler hedeften düşüldü' : ''}. Availability veya izin kısıtlaması olabilir.`,
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FAZ 8: Sonuçları derle
  // ═══════════════════════════════════════════════════════════════════════════

  const allAssignments: DraftAssignment[] = []
  const stats: Record<string, EmployeeDraftStats> = {}

  for (const emp of employees) {
    const empAssignments = [...slotMap.get(emp.id)!.values()]
      .map((x) => x.assignment)
      .sort((a, b) => a.work_date.localeCompare(b.work_date))
    allAssignments.push(...empAssignments)

    stats[emp.id] = {
      employeeId:      emp.id,
      employeeName:    emp.full_name,
      employment_type: emp.employment_type,
      totalMins:       empAssignments.reduce((s, a) => s + netWorkMins(a.start_time, a.end_time), 0),
      workDays:        empAssignments.length,
      openingCount:    empAssignments.filter((a) => a.shift_kind === 'opening').length,
      closingCount:    empAssignments.filter((a) => a.shift_kind === 'closing').length,
      fullCount:       empAssignments.filter((a) => a.shift_kind === 'full').length,
      assignments:     empAssignments,
    }
  }

  // Bağımsız validator
  warnings.push(...validatePlan(allAssignments, employees, weekDays))

  // Tekrar eden uyarıları kaldır
  const uniqueWarnings = warnings.filter(
    (w, i, arr) => arr.findIndex((x) => x.message === w.message) === i
  )

  // Hard violation: herhangi bir 'error' uyarısı varsa plan geçersiz
  const hasHardViolation = uniqueWarnings.some((w) => w.level === 'error')

  return {
    result: {
      weekStart,
      weekEnd,
      weekDays,
      assignments: allAssignments,
      stats,
      warnings: uniqueWarnings,
      hasHardViolation,
      seed,
    },
    ftDeficit,
    rosterWarnings,
  }
}

// ─── Bağımsız Validator ──────────────────────────────────────────────────────

/**
 * validatePlan — Planın tamamını bağımsız olarak kontrol eder.
 *
 * runPlanner() çalıştıktan sonra çağrılır.
 * Planlama mantığından bağımsız olarak tüm hard constraint'leri doğrular.
 * Yalnızca çalışılmış (worked) vardiyalardan kaynaklanan ihlaller plan
 * tarafından değiştirilemeyeceği için 'error' değil 'warning' olarak raporlanır.
 *
 * Kontroller:
 *   1. FT çalışan haftalık net saat ≤ 45s
 *   2. FT çalışan haftalık gün ≤ 6
 *   3. PT çalışan haftalık net saat ≤ 30s
 *   4. PT çalışan haftalık gün ≤ 4
 *   5. Sabit izin günü ihlali (Müdür Salı, Görsel/Depo Pazar)
 *   6. Onaylı izin günü ihlali
 *   7. Aynı çalışana aynı gün çakışan iki atama
 *   8. Her gün ≥1 opening kasiyer, ≥1 closing kasiyer, toplam ≥2 kasiyer
 *   9. Her gün opening + closing'de yönetici
 *  10. Müdür/Yardımcı ortacı alma yasağı
 *  11. (uyarı) Tüm hafta aynı vardiya türü (hep açılış / hep kapanış)
 *  12. Ardışık günler arası asgari dinlenme
 *  13. Geçen haftayla birlikte en fazla 6 ardışık iş günü (Md. 46)
 */
export function validatePlan(
  assignments: DraftAssignment[],
  employees: PlannerEmployee[],
  weekDays: string[],
): PlanWarning[] {
  const warnings: PlanWarning[] = []
  const WORKED_NOTE = ' (çalışılmış vardiya — plan değiştiremez)'
  /** İhlalin tüm vardiyaları çalışılmışsa uyarı, değilse hata */
  const report = (involved: DraftAssignment[], message: string) => {
    const workedOnly = involved.length > 0 && involved.every((a) => a.worked)
    warnings.push(workedOnly
      ? { level: 'warning', message: message.replace(/\.$/, '') + WORKED_NOTE + '.' }
      : { level: 'error', message })
  }

  // Çalışan lookup
  const empById = new Map(employees.map((e) => [e.id, e]))
  const storeManagerId = classifyManagers(employees).storeManager?.id
  const minRestMins = getWorkingTimeConfig().minRestHours * 60

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
      report(empAssigns, `${emp.full_name}: FT haftalık saat limiti aşıldı (${totalHours}s > 45s).`)
    }

    // 2. FT gün limiti
    if (emp.employment_type === 'full_time' && workDays.size > FT_MAX_DAYS) {
      report(empAssigns, `${emp.full_name}: FT haftalık gün limiti aşıldı (${workDays.size} gün > 6 gün).`)
    }

    // 3. PT saat limiti
    if (emp.employment_type === 'part_time' && totalMins > PT_MAX_MINS) {
      report(empAssigns, `${emp.full_name}: PT haftalık saat limiti aşıldı (${totalHours}s > ${PART_TIME_RULES.maxWeeklyHours}s).`)
    }

    // 4. PT gün limiti
    if (emp.employment_type === 'part_time' && workDays.size > PT_MAX_DAYS) {
      report(empAssigns, `${emp.full_name}: PT haftalık gün limiti aşıldı (${workDays.size} gün > ${PART_TIME_RULES.maxWeeklyDays} gün).`)
    }

    for (const a of empAssigns) {
      // 5. Sabit izin günü ihlali
      if (isFixedDayOff(emp, a.work_date, storeManagerId)) {
        report([a], emp.id === storeManagerId
          ? `${emp.full_name}: Müdür Salı günü çalışamaz (${a.work_date}).`
          : `${emp.full_name}: ${a.work_date} Pazar günü çalışamaz.`)
      }

      // 6. Onaylı izin günü ihlali
      if (emp.leaveDays.has(a.work_date)) {
        report([a], `${emp.full_name}: İzin günü (${a.work_date}) vardiyaya atanmış.`)
      }

      // 6b. 18 yaş altı korumaları
      for (const msg of minorViolations(emp, a.work_date, a.start_time, a.end_time)) {
        report([a], `${emp.full_name} (${a.work_date}): ${msg}`)
      }

      // 10. Müdür/Yardımcı ortacı alma yasağı
      if (isManagerRole(emp) && a.shift_kind === 'mid') {
        report([a], `${emp.full_name}: Yönetici ortacı (mid) vardiya alamaz (${a.work_date}).`)
      }
    }

    // 7. Aynı gün çakışan iki atama
    const dateCount = new Map<string, number>()
    for (const a of empAssigns) {
      dateCount.set(a.work_date, (dateCount.get(a.work_date) ?? 0) + 1)
    }
    for (const [date, count] of dateCount) {
      if (count > 1) {
        report(empAssigns.filter((a) => a.work_date === date), `${emp.full_name}: ${date} tarihinde çakışan ${count} atama var.`)
      }
    }

    // 12. Ardışık günler arası asgari dinlenme
    const sorted = [...empAssigns].sort((a, b) => a.work_date.localeCompare(b.work_date))
    if (sorted[0]?.work_date === weekDays[0] && emp.prevDayEndMins !== undefined) {
      const rest = toMins(sorted[0].start_time) - emp.prevDayEndMins
      if (rest < minRestMins) {
        report([sorted[0]], `${emp.full_name}: geçen haftanın son vardiyası → ${weekDays[0]} ${sorted[0].start_time} arası dinlenme ${Math.round(rest / 6) / 10}s (min. ${minRestMins / 60}s).`)
      }
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i]
      const next = sorted[i + 1]
      const dayGap = Math.round((new Date(next.work_date).getTime() - new Date(curr.work_date).getTime()) / 86_400_000)
      if (dayGap !== 1) continue
      const rest = 1440 - toMins(curr.end_time) + toMins(next.start_time)
      if (rest < minRestMins) {
        report([curr, next], `${emp.full_name}: ${curr.work_date} ${curr.end_time} → ${next.work_date} ${next.start_time} arası dinlenme ${Math.round(rest / 6) / 10}s (min. ${minRestMins / 60}s).`)
      }
    }

    // 13. Md. 46 — geçen haftanın sonuyla birlikte ardışık iş günü
    if (weekDays.length > 0) {
      const run = longestRun(weekDays, (d) => workDays.has(d), emp.prevStreak)
      if (run.length > MAX_CONSECUTIVE_DAYS) {
        const start = run.startIdx >= 0 ? weekDays[run.startIdx] : addDaysToDateString(weekDays[0], run.startIdx)
        const inRun = empAssigns.filter((a) => {
          const i = weekDays.indexOf(a.work_date)
          return i >= Math.max(0, run.startIdx) && i <= run.endIdx
        })
        report(inRun,
          `${emp.full_name}: ${start} – ${weekDays[run.endIdx]} arası ${run.length} gün ardışık çalışma`
          + `${run.startIdx < 0 ? ' (geçen haftayla birlikte)' : ''}. İş Kanunu Md. 46 gereği 7 günde bir hafta tatili verilmeli.`)
      }
    }

    // 11. Tüm hafta aynı tür (görsel/depo sabit kalıp hariç)
    if (!isFixedCrew(emp) && empAssigns.length >= 4) {
      const kinds = new Set(empAssigns.map((a) => a.shift_kind))
      if (kinds.size === 1) {
        warnings.push({
          level: 'warning',
          message: `${emp.full_name}: Tüm hafta aynı vardiya türünde (${[...kinds][0]}).`,
        })
      }
    }
  }

  // 8. Her gün kasiyer minimum ihtiyacı
  const kasiyerIds = new Set(
    employees.filter((e) => !isManagerRole(e) && positionIs(e.position, POS_KASIYER)).map((e) => e.id)
  )
  for (const dateStr of weekDays) {
    const kasiyerAssigns = assignments.filter((a) => kasiyerIds.has(a.employee_id) && a.work_date === dateStr)

    const total   = kasiyerAssigns.length
    const opening = kasiyerAssigns.filter((a) => isOpeningKind(a.shift_kind)).length
    const closing = kasiyerAssigns.filter((a) => isClosingKind(a.shift_kind)).length

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
  const managerIds = new Set(employees.filter(isManagerRole).map((e) => e.id))
  for (const dateStr of weekDays) {
    const dayAssigns = assignments.filter((a) => a.work_date === dateStr && managerIds.has(a.employee_id))

    if (!dayAssigns.some((a) => isOpeningKind(a.shift_kind))) {
      warnings.push({ level: 'error', message: `${dateStr}: Açılışta yönetici (Müdür/Müdür Yardımcısı) yok.` })
    }
    if (!dayAssigns.some((a) => isClosingKind(a.shift_kind))) {
      warnings.push({ level: 'error', message: `${dateStr}: Kapanışta yönetici (Müdür/Müdür Yardımcısı) yok.` })
    }
  }

  return warnings
}

