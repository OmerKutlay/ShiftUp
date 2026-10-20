/**
 * UI stüdyosu — tarayıcının çağırdığı tüm /api/* uçlarının sahte yanıtları.
 *
 * Veritabanı olmadan her sayfayı "dolu" ve gerçekçi göstermek için tasarlandı:
 *   - "Bugün" gerçek tarihe (Europe/Istanbul) göre hesaplanır; plan, devam ve izinler
 *     hep güncel görünür. Bugünün devam durumları mockOptions.demoTime saatine göre üretilir
 *     (varsayılan 15:40 — açılış/kapanış ekipleri aynı anda içeride, dolu bir an).
 *   - Veri deterministiktir (tarih + çalışan anahtarıyla tohumlanan sözde-rastgele üreteç):
 *     aynı gün aynı ekran görüntüsü.
 *   - Yanıt şekilleri src/app/api/** route'larının döndürdüğü JSON ile birebir aynıdır.
 *
 * Saf modül: çalışma zamanında hiçbir uygulama kodu içe aktarılmaz (yalnızca `import type`).
 */
import type { AccessLevel } from '../../src/lib/auth/roles'
import type { AttendanceRecord, AttendanceStatus, DailyShiftEntry } from '../../src/types/attendance'
import type { EmploymentType, Role } from '../../src/types/employee'
import type { ShiftTemplate } from '../../src/types/shiftTemplate'
import type { ShiftAssignmentWithDetails } from '../../src/types/schedule'
import type { LeaveRequest, LeaveStatus, LeaveType } from '../../src/types/leave'
import type { Notification, NotificationType } from '../../src/types/notification'
import type { DayOfWeek, EmployeeAvailability, OpenShift, ShiftSwapRequest, SwapStatus } from '../../src/types/workforce'
import type { TimeCorrectionRequest, TimeCorrectionStatus } from '../../src/types/timeCorrection'
import type { PublicHoliday } from '../../src/types/holiday'
import type { StoreLocation } from '../../src/types/location'
import type { AttendanceReportRow, AttendanceReportStatus } from '../../src/types/report'
import type { GenerateQrResponse, ProcessQrResponse, QrActionType } from '../../src/types/qr'
import type { TimesheetCode, TimesheetRow } from '../../src/lib/timesheet'
import type { OvertimeSummary, OvertimeWeek } from '../../src/lib/overtime'
import type { DraftAssignment, EmployeeDraftStats, PlannerResult, PlanWarning, ShiftKind } from '../../src/lib/workforcePlanner'
import type { DaySummary, EmployeeWeekSummary, WorkingTimeViolation } from '../../src/lib/workingTimeService'
import type { PushDiagnosticStep } from '../../src/lib/pushDiagnostics'
import type { AnnualLeaveBalance } from '../../src/lib/annualLeave'

// ═════════════════════════════════════════════════════════════
// Dış arayüz
// ═════════════════════════════════════════════════════════════

export type Persona = 'manager' | 'employee'
export interface MockResult { status: number; body: unknown }

/** Çekim öncesi değiştirilebilir ayarlar */
export const mockOptions = {
  /** Bugünün devam durumları için "şimdi" (İstanbul saati, 'HH:MM'); 'real' → gerçek saat */
  demoTime: '15:40' as string,
  /** /api/push/config — true ise "Bildirimleri aç" kartları görünür */
  pushEnabled: false,
}

/** Personaların çalışan id'leri (çerez / fixture eşlemesi için) */
export const PERSONA_EMPLOYEE_IDS: Record<Persona, string> = {
  manager: empId(1),
  employee: empId(5),
}

/** Returns null if the endpoint is unknown. `url` is the full request URL; `body` is the parsed JSON request body for non-GET (or null). */
export function mockApiResponse(method: string, url: URL, persona: Persona, body: unknown): MockResult | null {
  const m = method.toUpperCase()
  const path = url.pathname.replace(/\/+$/, '') || '/'
  for (const route of ROUTES) {
    if (route.method !== m) continue
    const params = matchPath(route.path, path)
    if (!params) continue
    const ctx = makeCtx(persona)
    if (route.minAccess && !hasAccess(ctx.me.role.access_level, route.minAccess)) {
      return json({ error: 'Bu işlem için yetkiniz yok.', code: 'FORBIDDEN' }, 403)
    }
    return route.handler({ ctx, url, q: url.searchParams, params, body: (body ?? null) as Body })
  }
  return null
}

// ═════════════════════════════════════════════════════════════
// Zaman yardımcıları (Europe/Istanbul = sabit UTC+3)
// ═════════════════════════════════════════════════════════════

const TZ_OFFSET_MIN = 180
const DAY_MS = 86_400_000

const pad2 = (n: number) => String(n).padStart(2, '0')
const dateMs = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
const addDays = (d: string, n: number) => new Date(dateMs(d) + n * DAY_MS).toISOString().slice(0, 10)
/** 0 = Pazartesi … 6 = Pazar */
const dow = (d: string) => (new Date(dateMs(d)).getUTCDay() + 6) % 7
const mondayOf = (d: string) => addDays(d, -dow(d))
const diffDays = (a: string, b: string) => Math.round((dateMs(b) - dateMs(a)) / DAY_MS)
const toMin = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m }
const hhmm = (min: number) => { const m = ((min % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}` }
const hhmmss = (min: number) => `${hhmm(min)}:00`
/** İstanbul yerel tarih + gün başından dakika → ISO (UTC) */
const isoAt = (date: string, min: number) => new Date(dateMs(date) + (min - TZ_OFFSET_MIN) * 60_000).toISOString()
const isValidDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(dateMs(v))
const isoMinutesAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()

function istanbulNow(): { date: string; minutes: number } {
  const d = new Date(Date.now() + TZ_OFFSET_MIN * 60_000)
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${month}-${pad2(i + 1)}`)
}

const trDate = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Intl.DateTimeFormat('tr-TR', { ...opts, timeZone: 'UTC' }).format(new Date(dateMs(d)))

// ═════════════════════════════════════════════════════════════
// Deterministik sözde-rastgele üreteç
// ═════════════════════════════════════════════════════════════

function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

