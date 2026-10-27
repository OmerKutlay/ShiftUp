'use client'

/**
 * WeekGrid — haftalık plan tablosu: kart içinde, yapışkan çalışan sütunu, gün başlıkları,
 * haftalık saat sütunu ve "Mağazada" alt satırı. Masaüstünde tablo kendi içinde kayar
 * (başlık ve alt satır görünür kalır). Satırlar rol gruplarına ayrılır.
 * compact=true → mobil hafta görünümü (başlangıç saatli mini hücreler, gruplama yok).
 * onCellPaint verilirse editör modu: hücreye tıklamak (masaüstünde basılı tutup sürüklemek) onu boyar;
 * kaydedilmemiş hücreler kesikli çerçeveyle işaretlenir.
 */
import { Fragment, useEffect, useRef } from 'react'
import { Store } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWithRole } from '@/types/employee'
import type { WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { LOADING_LABEL, PersonAvatar } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  DAY_LABELS, ROLE_GROUPS, fmtHoursTr, getAvailStatus, roleGroupOf,
  type AvailabilityMap, type EmployeeWeekStats,
} from './scheduleHelpers'
import { MiniShiftCell, ShiftCell, SummaryCell, weeklyLimitMins } from './ScheduleCells'

const DAY_SHORT = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']

/** Sütun genişlikleri (px) — 1440 genişlikte tablo yatay kaymadan sığar */
const NAME_W = 196
const SUM_W = 136
const DAY_MIN_W = 112

