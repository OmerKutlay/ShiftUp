/**
 * payrollExcel — bordro puantajını .xlsx olarak üretir (yalnızca server; exceljs tembel yüklenir).
 *
 * Sayfa 1 "Puantaj": başlık bloğu (mağaza, dönem, oluşturma zamanı) + çalışan başına bir satır:
 *   Sicil No, TC Kimlik No (boş — muhasebe doldurur), Ad Soyad, gün 1..N kodları, toplam sütunları.
 * Sayfa 2 "Açıklamalar": gün kodu açıklamaları, SGK eksik gün nedeni listesi, hesap kuralları.
 */
import { monthDays } from '@/lib/timesheet'
import { ANNUAL_OVERTIME_CAP_HOURS } from '@/lib/laborLaw'
import { SGK_MISSING_DAY_CODES, PAYROLL_CODE_LEGEND, type PayrollRow } from '@/lib/payrollTimesheet'

const DOW_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']

/** Excel'de formül olarak yorumlanabilecek metinleri kaçışlar */
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

const TOTAL_HEADERS = [
  'Çalışılan Gün', 'Normal Saat', 'Fazla Mesai Saat (%50)', 'Genel Tatil Çalışılan Gün', 'Genel Tatil Çalışılan Saat',
  'Gece Çalışması Saat', 'Hafta Tatili Gün', 'Genel Tatil Gün (Çalışılmadı)', 'Yıllık İzin Gün', 'Raporlu Gün',
  'Ücretsiz İzin Gün', 'Mazeret İzni Gün', 'Devamsız Gün', 'Eksik Gün', 'Eksik Gün Nedeni Kodu', 'SGK Prim Günü', 'Not',
]

