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
 *
 * Kodlar 02 ve 14 listede YOKTUR: alomaliye.com/2012/04/17/sgk-eksik-gun-nedenleri/ "02 ve 14 numaralı kodlar
 * listede yer almaz" der; 2018 tarihli bir sayfada disiplin cezası 02 diye geçer ama diğer tüm kaynaklarda 03.
 * 28/29 pandemi dönemine özeldir, güncel bildirimlerde kullanılmaz. sgk.gov.tr / e-Bildirge belgelerine
 * erişilemedi (arama yalnızca üçüncü taraf siteler döndürdü) — liste resmi kaynakla doğrulanmadı.
 *
 * Prim günü kuralı (özet; ayrıntı README "Bordro puantajı"):
 *   - Ay 30 gün kabul edilir; Şubat tam çalışılırsa 30 olur.
 *   - İşte olunan gün = takvim günü (çıkış − giriş + 1), en çok 30; ay başından beri çalışılıyorsa 30.
 *     31 günlük ayda 31. gün yalnızca işte olunan gün 30 iken eksik gün sayılmaz (giriş 3. gün ve sonrası: sayılır).
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
  /** Ay içinde hiç vardiya, izin veya devam kaydı yok — prim günü doğrulanmalı */
  noRecords: boolean
  notes: string[]
}

export interface PayrollTimesheet {
  month: string
  rows: PayrollRow[]
}

const hours = (mins: number) => Math.round((mins / 60) * 100) / 100


/** İşte olunan aralık: ay içindeki ilk ve son gün (1-tabanlı); işe giriş/çıkış bu aralığı daraltır */
export interface EmploymentWindow {
  /** Ayın kaçıncı günü işe başlandı (1 = ay başından beri) */
  fromDay: number
  /** Ayın kaçıncı günü son çalışma günü (ay sonu = ayın gün sayısı) */
  toDay: number
}

/**
 * Ay içinde işte olunan aralık. endDate (işten çıkış) şimdilik kimse vermiyor; employees.termination_date
 * eklendiğinde buraya bağlanır — çıkış ayında SGK 16 "Fesih tarihinde çalışmamıştır" eksik günü de
 * bu aralık dışındaki günlerden türetilmelidir (bkz. employedSgkDays). null = ayın tamamı.
 * Ay dışında (işe giriş ay sonundan sonra / çıkış ay başından önce) → null.
 */
export function employmentWindow(
  month: string,
  hireDate: string | null | undefined,
  endDate?: string | null
): EmploymentWindow | null {
  const len = monthDays(month).length
  const first = `${month}-01`
  const last = `${month}-${String(len).padStart(2, '0')}`
  if (hireDate && hireDate > last) return null
  if (endDate && endDate < first) return null
  const fromDay = hireDate && hireDate > first ? Number(hireDate.slice(8, 10)) : 1
  const toDay = endDate && endDate < last ? Number(endDate.slice(8, 10)) : len
  return { fromDay, toDay: Math.max(fromDay, toDay) }
}

/**
 * SGK'ya göre işte olunan gün (prim günü tavanı): ay 30 gün kabul edilir.
 *   - tam ay → 30 (Şubat dahil: ay sonuna kadar çalışılan Şubat 30 sayılır)
 *   - aksi halde takvim günü sayısı (toDay − fromDay + 1), en çok 30
 * Pencere yoksa (ay dışı) → 0.
 */
