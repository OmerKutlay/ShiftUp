/**
 * reportExports — Raporlar sekmelerinin CSV ve PDF çıktıları (saf tablo üreticileri + indirme).
 * Her rapor ekrandaki satırları (arama/filtre uygulanmış) dışa aktarır; CSV'de sayılar ondalık virgüllü
 * sayı olarak, PDF'te ekranla aynı biçimde yazılır.
 */
import { monthDays, TIMESHEET_CODE_COLORS, type TimesheetRow } from '@/lib/timesheet'
import type { OvertimeSummary } from '@/lib/overtime'
import type { PayrollRow } from '@/lib/payrollTimesheet'
import { ANNUAL_OVERTIME_CAP_HOURS } from '@/lib/laborLaw'
import { dayOfWeekFromDateString } from '@/lib/dateUtils'
import type { PublicHoliday } from '@/types/holiday'
import { toCsv } from '@/lib/export/csv'
import {
  buildExportTable, EXPORT_CODE_LEGEND, EXPORT_NOTES, exportDayValue, holidayWorkedMins, WEEKDAY_SHORT,
} from '@/lib/timesheetExport'
import { saveCsv } from '@/lib/export/download'
import { storeFileSlug } from '@/lib/export/fileName'
import { downloadPdf } from '@/lib/export/pdf'
import { monthLabel } from './timesheetSummary'

type Cell = string | number
/** Sayı biçimi: CSV için sayı (ondalık virgülü csvCell yazar), PDF için Türkçe metin */
type NumFmt = (n: number) => Cell

const csvFmt: NumFmt = (n) => n
const pdfFmt: NumFmt = (n) => n.toLocaleString('tr-TR')
/** Dakika → bir ondalıklı saat */
const h1 = (mins: number) => Math.round((mins / 60) * 10) / 10
const subtitle = (...parts: string[]) => parts.filter(Boolean).join(' · ')

export const WEEKDAY_INITIALS = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct']

// ─── Aylık puantaj ────────────────────────────────────────────

/**
 * PDF: CSV/Excel ile aynı gün kodları (O, Y, R, Ü, Z, D, G, B) ve aynı hesaplar; A4 yatay sayfaya sığması için
 * sayaç ve haftalık sütunlar yerine özet: %50 = haftalık 45 saat üstü, HT = hafta tatilinde çalışma, %100 = resmi tatil.
 */
const TIMESHEET_TOTALS = ['Çalışılan gün', 'Net s', '%50 s', 'HT s', '%100 s', 'Gece s', 'SGK gün']

function timesheetPdfBody(rows: TimesheetRow[], days: string[]): Cell[][] {
  return rows.map((r) => [
    r.employee.full_name,
    ...days.map((d) => {
      const v = exportDayValue(r, d)
      return typeof v === 'number' ? pdfFmt(v) : v
    }),
    r.workedDays,
    pdfFmt(h1(r.workedMins)),
    pdfFmt(h1(r.overtimeMins)),
    pdfFmt(h1(r.restWorkMins ?? 0)),
    pdfFmt(h1(holidayWorkedMins(r, days))),
    pdfFmt(h1(r.nightMins)),
    r.sgkDays,
  ])
}

const TIMESHEET_LEGEND = `Kodlar: ${EXPORT_CODE_LEGEND.map((l) => `${l.code} ${l.label}`).join(' · ')}`