export async function buildPayrollWorkbook(
  month: string,
  rows: PayrollRow[],
  storeName: string,
  generatedAt: string
): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ShiftUp'
  wb.created = new Date()
  wb.title = `Bordro puantajı — ${storeName} — ${month}`

  const days = monthDays(month)
  const FIXED = 3
  const ws = wb.addWorksheet('Puantaj', { views: [{ state: 'frozen', xSplit: FIXED, ySplit: 5 }] })

  ws.addRow([safeText(`${storeName} — Bordro Puantajı`)]).font = { bold: true, size: 13 }
  ws.addRow(['Dönem', month])
  ws.addRow(['Oluşturulma', generatedAt])
  ws.addRow([])
  ws.addRow(['Sicil No', 'TC Kimlik No', 'Ad Soyad', ...days.map((d) => Number(d.slice(8))), ...TOTAL_HEADERS])
  const hdr = ws.getRow(5)
  hdr.font = { bold: true }
  hdr.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  hdr.height = 45
  // Gün adları başlığın üstündeki 4. satırda
  days.forEach((d, i) => {
    ws.getRow(4).getCell(FIXED + 1 + i).value = DOW_TR[new Date(`${d}T00:00:00Z`).getUTCDay()]
    ws.getRow(4).getCell(FIXED + 1 + i).alignment = { horizontal: 'center' }
    ws.getRow(4).getCell(FIXED + 1 + i).font = { color: { argb: 'FF64748B' }, size: 9 }
  })

  for (const r of rows) {
    const line = ws.addRow([
      r.sicilNo, r.tcKimlikNo, safeText(r.fullName),
      ...days.map((d) => r.days[d] ?? ''),
      r.workedDays, r.normalHours, r.overtimeHours, r.holidayWorkedDays, r.holidayWorkedHours,
      r.nightHours, r.weeklyRestDays, r.holidayRestDays, r.annualLeaveDays, r.sickDays,
      r.unpaidDays, r.excuseDays, r.absentDays, r.missingDays, r.missingReasonCode, r.sgkDays,
      safeText(r.notes.join(' | ')),
    ])
    days.forEach((_, i) => { line.getCell(FIXED + 1 + i).alignment = { horizontal: 'center' } })
    // Sicil / eksik gün kodu metin olarak kalsın ("01" → 1 olmasın)
    line.getCell(1).numFmt = '@'
    line.getCell(2).numFmt = '@'
    line.getCell(FIXED + days.length + 15).numFmt = '@'
  }

  ws.getColumn(1).width = 12
  ws.getColumn(2).width = 14
  ws.getColumn(3).width = 26
  days.forEach((_, i) => { ws.getColumn(FIXED + 1 + i).width = 5 })
  TOTAL_HEADERS.forEach((_, i) => { ws.getColumn(FIXED + days.length + 1 + i).width = i === TOTAL_HEADERS.length - 1 ? 34 : 13 })

  const legend = wb.addWorksheet('Açıklamalar')
  legend.getColumn(1).width = 16
  legend.getColumn(2).width = 40
  legend.getColumn(3).width = 90
  legend.addRow(['Gün kodları']).font = { bold: true }
  legend.addRow(['Kod', 'Anlamı', 'Not']).font = { bold: true }
  for (const c of PAYROLL_CODE_LEGEND) legend.addRow([c.code, c.label, c.note])
  legend.addRow([])
  legend.addRow(['SGK eksik gün nedeni kodları']).font = { bold: true }
  legend.addRow(['Kod', 'Neden', 'Bu dosyada']).font = { bold: true }
  const used: Record<string, string> = {
    '01': 'Raporlu gün (R)', '15': 'Devamsız gün (D)', '21': 'Ücretsiz izin (Üİ)', '12': 'Aynı ay birden fazla neden',
  }
  for (const c of SGK_MISSING_DAY_CODES) {
    const row = legend.addRow([c.code, c.label, used[c.code] ?? ''])
    row.getCell(1).numFmt = '@'
  }
  legend.addRow([])
  legend.addRow(['Hesaplama notları']).font = { bold: true }
  const notes: Array<[string, string]> = [
    ['Normal saat', 'Net fiili çalışma (mola düşülmüş) − fazla mesai. Genel tatil çalışılan saat, normal saatin içinde ayrıca gösterilen bilgi sütunudur.'],
    ['Fazla mesai', `Pazartesi–Pazar haftasında 45 saati aşan net süre (İş K. Md. 41), %50 zamlı. Hafta, Pazar günü hangi aydaysa o aya yazılır. Yıllık üst sınır ${ANNUAL_OVERTIME_CAP_HOURS} saat. Bu rapor yalnızca bu mağazadaki vardiyaları sayar; birden fazla mağazada çalışanın işveren düzeyindeki toplamı için Raporlar > Fazla çalışma bakın.`],
    ['Genel tatil', 'Tam gün resmi tatilde çalışılan gün GTÇ, çalışılmayan gün GT. Yarım gün tatiller normal gün sayılır.'],
    ['SGK prim günü', 'Ay 30 gün kabul edilir (28/29/31 çeken aylarda da tam ay = 30). Prim günü = işte olunan gün − eksik gün. İşte olunan gün = takvim günü sayısı (en çok 30). 31 günlük ayda 31. gün yalnızca işte olunan gün 30 iken (tam ay veya 1.–2. gün giriş) eksik gün sayılmaz; gün sütunları ise gerçek günleri gösterir.'],
    ['Eksik gün', 'Rapor (01), ücretsiz izin (21) ve devamsızlık (15) günleri. Hafta tatili, genel tatil, yıllık izin ve mazeret izni ücretli sayılır, eksik gün değildir. Birden fazla neden varsa kod 12 (Birden fazla).'],
    ['Sicil / TC No', 'ShiftUp bu bilgileri saklamaz (KVKK). Muhasebe bu iki sütunu kendi kayıtlarından doldurur.'],
    ['İşten çıkış', 'Son çalışma günü (dahil) sonrasındaki günler işte olunan gün sayılmaz; prim günü çıkış gününde biter ve Not sütununda "Ayrıldı <tarih>" yazar. Çıkış gününde hiç çalışma/izin kaydı yoksa o gün SGK 16 (Fesih tarihinde çalışmamıştır) eksik günü olur. Ay başından önce ayrılanlar listelenmez. Ay tamamlanmadan alınan çıktıda gelecek günler (P) eksik sayılmaz; kesin bordro için ay sonunda yeniden indirin.'],
    ['Mağaza değişikliği', 'Ay içinde mağaza değiştiren çalışan, çalıştığı her mağazanın dosyasında görünür (puantaj mağaza bazlıdır). Prim gününü iki dosyada toplayıp 30 ile sınırlamak muhasebenin işidir.'],
    ['Hafta geçişi', 'Haftalık 45 saat üstü fazla mesai, haftanın Pazar günü hangi aydaysa o aya yazılır; ay sınırını aşan hafta tamamen bir aya düşer. Normal saat = net − fazla mesai, en az 0.'],
    ['Kontrol edin', 'Ay içinde hiç vardiya, izin veya devam kaydı olmayan çalışan listelenir ama Not sütununda "Kontrol edin: ay içinde kayıt yok" yazar; prim günü doğrulanmalıdır. İşe girişi ay sonundan sonra olanlar listelenmez.'],
  ]
  for (const [k, v] of notes) {
    const row = legend.addRow([k, v])
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    legend.mergeCells(row.number, 2, row.number, 3)
    row.height = 48
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