function rngFor(key: string): () => number {
  let a = hashStr(key)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const randInt = (r: () => number, min: number, max: number) => min + Math.floor(r() * (max - min + 1))

// ═════════════════════════════════════════════════════════════
// Kimlikler (UUID biçimli, okunabilir)
// ═════════════════════════════════════════════════════════════

function empId(n: number) { return `00000000-0000-4000-a000-${String(n).padStart(12, '0')}` }
const roleId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const tplId = (n: number) => `00000000-0000-0000-0001-${String(n).padStart(12, '0')}`
const daySuffix = (n: number, date: string) => `${pad2(n)}${date.replace(/-/g, '')}00`
const shiftId = (n: number, date: string) => `5a000000-0000-4000-8000-${daySuffix(n, date)}`
const attId = (n: number, date: string) => `a7000000-0000-4000-8000-${daySuffix(n, date)}`
const restLeaveId = (n: number, date: string) => `1e000000-0000-4000-8000-${daySuffix(n, date)}`
const seqId = (prefix: string, i: number) => `${prefix}000000-0000-4000-8000-${String(i).padStart(12, '0')}`

// ═════════════════════════════════════════════════════════════
// Roller (supabase/migrations/20261019100000_role_based_access_and_planning.sql)
// ═════════════════════════════════════════════════════════════

const ROLE_CREATED = '2026-09-28T07:00:00.000Z'
const role = (n: number, name: string, description: string, access_level: AccessLevel, planning_group: Role['planning_group'], sort_order: number): Role =>
  ({ id: roleId(n), name, description, access_level, planning_group, sort_order, created_at: ROLE_CREATED })

const R = {
  admin: role(1, 'Admin', 'Tam sistem erişimi — vardiya planına girmez', 'admin', null, 0),
  adminCashier: role(10, 'Admin · Kasiyer', 'Tam sistem erişimi — kasiyer olarak planlanır', 'admin', 'cashier', 1),
  adminSales: role(11, 'Admin · Satış Danışmanı', 'Tam sistem erişimi — satış danışmanı olarak planlanır', 'admin', 'sales', 2),
  storeManager: role(2, 'Mağaza Müdürü', 'Mağaza yönetimi, ayarlar ve planlama', 'store_manager', 'store_manager', 10),
  assistant: role(3, 'Müdür Yardımcısı', 'Yönetici yetkisi — açılış/kapanış yönetici kapsaması', 'manager', 'assistant_manager', 20),
  floorLead: role(9, 'Reyon Sorumlusu', 'Yönetici yetkisi — açılış/kapanış yönetici kapsaması', 'manager', 'floor_lead', 30),
  visual: role(8, 'Görsel Uzmanı', 'Yönetici yetkisi — görsel düzen, 08:00 sabit mesai', 'manager', 'visual', 40),
  cashier: role(6, 'Kasiyer', 'Çalışan — kasa', 'employee', 'cashier', 50),
  sales: role(4, 'Satış Danışmanı', 'Çalışan — satış katı', 'employee', 'sales', 60),
  stock: role(7, 'Depo Çalışanı', 'Çalışan — depo, 08:00 sabit mesai', 'employee', 'stock', 70),
  kiosk: role(5, 'Kiosk', 'QR kiosk cihazı — yalnızca kiosk ekranı', 'kiosk', null, 200),
}
const ROLES: Role[] = Object.values(R).sort((a, b) => a.sort_order - b.sort_order)

const ACCESS_RANK: Record<AccessLevel, number> = { kiosk: -1, employee: 0, manager: 1, store_manager: 2, admin: 3 }
const hasAccess = (level: AccessLevel, min: AccessLevel) => ACCESS_RANK[level] >= ACCESS_RANK[min]

// ═════════════════════════════════════════════════════════════
// Vardiya şablonları
// ═════════════════════════════════════════════════════════════

type TplKey = 'AC' | 'UAC' | 'ORT' | 'KAP' | 'UKAP' | 'FULL' | 'ERK' | 'PTA' | 'PTS' | 'SAY'

interface TplDef { key: TplKey; n: number; name: string; start: string; end: string; description: string | null; active: boolean }

const TEMPLATE_DEFS: Record<TplKey, TplDef> = {
  AC: { key: 'AC', n: 1, name: 'Açılış', start: '10:00', end: '18:00', description: 'Mağaza açılışı, kasa açılış sayımı', active: true },
  ORT: { key: 'ORT', n: 2, name: 'Ortacı', start: '12:00', end: '20:00', description: 'Öğle ve akşamüstü yoğunluğu', active: true },
  KAP: { key: 'KAP', n: 3, name: 'Kapanış', start: '14:00', end: '22:00', description: 'Kasa kapanışı ve mağaza kapanışı', active: true },
  UAC: { key: 'UAC', n: 4, name: 'Uzun Açılış', start: '10:00', end: '19:00', description: 'Yönetici açılış kapsaması', active: true },
  UKAP: { key: 'UKAP', n: 5, name: 'Uzun Kapanış', start: '13:00', end: '22:00', description: 'Yönetici kapanış kapsaması', active: true },
  FULL: { key: 'FULL', n: 6, name: 'Full', start: '10:00', end: '22:00', description: 'Açılıştan kapanışa — kampanya günleri', active: true },
  ERK: { key: 'ERK', n: 7, name: 'Erken (08:00)', start: '08:00', end: '16:00', description: 'Depo mal kabul ve görsel düzen — sabit mesai', active: true },
  PTS: { key: 'PTS', n: 8, name: 'Yarı Zamanlı Sabah', start: '10:00', end: '15:00', description: 'Yarı zamanlı — öğle yoğunluğu', active: true },
  PTA: { key: 'PTA', n: 9, name: 'Yarı Zamanlı Akşam', start: '17:00', end: '22:00', description: 'Yarı zamanlı — akşam yoğunluğu', active: true },
  SAY: { key: 'SAY', n: 10, name: 'Gece Sayımı', start: '22:00', end: '06:00', description: 'Yıllık envanter sayımı (yalnızca sayım gecesi)', active: false },
}

function templateOf(key: TplKey): ShiftTemplate {
  const t = TEMPLATE_DEFS[key]
  return {
    id: tplId(t.n),
    name: t.name,
    start_time: `${t.start}:00`,
    end_time: `${t.end}:00`,
    description: t.description,
    active: t.active,
    created_at: '2026-09-28T07:30:00.000Z',
    updated_at: t.active ? '2026-10-05T12:10:00.000Z' : '2026-02-02T09:00:00.000Z',
  }
}
const TEMPLATES: ShiftTemplate[] = Object.values(TEMPLATE_DEFS).map((t) => templateOf(t.key))

const grossOf = (start: string, end: string) => { const s = toMin(start); let e = toMin(end); if (e <= s) e += 1440; return e - s }
/** workingTimeService.plannedBreakMins ile aynı politika */
function plannedBreak(gross: number): number {
  let policy: number
  if (gross <= 240) policy = 15
  else if (gross >= 660) policy = 120
  else if (gross >= 570) policy = 90
  else policy = 60
  const statutory = gross <= 0 ? 0 : gross <= 240 ? 15 : gross <= 450 ? 30 : 60
  return Math.max(policy, statutory)
}
const netOf = (start: string, end: string) => Math.max(0, grossOf(start, end) - plannedBreak(grossOf(start, end)))

function kindFromTimes(start: string, end: string): ShiftKind {
  const s = start.slice(0, 5), e = end.slice(0, 5)
  if (s <= '10:00' && e >= '22:00') return 'full'
  if (s < '12:00') return 'opening'
  if (e >= '21:30') return 'closing'
  return 'mid'
}

// ═════════════════════════════════════════════════════════════
// Çalışanlar — Kadıköy Mağazası
// ═════════════════════════════════════════════════════════════

const STORE_NAME = 'Kadıköy Mağazası'

type Pattern = Array<TplKey | null>  // Pazartesi … Pazar

interface EmpDef {
  n: number
  id: string
  full_name: string
  email: string | null
  role: Role
  employment_type: EmploymentType
  hire_date: string
  birth_date: string | null
  overtime_consent_at: string | null
  active: boolean
  /** Çift haftaların planı; tek haftalarda açılış ↔ kapanış yer değiştirir */
  pattern: Pattern
  /** Haftalık tatil günü (0 = Pzt) — null: planlanmaz */
  restDow: number | null
  kiosk?: boolean
}

const mail = (s: string) => `${s}@kadikoy.shiftup.app`

function emp(n: number, full_name: string, user: string | null, r: Role, employment_type: EmploymentType,
  hire_date: string, birth_date: string | null, consent: string | null, pattern: Pattern, restDow: number | null,
  extra: Partial<EmpDef> = {}): EmpDef {
  return {
    n, id: empId(n), full_name, email: user ? mail(user) : null, role: r, employment_type, hire_date, birth_date,
    overtime_consent_at: consent ? `${consent}T09:00:00.000Z` : null, active: true, pattern, restDow, ...extra,
  }
}

const EMPLOYEES: EmpDef[] = [
  emp(1, 'Mehmet Kaya', 'mehmet.kaya', R.storeManager, 'full_time', '2016-09-05', '1984-04-12', '2023-01-10',
    ['UAC', 'AC', 'UKAP', 'AC', 'KAP', 'UAC', null], 6),
  emp(2, 'Zeynep Arslan', 'zeynep.arslan', R.assistant, 'full_time', '2018-03-19', '1988-11-02', '2023-01-10',
    ['FULL', null, 'UKAP', 'UAC', 'UKAP', 'UAC', 'UKAP'], 1),
  emp(3, 'Burak Şahin', 'burak.sahin', R.floorLead, 'full_time', '2019-07-01', '1991-02-23', '2023-02-14',
    ['KAP', 'KAP', null, 'AC', 'AC', 'UKAP', 'UKAP'], 2),
  emp(4, 'Elif Demir', 'elif.demir', R.visual, 'full_time', '2020-02-10', '1993-08-30', '2023-02-14',
    ['ERK', 'ERK', 'ERK', 'ERK', 'ERK', 'ERK', null], 6),
  emp(5, 'Ayşe Yılmaz', 'ayse.yilmaz', R.cashier, 'full_time', '2021-06-14', '1998-05-21', '2023-03-01',
    [null, 'AC', 'AC', 'ORT', 'KAP', 'KAP', 'AC'], 0),
  emp(6, 'Emre Çelik', 'emre.celik', R.cashier, 'full_time', '2022-01-17', '1996-12-09', '2023-03-01',
    ['KAP', 'KAP', 'ORT', null, 'AC', 'UAC', 'AC'], 3),
  emp(7, 'Selin Aydın', 'selin.aydin', R.cashier, 'part_time', '2024-09-02', '2004-03-14', null,
    [null, null, 'PTA', null, 'PTA', 'PTA', 'PTA'], 0),
  emp(8, 'Mert Öztürk', 'mert.ozturk', R.sales, 'full_time', '2022-08-22', '1995-07-07', null,
    ['AC', 'ORT', 'UKAP', 'UKAP', null, 'KAP', 'KAP'], 4),
  emp(9, 'Deniz Koç', 'deniz.koc', R.sales, 'full_time', '2020-11-02', '1990-10-01', '2023-03-01',
    ['ORT', 'AC', 'AC', 'KAP', 'KAP', null, 'ORT'], 5),
  emp(10, 'Cansu Yıldız', 'cansu.yildiz', R.sales, 'full_time', '2023-03-06', '1999-01-28', '2023-03-06',
    ['KAP', null, 'ORT', 'AC', 'ORT', 'KAP', 'AC'], 1),
  emp(11, 'Oğuz Kılıç', 'oguz.kilic', R.sales, 'part_time', '2025-02-03', '2005-06-19', null,
    ['PTS', 'PTS', null, null, null, 'PTS', 'PTS'], 2),
  emp(12, 'Gizem Aksoy', 'gizem.aksoy', R.sales, 'full_time', '2023-10-09', '1997-09-15', '2023-10-09',
    ['AC', 'KAP', 'KAP', null, 'ORT', 'AC', 'KAP'], 3),
  emp(13, 'Hakan Doğan', 'hakan.dogan', R.stock, 'full_time', '2017-05-15', '1979-03-03', '2023-01-10',
    ['ERK', 'ERK', 'ERK', 'ERK', 'ERK', 'ERK', null], 6),
  emp(14, 'Serkan Polat', 'serkan.polat', R.stock, 'full_time', '2024-04-01', '2000-11-11', '2024-04-01',
    ['ERK', 'ERK', 'ERK', 'ERK', 'ERK', null, 'ERK'], 5),
  emp(15, 'İrem Erdoğan', 'irem.erdogan', R.adminCashier, 'full_time', '2019-01-07', '1992-06-25', '2023-01-10',
    ['ORT', 'ORT', null, 'KAP', 'AC', 'ORT', 'AC'], 2),
  emp(16, 'Tuğba Özdemir', 'tugba.ozdemir', R.sales, 'part_time', '2025-06-16', '2003-02-02', null,
    [null, null, null, 'PTA', 'PTA', 'PTA', 'PTA'], 0),
  emp(17, 'Kerem Yavuz', 'kerem.yavuz', R.cashier, 'full_time', '2023-05-02', '1994-04-04', '2023-05-02',
    [null, null, null, null, null, null, null], null, { active: false }),
  emp(18, 'Nazlı Güneş', 'nazli.gunes', R.sales, 'full_time', '2021-09-13', '1993-12-17', '2023-01-10',
    [null, 'AC', 'ORT', 'KAP', 'KAP', 'ORT', 'AC'], 0),
  emp(19, 'Kasa Kiosku', 'kiosk', R.kiosk, 'full_time', '2026-10-13', null, null,
    [null, null, null, null, null, null, null], null, { kiosk: true }),
]

const EMP_BY_N = new Map(EMPLOYEES.map((e) => [e.n, e]))
const EMP_BY_ID = new Map(EMPLOYEES.map((e) => [e.id, e]))
const E = (n: number) => EMP_BY_N.get(n)!
/** Planlanan, aktif çalışanlar (kiosk hariç) */
const ACTIVE_STAFF = EMPLOYEES.filter((e) => e.active && !e.kiosk)
const byName = (a: { full_name: string }, b: { full_name: string }) => a.full_name.localeCompare(b.full_name, 'tr')

function employeeRow(e: EmpDef, withPrivate: boolean) {
  const created = `${e.hire_date < '2026-09-28' ? '2026-09-28' : e.hire_date}T08:00:00.000Z`
  return {
    id: e.id,
    full_name: e.full_name,
    email: withPrivate ? e.email : null,
    role_id: e.role.id,
    active: e.active,
    employment_type: e.employment_type,
    hire_date: e.hire_date,
    birth_date: e.birth_date,
    overtime_consent_at: e.overtime_consent_at,
    auth_user_id: withPrivate && e.email ? `0a000000-0000-4000-9000-0000000000${pad2(e.n)}` : null,
    created_at: created,
    updated_at: e.active ? created : '2026-10-02T15:20:00.000Z',
    roles: e.role,
  }
}

/** /api/shifts join'indeki çalışan (email/auth alanları yok) */
function employeeJoin(e: EmpDef) {
  const { email: _e, auth_user_id: _a, ...rest } = employeeRow(e, false)
  return rest
}

// ═════════════════════════════════════════════════════════════
// Bağlam: bugünün tarihi, demo saati, oturumdaki çalışan
// ═════════════════════════════════════════════════════════════

interface Ctx {
  persona: Persona
  me: EmpDef
  isManager: boolean
  today: string
  /** Bugünün demo saati (dakika) */
  nowMin: number
  leaves: LeaveRequest[]
  corrections: TcRecord[]
  forced: Map<string, Scenario>
  shiftCache: Map<string, GenShift | null>
  attCache: Map<string, AttendanceRecord | null>
}

function makeCtx(persona: Persona): Ctx {
  const now = istanbulNow()
  const nowMin = mockOptions.demoTime === 'real' ? now.minutes : toMin(mockOptions.demoTime)
  const me = persona === 'manager' ? E(1) : E(5)
  const ctx: Ctx = {
    persona, me, isManager: hasAccess(me.role.access_level, 'manager'), today: now.date, nowMin,
    leaves: [], corrections: [], forced: new Map(), shiftCache: new Map(), attCache: new Map(),
  }
  ctx.leaves = buildLeaves(ctx)
  ctx.corrections = buildCorrections(ctx)
  for (const [n, sc] of Object.entries(TODAY_SCENARIOS)) ctx.forced.set(`${empId(Number(n))}:${ctx.today}`, sc)
  return ctx
}

// ═════════════════════════════════════════════════════════════
// Plan üretimi (vardiyalar)
// ═════════════════════════════════════════════════════════════

const SWAP_KEYS: Partial<Record<TplKey, TplKey>> = { AC: 'KAP', KAP: 'AC', UAC: 'UKAP', UKAP: 'UAC' }
const EPOCH_MONDAY = '2024-01-01'

function patternFor(e: EmpDef, date: string, rotate = 0): Pattern {
  const week = Math.floor(diffDays(EPOCH_MONDAY, mondayOf(date)) / 7) + rotate
  return week % 2 === 0 ? e.pattern : e.pattern.map((k) => (k ? SWAP_KEYS[k] ?? k : null))
}

/** Bugün kesin çalışan (senaryolu) çalışanlar — dinlenme gününe denk gelse de bugün vardiyalı */
const FORCE_TODAY: Record<number, TplKey> = { 1: 'UKAP', 5: 'KAP', 6: 'ORT', 12: 'KAP', 14: 'ERK', 4: 'ERK' }

interface GenShift {
  id: string
  emp: EmpDef
  date: string
  key: TplKey
  start: string
  end: string
  is_on_leave: boolean
}

function plannedKey(ctx: Ctx, e: EmpDef, date: string): TplKey | null {
  if (!e.active || e.kiosk || date < e.hire_date) return null
  const key = patternFor(e, date)[dow(date)]
  if (!key && date === ctx.today && FORCE_TODAY[e.n]) return FORCE_TODAY[e.n]
  return key
}

function shiftFor(ctx: Ctx, e: EmpDef, date: string): GenShift | null {
  const cacheKey = `${e.n}:${date}`
  const cached = ctx.shiftCache.get(cacheKey)
  if (cached !== undefined) return cached
  const key = plannedKey(ctx, e, date)
  let out: GenShift | null = null
  if (key) {
    const t = TEMPLATE_DEFS[key]
    const onLeave = ctx.leaves.some((l) => l.employee_id === e.id && l.status === 'approved' &&
      l.leave_type !== 'weekly_rest' && l.start_date <= date && l.end_date >= date)
    out = { id: shiftId(e.n, date), emp: e, date, key, start: t.start, end: t.end, is_on_leave: onLeave }
  }
  ctx.shiftCache.set(cacheKey, out)
  return out
}

function isRestDay(ctx: Ctx, e: EmpDef, date: string): boolean {
  if (!e.active || e.kiosk || e.restDow === null || date < e.hire_date) return false
  return dow(date) === e.restDow && plannedKey(ctx, e, date) === null
}

function shiftsOn(ctx: Ctx, date: string): GenShift[] {
  return ACTIVE_STAFF.map((e) => shiftFor(ctx, e, date)).filter((s): s is GenShift => !!s)
    .sort((a, b) => a.start.localeCompare(b.start) || byName(a.emp, b.emp))
}

function shiftsInRange(ctx: Ctx, from: string, to: string, empFilter?: (e: EmpDef) => boolean): GenShift[] {
  const out: GenShift[] = []
  for (const d of datesBetween(from, to)) {
    for (const s of shiftsOn(ctx, d)) if (!empFilter || empFilter(s.emp)) out.push(s)
  }
  return out
}

function assignmentWithDetails(s: GenShift): ShiftAssignmentWithDetails {
  const created = isoAt(addDays(mondayOf(s.date), -3), 18 * 60 + 5)
  return {
    id: s.id,
    employee_id: s.emp.id,
    shift_template_id: tplId(TEMPLATE_DEFS[s.key].n),
    work_date: s.date,
    start_time: `${s.start}:00`,
    end_time: `${s.end}:00`,
    is_on_leave: s.is_on_leave,
    created_at: created,
    updated_at: created,
    shift_templates: templateOf(s.key),
    employees: employeeJoin(s.emp) as unknown as ShiftAssignmentWithDetails['employees'],
  }
}

// ═════════════════════════════════════════════════════════════
// Devam kayıtları
// ═════════════════════════════════════════════════════════════

type Scenario = 'absent' | 'late' | 'on_break' | 'working' | 'forgot_out' | 'corrected' | 'normal'

/** Bugün için ayrılmış durumlar — sayfalarda her durumdan örnek olsun */
const TODAY_SCENARIOS: Record<number, Scenario> = {
  5: 'working',     // Ayşe Yılmaz (çalışan persona): içeride, mola vermedi
  6: 'on_break',    // Emre Çelik: molada
  12: 'absent',     // Gizem Aksoy: gelmedi
  14: 'late',       // Serkan Polat: geç giriş
}

const QR_METHOD = 'qr_location'

function attendanceFor(ctx: Ctx, s: GenShift): AttendanceRecord | null {
  const cached = ctx.attCache.get(s.id)
  if (cached !== undefined) return cached
  const rec = s.is_on_leave || s.date > ctx.today ? null : buildRecord(ctx, s)
  ctx.attCache.set(s.id, rec)
  return rec
}

function buildRecord(ctx: Ctx, s: GenShift): AttendanceRecord | null {
  const r = rngFor(`att:${s.emp.id}:${s.date}`)
  const start = toMin(s.start)
  let end = toMin(s.end)
  if (end <= start) end += 1440
  const gross = end - start
  const brk = plannedBreak(gross)
  const isToday = s.date === ctx.today
  let sc: Scenario = ctx.forced.get(`${s.emp.id}:${s.date}`) ?? 'normal'
  if (sc === 'normal' && !isToday && r() < 0.025) sc = 'absent'
  if (sc === 'absent') return null

  const base = {
    id: attId(s.emp.n, s.date),
    employee_id: s.emp.id,
    shift_assignment_id: s.id,
    completed_break_minutes: 0,
    verification_method: QR_METHOD as string | null,
    exception_note: null as string | null,
  }

  if (sc === 'corrected') {
    return {
      ...base, status: 'clocked_out', clock_in_at: isoAt(s.date, start), break_start_at: null, break_end_at: null,
      clock_out_at: isoAt(s.date, end), completed_break_minutes: brk, verification_method: 'manual_correction',
      exception_note: 'Mesai düzeltme talebiyle girildi.',
      created_at: isoAt(addDays(s.date, 1), 11 * 60 + 20), updated_at: isoAt(addDays(s.date, 2), 10 * 60 + 5),
    }
  }

  const late = sc === 'late' || (sc === 'normal' && r() < 0.1)
  const clockIn = late ? start + randInt(r, isToday ? 18 : 6, isToday ? 26 : 27) : start - randInt(r, 0, 9)
  const overtime = r() < 0.13
  let clockOut = overtime ? end + randInt(r, 40, 110) : end + randInt(r, -3, 8)
  const bStart = start + Math.floor(gross / 2) - Math.floor(brk / 2) + randInt(r, -25, 20)
  const bEnd = bStart + brk + randInt(r, -4, 6)
  const manual = !isToday && r() < 0.025

  const rec: AttendanceRecord = {
    ...base,
    status: 'clocked_out',
    clock_in_at: isoAt(s.date, clockIn),
    break_start_at: isoAt(s.date, bStart),
    break_end_at: isoAt(s.date, bEnd),
    clock_out_at: null,
    created_at: isoAt(s.date, clockIn),
    updated_at: isoAt(s.date, clockIn),
  }
  if (manual) {
    rec.verification_method = 'manual_override'
    rec.exception_note = 'Düzeltme: QR okuyucu arızalıydı, giriş saati kamera kaydından girildi.'
  }

  if (sc === 'forgot_out') {
    rec.status = 'working_after_break'
    rec.updated_at = isoAt(s.date, bEnd)
    return rec
  }

  if (isToday) {
    const now = ctx.nowMin
    if (clockIn > now) return null              // vardiya henüz başlamadı
    if (end + 10 <= now) {                      // vardiya bitti
      clockOut = Math.min(clockOut, now - 3)
    } else {
      // Vardiya sürüyor
      rec.clock_out_at = null
      if (sc === 'on_break' && now - clockIn >= 60) {
        rec.status = 'on_break'
        rec.break_start_at = isoAt(s.date, now - 17)
        rec.break_end_at = null
        rec.updated_at = rec.break_start_at
      } else if (sc !== 'working' && bEnd < now - 5) {
        rec.status = 'working_after_break'
        rec.updated_at = rec.break_end_at!
      } else {
        rec.status = 'working'
        rec.break_start_at = null
        rec.break_end_at = null
      }
      return rec
    }
  }

  rec.clock_out_at = isoAt(s.date, clockOut)
  rec.updated_at = rec.clock_out_at
  return rec
}

const diffMin = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60_000) : null)
const breakMinsOf = (rec: AttendanceRecord) => (rec.completed_break_minutes ?? 0) + (diffMin(rec.break_start_at, rec.break_end_at) ?? 0)
function workedMinsOf(rec: AttendanceRecord | null): number | null {
  if (!rec || !rec.clock_in_at || !rec.clock_out_at) return null
  return Math.max(0, (diffMin(rec.clock_in_at, rec.clock_out_at) ?? 0) - breakMinsOf(rec))
}

