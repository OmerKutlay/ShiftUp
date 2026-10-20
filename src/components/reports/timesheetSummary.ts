/**
 * timesheetSummary — aylık puantaj ekranının saf hesapları ve gün kodu görünümleri.
 */
import { monthDays, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'

/** 9000 dk → "150"; 5430 dk → "90,5" (Türkçe ondalık, binlik ayraçlı) */
export function hoursLabel(mins: number): string {
  return (Math.round((mins / 60) * 10) / 10).toLocaleString('tr-TR')
}

/** "2026-10" → "Ekim 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1)
}

/** "2026-10" ± n ay */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "14:00"–"22:00" → "14–22"; dakikalı saatler korunur ("14:30–22") */
export function planLabel(plan: { start: string; end: string }): string {
  const h = (t: string) => (t.endsWith(':00') ? String(Number(t.slice(0, 2))) : t)
  return `${h(plan.start)}–${h(plan.end)}`
}

export const leaveTotal = (r: TimesheetRow) => r.leaveDays['Yİ'] + r.leaveDays['Rİ'] + r.leaveDays['Üİ'] + r.leaveDays['Mİ']

const firstName = (full: string) => full.trim().split(/\s+/)[0]

export interface TimesheetKpis {
  people: number
  netMins: number
  /** Ay bugünün ayıysa ay sonuna kalan gün, değilse null */
  daysLeft: number | null
  overtimeMins: number
  overtimePeople: number
  missingConsent: string[]
  absentDays: number
  absentNames: string[]
  leaveDays: number
  annualLeaveDays: number
  sickDays: number
}

export function summarizeTimesheet(rows: TimesheetRow[], month: string, today: string): TimesheetKpis {
  const days = monthDays(month)
  const inMonth = today.startsWith(month)
  return {
    people: rows.length,
    netMins: rows.reduce((s, r) => s + r.workedMins, 0),
    daysLeft: inMonth ? days.length - Number(today.slice(8, 10)) : null,
    overtimeMins: rows.reduce((s, r) => s + r.overtimeMins, 0),
    overtimePeople: rows.filter((r) => r.overtimeMins > 0).length,
    missingConsent: rows.filter((r) => r.overtimeWithoutConsent).map((r) => r.employee.full_name),
    absentDays: rows.reduce((s, r) => s + r.absentDays, 0),
    absentNames: rows.filter((r) => r.absentDays > 0).map((r) => firstName(r.employee.full_name)),
    leaveDays: rows.reduce((s, r) => s + leaveTotal(r), 0),
    annualLeaveDays: rows.reduce((s, r) => s + r.leaveDays['Yİ'], 0),
    sickDays: rows.reduce((s, r) => s + r.leaveDays['Rİ'], 0),
  }
}

/** Kişinin ayındaki gün kodlarının sayımı (yalnızca görülen kodlar, lejant sırasıyla) */
export function codeCounts(row: TimesheetRow): Array<{ code: Exclude<TimesheetCode, ''>; count: number }> {
  const counts = new Map<TimesheetCode, number>()
  for (const c of Object.values(row.days)) if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  return LEGEND_ORDER.filter((c) => counts.has(c)).map((code) => ({ code, count: counts.get(code)! }))
}

export const LEGEND_ORDER: Array<Exclude<TimesheetCode, ''>> = ['Ç', 'HT', 'Yİ', 'Rİ', 'Üİ', 'Mİ', 'D', 'RT', 'RTÇ', 'P']

// ─── Gün kodu renkleri ───────────────────────────────────────
// Tek kaynak: şerit, takvim, tablo ve lejant bu eşlemeleri kullanır. Değerler yalnızca tema
// token'larından türetilir (globals.css); satır içi stil yalnızca gün kodu kutularında.

/** Token rengini zeminle karıştır: mix('success', 50) → %50 yeşil */
const mix = (token: string, pct: number) => `color-mix(in oklch, var(--${token}) ${pct}%, var(--background))`
/** Metin rengi: tonun koyu hali (okunurluk için ön plan rengiyle karıştırılır) */
const ink = (token: string) => `color-mix(in oklch, var(--${token}) 78%, var(--foreground))`

/** Şeritteki kutu: dolgu rengi; planlı gün kesik çerçeveli boş kutu */
export const STRIP_TONE: Record<TimesheetCode, { bg: string; border?: string; dashed?: boolean }> = {
  'Ç': { bg: mix('success', 55) },
  'RTÇ': { bg: 'var(--primary)' },
  'HT': { bg: mix('foreground', 14) },
  'RT': { bg: mix('warning', 70) },
  'Yİ': { bg: mix('info', 65) },
  'Rİ': { bg: mix('plum', 60) },
  'Üİ': { bg: mix('muted-foreground', 60) },
  'Mİ': { bg: mix('plum', 18), border: mix('plum', 60) },
  'D': { bg: 'var(--destructive)' },
  // Planlı gün: "çalışacak" — çalıştı renginin açık hali (kesik çerçeve dar kutuda gürültü yapıyordu)
  'P': { bg: mix('success', 16) },
  '': { bg: mix('foreground', 5) },
}

/** Takvim / tablo hücresi: yumuşak zemin + metin rengi + saatsiz günlerde gösterilecek kısa etiket */
export const CALENDAR_TONE: Record<TimesheetCode, { bg: string; fg: string; label: string; border?: string; dashed?: boolean }> = {
  'Ç': { bg: mix('success', 10), fg: ink('success'), label: '' },
  'RTÇ': { bg: mix('primary', 12), fg: ink('primary'), label: '' },
  'HT': { bg: 'var(--muted)', fg: 'var(--muted-foreground)', label: 'Tatil' },
  'RT': { bg: mix('warning', 12), fg: ink('warning'), label: 'R. tatil' },
  'Yİ': { bg: mix('info', 10), fg: ink('info'), label: 'İzin' },
  'Rİ': { bg: mix('plum', 10), fg: ink('plum'), label: 'Rapor' },
  'Üİ': { bg: 'var(--muted)', fg: 'var(--muted-foreground)', label: 'Ücr. izin' },
  'Mİ': { bg: mix('plum', 10), fg: ink('plum'), label: 'Mazeret' },
  'D': { bg: mix('destructive', 6), fg: 'var(--destructive)', label: 'Yok', border: mix('destructive', 45) },
  'P': { bg: 'transparent', fg: 'var(--muted-foreground)', label: '', border: mix('foreground', 22), dashed: true },
  '': { bg: 'transparent', fg: 'var(--muted-foreground)', label: '' },
}

/** Kutu çerçevesi (yoksa undefined) */
export const toneBorder = (tone: { border?: string; dashed?: boolean }) =>
  tone.border ? `1px ${tone.dashed ? 'dashed' : 'solid'} ${tone.border}` : undefined
