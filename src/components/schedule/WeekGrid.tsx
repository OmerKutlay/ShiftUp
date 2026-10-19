'use client'

/**
 * WeekGrid — haftalık plan tablosu (yeni UI): rol gruplu satırlar, gün sütunları,
 * "Bu hafta" özet sütunu ve günlük kişi sayısı satırı.
 * compact=true → mobil hafta görünümü (başlangıç saatli mini kutular).
 */
import { Fragment } from 'react'
import { Store } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWithRole } from '@/types/employee'
import type { WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { PersonAvatar } from '@/components/common'
import { cn } from '@/lib/utils'
import {
  ROLE_GROUPS, fmtHoursTr, getAvailStatus, roleGroupOf,
  type AvailabilityMap, type EmployeeWeekStats,
} from './scheduleHelpers'
import { MiniShiftCell, ShiftCell, SummaryCell, weeklyLimitMins } from './ScheduleCells'

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
const DAY_SHORT = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']

export interface WeekGridProps {
  entries: WeeklyScheduleEntry[]
  weekDays: string[]
  todayStr: string
  holidayMap: Map<string, PublicHoliday>
  statsMap: Map<string, EmployeeWeekStats>
  approvedLeaveMap: Set<string>
  restDayMap: Set<string>
  availabilityMap: AvailabilityMap
  config: ReturnType<typeof getWorkingTimeConfig>
  onCellClick: (emp: EmployeeWithRole, date: string) => void
  readOnly?: boolean
  compact?: boolean
}

/** O gün mağazada çalışan kişi sayısı (izin / tatil hariç) */
export function workingCount(entries: WeeklyScheduleEntry[], day: string, leave: Set<string>, rest: Set<string>): number {
  return entries.filter((e) => {
    const a = e.dayAssignments[day]
    const key = `${e.employee.id}:${day}`
    return a && !a.is_on_leave && !leave.has(key) && !rest.has(key)
  }).length
}

export function WeekGrid(props: WeekGridProps) {
  const {
    entries, weekDays, todayStr, holidayMap, statsMap, approvedLeaveMap, restDayMap,
    availabilityMap, config, onCellClick, readOnly, compact,
  } = props

  const groups = ROLE_GROUPS
    .map((g) => ({ ...g, entries: entries.filter((e) => roleGroupOf(e.employee.role ?? '') === g.key) }))
    .filter((g) => g.entries.length > 0)

  const counts = weekDays.map((d) => workingCount(entries, d, approvedLeaveMap, restDayMap))
  const nonZero = counts.filter((c) => c > 0)
  const avg = nonZero.length ? nonZero.reduce((s, c) => s + c, 0) / nonZero.length : 0
  // Haftanın ortalamasından belirgin az kişi olan gün (≥2 kişi fark) "az" işaretlenir
  const isLow = (c: number) => c > 0 && avg - c >= 2
  const totalMins = [...statsMap.values()].reduce((s, st) => s + st.totalMins, 0)

  const nameW = compact ? 86 : 200
  const cols = compact
    ? `${nameW}px repeat(7, minmax(28px, 1fr)) 46px`
    : `${nameW}px repeat(7, minmax(108px, 1fr)) 150px`

  const todayIdx = weekDays.indexOf(todayStr)
  // Bugünün sütunu boydan boya açık kiremit zeminli
  const colBg = (i: number) => (i === todayIdx ? 'bg-accent' : undefined)
  const rowStyle = { gridTemplateColumns: cols }
  const nameCell = cn('sticky left-0 z-[1] flex min-w-0 items-center bg-card pr-2', compact ? 'gap-1.5 py-1.5' : 'gap-2.5 py-2')

  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <div style={{ minWidth: compact ? undefined : nameW + 7 * 108 + 150 }}>
        {/* Başlık */}
        <div className="grid items-stretch border-b" style={rowStyle}>
          <div className={cn(nameCell, 'items-end pb-2')}>
            {!compact && <span className="text-xs text-ink-secondary">Ekip</span>}
          </div>
          {weekDays.map((d, i) => {
            const isToday = i === todayIdx
            const holiday = holidayMap.get(d)
            const top = isToday ? 'Bugün' : DAY_NAMES[i]
            const tag = holiday ? (holiday.half_day ? 'arife' : 'tatil') : null
            const accent = isToday ? 'text-primary' : holiday ? 'text-warning' : undefined
            return (
              <div
                key={d}
                data-today={isToday || undefined}
                title={holiday ? `Resmi tatil: ${holiday.name}${holiday.half_day ? ' (13:00 sonrası)' : ''}` : undefined}
                className={cn('rounded-t-[10px] pb-2', colBg(i), compact ? 'pt-1.5 text-center' : 'px-2 pt-2.5')}
              >
                {compact ? (
                  <>
                    <p className={cn('text-[0.62rem]', accent ?? 'text-ink-secondary')}>{DAY_SHORT[i]}</p>
                    <p className={cn('text-[0.85rem] font-bold', accent)}>{Number(d.slice(8))}</p>
                  </>
                ) : (
                  <>
                    <p className={cn('truncate text-[0.72rem]', accent ?? 'text-ink-secondary', (isToday || tag) && 'font-semibold')}>
                      {top}{tag && ` · ${tag}`}
                    </p>
                    <p className={cn('truncate text-[0.95rem] font-bold', isToday && 'text-primary')}>
                      {format(new Date(`${d}T00:00:00`), 'd MMMM', { locale: tr })}
                    </p>
                  </>
                )}
              </div>
            )
          })}
          <div className={cn('flex items-end pb-2', compact ? 'justify-center' : 'px-3')}>
            <span className={cn('text-ink-secondary', compact ? 'text-[0.62rem]' : 'text-xs')}>{compact ? 'saat' : 'Bu hafta'}</span>
          </div>
        </div>

        {/* Gruplar */}
        {groups.map((g) => (
          <Fragment key={g.key}>
            {!compact && (
              <div className="grid items-stretch border-b" style={rowStyle}>
                <div className={cn(nameCell, 'py-2.5')}>
                  <span className="text-[0.8rem] font-bold">{g.label}</span>
                  <span className="text-xs text-ink-secondary">{g.entries.length} kişi</span>
                </div>
                {weekDays.map((d, i) => <div key={d} className={colBg(i)} />)}
                <div />
              </div>
            )}
            {g.entries.map((entry) => {
              const stats = statsMap.get(entry.employee.id)
              const emp = entry.employee
              const roleText = [emp.role, emp.employment_type === 'part_time' && (compact ? 'PT' : 'yarı zamanlı')].filter(Boolean).join(' · ')
              const rest = stats?.restViolations.length ?? 0
              const over = stats ? stats.totalMins > weeklyLimitMins(stats, config) : false
              return (
                <div key={emp.id} className="grid items-stretch border-b" style={rowStyle}>
                  <div className={nameCell}>
                    <PersonAvatar name={emp.full_name} size={compact ? 24 : 32} />
                    <div className="min-w-0">
                      <p className={cn('truncate font-bold', compact ? 'text-xs' : 'text-[0.85rem]')}>
                        {compact ? emp.full_name.split(/\s+/)[0] : emp.full_name}
                      </p>
                      <p className={cn('truncate text-ink-secondary', compact ? 'text-[0.62rem]' : 'text-[0.7rem]')}>{roleText}</p>
                    </div>
                  </div>
                  {weekDays.map((d, i) => {
                    const asgn = entry.dayAssignments[d]
                    const key = `${emp.id}:${d}`
                    const cellProps = {
                      assignment: asgn,
                      isOnLeave: asgn?.is_on_leave === true || approvedLeaveMap.has(key),
                      isRestDay: restDayMap.has(key),
                      availStatus: getAvailStatus(emp.id, d, availabilityMap, asgn?.start_time, asgn?.end_time),
                      dailyOver: stats ? (stats.dailyMins[d] ?? 0) > config.maxDailyWorkHours * 60 : false,
                      onClick: () => onCellClick(emp, d),
                      readOnly,
                    }
                    return (
                      <div key={d} className={cn('flex min-w-0 items-center', compact ? 'p-[3px]' : 'p-1', colBg(i))}>
                        {compact ? <MiniShiftCell {...cellProps} /> : <ShiftCell {...cellProps} />}
                      </div>
                    )
                  })}
                  {compact ? (
                    <div className="flex items-center justify-end gap-1 pr-0.5">
                      {(rest > 0 || over) && <span aria-label="Uyarı" className="size-1.5 rounded-full bg-danger-fill" />}
                      <span className={cn('text-xs font-bold', over && 'text-danger')}>
                        {stats ? (Math.round(stats.totalMins / 6) / 10).toLocaleString('tr-TR') : '—'}
                      </span>
                    </div>
                  ) : (
                    <SummaryCell stats={stats} config={config} />
                  )}
                </div>
              )
            })}
          </Fragment>
        ))}

        {/* Günlük kişi sayısı */}
        {!compact && (
          <div className="grid items-stretch" style={rowStyle}>
            <div className={cn(nameCell, 'py-3 text-ink-secondary')}>
              <Store className="size-4" />
              <span className="text-[0.78rem]">Mağazada</span>
            </div>
            {counts.map((c, i) => (
              <div key={weekDays[i]} className={cn('flex items-center rounded-b-[10px] px-2', colBg(i))}>
                {isLow(c) ? (
                  <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-bold text-warning">{c} kişi · az</span>
                ) : (
                  <span className="text-[0.8rem] font-semibold">{c} kişi</span>
                )}
              </div>
            ))}
            <div className="flex items-center px-3">
              <span className="text-[0.85rem] font-bold">{fmtHoursTr(totalMins).replace(' s', ' saat')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
