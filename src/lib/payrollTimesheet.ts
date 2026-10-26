/**
 * payrollTimesheet — bordro (muhasebe) için aylık puantaj: saf fonksiyonlar, DB'siz.
 *
 * Hesap buildTimesheet (timesheet.ts) çıktısı üzerine kurulur — çalışılan saat, haftalık 45 saat
 * üstü fazla çalışma (Md. 41), resmi tatil çalışması burada YENİDEN hesaplanmaz. Bu modül yalnızca
 * bordro diline çevirir: gün kodları, saat toplamları, SGK prim günü ve eksik gün nedeni.
 *
 * SGK eksik gün nedeni kodları (APHB / aylık prim ve hizmet belgesi, SGK Genelgesi 2020/20 listesi):
 * https://www.alomaliye.com/2020/06/22/eksik-gunlerde-kullanilacak-sgk-kodlari/
 * https://kolayik.com/blog/sgk-eksik-gun-nedenleri
 * (iki bağımsız kaynakta aynı liste; resmi kaynak: sgk.gov.tr eksik gün bildirim kılavuzu)
 *
 * Prim günü kuralı (özet; ayrıntı README "Bordro puantajı"):
 *   - Ay 30 gün kabul edilir; 31 çeken aylarda 31. gün ayrıca prim günü yaratmaz, Şubat tam çalışılırsa 30 olur.
 *   - Ay içinde işe giriş: 31 günlük ayda min(30, 32 − giriş günü), diğer aylarda 31 − giriş günü.
 *   - Prim günü = işte olunan gün − eksik gün. Eksik gün: rapor (01), ücretsiz izin (21), devamsızlık (15).
 *     Ücretli izin, hafta tatili, resmi tatil prim gününe dahildir.
 *   - Birden fazla farklı nedenle eksik gün varsa neden kodu 12 (Birden fazla).
 */