/** "C6EFCE" → [198, 239, 206] */
const rgb = (hex: string): [number, number, number] =>
  [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/**
 * Aylık puantaj CSV'si — klasik aylık puantaj çizelgesi düzeni (bkz. timesheetExport):
 *   1. satır başlık ("EYLÜL 2026 - PUANTAJ · Mağaza"), 2. satır sütun grupları, 3. satır haftanın günleri,
 *   4. satır sütun başlıkları; ardından çalışanlar, en altta kod açıklamaları.
 */
export function timesheetCsv(month: string, rows: TimesheetRow[], storeName: string): string {
  const t = buildExportTable(month, rows, storeName)
  const width = t.header.length
  const blank = () => Array<string>(width).fill('')
  const groupRow = blank()
  for (const g of t.groups) groupRow[g.start] = g.label
  const weekdayRow = blank()
  weekdayRow[t.firstDayCol - 1] = 'Hafta Günü'
  t.days.forEach((d, i) => { weekdayRow[t.firstDayCol + i] = WEEKDAY_SHORT[dayOfWeekFromDateString(d)] })
  const legend = [
    [],
    ['', 'Kod', 'Açıklama'],
    ...EXPORT_CODE_LEGEND.map((l) => ['', l.code, l.label]),
    [],
    ...EXPORT_NOTES.map((n) => ['', n]),
  ]
  return toCsv([storeName ? `${t.title} · ${storeName}` : t.title], [groupRow, weekdayRow, t.header, ...t.body, ...legend])
}

export function exportTimesheetCsv(month: string, rows: TimesheetRow[], storeName: string) {
  saveCsv(timesheetCsv(month, rows, storeName), `puantaj-${storeFileSlug(storeName)}-${month}.csv`)
}

export function exportTimesheetPdf(month: string, rows: TimesheetRow[], holidays: PublicHoliday[], storeName: string, filter?: string) {
  const days = monthDays(month)
  // Puantaj verisi komşu ayların günlerini de kapsar: yalnızca bu ayın tatilleri listelenir
  const monthHolidays = holidays.filter((x) => x.date.startsWith(month))
  const holidayMap = new Map(monthHolidays.map((x) => [x.date, x]))
  const first = 1
  const lastDay = first + days.length
  return downloadPdf({
    title: 'Aylık puantaj',
    subtitle: subtitle(storeName, monthLabel(month)),
    meta: [
      `${rows.length} çalışan · saatler mola düşülmüş net çalışmadır`,
      ...(filter ? [`Filtre: ${filter}`] : []),
    ],
    head: ['Çalışan', ...days.map((d) => `${Number(d.slice(8))}\n${WEEKDAY_INITIALS[dayOfWeekFromDateString(d)]}`), ...TIMESHEET_TOTALS],
    body: timesheetPdfBody(rows, days),
    orientation: 'landscape',
    fontSize: 6.5,
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold' },
      ...Object.fromEntries(days.map((_, i) => [first + i, { halign: 'center', cellPadding: 0.6 }])),
      ...Object.fromEntries(TIMESHEET_TOTALS.map((_, i) => [lastDay + i, { halign: 'right', cellWidth: i === 0 ? 12 : 10 }])),
    },
    // Kodlu günler durum rengine boyanır; boş günlerde resmi tatil ve hafta sonu sütunları açık zeminli
    cellStyle: (row, col) => {
      if (col < first || col >= lastDay) return undefined
      const d = days[col - first]
      const code = rows[row]?.days[d]
      const style = code === 'D' ? { fontStyle: 'bold' as const } : {}
      if (code && code !== 'P') {
        const c = TIMESHEET_CODE_COLORS[code]
        return { ...style, fillColor: rgb(c.fill), textColor: rgb(c.text) }
      }
      if (holidayMap.has(d)) return { ...style, fillColor: [250, 240, 214] }
      const w = dayOfWeekFromDateString(d)
      return w === 0 || w === 6 ? { ...style, fillColor: [240, 240, 242] } : style
    },
    notes: [
      TIMESHEET_LEGEND,
      ...(monthHolidays.length > 0
        ? [`Resmi tatiller: ${monthHolidays.map((x) => `${Number(x.date.slice(8))} ${x.name}${x.half_day ? ' (yarım gün, normal gün sayılır)' : ''}`).join(' · ')}`]
        : []),
      ...EXPORT_NOTES,
    ],
    filename: `puantaj-${storeFileSlug(storeName)}-${month}.pdf`,
  })
}

// ─── Fazla çalışma ────────────────────────────────────────────

const OVERTIME_HEAD = [
  'Çalışan', 'Fazla çalışma (s)', `Yıllık sınır (${ANNUAL_OVERTIME_CAP_HOURS} s) oranı %`, 'Kalan (s)',
  'Fazla çalışılan hafta', 'Yazılı onay',
]

