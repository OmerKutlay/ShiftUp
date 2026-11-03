/**
 * timesheetExcel — aylık puantajı .xlsx olarak üretir (yalnızca tarayıcıda, indirme anında yüklenir).
 *
 * Sayfa 1 "Puantaj": (mağaza adı verilmişse üstte başlık satırı) çalışan × gün tablosu + toplam sütunları.
 *   Çalışılan günlerde hücrede net saat (sayı), diğer günlerde kod yazar; her durum kendi rengine boyanır,
 *   tablonun altında renk lejantı bulunur.
 * Sayfa 2 "Açıklama": renkli kod listesi ve hesaplama notları
 */
import {
  monthDays, TIMESHEET_CODE_COLORS, TIMESHEET_CODE_LABELS, timesheetDayValue, type TimesheetCode, type TimesheetRow,
} from '@/lib/timesheet'
import { ANNUAL_OVERTIME_CAP_HOURS } from '@/lib/laborLaw'
import type { PublicHoliday } from '@/types/holiday'
import type { Cell } from 'exceljs'

type DayCode = Exclude<TimesheetCode, ''>

/** Lejant sırası: renk tablosunun sırası (Ç, RTÇ, HT, RT, Yİ, Rİ, Üİ, Mİ, D, P) */
const LEGEND = Object.keys(TIMESHEET_CODE_COLORS) as DayCode[]