// ═════════════════════════════════════════════════════════════
// İzinler
// ═════════════════════════════════════════════════════════════

const AUTO_WEEKLY_REST_REASON = 'Haftalık tatil (otomatik plan)'

interface LeaveDef {
  emp: number; type: LeaveType; from: number; to: number; status: LeaveStatus
  reason: string | null; note?: string | null; createdDaysAgo: number; createdAt: string; reviewer?: number
}

const LEAVE_DEFS: LeaveDef[] = [
  { emp: 9, type: 'annual', from: -1, to: 3, status: 'approved', reason: 'Ailemle Antalya tatili.', note: 'İyi tatiller!', createdDaysAgo: 14, createdAt: '10:12' },
  { emp: 12, type: 'sick', from: -9, to: -8, status: 'approved', reason: 'Grip — doktor raporu ekte.', note: 'Geçmiş olsun.', createdDaysAgo: 9, createdAt: '08:05' },
  { emp: 13, type: 'sick', from: -3, to: -2, status: 'approved', reason: 'Bel fıtığı ağrısı, 2 gün istirahat raporu.', note: null, createdDaysAgo: 3, createdAt: '07:40' },
  { emp: 5, type: 'annual', from: 12, to: 16, status: 'pending', reason: 'Kardeşimin düğünü için memlekete gideceğim.', createdDaysAgo: 2, createdAt: '21:14' },
  { emp: 8, type: 'personal', from: 5, to: 5, status: 'pending', reason: 'Tapu dairesinde randevum var.', createdDaysAgo: 1, createdAt: '18:32' },
  { emp: 10, type: 'annual', from: 20, to: 24, status: 'pending', reason: 'Yurt dışı seyahati.', createdDaysAgo: 3, createdAt: '12:47' },
  { emp: 11, type: 'unpaid', from: 8, to: 9, status: 'pending', reason: 'Vize sınavlarım var.', createdDaysAgo: 0, createdAt: '09:15' },
  { emp: 7, type: 'personal', from: 3, to: 3, status: 'pending', reason: 'Okulda proje sunumu.', createdDaysAgo: 4, createdAt: '16:02' },
  { emp: 6, type: 'annual', from: 2, to: 4, status: 'rejected', reason: 'Dinlenmek istiyorum.', note: 'Kampanya haftası, kasada yeterli kişi yok. Bir sonraki hafta için tekrar talep edebilirsin.', createdDaysAgo: 8, createdAt: '14:20', reviewer: 1 },
  { emp: 5, type: 'annual', from: -40, to: -36, status: 'approved', reason: 'Yaz tatili.', note: null, createdDaysAgo: 62, createdAt: '11:00' },
  { emp: 5, type: 'personal', from: -20, to: -20, status: 'rejected', reason: 'Ehliyet sınavı.', note: 'O gün iki kasiyer izinli; sınav tarihini değiştirebilirsen onaylarım.', createdDaysAgo: 27, createdAt: '19:41', reviewer: 2 },
  { emp: 3, type: 'annual', from: 26, to: 30, status: 'approved', reason: 'Kurban sonrası ertelenen yıllık izin.', note: 'Onaylandı.', createdDaysAgo: 11, createdAt: '13:30' },
  { emp: 18, type: 'other', from: -15, to: -15, status: 'approved', reason: 'Ev taşıma.', note: null, createdDaysAgo: 22, createdAt: '10:05' },
  { emp: 15, type: 'unpaid', from: -30, to: -29, status: 'approved', reason: 'Ailevi nedenler.', note: null, createdDaysAgo: 36, createdAt: '15:55' },
  { emp: 16, type: 'annual', from: 34, to: 37, status: 'pending', reason: 'Dönem arası tatili.', createdDaysAgo: 5, createdAt: '20:10' },
]

function buildLeaves(ctx: Ctx): LeaveRequest[] {
  return LEAVE_DEFS.map((d, i) => {
    const createdDate = addDays(ctx.today, -d.createdDaysAgo)
    const created = isoAt(createdDate, toMin(d.createdAt))
    const reviewed = d.status === 'pending' ? null : isoAt(createdDate < ctx.today ? addDays(createdDate, 1) : createdDate, 10 * 60 + 30)
    return {
      id: seqId('c3', i + 1),
      employee_id: empId(d.emp),
      leave_type: d.type,
      start_date: addDays(ctx.today, d.from),
      end_date: addDays(ctx.today, d.to),
      reason: d.reason,
      status: d.status,
      reviewer_note: d.note ?? null,
      reviewed_at: reviewed,
      created_at: created,
      updated_at: reviewed ?? created,
    }
  })
}

function weeklyRestLeaves(ctx: Ctx, from: string, to: string): LeaveRequest[] {
  const out: LeaveRequest[] = []
  for (const d of datesBetween(from, to)) {
    for (const e of ACTIVE_STAFF) {
      if (!isRestDay(ctx, e, d)) continue
      const created = isoAt(addDays(mondayOf(d), -3), 18 * 60 + 5)
      out.push({
        id: restLeaveId(e.n, d), employee_id: e.id, leave_type: 'weekly_rest', start_date: d, end_date: d,
        reason: AUTO_WEEKLY_REST_REASON, status: 'approved', reviewer_note: null, reviewed_at: created,
        created_at: created, updated_at: created,
      })
    }
  }
  return out
}

function withEmployee(l: LeaveRequest) {
  const e = EMP_BY_ID.get(l.employee_id)!
  return { ...l, employees: { id: e.id, full_name: e.full_name, roles: { name: e.role.name } } }
}

/** Onaylı izin (haftalık tatil dahil) — tarih → kod hesapları için */
function approvedLeaveOn(ctx: Ctx, e: EmpDef, date: string): LeaveType | null {
  const l = ctx.leaves.find((x) => x.employee_id === e.id && x.status === 'approved' && x.start_date <= date && x.end_date >= date)
  if (l) return l.leave_type
  return isRestDay(ctx, e, date) ? 'weekly_rest' : null
}

/** İş K. Md. 53 — annualLeaveService ile aynı hesap */
function leaveBalance(ctx: Ctx, e: EmpDef): AnnualLeaveBalance {
  const completedYears = (from: string, to: string) => {
    const [fy, fm, fd] = from.split('-').map(Number)
    const [ty, tm, td] = to.split('-').map(Number)
    let y = ty - fy
    if (tm < fm || (tm === fm && td < fd)) y--
    return y
  }
  const seniority = completedYears(e.hire_date, ctx.today)
  const age = e.birth_date ? completedYears(e.birth_date, ctx.today) : null
  let entitlement = seniority < 1 ? 0 : seniority >= 15 ? 26 : seniority > 5 ? 20 : 14
  if (seniority >= 1 && age != null && (age <= 18 || age >= 50)) entitlement = Math.max(entitlement, 20)
  const periodStart = `${Number(e.hire_date.slice(0, 4)) + seniority}${e.hire_date.slice(4)}`
  const periodEnd = addDays(`${Number(periodStart.slice(0, 4)) + 1}${periodStart.slice(4)}`, -1)
  const fullHolidays = new Set(holidaysInRange(periodStart, periodEnd).filter((h) => !h.half_day).map((h) => h.date))
  let used = 0
  let pending = 0
  for (const l of ctx.leaves) {
    if (l.employee_id !== e.id || l.leave_type !== 'annual' || l.status === 'rejected') continue
    const s = l.start_date > periodStart ? l.start_date : periodStart
    const t = l.end_date < periodEnd ? l.end_date : periodEnd
    if (s > t) continue
    const days = datesBetween(s, t).filter((d) => dow(d) !== 6 && !fullHolidays.has(d)).length
    if (l.status === 'approved') used += days
    else pending += days
  }
  return {
    known: true, seniorityYears: seniority, entitlementDays: entitlement, periodStart, periodEnd,
    usedDays: used, pendingDays: pending, remainingDays: entitlement - used - pending,
  }
}

// ═════════════════════════════════════════════════════════════
// Resmi tatiller (2429 s. Kanun)
// ═════════════════════════════════════════════════════════════

const FIXED_HOLIDAYS: Array<[string, string, boolean]> = [
  ['01-01', 'Yılbaşı', false],
  ['04-23', 'Ulusal Egemenlik ve Çocuk Bayramı', false],
  ['05-01', 'Emek ve Dayanışma Günü', false],
  ['05-19', 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı', false],
  ['07-15', 'Demokrasi ve Milli Birlik Günü', false],
  ['08-30', 'Zafer Bayramı', false],
  ['10-28', 'Cumhuriyet Bayramı Arifesi', true],
  ['10-29', 'Cumhuriyet Bayramı', false],
]
/** Dini bayramlar: [arife, 1. gün, gün sayısı] */
const RELIGIOUS: Record<number, Array<[string, string, string, number]>> = {
  2025: [['Ramazan Bayramı', '03-29', '03-30', 3], ['Kurban Bayramı', '06-05', '06-06', 4]],
  2026: [['Ramazan Bayramı', '03-19', '03-20', 3], ['Kurban Bayramı', '05-26', '05-27', 4]],
  2027: [['Ramazan Bayramı', '03-08', '03-09', 3], ['Kurban Bayramı', '05-15', '05-16', 4]],
  2028: [['Ramazan Bayramı', '02-25', '02-26', 3], ['Kurban Bayramı', '05-04', '05-05', 4]],
}

function holidaysOfYear(y: number): PublicHoliday[] {
  const out: PublicHoliday[] = FIXED_HOLIDAYS.map(([md, name, half]) => ({ date: `${y}-${md}`, name, half_day: half }))
  for (const [name, eve, first, days] of RELIGIOUS[y] ?? []) {
    out.push({ date: `${y}-${eve}`, name: `${name} Arifesi`, half_day: true })
    for (let i = 0; i < days; i++) out.push({ date: addDays(`${y}-${first}`, i), name: `${name} ${i + 1}. Gün`, half_day: false })
  }
  return out
}

function holidaysInRange(from: string, to: string): PublicHoliday[] {
  const out: PublicHoliday[] = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(...holidaysOfYear(y))
  return out.filter((h) => h.date >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date))
}

// ═════════════════════════════════════════════════════════════
// Mesai düzeltme talepleri
// ═════════════════════════════════════════════════════════════

type TcRecord = TimeCorrectionRequest & { break_minutes: number | null }

interface TcDef {
  emp: number; offset: number; status: TimeCorrectionStatus; scenario: Scenario
  reason: string; note?: string; reviewer?: number; startAdj?: number; endAdj?: number; createdHoursAfter: number
}

const TC_DEFS: TcDef[] = [
  { emp: 5, offset: -3, status: 'pending', scenario: 'forgot_out', endAdj: 12, createdHoursAfter: 14,
    reason: 'Kapanışta kasa sayımı uzadı, çıkışta QR okutmayı unuttum.' },
  { emp: 8, offset: -1, status: 'pending', scenario: 'forgot_out', endAdj: 35, createdHoursAfter: 13,
    reason: 'Akşam yoğunluğunda müşteriyle ilgilenirken çıkış okutmayı unuttum.' },
  { emp: 10, offset: -2, status: 'pending', scenario: 'absent', createdHoursAfter: 20,
    reason: 'Telefonumun şarjı bitti, giriş QR\'ını okutamadım. Vardiyamı eksiksiz çalıştım.' },
  { emp: 13, offset: -5, status: 'pending', scenario: 'normal', endAdj: 45, createdHoursAfter: 30,
    reason: 'Sevkiyat aracı geç geldi, 45 dk fazla kaldım; çıkış saatim yanlış kaydedildi.' },
  { emp: 5, offset: -10, status: 'approved', scenario: 'corrected', reviewer: 1, createdHoursAfter: 10,
    reason: 'Girişte QR okuyucu çalışmadı, kasa açılışını yaptım.', note: 'Kamera kaydıyla doğrulandı.' },
  { emp: 6, offset: -6, status: 'approved', scenario: 'corrected', reviewer: 2, createdHoursAfter: 16,
    reason: 'Uygulama giriş sırasında hata verdi.', note: 'Onaylandı.' },
  { emp: 18, offset: -8, status: 'direct', scenario: 'corrected', reviewer: 1, createdHoursAfter: 26,
    reason: 'Kiosk tableti güncelleme nedeniyle kapalıydı — saatler elle girildi.' },
  { emp: 5, offset: -17, status: 'rejected', scenario: 'normal', reviewer: 2, startAdj: -30, createdHoursAfter: 9,
    reason: 'Mesaiye 30 dakika erken başladım, sistemde görünmüyor.',
    note: 'Kamera kayıtlarına göre giriş vardiya saatinde; erken başlama talimatı verilmemişti.' },
  { emp: 14, offset: -12, status: 'rejected', scenario: 'normal', reviewer: 1, startAdj: -60, createdHoursAfter: 11,
    reason: 'Depo sevkiyatı için 1 saat erken geldim.', note: 'Erken giriş için yönetici onayı yok.' },
]

