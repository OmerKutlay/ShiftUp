/**
 * WeekPrintSheet — haftalık planın A4 yatay çıktı tablosu (saf sunum; veri dışarıdan gelir).
 * Siyah-beyaz yazıcıya uygun: renge dayanmaz, kenarlıklar görünür, dolgular açık gri.
 * Satırlar planla aynı sırada ve rol gruplarına ayrılmıştır; izin etiketi plan hücreleriyle aynıdır
 * (OFF_META). Satırlar tek satırlıktır (ad · rol, saat + vardiya adı) ki tipik bir mağaza tek sayfaya sığsın;
 * 30 kişiden fazlasında yazı küçülür, yine taşarsa başlık satırı her sayfada tekrarlanır.
 */
import type { WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { cn } from '@/lib/utils'
import { DAY_LABELS, ROLE_GROUPS, fmtRange, roleGroupOf, type EmployeeWeekStats } from '../scheduleHelpers'
import { OFF_META } from '../ScheduleCells'
import { formatWeekRangeTr, hoursNumTr } from './printHelpers'

export interface WeekPrintSheetProps {
  storeName: string
  weekDays: string[]
  entries: WeeklyScheduleEntry[]
  holidayMap: Map<string, PublicHoliday>
  statsMap: Map<string, EmployeeWeekStats>
  approvedLeaveMap: Set<string>
  restDayMap: Set<string>
  /** "Basım" damgası (önceden biçimlenmiş) */
  printedAt: string
}

/** O gün çalışan kişi sayısı (izin / tatil hariç) */
export function dayHeadcount(entries: WeeklyScheduleEntry[], day: string, leave: Set<string>, rest: Set<string>): number {
  return entries.filter((e) => {
    const a = e.dayAssignments[day]
    const key = `${e.employee.id}:${day}`
    return a && !a.is_on_leave && !leave.has(key) && !rest.has(key)
  }).length
}

const CELL = 'border border-black px-1 py-px align-middle leading-tight'

export function WeekPrintSheet({
  storeName, weekDays, entries, holidayMap, statsMap, approvedLeaveMap, restDayMap, printedAt,
}: WeekPrintSheetProps) {
  const groups = ROLE_GROUPS
    .map((g) => ({ ...g, entries: entries.filter((e) => roleGroupOf(e.employee.roles) === g.key) }))
    .filter((g) => g.entries.length > 0)
  const dense = entries.length > 30
  const totalMins = entries.reduce((s, e) => s + (statsMap.get(e.employee.id)?.totalMins ?? 0), 0)

  const cellContent = (e: WeeklyScheduleEntry, d: string) => {
    const a = e.dayAssignments[d]
    const key = `${e.employee.id}:${d}`
    if (restDayMap.has(key)) return <span className="italic">Haftalık tatil</span>
    if (a?.is_on_leave || approvedLeaveMap.has(key)) return <span className="italic">{OFF_META.leave.label}</span>
    if (!a) return null
    return (
      <>
        <span className="font-semibold tabular-nums">{fmtRange(a.start_time, a.end_time)}</span>
        {a.shift_templates?.name && <span className="ml-1 text-[0.85em]">{a.shift_templates.name}</span>}
      </>
    )
  }

  return (
    <section className={cn('print-sheet bg-white text-black', dense ? 'text-[9px]' : 'text-[10px]')}>
      <header className="mb-2 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold leading-tight">{storeName} · Haftalık vardiya planı</h1>
          <p className="text-sm font-medium">{formatWeekRangeTr(weekDays[0], weekDays[6])}</p>
        </div>
        <p className="text-[10px]">Basım: {printedAt}</p>
      </header>

      <table className="w-full table-fixed border-collapse border border-black">
        <colgroup>
          <col style={{ width: '18%' }} />
          {weekDays.map((d) => <col key={d} />)}
          <col style={{ width: '5%' }} />
        </colgroup>
        <thead className="print-thead bg-gray-200">
          <tr>
            <th className={cn(CELL, 'text-left')}>Çalışan</th>
            {weekDays.map((d, i) => {
              const h = holidayMap.get(d)
              return (
                <th key={d} className={cn(CELL, 'text-center')}>
                  <span className="block">{DAY_LABELS[i]} {Number(d.slice(8, 10))}.{d.slice(5, 7)}</span>
                  {h && <span className="block text-[0.85em] font-normal">{h.half_day ? 'Arife' : 'Resmi tatil'}: {h.name}</span>}
                </th>
              )
            })}
            <th className={cn(CELL, 'text-center')}>Saat</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.key} label={g.label} colSpan={weekDays.length + 2}>
              {g.entries.map((e) => (
                <tr key={e.employee.id} className="break-inside-avoid">
                  <td className={cn(CELL, 'text-left')}>
                    <span className="font-semibold">{e.employee.full_name}</span>
                    {e.employee.roles?.name && <span className="text-[0.85em]"> · {e.employee.roles.name}</span>}
                  </td>
                  {weekDays.map((d) => (
                    <td key={d} className={cn(CELL, 'text-center', holidayMap.has(d) && 'bg-gray-100')}>
                      {cellContent(e, d)}
                    </td>
                  ))}
                  <td className={cn(CELL, 'text-center font-semibold tabular-nums')}>
                    {hoursNumTr(statsMap.get(e.employee.id)?.totalMins ?? 0)}
                  </td>
                </tr>
              ))}
            </GroupRows>
          ))}
        </tbody>
        <tbody className="bg-gray-200">
          <tr className="break-inside-avoid">
            <td className={cn(CELL, 'font-semibold')}>Mağazada (kişi)</td>
            {weekDays.map((d) => (
              <td key={d} className={cn(CELL, 'text-center font-semibold tabular-nums')}>
                {dayHeadcount(entries, d, approvedLeaveMap, restDayMap)}
              </td>
            ))}
            <td className={cn(CELL, 'text-center font-semibold tabular-nums')}>{hoursNumTr(totalMins)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[9px]">Saat: haftalık net çalışma saati (mola düşülmüş).</p>
    </section>
  )
}

function GroupRows({ label, colSpan, children }: { label: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="break-inside-avoid">
        <td colSpan={colSpan} className={cn(CELL, 'bg-gray-100 text-left font-semibold')}>{label}</td>
      </tr>
      {children}
    </>
  )
}
