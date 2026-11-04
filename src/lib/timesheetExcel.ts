/**
 * timesheetExcel — aylık puantajı .xlsx olarak üretir (yalnızca tarayıcıda, indirme anında yüklenir).
 *
 * Düzen klasik aylık puantaj çizelgesidir (sütunlar ve kodlar: timesheetExport, CSV ile aynı tablo):
 *   1. satır haftanın günleri, 2. satır gün numaraları (takvim haftasına göre renkli şerit),
 *   3. satır sütun grupları ("EYLÜL 2026 - PUANTAJ", "PUANTAJ BİLGİLERİ", "FAZLA MESAİ BİLGİLERİ"),
 *   4. satır sütun başlıkları; her çalışan bir satır, en altta toplam satırı.
 * Gün hücreleri durum rengine boyanır. İkinci sayfa "Açıklamalar": kodlar, resmi tatiller, notlar.
 */
import { TIMESHEET_CODE_COLORS, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'
import {
  buildExportTable, EXPORT_CODE_LEGEND, EXPORT_NOTES, monthName, WEEKDAY_SHORT, weekBand,
} from '@/lib/timesheetExport'
import { dayOfWeekFromDateString } from '@/lib/dateUtils'
import type { PublicHoliday } from '@/types/holiday'
import type { Borders, Cell, Fill } from 'exceljs'

export { storeFileSlug } from '@/lib/export/fileName'

/** Excel'de formül olarak yorumlanabilecek metinleri kaçışlar */
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const HEADER_FILL = solid('FFFFFF99')
const NAME_FILL = solid('FFCCFFCC')
const HOLIDAY_FILL = solid('FFFDE68A')
/** Takvim haftası şeritleri (gün numarası başlığı ve haftalık fazla mesai sütunları) */
const BAND_FILLS = ['FF9BC2E6', 'FFE0A886', 'FFA9D08E', 'FFD694BE', 'FFDBE975', 'FFB4C6E7'].map(solid)
const thin = { style: 'thin' as const, color: { argb: 'FF808080' } }
const BORDER: Partial<Borders> = { top: thin, bottom: thin, left: thin, right: thin }

/** Hücreyi durum rengine boyar (zemin + yazı rengi) */
function paint(cell: Cell, code: Exclude<TimesheetCode, ''>, bold = false, size?: number) {
  const c = TIMESHEET_CODE_COLORS[code]
  cell.fill = solid(`FF${c.fill}`)
  cell.font = { color: { argb: `FF${c.text}` }, bold: bold || code === 'D', size }
}

export async function buildTimesheetWorkbook(
  month: string,
  rows: TimesheetRow[],
  holidays: PublicHoliday[],
  storeName?: string
): Promise<Uint8Array> {
  // Ağır kütüphane: yalnızca kullanıcı Excel indirirken (tarayıcıda) yüklenir
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ShiftUp'
  wb.created = new Date()
  if (storeName) wb.title = `Puantaj — ${storeName} — ${month}`

  const t = buildExportTable(month, rows, storeName ?? '')
  const holidaySet = new Set(holidays.filter((h) => !h.half_day).map((h) => h.date))
  const HEAD = 4
  const ws = wb.addWorksheet(monthName(month), { views: [{ state: 'frozen', xSplit: t.firstDayCol, ySplit: HEAD }] })
  const col = (i: number) => i + 1                     // 0-tabanlı tablo sütunu → Excel sütunu
  const dayCol = (i: number) => col(t.firstDayCol + i)
  const width = t.header.length
  const [, info, overtime, extra] = t.groups

  // ── Başlık satırları ──
  ws.getCell(1, 1).value = 'S.NO'
  ws.mergeCells(1, 1, HEAD, 1)
  ws.getCell(1, 2).value = 'Hafta Günü'
  ws.mergeCells(1, 2, 1, t.firstDayCol)
  ws.getCell(2, 2).value = 'Gün'
  ws.mergeCells(2, 2, 2, t.firstDayCol)
  ;['Adı Soyadı', 'Birim/Şube', 'Görevi'].forEach((label, i) => {
    ws.getCell(3, 2 + i).value = label
    ws.mergeCells(3, 2 + i, HEAD, 2 + i)
  })
  t.days.forEach((d, i) => {
    ws.getCell(1, dayCol(i)).value = WEEKDAY_SHORT[dayOfWeekFromDateString(d)]
    const num = ws.getCell(2, dayCol(i))
    num.value = Number(d.slice(8))
    num.fill = BAND_FILLS[weekBand(month, d) % BAND_FILLS.length]
    ws.getCell(HEAD, dayCol(i)).value = Number(d.slice(8))
  })
  for (const g of t.groups) {
    ws.getCell(3, col(g.start)).value = g.label
    ws.mergeCells(3, col(g.start), 3, col(g.start + g.span - 1))
  }
  // Satır 1–2 gün dışı sütunlarda boş: grup başlıklarıyla birlikte 1–3 arası birleştirilir
  for (const g of [info, overtime, extra]) ws.mergeCells(1, col(g.start), 2, col(g.start + g.span - 1))
  for (let i = info.start; i < width; i++) ws.getCell(HEAD, col(i)).value = t.header[i]

  for (let r = 1; r <= HEAD; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c)
      cell.font = { bold: true, size: r === 3 ? 11 : 9 }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = BORDER
      if (!cell.fill || cell.fill.type !== 'pattern') cell.fill = HEADER_FILL
    }
  }
  // Resmi tatil sütunları başlıkta vurgulanır; haftalık %50 sütunları haftanın şerit rengini alır
  t.days.forEach((d, i) => {
    if (!holidaySet.has(d)) return
    for (const r of [1, HEAD]) ws.getCell(r, dayCol(i)).fill = HOLIDAY_FILL
  })
  t.weeks.forEach((w, i) => {
    const fill = BAND_FILLS[weekBand(month, w.sunday) % BAND_FILLS.length]
    ws.getCell(HEAD, col(overtime.start + 2 * i)).fill = fill
    ws.getCell(HEAD, col(overtime.start + 2 * i + 1)).fill = fill
  })
  ws.getCell(HEAD, col(info.start + info.span - 1)).fill = NAME_FILL   // Toplam Gün (SGK)
  ws.getRow(HEAD).height = 48

  // ── Çalışan satırları ──
  t.body.forEach((values, ri) => {
    const r = rows[ri]
    const line = ws.addRow(values.map((v) => (typeof v === 'string' ? safeText(v) : v)))
    line.font = { size: 10 }
    for (let c = 1; c <= width; c++) {
      const cell = line.getCell(c)
      cell.border = BORDER
      if (c > t.firstDayCol) cell.alignment = { horizontal: 'center' }
    }
    for (let c = 1; c <= 3; c++) line.getCell(c).fill = NAME_FILL
    t.days.forEach((d, i) => {
      const code = r.days[d]
      if (code && code !== 'P') paint(line.getCell(dayCol(i)), code, false, 10)
    })
    line.getCell(col(info.start + info.span - 1)).fill = NAME_FILL
    const note = line.getCell(col(width - 1))
    note.alignment = { horizontal: 'left' }
    if (r.overtimeWithoutConsent) note.font = { size: 10, color: { argb: 'FFB91C1C' } }
  })

  // ── Toplam satırı: fazla mesai ve saat sütunları ──
  if (rows.length > 0) {
    const first = HEAD + 1
    const last = HEAD + rows.length
    const total = ws.addRow([])
    total.getCell(2).value = 'TOPLAM'
    for (let i = overtime.start; i < width - 1; i++) {
      const c = col(i)
      const letter = ws.getColumn(c).letter
      const sum = t.body.reduce((s, row) => s + (Number(row[i]) || 0), 0)
      total.getCell(c).value = { formula: `SUM(${letter}${first}:${letter}${last})`, result: Math.round(sum * 100) / 100 }
    }
    for (let c = 1; c <= width; c++) {
      const cell = total.getCell(c)
      cell.font = { bold: true }
      cell.border = BORDER
      if (c > t.firstDayCol) cell.alignment = { horizontal: 'center' }
    }
  }

  // ── Sütun genişlikleri ──
  ws.getColumn(1).width = 5.5
  ws.getColumn(2).width = 24
  ws.getColumn(3).width = 18
  ws.getColumn(4).width = 18
  t.days.forEach((_, i) => { ws.getColumn(dayCol(i)).width = 4.8 })
  for (let i = info.start; i < info.start + info.span; i++) ws.getColumn(col(i)).width = 5
  ws.getColumn(col(info.start)).width = 9.5
  ws.getColumn(col(info.start + info.span - 1)).width = 10
  for (let i = overtime.start; i < overtime.start + overtime.span; i++) ws.getColumn(col(i)).width = 13
  ws.getColumn(col(extra.start)).width = 9.5
  ws.getColumn(col(extra.start + 1)).width = 10
  ws.getColumn(col(width - 1)).width = 32

  // ── Açıklamalar sayfası ──
  const legend = wb.addWorksheet('Açıklamalar')
  legend.addRow(['İZİN KODLARI VE AÇIKLAMALARI']).font = { bold: true }
  if (storeName) legend.addRow(['Birim/Şube', safeText(storeName)])
  for (const l of EXPORT_CODE_LEGEND) {
    const cell = legend.addRow([l.code, l.label]).getCell(1)
    cell.alignment = { horizontal: 'center' }
    paint(cell, l.screen, true)
  }
  const monthHolidays = holidays.filter((h) => h.date.startsWith(month))
  if (monthHolidays.length > 0) {
    legend.addRow([])
    legend.addRow([`RESMİ TATİL GÜNLERİ - ${monthName(month).toLocaleUpperCase('tr-TR')}`]).font = { bold: true }
    for (const h of monthHolidays) {
      legend.addRow([Number(h.date.slice(8)), safeText(`${h.name}${h.half_day ? ' (yarım gün)' : ''}`)])
    }
  }
  legend.addRow([])
  legend.addRow(['NOTLAR']).font = { bold: true }
  for (const n of EXPORT_NOTES) legend.addRow(['', n])
  legend.getColumn(1).width = 12
  legend.getColumn(2).width = 110

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
