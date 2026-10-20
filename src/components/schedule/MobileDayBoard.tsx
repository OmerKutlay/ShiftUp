'use client'

/**
 * MobileDayBoard — haftalık planın "Gün" görünümü: gün şeridi, seçilen günün vardiyaları
 * ortak bir saat ekseninde (zaman çizelgesi) ve o gün çalışmayanlar. Telefonda varsayılan
 * görünümdür; masaüstünde "Gün" seçilince zaman çizelgesi ile çalışmayanlar yan yana durur.
 */
import { Fragment, useMemo } from 'react'
import { CalendarPlus, Plus, TriangleAlert } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { PersonAvatar } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@/components/ui/item'
import { cn } from '@/lib/utils'
import {
  DAY_LABELS, fmtDuration, fmtHoursTr, fmtRange, getAvailStatus, shiftDisplayName, shiftKindOf, shiftNetMins,
  type AvailabilityMap, type AvailStatus,
} from './scheduleHelpers'
import { OFF_META, type OffKind } from './ScheduleCells'

export interface MobileDayBoardProps {
  entries: WeeklyScheduleEntry[]
  weekDays: string[]
  selectedDay: string
  onSelectDay: (d: string) => void
  holidayMap: Map<string, PublicHoliday>
  approvedLeaveMap: Set<string>
  restDayMap: Set<string>
  availabilityMap: AvailabilityMap
  maxDailyMins: number
  onCellClick: (emp: EmployeeWithRole, date: string) => void
  readOnly?: boolean
}

type DayOffKind = OffKind | 'unassigned'

