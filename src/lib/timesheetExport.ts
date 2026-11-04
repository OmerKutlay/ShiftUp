/**
 * timesheetExport — aylık puantajın CSV ve Excel çıktılarının ortak tablosu (saf, DB'siz).
 *
 * Düzen, şirketlerde elle tutulan klasik aylık puantaj çizelgesini izler:
 *   S.NO · Adı Soyadı · Birim/Şube · Görevi · ayın her günü bir sütun
 *   → PUANTAJ BİLGİLERİ: çalışılan gün ve kod sayaçları (Ü R O D G B Y Z), Toplam Gün (SGK)
 *   → FAZLA MESAİ BİLGİLERİ: hafta hafta %50 (45 saat üstü) ve HT (hafta tatilinde çalışma),
 *     TOPLAM %50 (ikisinin toplamı), TOPLAM %100 (resmi tatil)
 *   → ek bilgiler: net saat, gece çalışması, not
 *
 * Gün hücresi: çalışılan günde net saat (sayı), diğer günlerde tek harfli kod (EXPORT_DAY_CODES).
 * Ekrandaki puantaj kodları (HT, Yİ, Rİ…) bu çizelgenin harflerine çevrilir.
 */
import { monthDays, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'
import { addDaysToDateString, dayOfWeekFromDateString } from '@/lib/dateUtils'

/** Çizelgede gün hücresine yazılan kodlar */
export type ExportDayCode = 'Ç' | 'B' | 'O' | 'G' | 'Y' | 'R' | 'Ü' | 'Z' | 'D' | ''

/** Ekran kodu → çizelge kodu. Planlı (P, henüz gerçekleşmedi) gün boş bırakılır. */
const EXPORT_CODE: Record<Exclude<TimesheetCode, ''>, ExportDayCode> = {
  'Ç': 'Ç', 'HTÇ': 'Ç', 'RTÇ': 'B', 'HT': 'O', 'RT': 'G', 'Yİ': 'Y', 'Rİ': 'R', 'Üİ': 'Ü', 'Mİ': 'Z', 'D': 'D', 'P': '',
}

/** Kod açıklamaları (çizelgenin "Açıklamalar" bölümü); `screen` = uygulamadaki karşılığı (renk için) */
export const EXPORT_CODE_LEGEND: ReadonlyArray<{ code: string; label: string; screen: Exclude<TimesheetCode, ''> }> = [
  { code: '7,5', label: 'Çalışılan gün — hücrede net çalışma saati yazar (molalar düşülmüş)', screen: 'Ç' },
  { code: 'Ç', label: 'Çalışılan gün — saat hesaplanamadı (çıkış okutulmamış)', screen: 'Ç' },
  { code: '7,5', label: 'Hafta tatilinde çalışılan gün — hücrede net saat (turkuaz hücre); saatler haftanın HT sütununda', screen: 'HTÇ' },
  { code: 'B', label: 'Çalışılan resmi tatil günü (saat yazılıysa turuncu hücre)', screen: 'RTÇ' },
  { code: 'G', label: 'Resmi tatil izni (resmi tatil, çalışılmadı)', screen: 'RT' },
  { code: 'O', label: 'Haftalık izin kullanılan gün (hafta tatili)', screen: 'HT' },
  { code: 'Y', label: 'Yıllık izin kullanılan gün', screen: 'Yİ' },
  { code: 'Z', label: 'Ücretli izin kullanılan gün (mazeret / diğer ücretli izin)', screen: 'Mİ' },
  { code: 'R', label: 'Raporlu olunan gün', screen: 'Rİ' },
  { code: 'Ü', label: 'Ücretsiz izin kullanılan gün', screen: 'Üİ' },
  { code: 'D', label: 'Devamsızlık yapılan gün (planlı vardiyaya gelinmedi)', screen: 'D' },
]

export const EXPORT_NOTES: readonly string[] = [
  'Toplam Gün (SGK): ay 30 gün kabul edilir; işte olunan günden (ay içi işe giriş / işten çıkış dahil) ücretsiz izin (Ü), rapor (R) ve devamsızlık (D) günleri düşülür — bordro puantajıyla aynı. Girişten önceki ve çıkıştan sonraki günler boştur.',
  'Haftalık %50: Pazartesi–Pazar haftasında 45 saati aşan net çalışma (İş K. Md. 41). Hafta, Pazar günü hangi aydaysa o ayın puantajına yazılır.',
  'Haftalık HT: haftalık tatil gününde çalışılan net saat (hafta tatilinde çalışma, %50 zamlı). Bu saatler 45 saat hesabına girmez; TOPLAM %50 = haftalık %50 + HT.',
  'TOPLAM %100: tam gün resmi tatilde çalışılan net saat (İş K. Md. 47). Yarım gün tatil (arife) normal gün sayılır.',
  'Gece çalışması: 20:00–06:00 arasına düşen fiili çalışma (İş K. Md. 69). Boş gün: kayıt yok ya da henüz gerçekleşmedi.',
]

const MONTHS_UPPER = ['OCAK', 'ŞUBAT', 'MART', 'NİSAN', 'MAYIS', 'HAZİRAN', 'TEMMUZ', 'AĞUSTOS', 'EYLÜL', 'EKİM', 'KASIM', 'ARALIK']
/** Pazar = 0 */
export const WEEKDAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI']

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

/** "2026-09" → "Eylül 2026" (Excel sayfa adı) */
export function monthName(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

/**
 * Takvim haftası şeridi (0-tabanlı): ayın ilk Pazartesi–Pazar haftası 0. Gün numarası başlığı ve
 * haftalık fazla mesai sütunları bu şeride göre renklenir.
 */
export function weekBand(month: string, date: string): number {
  const offset = (dayOfWeekFromDateString(`${month}-01`) + 6) % 7
  return Math.floor((Number(date.slice(8, 10)) - 1 + offset) / 7)
}

/** "2026-09" → "EYLÜL 2026 - PUANTAJ" */
export function timesheetTitle(month: string): string {
  return `${MONTHS_UPPER[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)} - PUANTAJ`
}

export interface ExportWeek {
  monday: string
  sunday: string
  /** "I. HAFTA %50 (31.08–06.09)" */
  label: string
  /** "I. HAFTA HT" — hafta tatilinde çalışma */
  restLabel: string
}

/** 2026-08-31 → 31.08 */
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

/** Fazla mesai haftaları: Pazar'ı bu ayda olan Pazartesi–Pazar haftaları (timesheet.ts ile aynı kural) */
export function exportWeeks(month: string): ExportWeek[] {
  return monthDays(month)
    .filter((d) => dayOfWeekFromDateString(d) === 0)
    .map((sunday, i) => {
      const monday = addDaysToDateString(sunday, -6)
      return { monday, sunday, label: `${ROMAN[i]}. HAFTA %50 (${dm(monday)}–${dm(sunday)})`, restLabel: `${ROMAN[i]}. HAFTA HT` }
    })
}

/** Dakika → saat (2 ondalık) */
const hours = (mins: number) => Math.round((mins / 60) * 100) / 100

/** Gün hücresi: çalışılan günde net saat (1 ondalık), diğer günlerde çizelge kodu */
export function exportDayValue(row: TimesheetRow, date: string): number | ExportDayCode {
  const code = row.days[date] ?? ''
  if (code === '') return ''
  const mins = row.dayMins[date] ?? 0
  if ((code === 'Ç' || code === 'RTÇ' || code === 'HTÇ') && mins > 0) return Math.round((mins / 60) * 10) / 10
  return EXPORT_CODE[code]
}

/** Tam gün resmi tatilde çalışılan net dakika (RTÇ günleri) — TOPLAM %100 */
export function holidayWorkedMins(r: TimesheetRow, days: string[]): number {
  return days.reduce((t, d) => t + (r.days[d] === 'RTÇ' ? r.dayMins[d] ?? 0 : 0), 0)
}

/** Sayaç sütunları — gerçek çizelgedeki sıra */
export const COUNT_HEADERS = ['Ü', 'R', 'O', 'D', 'G', 'B', 'Y', 'Z'] as const

export interface ExportTable {
  title: string
  days: string[]
  weeks: ExportWeek[]
  /** Sütun başlıkları (tek satır) */
  header: string[]
  /** Sütun grupları: [başlık, ilk sütun (0-tabanlı), sütun sayısı] */
  groups: Array<{ label: string; start: number; span: number }>
  body: Array<Array<string | number>>
  /** Gün sütunlarının başladığı indeks (0-tabanlı) */
  firstDayCol: number
}

export function buildExportTable(month: string, rows: TimesheetRow[], storeName: string): ExportTable {
  const days = monthDays(month)
  const weeks = exportWeeks(month)
  const lead = ['S.NO', 'Adı Soyadı', 'Birim/Şube', 'Görevi']
  const info = ['Çalışılan Gün', ...COUNT_HEADERS, 'Toplam Gün (SGK)']
  const overtime = [...weeks.flatMap((w) => [w.label, w.restLabel]), 'TOPLAM %50', 'TOPLAM %100']
  const extra = ['Net Saat', 'Gece Çalışması (s)', 'Not']
  const header = [...lead, ...days.map((d) => String(Number(d.slice(8)))), ...info, ...overtime, ...extra]

  const firstDayCol = lead.length
  const infoStart = firstDayCol + days.length
  const groups = [
    { label: timesheetTitle(month), start: firstDayCol, span: days.length },
    { label: 'PUANTAJ BİLGİLERİ', start: infoStart, span: info.length },
    { label: 'FAZLA MESAİ BİLGİLERİ', start: infoStart + info.length, span: overtime.length },
    { label: 'EK BİLGİLER', start: infoStart + info.length + overtime.length, span: extra.length },
  ]

  const body = rows.map((r, i) => {
    const holidayRest = days.filter((d) => r.days[d] === 'RT').length
    const counts: Record<(typeof COUNT_HEADERS)[number], number> = {
      'Ü': r.leaveDays['Üİ'],
      'R': r.leaveDays['Rİ'],
      'O': r.leaveDays['HT'],
      'D': r.absentDays,
      'G': holidayRest,
      'B': r.holidayWorkedDays,
      'Y': r.leaveDays['Yİ'],
      'Z': r.leaveDays['Mİ'],
    }
    const weekMins = weeks.flatMap((w) => [
      hours(r.overtimeByWeek?.[w.sunday] ?? 0),
      hours(r.restWorkByWeek?.[w.sunday] ?? 0),
    ])
    return [
      i + 1,
      r.employee.full_name,
      storeName,
      r.employee.role_name,
      ...days.map((d) => exportDayValue(r, d)),
      r.workedDays,
      ...COUNT_HEADERS.map((c) => counts[c]),
      r.sgkDays,
      ...weekMins,
      hours(r.overtimeMins + (r.restWorkMins ?? 0)),
      hours(holidayWorkedMins(r, days)),
      hours(r.workedMins),
      hours(r.nightMins),
      r.overtimeWithoutConsent ? 'Fazla çalışma için yazılı onay yok' : '',
    ]
  })

  return { title: timesheetTitle(month), days, weeks, header, groups, body, firstDayCol }
}