/** Hücreyi durum rengine boyar (zemin + yazı rengi) */
function paint(cell: Cell, code: DayCode, bold = false) {
  const c = TIMESHEET_CODE_COLORS[code]
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${c.fill}` } }
  cell.font = { color: { argb: `FF${c.text}` }, bold: bold || code === 'D' }
}

/** Lejant metni: Ç ve RTÇ hücrelerinde kod yerine saat yazdığı belirtilir */
const legendLabel = (code: DayCode) =>
  code === 'Ç' || code === 'RTÇ' ? `${TIMESHEET_CODE_LABELS[code]} — hücrede net çalışma saati yazar` : TIMESHEET_CODE_LABELS[code]

const DOW_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']

const hours = (mins: number) => Math.round((mins / 60) * 100) / 100

export { storeFileSlug } from '@/lib/export/fileName'

/** Excel'de formül olarak yorumlanabilecek metinleri kaçışlar */
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

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

  const days = monthDays(month)
  const holidaySet = new Set(holidays.filter((h) => !h.half_day).map((h) => h.date))
  // Mağaza adı varsa tablonun üstüne bir başlık satırı eklenir; tablo satırları bir aşağı kayar
  const top = storeName ? 1 : 0
  const ws = wb.addWorksheet('Puantaj', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 + top }] })

  const totals = [
    'Çalışılan Gün', 'Net Saat', 'Fazla Çalışma (s)', 'Gece Çalışması (s)', 'RT Çalışılan Gün',
    'Yıllık İzin', 'Rapor', 'Ücretsiz İzin', 'Mazeret İzni', 'Hafta Tatili', 'Devamsız', 'SGK Gün', 'Not',
  ]

  // Başlık satırları
  if (storeName) {
    ws.addRow([safeText(`${storeName} — Aylık Puantaj — ${month}`)])
    ws.getRow(1).font = { bold: true, size: 13 }
    ws.mergeCells(1, 1, 1, 2 + days.length)
  }
  ws.addRow(['Çalışan', 'Pozisyon', ...days.map((d) => Number(d.slice(8))), ...totals])
  ws.addRow(['', '', ...days.map((d) => DOW_TR[new Date(`${d}T00:00:00Z`).getUTCDay()]), ...totals.map(() => '')])
  for (const r of [1 + top, 2 + top]) {
    const row = ws.getRow(r)
    row.font = { bold: true }
    row.alignment = { horizontal: 'center', vertical: 'middle' }
  }
  ws.mergeCells(1 + top, 1, 2 + top, 1)
  ws.mergeCells(1 + top, 2, 2 + top, 2)
  totals.forEach((_, i) => ws.mergeCells(1 + top, 3 + days.length + i, 2 + top, 3 + days.length + i))
  ws.getRow(1 + top).height = 30

  for (const r of rows) {
    const notes: string[] = []
    if (r.overtimeWithoutConsent) notes.push('Fazla çalışma onayı yok')
    const line = ws.addRow([
      safeText(r.employee.full_name),
      safeText(r.employee.role_name),
      ...days.map((d) => timesheetDayValue(r, d)),
      r.workedDays,
      hours(r.workedMins),
      hours(r.overtimeMins),
      hours(r.nightMins),
      r.holidayWorkedDays,
      r.leaveDays['Yİ'],
      r.leaveDays['Rİ'],
      r.leaveDays['Üİ'],
      r.leaveDays['Mİ'],
      r.leaveDays['HT'],
      r.absentDays,
      r.sgkDays,
      notes.join('; '),
    ])
    days.forEach((d, i) => {
      const cell = line.getCell(3 + i)
      cell.alignment = { horizontal: 'center' }
      const code = r.days[d]
      if (code) paint(cell, code)
    })
    if (r.overtimeWithoutConsent) line.getCell(3 + days.length + totals.length - 1).font = { color: { argb: 'FFB91C1C' } }
  }

  // Resmi tatil sütunlarını başlıkta vurgula
  days.forEach((d, i) => {
    if (!holidaySet.has(d)) return
    for (const r of [1 + top, 2 + top]) {
      ws.getRow(r).getCell(3 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } }
    }
  })

  ws.getColumn(1).width = 24
  ws.getColumn(2).width = 18
  days.forEach((_, i) => { ws.getColumn(3 + i).width = 5.5 })
  totals.forEach((_, i) => { ws.getColumn(3 + days.length + i).width = i === totals.length - 1 ? 26 : 11 })
  ws.eachRow((row) => row.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
  }))

  // Renk lejantı tablonun altında (çerçeve döngüsünden sonra eklenir, çerçevesiz kalır)
  ws.addRow([])
  ws.addRow(['Renkler']).font = { bold: true }
  for (const code of LEGEND) {
    const line = ws.addRow([code, legendLabel(code)])
    const cell = line.getCell(1)
    cell.alignment = { horizontal: 'center' }
    paint(cell, code, true)
  }

  // Açıklama sayfası
  const legend = wb.addWorksheet('Açıklama')
  if (storeName) legend.addRow(['Mağaza', safeText(storeName)]).font = { bold: true }
  legend.addRow(['Kod', 'Anlamı']).font = { bold: true }
  for (const code of LEGEND) {
    const cell = legend.addRow([code, legendLabel(code)]).getCell(1)
    cell.alignment = { horizontal: 'center' }
    paint(cell, code, true)
  }
  legend.addRow([])
  legend.addRow(['Notlar']).font = { bold: true }
  legend.addRow(['Net saat', 'Fiili giriş–çıkış süresinden molalar düşülerek hesaplanır.'])
  legend.addRow(['Fazla çalışma', `Pazartesi–Pazar haftasında 45 saati aşan net süre (İş K. Md. 41). Hafta, Pazar günü hangi aydaysa o aya yazılır. Yıllık üst sınır ${ANNUAL_OVERTIME_CAP_HOURS} saattir.`])
  legend.addRow(['Gece çalışması', '20:00–06:00 arasına düşen fiili çalışma süresi (İş K. Md. 69).'])
  legend.addRow(['RT çalışılan gün', 'Resmi tatilde çalışılan tam günler — ek bir günlük ücret (İş K. Md. 47).'])
  legend.addRow(['SGK gün', 'Ay 30 gün kabul edilir; ücretsiz izin ve devamsız günler düşülür. Ay içi giriş/çıkış için kontrol edin.'])
  legend.getColumn(1).width = 18
  legend.getColumn(2).width = 110

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}