const toMins = (t: string) => {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

/** Vardiyanın dakika aralığı (gece yarısını geçen bitiş +24s) */
function spanOf(a: ShiftAssignmentWithDetails): [number, number] {
  const s = toMins(a.start_time)
  let e = toMins(a.end_time)
  if (e <= s) e += 24 * 60
  return [s, e]
}

const shortName = (n: string) => {
  const p = n.trim().split(/\s+/)
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : n
}

/** Zaman çizelgesi satırlarının ortak ızgarası: sol ad sütunu + saat ekseni */
const TRACK_GRID = 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 px-4 md:grid-cols-[15rem_minmax(0,1fr)] md:px-6'

/** Liste satırı: yöneticide tıklanabilir düğme, çalışanda düz satır */
function RowItem({ readOnly, onClick, className, children }: {
  readOnly: boolean; onClick: () => void; className?: string; children: React.ReactNode
}) {
  if (readOnly) return <Item size="sm" className={cn('rounded-none', className)}>{children}</Item>
  return (
    <Item size="sm" asChild className={cn('w-full rounded-none text-left hover:bg-muted/50', className)}>
      <button type="button" onClick={onClick}>{children}</button>
    </Item>
  )
}

interface WorkingRow {
  emp: EmployeeWithRole
  asgn: ShiftAssignmentWithDetails
  span: [number, number]
  net: number
  warn: AvailStatus | 'over' | null
}

export function MobileDayBoard({
  entries, weekDays, selectedDay, onSelectDay, holidayMap, approvedLeaveMap, restDayMap,
  availabilityMap, maxDailyMins, onCellClick, readOnly = false,
}: MobileDayBoardProps) {
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  // Her gün için çalışan sayısı (gün şeridi)
  const countByDay = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of weekDays) {
      m[d] = entries.filter((e) => {
        const a = e.dayAssignments[d]
        const key = `${e.employee.id}:${d}`
        return a && !a.is_on_leave && !approvedLeaveMap.has(key) && !restDayMap.has(key)
      }).length
    }
    return m
  }, [entries, weekDays, approvedLeaveMap, restDayMap])

  const { working, off } = useMemo(() => {
    const working: WorkingRow[] = []
    const off: { emp: EmployeeWithRole; kind: DayOffKind }[] = []
    for (const e of entries) {
      const key = `${e.employee.id}:${selectedDay}`
      const asgn = e.dayAssignments[selectedDay]
      if (restDayMap.has(key)) { off.push({ emp: e.employee, kind: 'rest' }); continue }
      if (asgn?.is_on_leave || approvedLeaveMap.has(key)) { off.push({ emp: e.employee, kind: 'leave' }); continue }
      const avail = getAvailStatus(e.employee.id, selectedDay, availabilityMap, asgn?.start_time, asgn?.end_time)
      if (!asgn) { off.push({ emp: e.employee, kind: avail === 'off' ? 'unavailable' : 'unassigned' }); continue }
      const net = shiftNetMins(asgn)
      working.push({
        emp: e.employee, asgn, span: spanOf(asgn), net,
        warn: net > maxDailyMins ? 'over' : avail === 'off' || avail === 'partial' ? avail : null,
      })
    }
    working.sort((a, b) => a.span[0] - b.span[0] || a.span[1] - b.span[1]
      || a.emp.full_name.localeCompare(b.emp.full_name, 'tr'))
    const order: DayOffKind[] = ['leave', 'rest', 'unavailable', 'unassigned']
    off.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.emp.full_name.localeCompare(b.emp.full_name, 'tr'))
    return { working, off }
  }, [entries, selectedDay, approvedLeaveMap, restDayMap, availabilityMap, maxDailyMins])

  // Saat ekseni: günün en erken başlangıcından en geç bitişine (tam saate yuvarlanmış), en az 09–22
  const [axisStart, axisEnd] = useMemo(() => {
    let s = 9 * 60, e = 22 * 60
    for (const r of working) { s = Math.min(s, r.span[0]); e = Math.max(e, r.span[1]) }
    return [Math.floor(s / 60) * 60, Math.ceil(e / 60) * 60]
  }, [working])
  const axisLen = axisEnd - axisStart
  const ticks: number[] = []
  const step = axisLen > 14 * 60 ? 240 : axisLen > 10 * 60 ? 180 : 120
  for (let t = axisStart; t <= axisEnd; t += step) ticks.push(t)
  const pct = (m: number) => `${((m - axisStart) / axisLen) * 100}%`
  const fmtHour = (m: number) => String(Math.floor(m / 60) % 24).padStart(2, '0')
  // Bugün seçiliyse "şu an" çizgisi
  const now = new Date()
  const nowRaw = now.getHours() * 60 + now.getMinutes()
  const nowMins = selectedDay === todayStr && nowRaw >= axisStart && nowRaw <= axisEnd ? nowRaw : null

  // Saat saat kaç kişi var — eksenin altındaki yoğunluk çubukları
  const coverage = useMemo(() => {
    const out: number[] = []
    for (let t = axisStart; t < axisEnd; t += 60) {
      out.push(working.filter((r) => r.span[0] < t + 60 && r.span[1] > t).length)
    }
    return out
  }, [working, axisStart, axisEnd])
  const maxCov = Math.max(1, ...coverage)

  const totalNet = working.reduce((s, r) => s + r.net, 0)
  const holiday = holidayMap.get(selectedDay)
  const dayLabel = format(new Date(`${selectedDay}T00:00:00`), 'd MMMM', { locale: tr })
  const cardTitle = selectedDay === todayStr
    ? `Bugün, ${dayLabel}`
    : format(new Date(`${selectedDay}T00:00:00`), 'd MMMM EEEE', { locale: tr })
  const lastEnd = working.reduce((m, r) => Math.max(m, r.span[1]), 0)

  return (
    <div className="flex flex-col gap-4">
      {/* ── Gün şeridi ── */}
      <div role="group" aria-label="Gün seçimi" className="grid grid-cols-7 gap-1 rounded-lg bg-muted p-1">
        {weekDays.map((d, i) => {
          const sel = d === selectedDay
          const isToday = d === todayStr
          const h = holidayMap.get(d)
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelectDay(d)}
              aria-pressed={sel}
              aria-label={`${format(new Date(`${d}T00:00:00`), 'd MMMM EEEE', { locale: tr })}, ${countByDay[d]} kişi`}
              className={cn(
                'flex min-w-0 flex-col items-center gap-0.5 rounded-md py-1.5 text-muted-foreground transition-colors outline-none',
                'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                sel && 'bg-background text-foreground shadow-sm'
              )}
            >
              <span className={cn('text-xs', h && 'text-warning')}>{DAY_LABELS[i]}</span>
              <span className={cn('text-lg leading-tight font-semibold tabular-nums', isToday && 'text-primary')}>
                {Number(d.slice(8))}
              </span>
              <span className="text-xs tabular-nums">
                {countByDay[d]}<span className="max-sm:hidden"> kişi</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── Zaman çizelgesi ── */}
        <Card className="gap-0 overflow-hidden py-0 shadow-xs">
          <CardHeader className="border-b py-4 md:px-6 [.border-b]:pb-4">
            <CardTitle className="first-letter:uppercase">{cardTitle}</CardTitle>
            <CardDescription>
              {working.length} kişi çalışıyor · {fmtHoursTr(totalNet).replace(' s', ' saat')}
              {working.length > 0 && ` · ${working[0].asgn.start_time.slice(0, 5)}–${fmtHour(lastEnd)}:${String(lastEnd % 60).padStart(2, '0')}`}
            </CardDescription>
            {holiday && (
              <CardAction>
                <Badge tone="warning" title={holiday.name}>{holiday.half_day ? 'Arife' : 'Resmi tatil'}</Badge>
              </CardAction>
            )}
          </CardHeader>

          {working.length > 0 ? (
            <div className="relative">
              {/* Dikey saat çizgileri ve "şu an" — tüm satırların arkasında */}
              <div aria-hidden className={cn(TRACK_GRID, 'pointer-events-none absolute inset-0')}>
                <span />
                <div className="relative">
                  {ticks.map((t) => (
                    <span key={t} className="absolute inset-y-0 w-px bg-border/70" style={{ left: pct(t) }} />
                  ))}
                  {nowMins !== null && (
                    <span className="absolute inset-y-0 w-px bg-destructive/70" style={{ left: pct(nowMins) }}>
                      <span className="absolute top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-destructive" />
                    </span>
                  )}
                </div>
              </div>

              {/* Eksen + saatlik kadro */}
              <div className={cn(TRACK_GRID, 'relative items-end border-b bg-muted/40 py-2')}>
                <span className="text-xs text-muted-foreground">Saatlik kadro</span>
                <div className="flex flex-col gap-1">
                  <div className="flex h-6 items-end gap-0.5" aria-label="Saatlik çalışan sayısı">
                    {coverage.map((c, i) => (
                      <span
                        key={i}
                        title={`${fmtHour(axisStart + i * 60)}:00 — ${c} kişi`}
                        className={cn('flex-1 rounded-sm', c === 0 ? 'bg-destructive/60' : 'bg-chart-1/40')}
                        style={{ height: c === 0 ? 3 : `${Math.max(15, (c / maxCov) * 100)}%` }}
                      />
                    ))}
                  </div>
                  <div className="relative h-4">
                    {ticks.map((t) => (
                      <span
                        key={t}
                        className={cn(
                          'absolute text-xs leading-4 text-muted-foreground tabular-nums',
                          t !== axisStart && (t === axisEnd ? '-translate-x-full' : '-translate-x-1/2')
                        )}
                        style={{ left: pct(t) }}
                      >
                        {fmtHour(t)}<span className="max-md:hidden">:00</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <ItemGroup>
                {working.map((r, idx) => {
                  const start = r.asgn.start_time.slice(0, 5)
                  const end = r.asgn.end_time.slice(0, 5)
                  const kind = shiftKindOf(r.asgn.shift_templates?.name, start, end)
                  const tone = SHIFT_KIND_TONES[kind]
                  const name = shiftDisplayName(r.asgn.shift_templates?.name, start, end)
                  const danger = r.warn === 'over' || r.warn === 'off'
                  const warnLabel = r.warn === 'over' ? 'Günlük limit üstü' : r.warn === 'off' ? 'Müsait değil' : 'Müsaitlik dışı'
                  return (
                    <Fragment key={r.emp.id}>
                      {idx > 0 && <ItemSeparator />}
                      <RowItem
                        readOnly={readOnly}
                        onClick={() => onCellClick(r.emp, selectedDay)}
                        className={cn(TRACK_GRID, 'py-2 md:px-6')}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <PersonAvatar name={r.emp.full_name} size={28} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-medium">
                              <span className="truncate md:hidden">{shortName(r.emp.full_name)}</span>
                              <span className="truncate max-md:hidden">{r.emp.full_name}</span>
                              {r.emp.employment_type === 'part_time' && (
                                <Badge variant="secondary" className="px-1.5">PT</Badge>
                              )}
                            </p>
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className={cn('shrink-0 whitespace-nowrap tabular-nums', danger && 'text-destructive')}>{fmtRange(start, end)}</span>
                              {r.warn && (
                                <TriangleAlert
                                  aria-label={warnLabel}
                                  className={cn('size-3.5 shrink-0', danger ? 'text-destructive' : 'text-warning')}
                                />
                              )}
                              {r.emp.roles?.name && <span className="truncate max-md:hidden">· {r.emp.roles.name}</span>}
                            </p>
                          </div>
                        </div>
                        <div className="relative h-8">
                          <div
                            className="@container absolute inset-y-0 flex items-center overflow-hidden rounded-md border-l-4 px-2"
                            style={{
                              left: pct(r.span[0]),
                              width: `${((r.span[1] - r.span[0]) / axisLen) * 100}%`,
                              backgroundColor: tone.soft,
                              borderLeftColor: tone.fill,
                              color: tone.text,
                            }}
                          >
                            <span className="hidden truncate text-xs font-medium @[4.5rem]:inline">{name}</span>
                            <span className="ml-auto hidden shrink-0 pl-2 text-xs tabular-nums @[9rem]:inline">
                              {fmtDuration(r.net)}
                            </span>
                          </div>
                        </div>
                      </RowItem>
                    </Fragment>
                  )
                })}
              </ItemGroup>
            </div>
          ) : (
            <Empty className="border-0 py-10 md:py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><CalendarPlus /></EmptyMedia>
                <EmptyTitle>Vardiya yok</EmptyTitle>
                <EmptyDescription>Bu gün için planlanmış vardiya yok.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </Card>

        {/* ── Çalışmayanlar ── */}
        {off.length > 0 && (
          <Card className="gap-0 overflow-hidden py-0 shadow-xs">
            <CardHeader className="border-b py-4 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-2">
                Çalışmayanlar
                <Badge variant="secondary" className="tabular-nums">{off.length}</Badge>
              </CardTitle>
              <CardDescription>İzinli, tatilde ya da vardiyasız</CardDescription>
            </CardHeader>
            <ItemGroup>
              {off.map(({ emp, kind }, idx) => {
                const meta = kind === 'unassigned' ? null : OFF_META[kind]
                const Icon = meta?.icon
                const body = (
                  <>
                    <ItemMedia><PersonAvatar name={emp.full_name} size={28} /></ItemMedia>
                    <ItemContent className="min-w-0 gap-0.5">
                      <ItemTitle className="w-full truncate">{emp.full_name}</ItemTitle>
                      {emp.roles?.name && <ItemDescription className="truncate text-xs">{emp.roles.name}</ItemDescription>}
                    </ItemContent>
                    <ItemActions>
                      {kind === 'unassigned' ? (
                        readOnly ? (
                          <span className="text-xs text-muted-foreground">Vardiya yok</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover/item:text-foreground">
                            <Plus className="size-3.5" />
                            Vardiya ekle
                          </span>
                        )
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {Icon && <Icon />}
                          {meta?.label}
                        </Badge>
                      )}
                    </ItemActions>
                  </>
                )
                return (
                  <Fragment key={emp.id}>
                    {idx > 0 && <ItemSeparator />}
                    <RowItem readOnly={readOnly} onClick={() => onCellClick(emp, selectedDay)} className="flex-nowrap py-2.5">
                      {body}
                    </RowItem>
                  </Fragment>
                )
              })}
            </ItemGroup>
          </Card>
        )}
      </div>
    </div>
  )
}