export function employedSgkDays(month: string, hireDate: string | null | undefined, endDate?: string | null): number {
  const w = employmentWindow(month, hireDate, endDate)
  if (!w) return 0
  const len = monthDays(month).length
  const to = len < 30 && w.toDay === len ? 30 : w.toDay
  return Math.min(30, to - w.fromDay + 1)
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

export const NO_RECORDS_NOTE = 'Kontrol edin: ay içinde kayıt yok'

/**
 * buildTimesheet satırlarını bordro satırlarına çevirir.
 * Gün sayaçlarının hepsi tek döngüden gelir (ekranda görünen gün sayıları gerçek günlerdir);
 * yalnızca "Eksik Gün" 31 günlük ayda tam çalışılan (işte olunan = 30) çalışanın 31. gününü saymaz.
 * İşe girişi ay sonundan sonra olan çalışanlar listeye alınmaz.
 */
export function toPayrollRows(month: string, rows: TimesheetRow[]): PayrollRow[] {
  const days = monthDays(month)
  const len = days.length
  const out: PayrollRow[] = []
  for (const r of rows) {
    const hire = r.employee.hire_date ?? null
    const window = employmentWindow(month, hire)
    if (!window) continue
    const employed = employedSgkDays(month, hire)
    // 31. gün yalnızca işte olunan gün 30'a tamamlanmışken prim günü yaratmaz
    const skip31 = len === 31 && employed === 30

    const codes: Record<string, PayrollDayCode> = {}
    const t = { worked: 0, rest: 0, holiday: 0, annual: 0, sick: 0, unpaid: 0, excuse: 0, absent: 0, holidayWorked: 0 }
    let holidayWorkedMins = 0
    const missing = { rest: 0, unpaid: 0, absent: 0 }
    let hasRecord = false
    for (const d of days) {
      const dayNo = Number(d.slice(8))
      if (dayNo < window.fromDay) { codes[d] = ''; continue }
      const c = r.days[d] ?? ''
      codes[d] = c === '' ? '' : DAY_CODE[c]
      if (c !== '' && c !== 'RT') hasRecord = true
      const countsMissing = !(skip31 && dayNo === 31)
      switch (c) {
        case 'Ç': t.worked++; break
        case 'RTÇ': t.worked++; t.holidayWorked++; holidayWorkedMins += r.dayMins[d] ?? 0; break
        case 'HT': t.rest++; break
        case 'RT': t.holiday++; break
        case 'Yİ': t.annual++; break
        case 'Mİ': t.excuse++; break
        case 'Rİ': t.sick++; if (countsMissing) missing.rest++; break
        case 'Üİ': t.unpaid++; if (countsMissing) missing.unpaid++; break
        case 'D': t.absent++; if (countsMissing) missing.absent++; break
      }
    }
    const sgk = sgkSummary(employed, missing)
    const notes: string[] = []
    if (r.overtimeWithoutConsent) notes.push('Fazla çalışma için yazılı onay kayıtlı değil')
    if (window.fromDay > 1) notes.push(`Ay içinde işe giriş (${hire})`)
    if (!hasRecord) notes.push(NO_RECORDS_NOTE)
    out.push({
      employeeId: r.employee.id,
      fullName: r.employee.full_name,
      sicilNo: '',
      tcKimlikNo: '',
      days: codes,
      workedDays: t.worked,
      normalHours: hours(Math.max(0, r.workedMins - r.overtimeMins)),
      overtimeHours: hours(r.overtimeMins),
      holidayWorkedHours: hours(holidayWorkedMins),
      holidayWorkedDays: t.holidayWorked,
      nightHours: hours(r.nightMins),
      weeklyRestDays: t.rest,
      holidayRestDays: t.holiday,
      annualLeaveDays: t.annual,
      sickDays: t.sick,
      unpaidDays: t.unpaid,
      excuseDays: t.excuse,
      absentDays: t.absent,
      employedDays: employed,
      ...sgk,
      noRecords: !hasRecord,
      notes,
    })
  }
  return out
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

/**
 * Baştaki sıfırı korunacak sabit kod hücresi: Excel ="01" ifadesini metin 01 olarak gösterir.
 * Yalnızca bizim ürettiğimiz sabit 2 haneli SGK kodları verilir (kullanıcı girdisi asla) — bu yüzden
 * enjeksiyon kaçışından geçmez; biçim doğrulanır.
 */
export function csvTextCode(code: string): string {
  if (code === '') return ''
  if (!/^\d{2}$/.test(code)) throw new Error('Geçersiz kod')
  return `"=""${code}"""`
}

/** UTF-8 BOM'lu, `;` ayraçlı, yalnızca toplamlar içeren CSV (gün kodu sütunları yok) */
export function payrollToCsv(rows: PayrollRow[]): string {
  const lines = [PAYROLL_CSV_HEADERS.join(';')]
  for (const r of rows) {
    const cells = [
      r.sicilNo, r.tcKimlikNo, r.fullName, r.workedDays, num(r.normalHours), num(r.overtimeHours),
      r.holidayWorkedDays, num(r.holidayWorkedHours), num(r.nightHours), r.weeklyRestDays,
      r.holidayRestDays, r.annualLeaveDays, r.sickDays, r.unpaidDays, r.excuseDays,
      r.absentDays, r.missingDays, null, r.sgkDays, r.notes.join(' | '),
    ].map((c) => (c === null ? csvTextCode(r.missingReasonCode) : csvCell(String(c))))
    lines.push(cells.join(';'))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