function buildCorrections(ctx: Ctx): TcRecord[] {
  const out: TcRecord[] = []
  TC_DEFS.forEach((d, i) => {
    const e = E(d.emp)
    const date = addDays(ctx.today, d.offset)
    if (d.scenario !== 'normal') ctx.forced.set(`${e.id}:${date}`, d.scenario)
    const key = plannedKey(ctx, e, date)
    const t = key ? TEMPLATE_DEFS[key] : TEMPLATE_DEFS.AC
    const start = toMin(t.start) + (d.startAdj ?? 0)
    const end = toMin(t.end) + (d.endAdj ?? 0)
    const created = isoAt(date, toMin(t.end) + d.createdHoursAfter * 60)
    const reviewer = d.reviewer ? E(d.reviewer) : null
    const reviewedAt = d.status === 'pending' ? null : d.status === 'direct' ? created : new Date(Date.parse(created) + 19 * 3_600_000).toISOString()
    out.push({
      id: seqId('7c', i + 1),
      employee_id: e.id,
      date,
      requested_start_time: hhmmss(start),
      requested_end_time: hhmmss(end),
      break_minutes: d.status === 'direct' ? 60 : null,
      reason: d.reason,
      status: d.status,
      reviewed_by: reviewer?.id ?? null,
      reviewed_at: reviewedAt,
      reviewer_note: d.note ?? null,
      created_at: created,
      updated_at: reviewedAt ?? created,
      employee: { id: e.id, full_name: e.full_name, roles: { name: e.role.name } },
      reviewer: reviewer ? { id: reviewer.id, full_name: reviewer.full_name } : null,
    })
  })
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ═════════════════════════════════════════════════════════════
// Açık vardiyalar
// ═════════════════════════════════════════════════════════════

interface OpenShiftDef {
  offset: number; start: string; end: string; role: string | null; description: string | null
  status: OpenShift['status']; filledBy?: number; createdDaysAgo: number
}

const OPEN_SHIFT_DEFS: OpenShiftDef[] = [
  { offset: 1, start: '17:00', end: '22:00', role: 'Kasiyer', description: 'Akşam kasa yoğunluğu — 3. kasa açılacak.', status: 'open', createdDaysAgo: 1 },
  { offset: 3, start: '10:00', end: '18:00', role: 'Satış Danışmanı', description: 'Deniz izinde; açılışta satış katına destek.', status: 'open', createdDaysAgo: 2 },
  { offset: 4, start: '14:00', end: '22:00', role: 'Kasiyer', description: 'Cuma kapanışı için ek kasiyer.', status: 'open', createdDaysAgo: 2 },
  { offset: 5, start: '08:00', end: '16:00', role: 'Depo Çalışanı', description: 'Sezon sevkiyatı — mal kabul ve etiketleme.', status: 'open', createdDaysAgo: 3 },
  { offset: 8, start: '12:00', end: '20:00', role: null, description: 'Kasım kampanyası hazırlığı, reyon düzeni.', status: 'open', createdDaysAgo: 0 },
  { offset: 10, start: '10:00', end: '15:00', role: 'Satış Danışmanı', description: null, status: 'open', createdDaysAgo: 0 },
  { offset: -4, start: '17:00', end: '22:00', role: 'Kasiyer', description: 'Hafta sonu akşam yoğunluğu.', status: 'filled', filledBy: 7, createdDaysAgo: 9 },
  { offset: -2, start: '10:00', end: '15:00', role: 'Satış Danışmanı', description: null, status: 'filled', filledBy: 11, createdDaysAgo: 6 },
  { offset: 2, start: '12:00', end: '20:00', role: null, description: 'Vitrin değişimi desteği.', status: 'filled', filledBy: 18, createdDaysAgo: 4 },
  { offset: 6, start: '17:00', end: '22:00', role: 'Satış Danışmanı', description: 'Cumartesi akşamı.', status: 'filled', filledBy: 16, createdDaysAgo: 3 },
  { offset: -1, start: '14:00', end: '22:00', role: 'Kasiyer', description: 'Plan değişti, gerek kalmadı.', status: 'cancelled', createdDaysAgo: 5 },
  { offset: 7, start: '08:00', end: '16:00', role: 'Depo Çalışanı', description: 'Sevkiyat ertelendi.', status: 'cancelled', createdDaysAgo: 4 },
]

function buildOpenShifts(ctx: Ctx) {
  return OPEN_SHIFT_DEFS.map((d, i) => {
    const created = isoAt(addDays(ctx.today, -d.createdDaysAgo), 9 * 60 + 30 + i * 7)
    const filler = d.filledBy ? E(d.filledBy) : null
    const updated = d.status === 'open' ? created : new Date(Date.parse(created) + (5 + i) * 3_600_000).toISOString()
    const row: OpenShift & { filled_assignment_id: string | null } = {
      id: seqId('0f', i + 1),
      work_date: addDays(ctx.today, d.offset),
      start_time: `${d.start}:00`,
      end_time: `${d.end}:00`,
      role_needed: d.role,
      description: d.description,
      status: d.status,
      filled_by: filler?.id ?? null,
      filled_assignment_id: filler ? shiftId(filler.n, addDays(ctx.today, d.offset)) : null,
      created_at: created,
      updated_at: updated,
      filled_by_employee: filler ? { id: filler.id, full_name: filler.full_name } : null,
    }
    return row
  }).sort((a, b) => a.work_date.localeCompare(b.work_date) || a.start_time.localeCompare(b.start_time))
}

// ═════════════════════════════════════════════════════════════
// Vardiya takasları
// ═════════════════════════════════════════════════════════════

/** Çalışanın (bugünden itibaren / geriye) n'inci vardiyası */
function nthShift(ctx: Ctx, e: EmpDef, fromOffset: number, step: 1 | -1, n = 1): GenShift | null {
  let found = 0
  for (let i = 0; i < 40; i++) {
    const s = shiftFor(ctx, e, addDays(ctx.today, fromOffset + i * step))
    if (s && !s.is_on_leave && ++found === n) return s
  }
  return null
}

interface SwapDef {
  requester: number; target: number | null; targetPick: 'shift' | 'none'; status: SwapStatus; accepted?: boolean
  dir: 1 | -1; nth: number; note: string | null; reviewerNote?: string | null; reviewer?: number; createdDaysAgo: number
}

const SWAP_DEFS: SwapDef[] = [
  { requester: 5, target: 6, targetPick: 'shift', status: 'pending', dir: 1, nth: 2, createdDaysAgo: 0,
    note: 'Cuma akşamı ailevi bir programım var, vardiyalarımızı değişebilir miyiz?' },
  { requester: 7, target: 5, targetPick: 'shift', status: 'pending', dir: 1, nth: 1, createdDaysAgo: 1,
    note: 'Okulda sınav haftası; senin günündeki vardiyanı alabilirim.' },
  { requester: 8, target: 9, targetPick: 'shift', status: 'pending', accepted: true, dir: 1, nth: 3, createdDaysAgo: 2,
    note: 'Doktor randevum var.' },
  { requester: 11, target: 16, targetPick: 'none', status: 'pending', accepted: true, dir: 1, nth: 2, createdDaysAgo: 1,
    note: 'Bu vardiyamı devretmek istiyorum (sınav).' },
  { requester: 3, target: 18, targetPick: 'shift', status: 'approved', accepted: true, dir: -1, nth: 2, reviewer: 1, createdDaysAgo: 6,
    note: 'Bayram dönüşü yol planı.', reviewerNote: 'Uygun, onaylandı.' },
  { requester: 10, target: 12, targetPick: 'shift', status: 'rejected', accepted: true, dir: 1, nth: 4, reviewer: 2, createdDaysAgo: 3,
    note: 'Kurs saatim değişti.', reviewerNote: 'Gizem o hafta zaten 6 gün çalışıyor; dinlenme süresi yetersiz kalıyor.' },
  { requester: 15, target: 6, targetPick: 'shift', status: 'cancelled', dir: 1, nth: 3, createdDaysAgo: 4,
    note: 'Planım değişti, gerek kalmadı.' },
  { requester: 5, target: 15, targetPick: 'shift', status: 'approved', accepted: true, dir: -1, nth: 3, reviewer: 1, createdDaysAgo: 12,
    note: 'Pazartesi hastane kontrolüm var.', reviewerNote: null },
]

function buildSwaps(ctx: Ctx): ShiftSwapRequest[] {
  const out: ShiftSwapRequest[] = []
  SWAP_DEFS.forEach((d, i) => {
    const req = E(d.requester)
    const rs = nthShift(ctx, req, d.dir === 1 ? 1 : -1, d.dir, d.nth)
    if (!rs) return
    const tgt = d.target ? E(d.target) : null
    let ts: GenShift | null = null
    if (tgt && d.targetPick === 'shift') {
      for (let k = 0; k < 10 && !ts; k++) {
        const s = shiftFor(ctx, tgt, addDays(rs.date, k))
        if (s && !s.is_on_leave && s.date !== rs.date) ts = s
      }
    }
    const created = isoAt(addDays(ctx.today, -d.createdDaysAgo), 11 * 60 + i * 37)
    const accepted = d.accepted ? new Date(Date.parse(created) + 3 * 3_600_000).toISOString() : null
    const reviewed = d.status === 'pending' ? null : new Date(Date.parse(created) + 20 * 3_600_000).toISOString()
    const reviewer = d.reviewer ? E(d.reviewer) : null
    const sh = (s: GenShift) => ({ work_date: s.date, start_time: `${s.start}:00`, end_time: `${s.end}:00` })
    out.push({
      id: seqId('5b', i + 1),
      requester_id: req.id,
      requester_shift_id: rs.id,
      target_id: tgt?.id ?? null,
      target_shift_id: ts?.id ?? null,
      status: d.status,
      target_accepted_at: accepted,
      reviewed_by: reviewer?.id ?? null,
      requester_note: d.note,
      reviewer_note: d.reviewerNote ?? null,
      reviewed_at: reviewed,
      created_at: created,
      updated_at: reviewed ?? accepted ?? created,
      requester: { id: req.id, full_name: req.full_name },
      target: tgt ? { id: tgt.id, full_name: tgt.full_name } : null,
      requester_shift: sh(rs),
      target_shift: ts ? sh(ts) : null,
    })
  })
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ═════════════════════════════════════════════════════════════
// Müsaitlik
// ═════════════════════════════════════════════════════════════

const DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const AVAILABILITY_DEFS: Array<[number, DayOfWeek, string, string, boolean, string | null]> = [
  [5, 'tuesday', '08:00', '13:00', false, 'Üniversite dersi'],
  [5, 'thursday', '08:00', '13:00', false, 'Üniversite dersi'],
  [7, 'monday', '08:00', '16:00', false, 'Okul'],
  [7, 'tuesday', '08:00', '16:00', false, 'Okul'],
  [7, 'wednesday', '08:00', '15:00', false, 'Okul'],
  [7, 'thursday', '08:00', '16:00', false, 'Okul'],
  [7, 'friday', '08:00', '15:00', false, 'Okul'],
  [11, 'wednesday', '09:00', '17:00', false, 'Ders'],
  [11, 'thursday', '09:00', '17:00', false, 'Ders'],
  [11, 'friday', '09:00', '13:00', false, 'Ders'],
  [16, 'thursday', '16:00', '23:00', true, 'Akşamları müsait'],
  [16, 'friday', '16:00', '23:00', true, 'Akşamları müsait'],
  [16, 'saturday', '10:00', '23:00', true, null],
  [16, 'sunday', '10:00', '23:00', true, null],
  [10, 'monday', '17:00', '23:00', false, 'Kreşten çocuğu alıyorum'],
  [10, 'wednesday', '17:00', '23:00', false, 'Kreşten çocuğu alıyorum'],
  [18, 'saturday', '08:00', '12:00', false, 'İngilizce kursu'],
  [8, 'wednesday', '18:00', '23:00', false, 'Yüksek lisans dersi'],
  [3, 'sunday', '18:00', '23:00', false, null],
  [14, 'saturday', '08:00', '23:00', false, 'Hafta sonu askerlik yoklaması (geçici)'],
  [12, 'friday', '10:00', '14:00', false, 'Fizik tedavi'],
]

function buildAvailability(): EmployeeAvailability[] {
  return AVAILABILITY_DEFS.map(([n, day, s, e, avail, note], i) => ({
    id: seqId('a5', i + 1),
    employee_id: empId(n),
    day_of_week: day,
    start_time: `${s}:00`,
    end_time: `${e}:00`,
    is_available: avail,
    note,
    created_at: isoAt('2026-10-01', 9 * 60 + i * 13),
    updated_at: isoAt('2026-10-01', 9 * 60 + i * 13),
  })).sort((a, b) => DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week) || a.start_time.localeCompare(b.start_time))
}

// ═════════════════════════════════════════════════════════════
// Bildirimler
// ═════════════════════════════════════════════════════════════

type NotifDef = [NotificationType, string, string, number /* dk önce */, boolean /* okundu */]

function notificationDefs(ctx: Ctx): NotifDef[] {
  const label = (offset: number) => trDate(addDays(ctx.today, offset), { day: 'numeric', month: 'long', weekday: 'long' })
  /** Çalışanın o günkü vardiya saatleri ('14:00–22:00') */
  const sh = (n: number, offset = 0, fallback: TplKey = 'KAP') => {
    const s = shiftFor(ctx, E(n), addDays(ctx.today, offset))
    return s ? `${s.start}–${s.end}` : `${TEMPLATE_DEFS[fallback].start}–${TEMPLATE_DEFS[fallback].end}`
  }
  if (ctx.persona === 'manager') {
    return [
      ['attendance_missed_clock_in', 'Giriş okutulmadı', `Gizem Aksoy, bugün ${sh(12)} vardiyası için henüz giriş QR'ı okutmadı.`, 6, false],
      ['attendance_late_clock_in', 'Geç giriş', 'Serkan Polat, bugün 08:00–16:00 vardiyasına 23 dk geç giriş okuttu (giriş: 08:23).', 25, false],
      ['leave_submitted', 'Yeni izin talebi', `Oğuz Kılıç, ${label(8)} – ${label(9)} tarihleri için ücretsiz izin talep etti.`, 48, false],
      ['time_correction_submitted', 'Yeni Mesai Düzeltme Talebi', `Mert Öztürk, ${label(-1)} için mesai düzeltme talebi gönderdi.`, 95, false],
      ['shift_swap_submitted', 'Vardiya takası onay bekliyor', 'Mert Öztürk ile Deniz Koç arasındaki takas karşı tarafça kabul edildi, onayınızı bekliyor.', 160, false],
      ['leave_submitted', 'Yeni izin talebi', `Mert Öztürk, ${label(5)} için kişisel izin talep etti.`, 22 * 60, false],
      ['open_shift_claimed', 'Açık vardiya alındı', `Nazlı Güneş, ${addDays(ctx.today, 2)} 12:00–20:00 açık vardiyasını üstlendi.`, 26 * 60, true],
      ['attendance_late_clock_out', 'Geç çıkış', 'Burak Şahin, dünkü 14:00–22:00 vardiyasından 1 sa 10 dk geç çıkış okuttu (çıkış: 23:10).', 17 * 60, true],
      ['attendance_missed_clock_out', 'Çıkış okutulmadı', `Ayşe Yılmaz, ${label(-3)} vardiyası bitti ancak çıkış QR'ı okutulmadı.`, 3 * 24 * 60 - 120, true],
      ['time_correction_submitted', 'Yeni Mesai Düzeltme Talebi', `Cansu Yıldız, ${label(-2)} için mesai düzeltme talebi gönderdi.`, 2 * 24 * 60 - 200, true],
      ['leave_submitted', 'Yeni izin talebi', `Ayşe Yılmaz, ${label(12)} – ${label(16)} tarihleri için yıllık izin talep etti.`, 2 * 24 * 60 + 300, true],
      ['shift_reminder', 'Vardiya hatırlatması', `Bugün ${sh(1, 0, 'UAC')} vardiyanız var.`, 9 * 60, true],
      ['leave_submitted', 'Yeni izin talebi', `Cansu Yıldız, ${label(20)} – ${label(24)} tarihleri için yıllık izin talep etti.`, 3 * 24 * 60 + 90, true],
      ['attendance_missed_clock_in', 'Giriş okutulmadı', `Hakan Doğan, ${label(-4)} ${sh(13, -4, 'ERK')} vardiyası için henüz giriş QR'ı okutmadı.`, 4 * 24 * 60 + 30, true],
    ]
  }
  return [
    ['shift_swap_submitted', 'Size bir vardiya takas teklifi var', 'Selin Aydın sizinle vardiya takası yapmak istiyor. Kabul etmek veya reddetmek için Vardiya Takası sayfasına gidin.', 35, false],
    ['open_shift_available', 'Yeni Açık Vardiya', `${label(1)} tarihinde 17:00 – 22:00 (Kasiyer) için açık vardiya oluşturuldu. Üstlenmek için Açık Vardiyalar sayfasını ziyaret edin.`, 80, false],
    ['shift_reminder', 'Vardiya hatırlatması', `Bugün ${sh(5)} vardiyanız var. İyi çalışmalar!`, 9 * 60, false],
    ['open_shift_available', 'Yeni Açık Vardiya', `${label(4)} tarihinde 14:00 – 22:00 (Kasiyer) için açık vardiya oluşturuldu. Üstlenmek için Açık Vardiyalar sayfasını ziyaret edin.`, 2 * 24 * 60, true],
    ['leave_submitted', 'İzin talebiniz alındı', `${label(12)} – ${label(16)} yıllık izin talebiniz yöneticinize iletildi.`, 2 * 24 * 60 + 150, true],
    ['time_correction_approved', 'Mesai düzeltme talebiniz onaylandı', `${label(-10)} tarihli mesai düzeltme talebiniz onaylandı. Not: Kamera kaydıyla doğrulandı.`, 9 * 24 * 60, true],
    ['shift_swap_approved', 'Vardiya takası onaylandı', 'İrem Erdoğan ile vardiya takasınız onaylandı; planınız güncellendi.', 11 * 24 * 60, true],
    ['attendance_override', 'Devam kaydınız güncellendi', 'Devam kaydınızda bir düzeltme yapıldı. Sebep: Mola bitişi okutulmamış, kamera kaydına göre düzeltildi.', 13 * 24 * 60, true],
    ['time_correction_rejected', 'Mesai düzeltme talebiniz reddedildi', `${label(-17)} tarihli talebiniz reddedildi. Not: Kamera kayıtlarına göre giriş vardiya saatinde.`, 16 * 24 * 60, true],
    ['leave_rejected', 'İzin talebiniz reddedildi', 'Kişisel izin talebiniz reddedildi. Not: O gün iki kasiyer izinli; sınav tarihini değiştirebilirsen onaylarım.', 26 * 24 * 60, true],
    ['leave_approved', 'İzin talebiniz onaylandı', `${label(-40)} – ${label(-36)} yıllık izin talebiniz onaylandı. İyi tatiller!`, 60 * 24 * 60, true],
  ]
}

function buildNotifications(ctx: Ctx): Notification[] {
  return notificationDefs(ctx).map(([type, title, message, ago, read], i) => ({
    id: seqId('9b', i + 1),
    employee_id: ctx.me.id,
    type,
    title,
    message,
    is_read: read,
    related_id: null,
    created_at: isoMinutesAgo(ago),
  })).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ═════════════════════════════════════════════════════════════
// Denetim kaydı
// ═════════════════════════════════════════════════════════════

interface AuditRow {
  id: string; action: string; entity_type: string; entity_id: string | null
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string | null
  created_at: string; actor: { id: string; full_name: string } | null; subject_ids: string[]
}

function buildAuditLogs(ctx: Ctx): AuditRow[] {
  const rows: AuditRow[] = []
  let seq = 0
  const at = (daysAgo: number, time: string) => isoAt(addDays(ctx.today, -daysAgo), toMin(time))
  const add = (daysAgo: number, time: string, actor: number | null, action: string, entity_type: string, entity_id: string | null,
    before: Record<string, unknown> | null, after: Record<string, unknown> | null, note: string | null, subjects: number[]) => {
    const a = actor ? E(actor) : null
    rows.push({
      id: seqId('ad', ++seq), action, entity_type, entity_id, before, after, note, created_at: at(daysAgo, time),
      actor: a ? { id: a.id, full_name: a.full_name } : null, subject_ids: subjects.map(empId),
    })
  }
  const d = (off: number) => addDays(ctx.today, off)
  const leaveId = (i: number) => seqId('c3', i)
  const tcId = (i: number) => seqId('7c', i)
  const weekStart = mondayOf(ctx.today)

  add(0, '10:42', 1, 'attendance.override', 'attendance_record', attId(13, d(-1)),
    { status: 'working_after_break', clock_out_at: null }, { status: 'clocked_out', clock_out_at: isoAt(d(-1), 16 * 60 + 4) },
    'Çıkış okutulmamış, kamera kaydına göre girildi.', [13])
  add(0, '09:58', 1, 'leave.approved', 'leave_request', leaveId(3), { status: 'pending' }, { status: 'approved', reviewer_note: null, removed: 2, keptWorked: 0 }, null, [13])
  add(1, '18:20', 2, 'shift.update', 'shift_assignment', shiftId(15, d(3)),
    { work_date: d(3), start_time: '12:00:00', end_time: '20:00:00' }, { start_time: '14:00', end_time: '22:00' },
    'İhlaller onaylandı: Ardışık vardiyalar arası dinlenme süresi yetersiz (10s < 11s).', [15])
  add(1, '17:05', 1, 'time_correction.direct', 'attendance_record', attId(18, d(-8)), null,
    { employee_id: empId(18), date: d(-8), start: '12:00', end: '20:00', break_minutes: 60 }, null, [18])
  add(1, '15:31', 9, 'shift_swap.accepted', 'shift_swap_request', seqId('5b', 3), null, { requester_shift_id: shiftId(8, d(3)), target_shift_id: shiftId(9, d(4)) }, null, [8, 9])
  add(2, '16:47', 1, 'shift.create', 'shift_assignment', shiftId(18, d(2)), null, { employee_id: empId(18), work_date: d(2), start_time: '12:00', end_time: '20:00' }, null, [18])
  add(2, '11:12', 1, 'report.timesheet.export', 'report', ctx.today.slice(0, 7), null, null, null, [])
  add(3, '10:30', 2, 'leave.rejected', 'leave_request', leaveId(9), { status: 'pending' },
    { status: 'rejected', reviewer_note: 'Kampanya haftası, kasada yeterli kişi yok. Bir sonraki hafta için tekrar talep edebilirsin.' }, null, [6])
  add(3, '10:02', 2, 'shift_swap.rejected', 'shift_swap_request', seqId('5b', 6), null, { requester_shift_id: shiftId(10, d(5)), target_shift_id: shiftId(12, d(6)) }, null, [10, 12])
  add(4, '19:40', 15, 'shift_swap.cancelled', 'shift_swap_request', seqId('5b', 7), null, null, null, [15, 6])
  add(4, '18:05', 1, 'workforce.apply', 'week_plan', weekStart, null,
    { weekStart: d(-dow(ctx.today)), weekEnd: d(6 - dow(ctx.today)), created: 88, replaced: 12, restDays: 14 },
    'İhlaller onaylandı: Zeynep Arslan: Haftalık 50s — maks. 45s aşıldı.', [])
  add(5, '14:16', 1, 'employee.update', 'employee', empId(14), { email: mail('serkan.polat'), active: true, role_id: R.stock.id },
    { overtime_consent_at: '2024-04-01', employment_type: 'full_time' }, null, [14])
  add(6, '12:22', 2, 'time_correction.approved', 'attendance_record', attId(6, d(-6)), null,
    { request_id: tcId(6), date: d(-6), start: '14:00', end: '22:00', break_minutes: 60 }, null, [6])
  add(6, '09:45', 1, 'leave.weekly_rest.assign', 'leave_request', restLeaveId(16, d(-1)), null,
    { employee_id: empId(16), start_date: d(-1), end_date: d(-1), removed: 1, keptWorked: 0 }, null, [16])
  add(7, '20:55', 3, 'attendance.override', 'attendance_record', attId(7, d(-7)),
    { status: 'on_break', break_end_at: null }, { status: 'working_after_break', break_end_at: isoAt(d(-7), 19 * 60 + 32) },
    'Mola dönüşü okutulmamış.', [7])
  add(8, '13:10', 1, 'holiday.upsert', 'public_holiday', `${ctx.today.slice(0, 4)}-10-28`, null,
    { date: `${ctx.today.slice(0, 4)}-10-28`, name: 'Cumhuriyet Bayramı Arifesi', half_day: true }, null, [])
  add(8, '13:09', 1, 'holiday.upsert', 'public_holiday', `${ctx.today.slice(0, 4)}-10-29`, null,
    { date: `${ctx.today.slice(0, 4)}-10-29`, name: 'Cumhuriyet Bayramı', half_day: false }, null, [])
  add(9, '17:44', 1, 'time_correction.rejected', 'time_correction_request', tcId(9), null, null, 'Erken giriş için yönetici onayı yok.', [14])
  add(10, '10:18', 1, 'leave.approved', 'leave_request', leaveId(1), { status: 'pending' }, { status: 'approved', reviewer_note: 'İyi tatiller!', removed: 0, keptWorked: 0 }, null, [9])
  add(11, '09:03', 1, 'time_correction.approved', 'attendance_record', attId(5, d(-10)), null,
    { request_id: tcId(5), date: d(-10), start: '10:00', end: '18:00', break_minutes: 60 }, null, [5])
  add(11, '18:12', 1, 'workforce.apply', 'week_plan', addDays(weekStart, -7), null,
    { weekStart: addDays(weekStart, -7), weekEnd: addDays(weekStart, -1), created: 91, replaced: 0, restDays: 15 }, null, [])
  add(12, '16:30', 1, 'shift.delete', 'shift_assignment', shiftId(17, d(-12)),
    { employee_id: empId(17), work_date: d(-12), start_time: '14:00:00', end_time: '22:00:00' }, null, null, [17])
  add(13, '11:50', 1, 'employee.update', 'employee', empId(17), { email: mail('kerem.yavuz'), active: true, role_id: R.cashier.id },
    { active: false }, null, [17])
  add(14, '15:20', 1, 'shift_swap.approved', 'shift_swap_request', seqId('5b', 5), null, { requester_shift_id: shiftId(3, d(-2)), target_shift_id: shiftId(18, d(-1)) }, null, [3, 18])
  add(15, '10:01', 1, 'employee.update', 'employee', empId(16), { email: mail('tugba.ozdemir'), active: true, role_id: R.sales.id },
    { employment_type: 'part_time', birth_date: '2003-02-02' }, null, [16])
  add(16, '19:22', 2, 'attendance.override', 'attendance_record', attId(10, d(-16)),
    { status: 'shift_waiting', clock_in_at: null }, { status: 'clocked_out', clock_in_at: isoAt(d(-16), 14 * 60 + 2), clock_out_at: isoAt(d(-16), 22 * 60 + 4) },
    'Kiosk bağlantı sorunu.', [10])
  add(17, '12:34', 1, 'store_location.update', 'store_location', seqId('51', 1), null,
    { name: STORE_NAME, latitude: 40.990612, longitude: 29.029041, allowed_radius_meters: 120, max_accuracy_meters: 60 }, null, [])
  add(18, '09:15', 1, 'leave.delete', 'leave_request', seqId('c3', 90),
    { employee_id: empId(11), leave_type: 'personal', start_date: d(-12), end_date: d(-12), status: 'pending' }, null, null, [11])
  add(18, '18:40', 1, 'workforce.apply', 'week_plan', addDays(weekStart, -14), null,
    { weekStart: addDays(weekStart, -14), weekEnd: addDays(weekStart, -8), created: 90, replaced: 4, restDays: 15 }, null, [])
  add(20, '14:44', 1, 'employee.delete', 'employee', seqId('ee', 1), { full_name: 'Test Kullanıcı', email: mail('test') }, null, null, [])
  add(21, '11:11', 2, 'shift.create', 'shift_assignment', shiftId(11, d(-21)), null,
    { employee_id: empId(11), work_date: d(-21), start_time: '10:00', end_time: '15:00' },
    'İhlaller onaylandı: Yarı zamanlı çalışan haftada en fazla 4 gün çalışabilir (5. gün).', [11])
  add(22, '17:02', 1, 'report.timesheet.export', 'report', addDays(`${ctx.today.slice(0, 7)}-01`, -1).slice(0, 7), null, null, null, [])
  add(24, '10:27', 1, 'leave.approved', 'leave_request', leaveId(13), { status: 'pending' }, { status: 'approved', reviewer_note: null, removed: 1, keptWorked: 0 }, null, [18])
  add(25, '18:09', 1, 'workforce.apply', 'week_plan', addDays(weekStart, -21), null,
    { weekStart: addDays(weekStart, -21), weekEnd: addDays(weekStart, -15), created: 89, replaced: 0, restDays: 14 }, null, [])

  // Önceki haftalardan rutin vardiya değişiklikleri (sayfalamayı göstermek için)
  for (let i = 0; i < 26; i++) {
    const e = ACTIVE_STAFF[i % ACTIVE_STAFF.length]
    const day = d(-26 - i)
    const s = shiftFor(ctx, e, day)
    if (!s) continue
    const action = i % 3 === 0 ? 'shift.create' : 'shift.update'
    add(26 + i, `${pad2(10 + (i % 8))}:${pad2((i * 13) % 60)}`, i % 4 === 0 ? 2 : 1, action, 'shift_assignment', s.id,
      action === 'shift.update' ? { work_date: day, start_time: `${s.start}:00`, end_time: `${s.end}:00` } : null,
      action === 'shift.update' ? { start_time: hhmm(toMin(s.start) + 60), end_time: hhmm(toMin(s.end) + 60) } : { employee_id: e.id, work_date: day, start_time: s.start, end_time: s.end },
      null, [e.n])
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ═════════════════════════════════════════════════════════════
// Mağaza konumu
// ═════════════════════════════════════════════════════════════

const LOCATIONS: StoreLocation[] = [
  {
    id: seqId('51', 1), name: STORE_NAME, latitude: 40.990612, longitude: 29.029041,
    allowed_radius_meters: 120, max_accuracy_meters: 60, active: true,
    created_at: '2026-09-28T08:00:00.000Z', updated_at: '2026-10-03T09:34:00.000Z',
  },
  {
    id: seqId('51', 2), name: 'Moda Depo (eski)', latitude: 40.983921, longitude: 29.026433,
    allowed_radius_meters: 200, max_accuracy_meters: 80, active: false,
    created_at: '2026-09-28T08:00:00.000Z', updated_at: '2026-09-30T16:10:00.000Z',
  },
]

// ═════════════════════════════════════════════════════════════
// Türetilmiş görünümler: günlük, panel, raporlar
// ═════════════════════════════════════════════════════════════

function dailyEntries(ctx: Ctx, date: string): DailyShiftEntry[] {
  return shiftsOn(ctx, date).map((s) => {
    const a = assignmentWithDetails(s)
    return {
      employee: {
        id: s.emp.id, full_name: s.emp.full_name, role_id: s.emp.role.id, roles: { name: s.emp.role.name },
        active: s.emp.active, created_at: a.employees!.created_at, updated_at: a.employees!.updated_at,
      },
      shiftAssignment: {
        id: a.id, employee_id: a.employee_id, shift_template_id: a.shift_template_id, work_date: a.work_date,
        start_time: a.start_time, end_time: a.end_time, is_on_leave: a.is_on_leave, created_at: a.created_at, updated_at: a.updated_at,
      },
      attendanceRecord: attendanceFor(ctx, s),
    }
  })
}

function dashboard(ctx: Ctx) {
  const entries = dailyEntries(ctx, ctx.today)
  const recs = entries.map((e) => e.attendanceRecord).filter((r): r is AttendanceRecord => !!r)
  const pending = ctx.leaves.filter((l) => l.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at))
  return {
    stats: {
      active_employees: ACTIVE_STAFF.length,
      today_shifts: entries.length,
      currently_working: recs.filter((r) => r.status === 'working' || r.status === 'working_after_break').length,
      on_break: recs.filter((r) => r.status === 'on_break').length,
      clocked_out: recs.filter((r) => r.status === 'clocked_out').length,
      // route ile aynı: başlamış, izinli olmayan ve devam kaydı olmayan vardiyalar
      no_show: entries.filter((e) => !e.shiftAssignment.is_on_leave && !e.attendanceRecord
        && toMin(e.shiftAssignment.start_time.slice(0, 5)) <= (mockOptions.demoTime === 'real' ? 24 * 60 : toMin(mockOptions.demoTime))).length,
      pending_leaves: pending.length,
    },
    today_roster: entries.map((e) => ({
      employee_id: e.employee.id,
      full_name: e.employee.full_name,
      role_name: e.employee.roles?.name ?? '—',
      start_time: e.shiftAssignment.start_time,
      end_time: e.shiftAssignment.end_time,
      attendance_status: e.attendanceRecord?.status ?? 'shift_waiting',
      is_on_leave: Boolean(e.shiftAssignment.is_on_leave),
      clock_in_at: e.attendanceRecord?.clock_in_at ?? null,
      clock_out_at: e.attendanceRecord?.clock_out_at ?? null,
    })),
    pending_leaves: pending.slice(0, 5).map((l) => {
      const e = EMP_BY_ID.get(l.employee_id)!
      return {
        id: l.id, employee_id: l.employee_id, leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date,
        employees: { full_name: e.full_name, roles: { name: e.role.name } },
      }
    }),
  }
}

function attendanceReport(ctx: Ctx, from: string, to: string, employeeId: string | null): AttendanceReportRow[] {
  const rows: AttendanceReportRow[] = []
  for (const s of shiftsInRange(ctx, from, to, (e) => !employeeId || e.id === employeeId)) {
    const rec = attendanceFor(ctx, s)
    let status: AttendanceReportStatus = rec?.status ?? 'shift_waiting'
    if (!rec) {
      if (s.is_on_leave) status = 'on_leave'
      else if (s.date > ctx.today || (s.date === ctx.today && toMin(s.start) + 30 > ctx.nowMin)) status = 'upcoming'
    }
    const hasBreak = !!rec && (!!rec.break_start_at || rec.completed_break_minutes > 0)
    rows.push({
      record_id: rec?.id ?? null,
      employee_id: s.emp.id,
      full_name: s.emp.full_name,
      work_date: s.date,
      shift_name: TEMPLATE_DEFS[s.key].name,
      start_time: `${s.start}:00`,
      end_time: `${s.end}:00`,
      status,
      is_on_leave: s.is_on_leave,
      clock_in_at: rec?.clock_in_at ?? null,
      break_start_at: rec?.break_start_at ?? null,
      break_end_at: rec?.break_end_at ?? null,
      clock_out_at: rec?.clock_out_at ?? null,
      worked_minutes: workedMinsOf(rec),
      break_minutes: hasBreak && rec ? breakMinsOf(rec) : null,
      verification_method: rec?.verification_method ?? null,
      exception_note: rec?.exception_note ?? null,
    })
  }
  return rows
}

function myReport(ctx: Ctx, from: string, to: string) {
  const rows = shiftsInRange(ctx, from, to, (e) => e.id === ctx.me.id).map((s) => {
    const rec = attendanceFor(ctx, s)
    const hasBreak = !!rec && (!!rec.break_start_at || rec.completed_break_minutes > 0)
    return {
      work_date: s.date,
      start_time: `${s.start}:00`,
      end_time: `${s.end}:00`,
      is_on_leave: s.is_on_leave,
      shift_name: TEMPLATE_DEFS[s.key].name as string | null,
      status: (rec?.status ?? 'shift_waiting') as string,
      clock_in_at: rec?.clock_in_at ?? null,
      clock_out_at: rec?.clock_out_at ?? null,
      break_start_at: rec?.break_start_at ?? null,
      break_end_at: rec?.break_end_at ?? null,
      worked_minutes: workedMinsOf(rec),
      break_minutes: hasBreak && rec ? breakMinsOf(rec) : null,
      is_manual_correction: false,
    }
  })
  // Vardiyası olmayan günlere onaylı / doğrudan düzeltmeler (route ile aynı)
  const dates = new Set(rows.map((r) => r.work_date))
  for (const c of ctx.corrections) {
    if (c.employee_id !== ctx.me.id || (c.status !== 'approved' && c.status !== 'direct')) continue
    if (c.date < from || c.date > to || dates.has(c.date)) continue
    const gross = grossOf(c.requested_start_time, c.requested_end_time)
    const brk = c.break_minutes ?? (gross <= 240 ? 15 : gross <= 450 ? 30 : 60)
    rows.push({
      work_date: c.date, start_time: c.requested_start_time.slice(0, 5), end_time: c.requested_end_time.slice(0, 5),
      is_on_leave: false, shift_name: null, status: 'clocked_out', clock_in_at: null, clock_out_at: null,
      break_start_at: null, break_end_at: null, worked_minutes: Math.max(0, gross - brk), break_minutes: brk,
      is_manual_correction: true,
    })
  }
  return rows.sort((a, b) => a.work_date.localeCompare(b.work_date))
}

const LEAVE_CODE: Record<string, TimesheetCode> = { weekly_rest: 'HT', annual: 'Yİ', sick: 'Rİ', unpaid: 'Üİ', personal: 'Mİ', other: 'Mİ' }
const NIGHT_START = 20 * 60
const MAX_WEEKLY_WORK_MINS = 45 * 60

function nightMinutesOf(rec: AttendanceRecord): number {
  if (!rec.clock_in_at || !rec.clock_out_at) return 0
  const start = Date.parse(rec.clock_in_at), end = Date.parse(rec.clock_out_at)
  let total = 0
  const dayStartUtc = Math.floor((start + TZ_OFFSET_MIN * 60_000) / DAY_MS) * DAY_MS - TZ_OFFSET_MIN * 60_000
  for (let ds = dayStartUtc - DAY_MS; ds <= end; ds += DAY_MS) {
    const ws = ds + NIGHT_START * 60_000, we = ds + DAY_MS + 6 * 60 * 60_000
    total += Math.max(0, Math.min(end, we) - Math.max(start, ws))
  }
  return Math.round(total / 60_000)
}

function timesheet(ctx: Ctx, month: string): { month: string; rows: TimesheetRow[]; holidays: PublicHoliday[] } {
  const days = monthDays(month)
  const rangeFrom = mondayOf(days[0])
  const rangeTo = addDays(mondayOf(days[days.length - 1]), 6)
  const holidays = holidaysInRange(rangeFrom, rangeTo)
  const holidayBy = new Map(holidays.map((h) => [h.date, h]))
  const staff = EMPLOYEES.filter((e) => !e.kiosk && (e.active || days.some((d) => shiftFor(ctx, e, d))))
    .sort(byName)

  const rows = staff.map((e): TimesheetRow => {
    const row: TimesheetRow = {
      employee: { id: e.id, full_name: e.full_name, role_name: e.role.name, employment_type: e.employment_type, overtime_consent_at: e.overtime_consent_at },
      days: {}, dayMins: {}, dayPlan: {}, workedMins: 0, nightMins: 0, overtimeMins: 0, holidayWorkedDays: 0,
      workedDays: 0, absentDays: 0, leaveDays: { 'Yİ': 0, 'Rİ': 0, 'Üİ': 0, 'Mİ': 0, 'HT': 0 }, sgkDays: 0, overtimeWithoutConsent: false,
    }
    for (const date of days) {
      const s = shiftFor(ctx, e, date)
      const live = s && !s.is_on_leave ? s : null
      const rec = live ? attendanceFor(ctx, live) : null
      const holiday = holidayBy.get(date)
      const leave = approvedLeaveOn(ctx, e, date)
      let code: TimesheetCode = ''
      if (rec?.clock_in_at) {
        code = holiday ? 'RTÇ' : 'Ç'
        row.workedDays++
        if (holiday && !holiday.half_day) row.holidayWorkedDays++
        const mins = workedMinsOf(rec) ?? 0
        row.workedMins += mins
        row.dayMins[date] = mins
        row.nightMins += nightMinutesOf(rec)
      } else if (leave) {
        code = LEAVE_CODE[leave] ?? 'Mİ'
        if (code in row.leaveDays) row.leaveDays[code as keyof TimesheetRow['leaveDays']]++
      } else if (holiday && !holiday.half_day) {
        code = 'RT'
      } else if (live) {
        row.dayPlan[date] = { start: live.start, end: live.end }
        if (date < ctx.today) { code = 'D'; row.absentDays++ } else code = 'P'
      }
      row.days[date] = code
    }
    for (const sunday of days.filter((d) => dow(d) === 6)) {
      const weekMins = datesBetween(addDays(sunday, -6), sunday).reduce((sum, d) => {
        const s = shiftFor(ctx, e, d)
        return sum + (s && !s.is_on_leave ? workedMinsOf(attendanceFor(ctx, s)) ?? 0 : 0)
      }, 0)
      row.overtimeMins += Math.max(0, weekMins - MAX_WEEKLY_WORK_MINS)
    }
    row.overtimeWithoutConsent = row.overtimeMins > 0 && !e.overtime_consent_at
    row.sgkDays = Math.max(0, Math.min(30, days.length) - row.leaveDays['Üİ'] - row.absentDays)
    return row
  })
  return { month, rows, holidays }
}

function overtime(ctx: Ctx, year: number): { year: number; summaries: OvertimeSummary[] } {
  const jan1 = `${year}-01-01`
  const firstSunday = addDays(jan1, (6 - dow(jan1) + 7) % 7)
  const dec31 = `${year}-12-31`
  const lastSunday = addDays(dec31, -((dow(dec31) + 1) % 7))
  const capMins = 270 * 60
  const summaries = ACTIVE_STAFF.slice().sort(byName).map((e): OvertimeSummary => {
    const weeks: OvertimeWeek[] = []
    for (let sun = firstSunday; sun <= lastSunday && addDays(sun, -6) <= ctx.today; sun = addDays(sun, 7)) {
      const monday = addDays(sun, -6)
      let worked = 0
      for (const d of datesBetween(monday, sun)) {
        const s = shiftFor(ctx, e, d)
        if (s && !s.is_on_leave) worked += workedMinsOf(attendanceFor(ctx, s)) ?? 0
      }
      const ot = Math.max(0, worked - MAX_WEEKLY_WORK_MINS)
      if (ot > 0) weeks.push({ weekStart: monday, workedMins: worked, overtimeMins: ot })
    }
    const total = weeks.reduce((s, w) => s + w.overtimeMins, 0)
    return {
      employee_id: e.id, full_name: e.full_name, consent_at: e.overtime_consent_at, weeks,
      totalOvertimeMins: total, capMins, capRatio: total / capMins, overCap: total > capMins,
      missingConsent: total > 0 && !e.overtime_consent_at,
    }
  })
  return { year, summaries }
}

// ═════════════════════════════════════════════════════════════
// İş gücü planlama
// ═════════════════════════════════════════════════════════════

const weekDaysOf = (ref: string) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(ref), i))
const fmtDuration = (mins: number) => (mins % 60 === 0 ? `${Math.floor(mins / 60)}s` : `${Math.floor(mins / 60)}s ${mins % 60}dk`)

function planning(ctx: Ctx, ref: string) {
  const weekDays = weekDaysOf(ref)
  const summaries: EmployeeWeekSummary[] = ACTIVE_STAFF.slice().sort(byName).map((e) => {
    const days: Record<string, DaySummary> = {}
    let total = 0
    let workDays = 0
    const violations: WorkingTimeViolation[] = []
    for (const d of weekDays) {
      const s = shiftFor(ctx, e, d)
      const mins = s && !s.is_on_leave ? netOf(s.start, s.end) : 0
      days[d] = {
        date: d,
        shifts: s ? [{ id: s.id, start_time: `${s.start}:00`, end_time: `${s.end}:00`, is_on_leave: s.is_on_leave }] : [],
        totalMins: mins,
        isLeave: !!s?.is_on_leave,
      }
      total += mins
      if (mins > 0) workDays++
    }
    if (e.employment_type === 'part_time') {
      if (total > 30 * 60) violations.push({ type: 'part_time_hour_limit', message: `Yarı zamanlı çalışan haftalık 30s limitini aşıyor (${fmtDuration(total)}).`, severity: 'error' })
      if (workDays > 4) violations.push({ type: 'part_time_day_limit', message: `Yarı zamanlı çalışan haftada en fazla 4 gün çalışabilir (${workDays} gün).`, severity: 'error' })
    } else if (total > MAX_WEEKLY_WORK_MINS) {
      violations.push({ type: 'weekly_max', message: `Haftalık ${fmtDuration(total)} — maks. 45s aşıldı.`, severity: 'error' })
    }
    return { employeeId: e.id, employeeName: e.full_name, employment_type: e.employment_type, days, totalWeeklyMins: total, weeklyWorkDays: workDays, violations }
  })
  const openShiftsThisWeek = buildOpenShifts(ctx)
    .filter((o) => o.status === 'open' && o.work_date >= weekDays[0] && o.work_date <= weekDays[6])
    .map(({ id, work_date, start_time, end_time, role_needed, status }) => ({ id, work_date, start_time, end_time, role_needed, status }))
  return {
    weekStart: weekDays[0], weekEnd: weekDays[6], weekDays,
    config: { minRestHours: 11, maxDailyWorkHours: 11, maxWeeklyWorkHours: 45 },
    summaries, openShiftsThisWeek,
  }
}

function draftReason(e: EmpDef, kind: ShiftKind): string {
  const g = e.role.planning_group
  if (e.employment_type === 'part_time') return kind === 'opening' ? 'Yarı zamanlı — öğle yoğunluğu' : 'Yarı zamanlı — akşam yoğunluğu'
  if (g === 'visual' || g === 'stock') return 'Sabit 08:00 ekibi'
  if (g === 'store_manager' || g === 'assistant_manager' || g === 'floor_lead') {
    return kind === 'full' ? 'Açılış + kapanış yönetici kapsaması' : kind === 'opening' ? 'Açılış yöneticisi' : kind === 'closing' ? 'Kapanış yöneticisi' : 'Ara vardiya yöneticisi'
  }
  if (g === 'cashier') return kind === 'opening' ? 'Açılış kasiyeri' : kind === 'closing' ? 'Kapanış kasiyeri' : 'Öğle yoğunluğu kasa desteği'
  return kind === 'opening' ? 'Hafta içi açılış satış danışmanı' : kind === 'closing' ? 'Kapanış satış danışmanı' : 'Öğle yoğunluğu satış desteği'
}

function generateDraft(ctx: Ctx, ref: string): PlannerResult {
  const weekDays = weekDaysOf(ref)
  const assignments: DraftAssignment[] = []
  const stats: Record<string, EmployeeDraftStats> = {}
  for (const e of ACTIVE_STAFF.slice().sort(byName)) {
    const st: EmployeeDraftStats = {
      employeeId: e.id, employeeName: e.full_name, employment_type: e.employment_type,
      totalMins: 0, workDays: 0, openingCount: 0, closingCount: 0, fullCount: 0, assignments: [],
    }
    for (const d of weekDays) {
      let start: string, end: string, tplKey: TplKey | null, worked = false, reason: string
      if (d < ctx.today) {
        const s = shiftFor(ctx, e, d)
        if (!s || s.is_on_leave) continue
        start = s.start; end = s.end; tplKey = s.key; worked = true; reason = 'Giriş/çıkış kaydı var — değiştirilemez'
      } else {
        if (approvedLeaveOn(ctx, e, d) && approvedLeaveOn(ctx, e, d) !== 'weekly_rest') continue
        const key = patternFor(e, d, 1)[dow(d)]
        if (!key) continue
        tplKey = key; start = TEMPLATE_DEFS[key].start; end = TEMPLATE_DEFS[key].end; reason = ''
      }
      const kind = kindFromTimes(start, end)
      const a: DraftAssignment = {
        employee_id: e.id, employee_name: e.full_name, work_date: d, start_time: start, end_time: end,
        shift_template_id: tplKey ? tplId(TEMPLATE_DEFS[tplKey].n) : null, shift_kind: kind,
        reason: reason || draftReason(e, kind),
        ...(worked ? { worked: true } : {}),
        ...(kind === 'full' && e.role.planning_group === 'assistant_manager' ? { overtime: true } : {}),
      }
      assignments.push(a)
      st.assignments.push(a)
      st.totalMins += netOf(start, end)
      st.workDays++
      if (kind === 'opening') st.openingCount++
      else if (kind === 'closing') st.closingCount++
      else if (kind === 'full') st.fullCount++
    }
    stats[e.id] = st
  }
  const z = stats[empId(2)]
  const sat = trDate(weekDays[5], { day: 'numeric', month: 'long', weekday: 'long' })
  const warnings: PlanWarning[] = [
    { level: 'warning', message: `Zeynep Arslan: haftalık ${Math.round((z?.totalMins ?? 0) / 60)} saat — ${Math.max(0, Math.round((z?.totalMins ?? 0) / 60) - 45)} saat fazla mesai (yönetici açılış/kapanış kapsaması için). ` },
    { level: 'warning', message: `${sat}: Etiket yenileme için 2 ek çalışan 08:00'e atanamadı (1 atandı).` },
    { level: 'warning', message: `Deniz Koç: haftada 2 izin/tatil günü tanımlı; FT için en fazla 1 gün olmalı. ` },
    { level: 'info', message: `Tuğba Özdemir: ${trDate(weekDays[3])} – ${trDate(weekDays[6])} arası 4 gün üst üste çalışma` },
    { level: 'info', message: 'Selin Aydın: müsaitlik kısıtı nedeniyle hafta içi yalnızca akşam vardiyası atandı.' },
  ]
  return {
    weekStart: weekDays[0], weekEnd: weekDays[6], weekDays, assignments, stats, warnings,
    hasHardViolation: false, seed: hashStr(weekDays[0]) % 100000,
  }
}

// ═════════════════════════════════════════════════════════════
// Oturumdaki çalışanın anlık durumu (/api/attendance/current-status)
// ═════════════════════════════════════════════════════════════

const ALLOWED: Record<AttendanceStatus, QrActionType[]> = {
  shift_waiting: ['clock_in'],
  working: ['break_start', 'clock_out'],
  on_break: ['break_end'],
  working_after_break: ['break_start', 'clock_out'],
  clocked_out: [],
}

function currentStatus(ctx: Ctx, employeeId: string) {
  const e = EMP_BY_ID.get(employeeId) ?? ctx.me
  const s = shiftFor(ctx, e, ctx.today)
  if (!s || s.is_on_leave) return { has_shift: false, current_status: null, suggested_action: null, allowed_actions: [] }
  const status: AttendanceStatus = attendanceFor(ctx, s)?.status ?? 'shift_waiting'
  const allowed = ALLOWED[status]
  const suggested = (['clock_in', 'clock_out', 'break_start', 'break_end'] as QrActionType[]).find((a) => allowed.includes(a)) ?? null
  return {
    has_shift: true, shift_id: s.id, shift_date: s.date, shift_start: `${s.start}:00`, shift_end: `${s.end}:00`,
    current_status: status, suggested_action: suggested, allowed_actions: allowed,
  }
}

// ═════════════════════════════════════════════════════════════
// Yönlendirme
// ═════════════════════════════════════════════════════════════

type Body = Record<string, unknown> | null
interface Req { ctx: Ctx; url: URL; q: URLSearchParams; params: Record<string, string>; body: Body }
interface Route { method: string; path: string; minAccess?: AccessLevel; handler: (r: Req) => MockResult }

const json = (body: unknown, status = 200): MockResult => ({ status, body })
const bad = (error: string) => json({ error, code: 'VALIDATION_ERROR' }, 400)
const str = (b: Body, k: string): string | undefined => (b && typeof b[k] === 'string' ? (b[k] as string) : undefined)
const nowIso = () => new Date().toISOString()

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/'), a = path.split('/')
  if (p.length !== a.length) return null
  const out: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) out[p[i].slice(1)] = decodeURIComponent(a[i])
    else if (p[i] !== a[i]) return null
  }
  return out
}