import { buildTimesheet, monthDays, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'

export const SGK_MISSING_DAY_CODES: ReadonlyArray<{ code: string; label: string }> = [
  { code: '01', label: 'İstirahat' },
  { code: '03', label: 'Disiplin cezası' },
  { code: '04', label: 'Gözaltına alınma' },
  { code: '05', label: 'Tutukluluk' },
  { code: '06', label: 'Kısmi istihdam' },
  { code: '07', label: 'Puantaj kayıtları' },
  { code: '08', label: 'Grev' },
  { code: '09', label: 'Lokavt' },
  { code: '10', label: 'Genel hayatı etkileyen olaylar' },
  { code: '11', label: 'Doğal afet' },
  { code: '12', label: 'Birden fazla' },
  { code: '13', label: 'Diğer nedenler' },
  { code: '15', label: 'Devamsızlık' },
  { code: '16', label: 'Fesih tarihinde çalışmamıştır' },
  { code: '17', label: 'Ev hizmetlerinde 30 günden az çalışma' },
  { code: '18', label: 'Kısa çalışma ödeneği' },
  { code: '19', label: 'Ücretsiz doğum izni' },
  { code: '20', label: 'Ücretsiz yol izni' },
  { code: '21', label: 'Diğer ücretsiz izin' },
  { code: '22', label: '5434 SK ek 76, GM 192' },
  { code: '23', label: 'Yarım çalışma' },
  { code: '24', label: 'Yarım çalışma ve diğer nedenler' },
  { code: '25', label: 'Diğer belge/kanun türlerinden gün tamamlama' },
  { code: '26', label: 'Kısmi istihdama izin verilen yabancı uyruklu' },
  { code: '27', label: 'Kısa çalışma ödeneği ve diğer nedenler' },
  { code: '28', label: 'Pandemi ücretsiz izin (4857 G.M. 10)' },
  { code: '29', label: 'Pandemi ücretsiz izin ve diğer' },
]

const SGK_REST = '01'
const SGK_UNPAID = '21'
const SGK_ABSENT = '15'
const SGK_MULTIPLE = '12'

/** Bordro gün kodları (puantaj kodlarından türetilir) */
export type PayrollDayCode = 'Ç' | 'HT' | 'GT' | 'GTÇ' | 'Yİ' | 'R' | 'Üİ' | 'M' | 'D' | 'P' | ''

export const PAYROLL_CODE_LEGEND: ReadonlyArray<{ code: Exclude<PayrollDayCode, ''>; label: string; note: string }> = [
  { code: 'Ç', label: 'Çalıştı', note: 'Giriş-çıkış kaydı olan normal gün' },
  { code: 'HT', label: 'Hafta tatili', note: 'Ücretli; prim gününe dahil' },
  { code: 'GT', label: 'Genel tatil (çalışılmadı)', note: 'Ulusal/mağaza resmi tatili; ücretli, prim gününe dahil' },
  { code: 'GTÇ', label: 'Genel tatilde çalıştı', note: 'İş K. Md. 47 — ek günlük ücret' },
  { code: 'Yİ', label: 'Yıllık ücretli izin', note: 'Ücretli; prim gününe dahil' },
  { code: 'R', label: 'Raporlu (istirahat)', note: 'SGK eksik gün 01; ücreti SGK öder' },
  { code: 'Üİ', label: 'Ücretsiz izin', note: 'SGK eksik gün 21' },
  { code: 'M', label: 'Mazeret / diğer izin', note: 'Ücretli kabul edilir; prim gününe dahil' },
  { code: 'D', label: 'Devamsız', note: 'Planlı vardiyaya gelmedi; SGK eksik gün 15' },
  { code: 'P', label: 'Planlı (henüz gerçekleşmedi)', note: 'Ay tamamlanmadan alınan çıktıda görünür' },
]

const DAY_CODE: Record<Exclude<TimesheetCode, ''>, PayrollDayCode> = {
  'Ç': 'Ç', 'RTÇ': 'GTÇ', 'HT': 'HT', 'RT': 'GT', 'Yİ': 'Yİ', 'Rİ': 'R', 'Üİ': 'Üİ', 'Mİ': 'M', 'D': 'D', 'P': 'P',
}

export interface PayrollRow {
  employeeId: string
  fullName: string
  /** Veritabanında sicil no / TC kimlik no tutulmaz (KVKK) — muhasebe tarafından doldurulur */
  sicilNo: ''
  tcKimlikNo: ''
  /** Ay içindeki gün → bordro kodu; işe girişten önceki günler '' */
  days: Record<string, PayrollDayCode>
  workedDays: number
  /** Net normal saat = toplam net çalışma − fazla çalışma */
  normalHours: number
  /** Haftalık 45 saat üstü (%50 zamlı) */
  overtimeHours: number
  /** Genel tatil günlerinde çalışılan net saat (normal saatin içinde, bilgi amaçlı) */
  holidayWorkedHours: number
  holidayWorkedDays: number
  nightHours: number
  weeklyRestDays: number
  /** Genel tatil (çalışılmadı) günleri */
  holidayRestDays: number
  annualLeaveDays: number
  sickDays: number
  unpaidDays: number
  excuseDays: number
  absentDays: number
  /** İşte olunan gün (30 gün kuralıyla; işe giriş ayında < 30) */
  employedDays: number
  missingDays: number
  /** SGK eksik gün nedeni kodu ('' = eksik gün yok); birden fazla neden → '12' */
  missingReasonCode: string
  sgkDays: number
  notes: string[]
}

export interface PayrollTimesheet {
  month: string
  rows: PayrollRow[]
}

const hours = (mins: number) => Math.round((mins / 60) * 100) / 100

/** İşe giriş günü (ay içindeyse) → SGK'ya göre işte olunan gün; aksi halde tam ay = 30 */
export function employedSgkDays(month: string, hireDate: string | null | undefined): number {
  if (!hireDate || hireDate.slice(0, 7) !== month) return 30
  const len = monthDays(month).length
  const d = Number(hireDate.slice(8, 10))
  return len === 31 ? Math.min(30, 32 - d) : 31 - d
}

/** Eksik gün sayısından SGK prim günü ve neden kodu (saf; testlerde doğrudan denenir) */
export function sgkSummary(employedDays: number, reasons: { rest: number; unpaid: number; absent: number }) {
  const missing = reasons.rest + reasons.unpaid + reasons.absent
  const kinds = [reasons.rest > 0 && SGK_REST, reasons.unpaid > 0 && SGK_UNPAID, reasons.absent > 0 && SGK_ABSENT]
    .filter((c): c is string => !!c)
  return {
    missingDays: missing,
    missingReasonCode: kinds.length === 0 ? '' : kinds.length === 1 ? kinds[0] : SGK_MULTIPLE,
    sgkDays: Math.max(0, employedDays - missing),
  }
}

/** buildTimesheet satırlarını bordro satırlarına çevirir */
export function toPayrollRows(month: string, rows: TimesheetRow[]): PayrollRow[] {
  const days = monthDays(month)
  const len = days.length
  return rows.map((r) => {
    const hire = r.employee.hire_date ?? null
    const hiredThisMonth = !!hire && hire.slice(0, 7) === month
    const beforeHire = (d: string) => hiredThisMonth && d < hire!
    // Gün kodları — işe girişten önceki günler boş; o günlerdeki sayaçlar tutarlı olsun diye ayrıca sayılır
    const out: Record<string, PayrollDayCode> = {}
    let holidayWorkedMins = 0
    let holidayRest = 0
    const counts = { rest: 0, unpaid: 0, absent: 0 }
    for (const d of days) {
      if (beforeHire(d)) { out[d] = ''; continue }
      const c = r.days[d] ?? ''
      out[d] = c === '' ? '' : DAY_CODE[c]
      if (c === 'RTÇ') holidayWorkedMins += r.dayMins[d] ?? 0
      if (c === 'RT') holidayRest++
      // 31 günlük ayda 31. gün prim günü yaratmadığı için eksik gün de sayılmaz
      const countable = !(len === 31 && d.endsWith('-31'))
      if (countable && c === 'Rİ') counts.rest++
      if (countable && c === 'Üİ') counts.unpaid++
      if (countable && c === 'D') counts.absent++
    }
    const employed = employedSgkDays(month, hire)
    const sgk = sgkSummary(employed, counts)
    const notes: string[] = []
    if (r.overtimeWithoutConsent) notes.push('Fazla çalışma için yazılı onay kayıtlı değil')
    if (hiredThisMonth) notes.push(`Ay içinde işe giriş (${hire})`)
    return {
      employeeId: r.employee.id,
      fullName: r.employee.full_name,
      sicilNo: '',
      tcKimlikNo: '',
      days: out,
      workedDays: r.workedDays,
      normalHours: hours(Math.max(0, r.workedMins - r.overtimeMins)),
      overtimeHours: hours(r.overtimeMins),
      holidayWorkedHours: hours(holidayWorkedMins),
      holidayWorkedDays: r.holidayWorkedDays,
      nightHours: hours(r.nightMins),
      weeklyRestDays: r.leaveDays['HT'],
      holidayRestDays: holidayRest,
      annualLeaveDays: r.leaveDays['Yİ'],
      sickDays: r.leaveDays['Rİ'],
      unpaidDays: r.leaveDays['Üİ'],
      excuseDays: r.leaveDays['Mİ'],
      absentDays: r.absentDays,
      employedDays: employed,
      ...sgk,
      notes,
    }
  })
}

/** Ay + mağaza verisinden bordro puantajı (buildTimesheet parametreleriyle aynı) */
export function buildPayrollTimesheet(params: Parameters<typeof buildTimesheet>[0]): PayrollTimesheet {
  return { month: params.month, rows: toPayrollRows(params.month, buildTimesheet(params)) }
}

// ─── CSV ──────────────────────────────────────────────────────

export const PAYROLL_CSV_HEADERS = [
  'Sicil No', 'TC Kimlik No', 'Ad Soyad', 'Çalışılan Gün', 'Normal Saat', 'Fazla Mesai Saat (%50)',
  'Genel Tatil Çalışılan Gün', 'Genel Tatil Çalışılan Saat', 'Gece Çalışması Saat', 'Hafta Tatili Gün',
  'Genel Tatil Gün (Çalışılmadı)', 'Yıllık İzin Gün', 'Raporlu Gün', 'Ücretsiz İzin Gün', 'Mazeret İzni Gün',
  'Devamsız Gün', 'Eksik Gün', 'Eksik Gün Nedeni Kodu', 'SGK Prim Günü', 'Not',
] as const

/** Türkçe Excel için ondalık virgül */
const num = (n: number) => String(n).replace('.', ',')

/** Formül enjeksiyonuna karşı kaçış + ; içeren/tırnaklı hücreler için tırnaklama */
function csvCell(v: string): string {
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** UTF-8 BOM'lu, `;` ayraçlı, yalnızca toplamlar içeren CSV (gün kodu sütunları yok) */
export function payrollToCsv(rows: PayrollRow[]): string {
  const lines = [PAYROLL_CSV_HEADERS.join(';')]
  for (const r of rows) {
    lines.push([
      r.sicilNo, r.tcKimlikNo, r.fullName, r.workedDays, num(r.normalHours), num(r.overtimeHours),
      r.holidayWorkedDays, num(r.holidayWorkedHours), num(r.nightHours), r.weeklyRestDays,
      r.holidayRestDays, r.annualLeaveDays, r.sickDays, r.unpaidDays, r.excuseDays,
      r.absentDays, r.missingDays, r.missingReasonCode, r.sgkDays, r.notes.join(' | '),
    ].map((c) => csvCell(String(c))).join(';'))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
