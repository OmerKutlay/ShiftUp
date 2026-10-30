/**
 * weekExport — haftalık planın PDF ve CSV çıktısı. Yazdırma tablosuyla (WeekPrintSheet) aynı içerik:
 * rol grupları, hücrede vardiya saati + şablon adı / izin / haftalık tatil, haftalık net saat ve
 * günlük mağazadaki kişi sayısı.
 */
import type { WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { toCsv } from '@/lib/export/csv'
import { saveCsv } from '@/lib/export/download'
import { storeFileSlug } from '@/lib/export/fileName'
import { downloadPdf, type PdfRow } from '@/lib/export/pdf'
import { DAY_LABELS, ROLE_GROUPS, fmtRange, roleGroupOf, type EmployeeWeekStats } from '../scheduleHelpers'
import { OFF_META } from '../ScheduleCells'
import { dayHeadcount } from './WeekPrintSheet'
import { formatWeekRangeTr } from './printHelpers'

export interface WeekExportInput {
  storeName: string
  weekDays: string[]
  entries: WeeklyScheduleEntry[]
  holidayMap: Map<string, PublicHoliday>
  statsMap: Map<string, EmployeeWeekStats>
  approvedLeaveMap: Set<string>
  restDayMap: Set<string>
}

/** Dakika → bir ondalıklı saat */
const h1 = (mins: number) => Math.round(mins / 6) / 10

/** Yazdırma tablosuyla aynı: "Pzt 26.10" */
const dayHead = (d: string, i: number) => `${DAY_LABELS[i]} ${Number(d.slice(8, 10))}.${d.slice(5, 7)}`

/** Hücre: [saat aralığı, şablon adı] ya da izin / tatil etiketi; boşsa [] */
function cellParts(input: WeekExportInput, e: WeeklyScheduleEntry, d: string): string[] {
  const key = `${e.employee.id}:${d}`
  if (input.restDayMap.has(key)) return ['Haftalık tatil']
  const a = e.dayAssignments[d]
  if (a?.is_on_leave || input.approvedLeaveMap.has(key)) return [OFF_META.leave.label]
  if (!a) return []
  return [fmtRange(a.start_time, a.end_time), a.shift_templates?.name ?? ''].filter(Boolean)
}

function grouped(entries: WeeklyScheduleEntry[]) {
  return ROLE_GROUPS
    .map((g) => ({ label: g.label, entries: entries.filter((e) => roleGroupOf(e.employee.roles) === g.key) }))
    .filter((g) => g.entries.length > 0)
}

/** PDF sütun genişlikleri (mm) */
const NAME_W = 42
const HOURS_W = 14

const fileBase = (input: WeekExportInput) => `haftalik-plan-${storeFileSlug(input.storeName)}-${input.weekDays[0]}`

export function exportWeekCsv(input: WeekExportInput) {
  const { weekDays, entries, statsMap } = input
  const head = ['Grup', 'Çalışan', 'Rol', ...weekDays.map(dayHead), 'Haftalık net saat']
  const rows: Array<Array<string | number>> = []
  for (const g of grouped(entries)) {
    for (const e of g.entries) {
      rows.push([
        g.label,
        e.employee.full_name,
        e.employee.roles?.name ?? '',
        ...weekDays.map((d) => {
          const [range, name] = cellParts(input, e, d)
          return name ? `${range} (${name})` : range ?? ''
        }),
        h1(statsMap.get(e.employee.id)?.totalMins ?? 0),
      ])
    }
  }
  const totalMins = entries.reduce((s, e) => s + (statsMap.get(e.employee.id)?.totalMins ?? 0), 0)
  rows.push([
    'Toplam', 'Mağazada (kişi)', '',
    ...weekDays.map((d) => dayHeadcount(entries, d, input.approvedLeaveMap, input.restDayMap)),
    h1(totalMins),
  ])
  saveCsv(toCsv(head, rows), `${fileBase(input)}.csv`)
}

export function exportWeekPdf(input: WeekExportInput) {
  const { weekDays, entries, statsMap, holidayMap } = input
  const hours = (mins: number) => h1(mins).toLocaleString('tr-TR')
  const body: PdfRow[] = []
  for (const g of grouped(entries)) {
    body.push({ group: g.label })
    for (const e of g.entries) {
      body.push([
        [e.employee.full_name, e.employee.roles?.name].filter(Boolean).join('\n'),
        ...weekDays.map((d) => cellParts(input, e, d).join('\n')),
        hours(statsMap.get(e.employee.id)?.totalMins ?? 0),
      ])
    }
  }
  const totalMins = entries.reduce((s, e) => s + (statsMap.get(e.employee.id)?.totalMins ?? 0), 0)
  const dayCols = weekDays.length

  return downloadPdf({
    title: 'Haftalık vardiya planı',
    subtitle: [input.storeName, formatWeekRangeTr(weekDays[0], weekDays[weekDays.length - 1])].filter(Boolean).join(' · '),
    head: [
      'Çalışan',
      ...weekDays.map((d, i) => {
        const h = holidayMap.get(d)
        return h ? `${dayHead(d, i)}\n${h.half_day ? 'Arife' : 'Resmi tatil'}: ${h.name}` : dayHead(d, i)
      }),
      'Saat',
    ],
    body,
    foot: [
      'Mağazada (kişi)',
      ...weekDays.map((d) => dayHeadcount(entries, d, input.approvedLeaveMap, input.restDayMap)),
      hours(totalMins),
    ],
    orientation: 'landscape',
    fontSize: entries.length > 25 ? 7 : 8,
    // Gün sütunları eşit genişlikte (tatil adı uzun olsa da): A4 yatay 277 mm − ad − saat
    columnStyles: {
      0: { cellWidth: NAME_W },
      ...Object.fromEntries(weekDays.map((_, i) => [i + 1, { halign: 'center' as const, cellWidth: (277 - NAME_W - HOURS_W) / dayCols }])),
      [dayCols + 1]: { halign: 'center', cellWidth: HOURS_W, fontStyle: 'bold' },
    },
    // Resmi tatil sütunu açık gri (yazdırma çıktısıyla aynı)
    cellStyle: (_row, col) => (col >= 1 && col <= dayCols && holidayMap.has(weekDays[col - 1]) ? { fillColor: [240, 240, 242] } : undefined),
    notes: ['Saat: haftalık net çalışma saati (mola düşülmüş).'],
    filename: `${fileBase(input)}.pdf`,
  })
}