const get = (path: string, handler: Route['handler'], minAccess?: AccessLevel): Route => ({ method: 'GET', path, handler, minAccess })
const post = (path: string, handler: Route['handler'], minAccess?: AccessLevel): Route => ({ method: 'POST', path, handler, minAccess })
const patch = (path: string, handler: Route['handler'], minAccess?: AccessLevel): Route => ({ method: 'PATCH', path, handler, minAccess })
const del = (path: string, handler: Route['handler'], minAccess?: AccessLevel): Route => ({ method: 'DELETE', path, handler, minAccess })

const ROUTES: Route[] = [
  // ── Kimlik ────────────────────────────────────────────────
  get('/api/auth/me', ({ ctx }) => {
    const { employment_type: _t, hire_date: _h, birth_date: _b, overtime_consent_at: _o, ...me } = employeeRow(ctx.me, true)
    return json({ employee: me })
  }),
  get('/api/auth/mode', () => json({ mode: 'production' })),
  post('/api/auth/logout', () => json({ ok: true })),
  post('/api/auth/send-otp', () => json({ ok: true })),
  post('/api/auth/verify-otp', () => json({ ok: true })),
  post('/api/auth/dev-login', ({ ctx, body }) =>
    json(str(body, 'step') === 'verify-otp' ? { ok: true, employee: employeeRow(ctx.me, true) } : { ok: true })),

  // ── Mağaza ────────────────────────────────────────────────
  get('/api/store-location/name', () => json({ name: STORE_NAME })),
  get('/api/store-location', () => json({ locations: LOCATIONS }), 'store_manager'),
  post('/api/store-location', ({ body }) => {
    const id = str(body, 'id')
    const base = LOCATIONS.find((l) => l.id === id) ?? LOCATIONS[0]
    return json({ location: { ...base, ...(body ?? {}), id: id ?? seqId('51', 3), updated_at: nowIso() } }, id ? 200 : 201)
  }, 'store_manager'),

  // ── Push ──────────────────────────────────────────────────
  get('/api/push/config', () => json(mockOptions.pushEnabled
    ? { enabled: true, publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' }
    : { enabled: false, publicKey: null })),
  post('/api/push/subscription', () => json({ success: true })),
  del('/api/push/subscription', () => json({ success: true, removed: true })),
  get('/api/push/diagnostics', ({ q }) => {
    const thisDevice = q.get('endpoint') ? true : null
    const steps: PushDiagnosticStep[] = [
      { key: 'vapid', ok: true, label: 'Cloudflare: VAPID_PUBLIC_KEY', hint: null },
      { key: 'migration', ok: true, label: 'Veritabanı migration\'ları (push_subscriptions, push_diagnostics)', hint: null },
      { key: 'pg_net', ok: true, label: 'pg_net eklentisi', hint: null },
      { key: 'vault', ok: true, label: 'Vault secret\'ları (push_function_url, push_webhook_secret)', hint: null },
      { key: 'trigger', ok: true, label: 'Bildirim tetikleyicisi (trg_notifications_push_fanout)', hint: null },
      { key: 'subscription', ok: true, label: 'Bu hesabın kayıtlı cihazları (2)', hint: null },
      { key: 'function', ok: true, label: 'send-push Edge Function son yanıtı — HTTP 200 (gönderilen 2, başarısız 0)', hint: null },
    ]
    return json({
      app: { vapidPublicKey: true },
      me: { subscriptions: 2, thisDevice },
      db: {
        pg_net: true, vault: true, function_url: true, webhook_secret: true, trigger: true, subscriptions: 14,
        recent_responses: [{ status_code: 200, error_msg: null, content: '{"sent":2,"failed":0,"removed":0}', created: isoMinutesAgo(6) }],
      },
      steps,
    })
  }, 'store_manager'),

  // ── Roller / çalışanlar ───────────────────────────────────
  get('/api/roles', () => json({ roles: ROLES })),
  get('/api/employees', ({ ctx, q }) => {
    const active = q.get('active')
    let list = active === 'true'
      ? ACTIVE_STAFF.map((e) => {
        const { email: _e, auth_user_id: _a, ...rest } = employeeRow(e, false)
        return rest
      })
      : EMPLOYEES.filter((e) => active !== 'false' || !e.active).map((e) => employeeRow(e, ctx.isManager))
    list = list.sort(byName)
    return json({ employees: list })
  }),
  post('/api/employees', ({ body }) => {
    const roleRow = ROLES.find((r) => r.id === str(body, 'role_id')) ?? null
    const t = nowIso()
    return json({
      employee: {
        id: seqId('e1', 1), full_name: str(body, 'full_name') ?? 'Yeni Çalışan', email: str(body, 'email') ?? null,
        role_id: roleRow?.id ?? null, active: true, employment_type: (str(body, 'employment_type') ?? 'full_time') as EmploymentType,
        hire_date: str(body, 'hire_date') ?? null, birth_date: str(body, 'birth_date') ?? null,
        overtime_consent_at: str(body, 'overtime_consent_at') ?? null, auth_user_id: null, created_at: t, updated_at: t,
      },
    }, 201)
  }, 'manager'),
  patch('/api/employees/:id', ({ params, body }) => {
    const e = EMP_BY_ID.get(params.id)
    if (!e) return json({ error: 'Çalışan bulunamadı.', code: 'NOT_FOUND' }, 404)
    const { roles: _r, ...row } = employeeRow(e, true)
    return json({ employee: { ...row, ...(body ?? {}), updated_at: nowIso() } })
  }, 'manager'),
  del('/api/employees/:id', ({ params }) => json({ success: true, deleted_id: params.id }), 'store_manager'),

  // ── Vardiya şablonları ────────────────────────────────────
  get('/api/shift-templates', ({ q }) => json({
    templates: (q.get('active') === 'true' ? TEMPLATES.filter((t) => t.active) : TEMPLATES)
      .slice().sort((a, b) => a.start_time.localeCompare(b.start_time) || a.name.localeCompare(b.name, 'tr')),
  })),
  post('/api/shift-templates', ({ body }) => {
    const t = nowIso()
    const time = (k: string, d: string) => `${(str(body, k) ?? d).slice(0, 5)}:00`
    return json({
      template: {
        id: tplId(99), name: str(body, 'name') ?? 'Yeni Şablon', start_time: time('start_time', '10:00'), end_time: time('end_time', '18:00'),
        description: str(body, 'description') ?? null, active: body?.active !== false, created_at: t, updated_at: t,
      },
    }, 201)
  }, 'manager'),
  patch('/api/shift-templates/:id', ({ params, body }) => {
    const base = TEMPLATES.find((t) => t.id === params.id) ?? TEMPLATES[0]
    return json({ template: { ...base, ...(body ?? {}), id: params.id, updated_at: nowIso() } })
  }, 'manager'),

  // ── Vardiyalar ────────────────────────────────────────────
  get('/api/shifts', ({ ctx, q }) => {
    const week = q.get('week'), start = q.get('start'), end = q.get('end')
    if (isValidDate(week)) {
      const days = weekDaysOf(week)
      return json({ assignments: shiftsInRange(ctx, days[0], days[6]).map(assignmentWithDetails) })
    }
    if (isValidDate(start) && isValidDate(end)) {
      if (diffDays(start, end) < 0 || diffDays(start, end) > 62) return bad('Tarih aralığı 0–62 gün olmalıdır.')
      return json({ assignments: shiftsInRange(ctx, start, end).map(assignmentWithDetails) })
    }
    return bad('week veya start/end parametresi gerekli.')
  }),
  post('/api/shifts', ({ ctx, body }) => {
    const e = EMP_BY_ID.get(str(body, 'employee_id') ?? '') ?? E(5)
    const date = str(body, 'work_date') ?? ctx.today
    const tpl = TEMPLATES.find((t) => t.id === str(body, 'shift_template_id')) ?? null
    const start = (str(body, 'start_time') ?? '10:00').slice(0, 5), end = (str(body, 'end_time') ?? '18:00').slice(0, 5)
    const t = nowIso()
    return json({
      assignment: {
        id: shiftId(e.n, date), employee_id: e.id, shift_template_id: tpl?.id ?? null, work_date: date,
        start_time: `${start}:00`, end_time: `${end}:00`, is_on_leave: false, created_at: t, updated_at: t,
        shift_templates: tpl, employees: employeeJoin(e),
      },
    }, 201)
  }, 'manager'),
  patch('/api/shifts/:id', ({ ctx, params, body }) => {
    const m = /^5a000000-0000-4000-8000-(\d{2})(\d{4})(\d{2})(\d{2})00$/.exec(params.id)
    const e = m ? EMP_BY_N.get(Number(m[1])) ?? E(5) : E(5)
    const date = m ? `${m[2]}-${m[3]}-${m[4]}` : ctx.today
    const base = shiftFor(ctx, e, date)
    const tpl = TEMPLATES.find((t) => t.id === str(body, 'shift_template_id')) ?? (base ? templateOf(base.key) : null)
    const start = (str(body, 'start_time') ?? base?.start ?? '10:00').slice(0, 5)
    const end = (str(body, 'end_time') ?? base?.end ?? '18:00').slice(0, 5)
    return json({
      assignment: {
        id: params.id, employee_id: e.id, shift_template_id: tpl?.id ?? null, work_date: date,
        start_time: `${start}:00`, end_time: `${end}:00`, is_on_leave: false,
        created_at: isoAt(addDays(mondayOf(date), -3), 18 * 60 + 5), updated_at: nowIso(),
        shift_templates: tpl, employees: employeeJoin(e),
      },
    })
  }, 'manager'),
  del('/api/shifts/:id', () => json({ success: true }), 'manager'),

  // ── Günlük operasyon / devam ──────────────────────────────
  get('/api/attendance/daily', ({ ctx, q }) => {
    const date = q.get('date')
    if (date && !isValidDate(date)) return bad('Geçersiz tarih.')
    const d = date ?? ctx.today
    return json({ date: d, entries: dailyEntries(ctx, d) })
  }, 'manager'),
  get('/api/attendance/current-status', ({ ctx, q }) => {
    const requested = q.get('employee_id')
    if (requested && requested !== ctx.me.id && !ctx.isManager) {
      return json({ error: 'Yalnızca kendi durumunuzu görüntüleyebilirsiniz.', code: 'FORBIDDEN' }, 403)
    }
    return json(currentStatus(ctx, requested ?? ctx.me.id))
  }),
  post('/api/attendance/override', ({ ctx, body }) => {
    const recordId = str(body, 'record_id') ?? ''
    const m = /^a7000000-0000-4000-8000-(\d{2})(\d{4})(\d{2})(\d{2})00$/.exec(recordId)
    const e = m ? EMP_BY_N.get(Number(m[1])) : undefined
    const date = m ? `${m[2]}-${m[3]}-${m[4]}` : ctx.today
    const s = e ? shiftFor(ctx, e, date) : null
    const existing = s ? attendanceFor(ctx, s) : null
    const note = str(body, 'exception_note') ?? ''
    const record = {
      ...(existing ?? {}),
      ...(body ?? {}),
      id: recordId,
      exception_note: existing?.exception_note ? `${existing.exception_note} | Düzeltme: ${note}` : `Düzeltme: ${note}`,
      verification_method: 'manual_override',
      updated_at: nowIso(),
    }
    return json({ success: true, record })
  }, 'manager'),
  get('/api/attendance/alerts/scan', () => json({ checked: 13, notified: 1 })),
  post('/api/attendance/alerts/scan', () => json({ checked: 13, notified: 1 }), 'manager'),

  // ── Panel ─────────────────────────────────────────────────
  get('/api/dashboard', ({ ctx }) => json(dashboard(ctx)), 'manager'),

  // ── QR / kiosk ────────────────────────────────────────────
  get('/api/kiosk/qr', ({ ctx }) => json({ qr_data: `SU2.${hashStr(`kiosk:${ctx.today}`).toString(36)}Kd1kY0yM4gaZ${hashStr(ctx.today).toString(16)}` }), 'manager'),
  post('/api/qr/generate', ({ body }) => {
    const employee_id = str(body, 'employee_id') ?? empId(5)
    const action = (str(body, 'action_type') ?? 'clock_in') as QrActionType
    const ttl = typeof body?.ttl_seconds === 'number' ? Math.min(body.ttl_seconds as number, 60) : 60
    const expires_at = new Date(Date.now() + ttl * 1000).toISOString()
    const token = hashStr(`${employee_id}:${action}`).toString(16).padStart(8, '0').repeat(8)
    const res: GenerateQrResponse = {
      token, action_type: action, employee_id, expires_at,
      qr_data: JSON.stringify({ token, action, employee_id, exp: Math.floor(Date.parse(expires_at) / 1000) }),
    }
    return json(res, 201)
  }, 'manager'),
  post('/api/qr/process', ({ ctx, body }) => {
    const action = (str(body, 'intended_action') ?? currentStatus(ctx, ctx.me.id).suggested_action ?? 'clock_in') as QrActionType
    const next: Record<QrActionType, [string, string]> = {
      clock_in: ['working', 'Giriş kaydedildi. İyi çalışmalar!'],
      break_start: ['on_break', 'Mola başladı. Afiyet olsun!'],
      break_end: ['working_after_break', 'Moladan dönüş kaydedildi.'],
      clock_out: ['clocked_out', 'Çıkış kaydedildi. İyi akşamlar!'],
    }
    const res: ProcessQrResponse = {
      success: true, action_type: action, new_status: next[action][0], timestamp: hhmm(istanbulNow().minutes), message: next[action][1],
    }
    return json(res)
  }),

  // ── İzinler ───────────────────────────────────────────────
  get('/api/leave', ({ ctx, q }) => {
    const status = q.get('status'), employeeId = q.get('employee_id'), from = q.get('from'), to = q.get('to')
    if (status && !['pending', 'approved', 'rejected'].includes(status)) return bad('Geçersiz durum filtresi.')
    if ((from && !isValidDate(from)) || (to && !isValidDate(to))) return bad('Geçersiz tarih aralığı.')
    // Haftalık tatiller: aralık verilmişse o aralık (en fazla 62 gün), yoksa yalnızca bu hafta
    const restFrom = from ?? mondayOf(ctx.today)
    const restTo = to && (!from || diffDays(from, to) <= 62) ? to : addDays(restFrom, from ? 62 : 6)
    let list = [...ctx.leaves, ...weeklyRestLeaves(ctx, restFrom, restTo)]
      .filter((l) => (!status || l.status === status) && (!employeeId || l.employee_id === employeeId) &&
        (!to || l.start_date <= to) && (!from || l.end_date >= from))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(withEmployee)
    if (!ctx.isManager) {
      list = list.filter((l) => l.employee_id === ctx.me.id || l.status === 'approved')
        .map((l) => (l.employee_id === ctx.me.id ? l : { ...l, reason: null, reviewer_note: null }))
    }
    return json({ requests: list })
  }),
  post('/api/leave', ({ ctx, body }) => {
    const e = EMP_BY_ID.get(str(body, 'employee_id') ?? '') ?? ctx.me
    const type = (str(body, 'leave_type') ?? 'annual') as LeaveType
    const t = nowIso()
    const weekly = type === 'weekly_rest'
    return json({
      request: {
        id: seqId('c3', 500), employee_id: e.id, leave_type: type,
        start_date: str(body, 'start_date') ?? ctx.today, end_date: str(body, 'end_date') ?? ctx.today,
        reason: str(body, 'reason') ?? null, status: weekly ? 'approved' : 'pending', reviewer_note: null,
        reviewed_at: weekly ? t : null, created_at: t, updated_at: t,
      },
      kept_worked_shifts: [],
    }, 201)
  }),
  del('/api/leave', () => json({ success: true })),
  post('/api/leave/review', ({ ctx, body }) => {
    const base = ctx.leaves.find((l) => l.id === str(body, 'request_id')) ?? ctx.leaves[3]
    const t = nowIso()
    return json({
      request: { ...base, status: str(body, 'status') ?? 'approved', reviewer_note: str(body, 'reviewer_note') ?? null, reviewed_at: t, updated_at: t },
      kept_worked_shifts: [],
    })
  }, 'manager'),
  get('/api/leave/balance', ({ ctx, q }) => {
    const requested = q.get('employee_id')
    if (requested && requested !== ctx.me.id && !ctx.isManager) return json({ error: 'Bu işlem için yetkiniz yok.', code: 'FORBIDDEN' }, 403)
    const e = (requested && EMP_BY_ID.get(requested)) || ctx.me
    return json({ balance: leaveBalance(ctx, e) })
  }),

  // ── Resmi tatiller ────────────────────────────────────────
  get('/api/holidays', ({ q }) => {
    const from = q.get('from'), to = q.get('to')
    if (!isValidDate(from) || !isValidDate(to) || from > to) return bad('Geçerli from/to tarihleri gerekli.')
    return json({ holidays: holidaysInRange(from, to) })
  }),
  post('/api/holidays', ({ body }) => json({
    holiday: { date: str(body, 'date') ?? '2026-12-31', name: (str(body, 'name') ?? 'Resmi tatil').trim(), half_day: body?.half_day === true },
  }, 201), 'store_manager'),
  del('/api/holidays', () => json({ success: true }), 'store_manager'),

  // ── Bildirimler ───────────────────────────────────────────
  get('/api/notifications', ({ ctx, q }) => {
    const limit = Math.min(parseInt(q.get('limit') ?? '50', 10) || 50, 100)
    return json({ notifications: buildNotifications(ctx).slice(0, limit) })
  }),
  post('/api/notifications', ({ body }) => json({
    notification: {
      id: seqId('9b', 900), employee_id: str(body, 'employee_id') ?? empId(5), type: str(body, 'type') ?? 'shift_reminder',
      title: str(body, 'title') ?? '', message: str(body, 'message') ?? '', is_read: false,
      related_id: str(body, 'related_id') ?? null, created_at: nowIso(),
    },
  }, 201), 'manager'),
  patch('/api/notifications/read', () => json({ success: true })),
  patch('/api/notifications/read-all', () => json({ success: true })),

  // ── Raporlar ──────────────────────────────────────────────
  get('/api/reports/attendance', ({ ctx, q }) => {
    const from = q.get('date_from'), to = q.get('date_to')
    if (!isValidDate(from) || !isValidDate(to)) return bad('Geçersiz tarih formatı.')
    if (to < from) return bad('Bitiş tarihi başlangıç tarihinden önce olamaz.')
    if (diffDays(from, to) > 366) return bad('Tarih aralığı en fazla 366 gün olabilir.')
    return json({ rows: attendanceReport(ctx, from, to, q.get('employee_id') || null) })
  }, 'manager'),
  get('/api/reports/my', ({ ctx, q }) => {
    const from = q.get('date_from'), to = q.get('date_to')
    if (!isValidDate(from) || !isValidDate(to)) return bad('date_from ve date_to (YYYY-MM-DD) zorunludur.')
    if (to < from) return bad('Geçersiz tarih aralığı.')
    if (diffDays(from, to) > 366) return bad('Tarih aralığı en fazla 366 gün olabilir.')
    return json({ rows: myReport(ctx, from, to) })
  }),
  get('/api/reports/timesheet', ({ ctx, q }) => {
    const month = q.get('month') ?? ''
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return bad('month YYYY-MM formatında olmalıdır.')
    if (q.get('format') === 'xlsx') return json({ error: 'studio: Excel dosyası taklit edilmez.', code: 'STUDIO_BINARY' }, 501)
    return json(timesheet(ctx, month))
  }, 'manager'),
  get('/api/reports/overtime', ({ ctx, q }) => {
    const year = Number(q.get('year'))
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return bad('Geçerli bir yıl giriniz.')
    return json(overtime(ctx, year))
  }, 'manager'),

  // ── Denetim kaydı ─────────────────────────────────────────
  get('/api/audit-logs', ({ ctx, q }) => {
    const limit = Math.min(Math.max(parseInt(q.get('limit') ?? '50', 10) || 50, 1), 200)
    const before = q.get('before'), entityType = q.get('entity_type'), action = q.get('action')
    const all = buildAuditLogs(ctx)
    const page = all
      .filter((l) => (!before || l.created_at < new Date(before).toISOString()) &&
        (!entityType || l.entity_type === entityType) && (!action || l.action.startsWith(action)))
      .slice(0, limit)
    const roles: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.id, r.name]))
    const employees: Record<string, string> = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e.full_name]))
    return json({ logs: page, refs: { employees, roles }, next_before: page.length === limit ? page[page.length - 1].created_at : null })
  }, 'store_manager'),

  // ── Müsaitlik ─────────────────────────────────────────────
  get('/api/availability', ({ ctx, q }) => {
    const all = q.get('all') === 'true' && ctx.isManager
    const target = ctx.isManager ? (q.get('employee_id') ?? ctx.me.id) : ctx.me.id
    return json({ availability: buildAvailability().filter((a) => all || a.employee_id === target) })
  }),
  post('/api/availability', ({ ctx, body }) => {
    const t = nowIso()
    return json({
      availability: {
        id: seqId('a5', 900), employee_id: str(body, 'employee_id') ?? ctx.me.id,
        day_of_week: (str(body, 'day_of_week') ?? 'monday') as DayOfWeek,
        start_time: `${(str(body, 'start_time') ?? '09:00').slice(0, 5)}:00`, end_time: `${(str(body, 'end_time') ?? '17:00').slice(0, 5)}:00`,
        is_available: body?.is_available !== false, note: str(body, 'note')?.trim() || null, created_at: t, updated_at: t,
      },
    }, 201)
  }),
  del('/api/availability', () => json({ success: true })),

  // ── Açık vardiyalar ───────────────────────────────────────
  get('/api/open-shifts', ({ ctx, q }) => {
    const status = q.get('status'), date = q.get('date')
    if (status && !['open', 'filled', 'cancelled'].includes(status)) return bad('Geçersiz durum filtresi.')
    return json({ open_shifts: buildOpenShifts(ctx).filter((o) => (!status || o.status === status) && (!date || o.work_date === date)) })
  }),
  post('/api/open-shifts', ({ ctx, body }) => {
    const t = nowIso()
    return json({
      open_shift: {
        id: seqId('0f', 900), work_date: str(body, 'work_date') ?? addDays(ctx.today, 1),
        start_time: `${(str(body, 'start_time') ?? '10:00').slice(0, 5)}:00`, end_time: `${(str(body, 'end_time') ?? '18:00').slice(0, 5)}:00`,
        role_needed: str(body, 'role_needed')?.trim() || null, description: str(body, 'description')?.trim() || null,
        status: 'open', filled_by: null, filled_assignment_id: null, created_at: t, updated_at: t,
      },
    }, 201)
  }, 'manager'),
  patch('/api/open-shifts', ({ ctx, body }) => {
    const base = buildOpenShifts(ctx).find((o) => o.id === str(body, 'id')) ?? buildOpenShifts(ctx)[0]
    const { filled_by_employee: _f, ...row } = base
    return json({ open_shift: { ...row, ...(str(body, 'status') ? { status: str(body, 'status') } : {}), updated_at: nowIso() } })
  }, 'manager'),
  post('/api/open-shifts/claim', ({ ctx, body }) => {
    const base = buildOpenShifts(ctx).find((o) => o.id === str(body, 'open_shift_id')) ?? buildOpenShifts(ctx)[0]
    const { filled_by_employee: _f, ...row } = base
    const assignmentId = shiftId(ctx.me.n, base.work_date)
    return json({
      open_shift: { ...row, status: 'filled', filled_by: ctx.me.id, filled_assignment_id: assignmentId, updated_at: nowIso() },
      shift_assignment_id: assignmentId,
      warnings: [],
    })
  }),

  // ── Vardiya takası ────────────────────────────────────────
  get('/api/shift-swap', ({ ctx, q }) => {
    const status = q.get('status')
    if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) return bad('Geçersiz durum filtresi.')
    return json({
      swap_requests: buildSwaps(ctx).filter((s) => (!status || s.status === status) &&
        (ctx.isManager || s.requester_id === ctx.me.id || s.target_id === ctx.me.id)),
    })
  }),
  post('/api/shift-swap', ({ ctx, body }) => {
    const t = nowIso()
    return json({
      swap_request: {
        id: seqId('5b', 900), requester_id: ctx.me.id, requester_shift_id: str(body, 'requester_shift_id') ?? null,
        target_id: str(body, 'target_id') ?? null, target_shift_id: str(body, 'target_shift_id') ?? null, status: 'pending',
        target_accepted_at: null, reviewed_by: null, requester_note: str(body, 'requester_note') ?? null, reviewer_note: null,
        reviewed_at: null, created_at: t, updated_at: t,
      },
    }, 201)
  }),
  post('/api/shift-swap/review', ({ ctx, body }) => {
    const swaps = buildSwaps(ctx)
    const base = swaps.find((s) => s.id === str(body, 'swap_id')) ?? swaps[0]
    const { requester: _r, target: _t, requester_shift: _rs, target_shift: _ts, ...row } = base
    const t = nowIso()
    const action = str(body, 'status') ?? 'approved'
    const patchRow = action === 'accepted'
      ? { target_accepted_at: t, updated_at: t }
      : action === 'declined'
        ? { status: 'rejected', reviewer_note: 'Karşı taraf teklifi reddetti.', reviewed_at: t, updated_at: t }
        : { status: action, reviewed_by: ctx.me.id, reviewer_note: str(body, 'reviewer_note') ?? null, reviewed_at: t, updated_at: t }
    return json({ swap_request: { ...row, ...patchRow }, warnings: [] })
  }),

  // ── Mesai düzeltme ────────────────────────────────────────
  get('/api/time-correction', ({ ctx, q }) => {
    const status = q.get('status')
    if (status && !['pending', 'approved', 'rejected', 'direct'].includes(status)) return bad('Geçersiz durum filtresi.')
    return json({
      requests: ctx.corrections.filter((c) => (ctx.isManager || c.employee_id === ctx.me.id) && (!status || c.status === status)),
    })
  }),
  post('/api/time-correction', ({ ctx, body }) => {
    const direct = body?.direct === true
    if (direct && !ctx.isManager) return json({ error: 'Bu işlem için yetkiniz yok.', code: 'FORBIDDEN' }, 403)
    const e = (direct && EMP_BY_ID.get(str(body, 'employee_id') ?? '')) || ctx.me
    const t = nowIso()
    return json({
      request: {
        id: seqId('7c', 900), employee_id: e.id, date: str(body, 'date') ?? addDays(ctx.today, -1),
        requested_start_time: `${(str(body, 'requested_start_time') ?? '10:00').slice(0, 5)}:00`,
        requested_end_time: `${(str(body, 'requested_end_time') ?? '18:00').slice(0, 5)}:00`,
        break_minutes: typeof body?.break_minutes === 'number' ? body.break_minutes : null,
        reason: str(body, 'reason') ?? '', status: direct ? 'direct' : 'pending',
        reviewed_by: direct ? ctx.me.id : null, reviewed_at: direct ? t : null, reviewer_note: null, created_at: t, updated_at: t,
      },
    }, 201)
  }),
  post('/api/time-correction/review', ({ ctx, body }) => {
    const base = ctx.corrections.find((c) => c.id === str(body, 'request_id')) ?? ctx.corrections[0]
    const { employee: _e, reviewer: _r, ...row } = base
    const t = nowIso()
    return json({
      request: { ...row, status: str(body, 'status') ?? 'approved', reviewed_by: ctx.me.id, reviewed_at: t, reviewer_note: str(body, 'reviewer_note') ?? null, updated_at: t },
      warnings: [],
    })
  }, 'manager'),

  // ── İş gücü planlama ──────────────────────────────────────
  get('/api/workforce/planning', ({ ctx, q }) => {
    const ref = q.get('week') ?? ctx.today
    if (!isValidDate(ref)) return bad('Geçersiz week parametresi.')
    return json(planning(ctx, ref))
  }, 'manager'),
  post('/api/workforce/generate', ({ ctx, body }) => {
    const ref = str(body, 'week') ?? ctx.today
    if (!isValidDate(ref)) return bad('Geçersiz week parametresi.')
    return json(generateDraft(ctx, ref))
  }, 'manager'),
  post('/api/workforce/apply', ({ body }) => {
    const n = Array.isArray(body?.assignments) ? (body!.assignments as unknown[]).length : 0
    return json({ created: n, replaced: Math.max(0, n - 6), skipped: 0, restDays: 14, warnings: [], errors: [] })
  }, 'manager'),
]