/** 2026-03-14 → 14.03.2026 */
const trDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`

function overtimeBody(rows: OvertimeSummary[], fmt: NumFmt): Cell[][] {
  return rows.map((s) => [
    s.full_name,
    fmt(h1(s.totalOvertimeMins)),
    Math.round(s.capRatio * 100),
    fmt(h1(s.capMins - s.totalOvertimeMins)),
    s.weeks.length,
    s.consent_at ? `Var (${trDate(s.consent_at.slice(0, 10))})` : 'Yok',
  ])
}

export function exportOvertimeCsv(year: number, rows: OvertimeSummary[], storeName: string) {
  saveCsv(toCsv(OVERTIME_HEAD, overtimeBody(rows, csvFmt)), `fazla-calisma-${storeFileSlug(storeName)}-${year}.csv`)
}

export function exportOvertimePdf(year: number, rows: OvertimeSummary[], storeName: string, filter?: string) {
  const total = rows.reduce((t, s) => t + s.totalOvertimeMins, 0)
  return downloadPdf({
    title: 'Yıllık fazla çalışma',
    subtitle: subtitle(storeName, String(year)),
    meta: [
      `${rows.length} çalışan · toplam ${pdfFmt(h1(total))} saat · sınırı aşan ${rows.filter((s) => s.overCap).length} · yazılı onayı eksik ${rows.filter((s) => !s.consent_at).length}`,
      ...(filter ? [`Filtre: ${filter}`] : []),
    ],
    head: OVERTIME_HEAD,
    body: overtimeBody(rows, pdfFmt),
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
    },
    // Sınırı aşanlar kalın; kalan sütunu negatif değer gösterir
    cellStyle: (row) => (rows[row]?.overCap ? { fontStyle: 'bold' } : undefined),
    notes: [
      `İş Kanunu Md. 41: haftalık 45 saati aşan net çalışma fazla çalışmadır; yıllık üst sınır ${ANNUAL_OVERTIME_CAP_HOURS} saattir ve çalışanın yazılı onayı gerekir. Negatif "Kalan" sınırın aşıldığını gösterir.`,
    ],
    filename: `fazla-calisma-${storeFileSlug(storeName)}-${year}.pdf`,
  })
}

// ─── Bordro puantajı (PDF; CSV/Excel sunucudan) ──────────────

export function exportPayrollPdf(month: string, rows: PayrollRow[], storeName: string) {
  const n = (v: number) => (v === 0 ? '—' : v.toLocaleString('tr-TR'))
  return downloadPdf({
    title: 'Bordro puantajı',
    subtitle: subtitle(storeName, monthLabel(month)),
    meta: [`${rows.length} çalışan · Sicil ve TC kimlik no saklanmaz; muhasebe doldurur. Ay bitmeden alınan çıktı geçicidir.`],
    head: [
      'Çalışan', 'Çalışılan gün', 'Normal s', 'Fazla s (%50)', 'Hafta tatili çalışma s (%50)', 'Genel tatil çalışılan gün', 'Hafta tatili',
      'Yıllık izin', 'Rapor', 'Ücretsiz izin', 'Devamsız', 'Eksik gün', 'Eksik gün nedeni', 'SGK gün',
    ],
    body: rows.map((r) => [
      r.noRecords ? `${r.fullName}\n(ay içinde kayıt yok)` : r.fullName,
      n(r.workedDays), n(r.normalHours), n(r.overtimeHours), n(r.restWorkedHours), n(r.holidayWorkedDays), n(r.weeklyRestDays),
      n(r.annualLeaveDays), n(r.sickDays), n(r.unpaidDays), n(r.absentDays), n(r.missingDays),
      r.missingReasonCode || '—', r.sgkDays,
    ]),
    orientation: 'landscape',
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 48 },
      ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 1, { halign: 'right' }])),
    },
    filename: `bordro-puantaj-${month}-${storeFileSlug(storeName)}.pdf`,
  })
}