/** Masaüstünde tablonun azami yüksekliği: başlık + araç çubuğu dışında kalan ekran */
const SCROLL_AREA = 'md:max-h-[calc(100svh-15.5rem)] md:min-h-80'

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
  /** Salt okunur görünümde oturumdaki çalışanın satırı ("Siz") */
  meId?: string
  /** Editör modu: hücreyi seçili taşla boyar (onCellClick yerine) */
  onCellPaint?: (emp: EmployeeWithRole, date: string) => void
  /** Editör modu: kaydedilmemiş hücreler (`employee_id:YYYY-MM-DD`) */
  pendingKeys?: ReadonlySet<string>
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
    availabilityMap, config, onCellClick, readOnly, compact, meId, onCellPaint, pendingKeys,
  } = props
  const editing = !!onCellPaint

  // Fareyle sürükleyerek boyama: basılıyken üzerinden geçilen hücreler de boyanır
  const dragging = useRef(false)
  useEffect(() => {
    if (!editing) return
    const stop = () => { dragging.current = false }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [editing])

  const groups = ROLE_GROUPS
    .map((g) => ({ ...g, entries: entries.filter((e) => roleGroupOf(e.employee.roles) === g.key) }))
    .filter((g) => g.entries.length > 0)

  const counts = weekDays.map((d) => workingCount(entries, d, approvedLeaveMap, restDayMap))
  const nonZero = counts.filter((c) => c > 0)
  const avg = nonZero.length ? nonZero.reduce((s, c) => s + c, 0) / nonZero.length : 0
  // Haftanın ortalamasından belirgin az kişi olan gün (≥2 kişi fark) "az" işaretlenir
  const isLow = (c: number) => c > 0 && avg - c >= 2
  const visibleIds = new Set(entries.map((e) => e.employee.id))
  const totalMins = [...statsMap.entries()].reduce((s, [id, st]) => s + (visibleIds.has(id) ? st.totalMins : 0), 0)
  const todayIdx = weekDays.indexOf(todayStr)
  const colCount = weekDays.length + 2

  // ── Hücre sınıfları ──
  const head = 'sticky top-0 z-20 border-b bg-muted text-left align-middle font-medium'
  const nameCol = 'sticky left-0 z-10 border-r bg-card'
  const sumCol = 'sticky right-0 z-10 border-l bg-card'
  const dayCol = (i: number) => cn(i > 0 && 'border-l', i === todayIdx && 'bg-muted/30')

  const row = (entry: WeeklyScheduleEntry) => {
    const stats = statsMap.get(entry.employee.id)
    const emp = entry.employee
    const partTime = emp.employment_type === 'part_time'
    const roleText = [emp.roles?.name, partTime && (compact ? 'PT' : 'Yarı zamanlı')].filter(Boolean).join(' · ')
    const mine = !!meId && emp.id === meId
    // Taşınan / pasif çalışan: yalnızca bu mağazadaki vardiyaları görünür, düzenlenemez
    const former = !!entry.formerLabel
    const over = stats ? stats.totalMins > weeklyLimitMins(stats, config) : false
    const warn = over || (stats?.restViolations.length ?? 0) > 0
    return (
      <tr key={emp.id} className="group/row">
        <td className={cn(nameCol, 'border-b', compact ? 'px-2 py-1' : 'px-3 py-1', mine && 'bg-accent')}>
          <div className={cn('flex min-w-0 items-center', compact ? 'gap-1.5' : 'gap-2.5')}>
            {!compact && <PersonAvatar name={emp.full_name} size={28} />}
            <div className="min-w-0">
              <p className={cn('flex items-center gap-1.5 font-medium', compact ? 'text-xs' : 'text-sm')}>
                <span className="truncate">{compact ? emp.full_name.split(/\s+/)[0] : emp.full_name}</span>
                {mine && <Badge variant="outline" className="bg-background px-1.5">Siz</Badge>}
                {former && !compact && <Badge variant="secondary" className="px-1.5 font-normal">{entry.formerLabel}</Badge>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{former && compact ? entry.formerLabel : roleText}</p>
            </div>
          </div>
        </td>
        {weekDays.map((d, i) => {
          const asgn = entry.dayAssignments[d]
          const key = `${emp.id}:${d}`
          const cellProps = {
            assignment: asgn,
            isOnLeave: asgn?.is_on_leave === true || approvedLeaveMap.has(key),
            isRestDay: restDayMap.has(key),
            availStatus: getAvailStatus(emp.id, d, availabilityMap, asgn?.start_time, asgn?.end_time),
            dailyOver: stats ? (stats.dailyMins[d] ?? 0) > config.maxDailyWorkHours * 60 : false,
            onClick: () => (onCellPaint ? onCellPaint(emp, d) : onCellClick(emp, d)),
            readOnly: readOnly || former,
          }
          const pending = pendingKeys?.has(key) ?? false
          // Fare: basınca boya, basılıyken girilen hücreyi boya. Dokunma / klavye onClick ile boyar
          // (aynı taşla tekrar boyamak etkisiz olduğundan farede onClick'in ikinci kez çalışması sorun değil).
          const paintHandlers = onCellPaint && !former ? {
            onPointerDown: (e: React.PointerEvent) => {
              if (e.pointerType !== 'mouse' || e.button !== 0) return
              dragging.current = true
              onCellPaint(emp, d)
            },
            onPointerEnter: (e: React.PointerEvent) => {
              if (e.pointerType === 'mouse' && dragging.current) onCellPaint(emp, d)
            },
          } : undefined
          return (
            <td
              key={d}
              data-pending={pending || undefined}
              className={cn('border-b', compact ? 'p-0.5' : 'p-1', dayCol(i), editing && 'relative')}
              {...paintHandlers}
            >
              {compact ? <MiniShiftCell {...cellProps} /> : <ShiftCell {...cellProps} />}
              {pending && (
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute rounded-md border-2 border-dashed border-primary/70',
                    compact ? 'inset-0.5' : 'inset-1'
                  )}
                />
              )}
            </td>
          )
        })}
        <td className={cn(sumCol, 'border-b', mine && 'bg-accent', compact && 'px-1 text-right')}>
          {compact ? (
            <span className={cn('inline-flex items-center gap-1 text-xs font-medium tabular-nums', over && 'text-destructive')}>
              {warn && <span aria-label="Uyarı" className="size-1.5 rounded-full bg-destructive" />}
              {stats ? (Math.round(stats.totalMins / 6) / 10).toLocaleString('tr-TR') : '—'}
            </span>
          ) : (
            <SummaryCell stats={stats} config={config} />
          )}
        </td>
      </tr>
    )
  }

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-xs">
      <div data-no-pull-refresh className={cn('overflow-auto overscroll-x-contain', !compact && SCROLL_AREA)}>
        <table
          className={cn('w-full table-fixed border-separate border-spacing-0 text-sm', editing && 'select-none')}
          style={compact ? undefined : { minWidth: NAME_W + SUM_W + weekDays.length * DAY_MIN_W }}
        >
          <colgroup>
            <col style={{ width: compact ? 72 : NAME_W }} />
            {weekDays.map((d) => <col key={d} />)}
            <col style={{ width: compact ? 40 : SUM_W }} />
          </colgroup>

          <thead>
            <tr>
              <th className={cn(head, nameCol, 'z-30 bg-muted', compact ? 'px-2' : 'h-14 px-3')}>
                {!compact && <span className="text-xs text-muted-foreground">Çalışan</span>}
              </th>
              {weekDays.map((d, i) => {
                const isToday = i === todayIdx
                const holiday = holidayMap.get(d)
                const date = new Date(`${d}T00:00:00`)
                const tag = holiday ? (holiday.half_day ? 'Arife' : 'Resmi tatil') : null
                const cell = compact ? (
                  <div className="flex flex-col items-center gap-0.5 py-1.5">
                    <span className={cn('text-xs font-normal', holiday ? 'text-warning' : 'text-muted-foreground')}>{DAY_SHORT[i]}</span>
                    <span className={cn('rounded-md px-1 text-sm font-semibold tabular-nums', isToday && 'bg-primary text-primary-foreground')}>
                      {date.getDate()}
                    </span>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className={cn('truncate text-xs font-normal', holiday ? 'text-warning' : 'text-muted-foreground')}>
                      {isToday ? 'Bugün' : DAY_LABELS[i]}{tag && ` · ${tag}`}
                    </span>
                    <span className="flex items-center gap-1 text-sm font-semibold">
                      <span className={cn('rounded-md tabular-nums', isToday && 'bg-primary px-1.5 text-primary-foreground')}>
                        {date.getDate()}
                      </span>
                      {format(date, 'MMM', { locale: tr })}
                    </span>
                  </div>
                )
                return (
                  <th key={d} data-today={isToday || undefined} className={cn(head, i > 0 && 'border-l', compact ? 'px-0' : 'px-3')}>
                    {holiday ? (
                      <Tooltip>
                        <TooltipTrigger asChild><div>{cell}</div></TooltipTrigger>
                        <TooltipContent>
                          Resmi tatil: {holiday.name}{holiday.half_day && ' (13:00 sonrası)'}
                        </TooltipContent>
                      </Tooltip>
                    ) : cell}
                  </th>
                )
              })}
              <th className={cn(head, sumCol, 'z-30 bg-muted', compact ? 'px-1 text-right' : 'px-3')}>
                <span className="text-xs text-muted-foreground">{compact ? 'saat' : 'Bu hafta'}</span>
              </th>
            </tr>
          </thead>

          <tbody className={cn(!compact && '[&>tr:last-child>td]:border-b-0')}>
            {compact
              ? entries.map(row)
              : groups.map((g) => (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={colCount} className="h-9 border-b bg-muted/50 p-0">
                      <div className="sticky left-0 flex w-fit items-center gap-2 px-3 text-xs font-medium text-muted-foreground">
                        {g.label}
                        <Badge variant="secondary" className="px-1.5 tabular-nums">{g.entries.length}</Badge>
                      </div>
                    </td>
                  </tr>
                  {g.entries.map(row)}
                </Fragment>
              ))}
          </tbody>

          {!compact && (
            <tfoot>
              <tr>
                <td className={cn(nameCol, 'sticky bottom-0 z-30 h-11 border-t bg-muted px-3')}>
                  <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Store className="size-4" />
                    Mağazada
                  </span>
                </td>
                {counts.map((c, i) => (
                  <td key={weekDays[i]} className={cn('sticky bottom-0 z-20 border-t bg-muted px-3', i > 0 && 'border-l')}>
                    {isLow(c) ? (
                      <Badge tone="warning" className="tabular-nums">{c} kişi · az</Badge>
                    ) : (
                      <span className="text-xs font-medium tabular-nums">{c} kişi</span>
                    )}
                  </td>
                ))}
                <td className={cn(sumCol, 'sticky bottom-0 z-30 border-t bg-muted px-3 text-sm font-medium tabular-nums')}>
                  {fmtHoursTr(totalMins).replace(' s', ' saat')}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  )
}

/** Tablo düzenini taklit eden yükleme iskeleti */
export function WeekGridSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card role="status" aria-busy="true" aria-label={LOADING_LABEL} className="gap-0 overflow-hidden py-0 shadow-xs">
      <div className="flex h-14 items-center gap-4 border-b bg-muted px-3">
        <Skeleton className="h-3 w-16" />
        <div className="grid flex-1 grid-cols-7 gap-4">
          {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-3 w-12" />)}
        </div>
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-14 items-center gap-4 border-b px-3 last:border-b-0">
          <div className="flex w-44 shrink-0 items-center gap-2.5">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
          <div className="grid flex-1 grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, d) => (
              <Skeleton key={d} className={cn('h-10', (r + d) % 4 === 0 && 'opacity-40')} />
            ))}
          </div>
        </div>
      ))}
    </Card>
  )
}
