'use client'

/**
 * MobileDayBoard — haftalık planın telefon görünümü: seçilen günün tüm vardiyaları
 * ortak bir saat ekseninde (Gantt) alt alta. 7 sütunlu tablo dar ekranda okunmadığı için
 * mobilde varsayılan görünüm budur; haftalık tablo ayrıca seçilebilir.
 */
import { useMemo } from 'react'
import { Armchair, Ban, Plane, Plus, TriangleAlert, type LucideIcon } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { formatTime } from '@/types/shiftTemplate'
import { netWorkMins } from '@/lib/workingTimeService'
import { DAY_LABELS, fmtHoursTr, shiftKindOf, getAvailStatus, type AvailabilityMap, type AvailStatus } from './scheduleHelpers'
import { PersonAvatar } from '@/components/common'
import { C, SHIFT_KIND_TONES, tint } from '@/lib/palette'
import { cn } from '@/lib/utils'

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

type OffKind = 'leave' | 'rest' | 'unavailable' | 'unassigned'

const OFF_META: Record<OffKind, { label: string; className: string; icon: LucideIcon }> = {
  leave: { label: 'İzinli', className: 'bg-success-soft text-success', icon: Plane },
  rest: { label: 'Tatil', className: 'bg-surface-muted text-ink-secondary', icon: Armchair },
  unavailable: { label: 'Müsait değil', className: 'bg-danger-soft text-danger', icon: Ban },
  unassigned: { label: 'Vardiya yok', className: 'bg-muted text-neutral', icon: Plus },
}

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

/** Tıklanabilir satır; salt okunurda düz kutu */
function Row({ readOnly, onClick, className, children }: {
  readOnly: boolean; onClick: () => void; className: string; children: React.ReactNode
}) {
  if (readOnly) return <div className={className}>{children}</div>
  return (
    <button type="button" onClick={onClick} className={cn(className, 'transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted')}>
      {children}
    </button>
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

  // Her gün için çalışan sayısı (gün şeridindeki rozetler)
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
    const off: { emp: EmployeeWithRole; kind: OffKind }[] = []
    for (const e of entries) {
      const key = `${e.employee.id}:${selectedDay}`
      const asgn = e.dayAssignments[selectedDay]
      if (restDayMap.has(key)) { off.push({ emp: e.employee, kind: 'rest' }); continue }
      if (asgn?.is_on_leave || approvedLeaveMap.has(key)) { off.push({ emp: e.employee, kind: 'leave' }); continue }
      const avail = getAvailStatus(e.employee.id, selectedDay, availabilityMap, asgn?.start_time, asgn?.end_time)
      if (!asgn) { off.push({ emp: e.employee, kind: avail === 'off' ? 'unavailable' : 'unassigned' }); continue }
      const net = netWorkMins(asgn.start_time, asgn.end_time)
      working.push({
        emp: e.employee, asgn, span: spanOf(asgn), net,
        warn: net > maxDailyMins ? 'over' : avail === 'off' || avail === 'partial' ? avail : null,
      })
    }
    working.sort((a, b) => a.span[0] - b.span[0] || a.span[1] - b.span[1]
      || a.emp.full_name.localeCompare(b.emp.full_name, 'tr'))
    const order: OffKind[] = ['leave', 'rest', 'unavailable', 'unassigned']
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
  const step = axisLen > 14 * 60 ? 240 : 180
  for (let t = axisStart; t <= axisEnd; t += step) ticks.push(t)
  const pct = (m: number) => `${((m - axisStart) / axisLen) * 100}%`
  // Bugün seçiliyse "şu an" çizgisi
  const now = new Date()
  const nowRaw = now.getHours() * 60 + now.getMinutes()
  const nowMins = selectedDay === todayStr && nowRaw >= axisStart && nowRaw <= axisEnd ? nowRaw : null

  // Saat saat kaç kişi var — eksenin altındaki yoğunluk şeridi
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
  const dayTitle = format(new Date(`${selectedDay}T00:00:00`), 'd MMMM EEEE', { locale: tr })
  const fmtHour = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}`

  const dayLabel = format(new Date(`${selectedDay}T00:00:00`), 'd MMMM', { locale: tr })
  const cardTitle = selectedDay === todayStr ? `Bugün, ${dayLabel}` : dayTitle
  const shortName = (n: string) => {
    const p = n.trim().split(/\s+/)
    return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : n
  }

  return (
    <div>
      {/* ── Gün şeridi ── */}
      <div className="mb-4 grid grid-cols-7 gap-1">
        {weekDays.map((d, i) => {
          const sel = d === selectedDay
          const isToday = d === todayStr
          const h = holidayMap.get(d)
          const accent = sel ? 'text-white' : isToday ? 'text-primary' : h ? 'text-warning' : undefined
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelectDay(d)}
              aria-pressed={sel}
              aria-label={`${format(new Date(`${d}T00:00:00`), 'd MMMM EEEE', { locale: tr })}, ${countByDay[d]} kişi`}
              className={cn(
                'flex flex-col items-center rounded-xl py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                sel && 'bg-primary shadow-[0_4px_10px_rgb(194_83_45/0.25)]',
                accent
              )}
            >
              <span className={cn('text-[0.68rem] font-semibold', accent ?? 'text-ink-secondary')}>{DAY_LABELS[i]}</span>
              <span className="text-[1.05rem] font-bold leading-tight">{Number(d.slice(8))}</span>
              <span className={cn('text-[0.6rem]', h && 'font-bold', accent ?? (countByDay[d] ? 'text-ink-secondary' : 'text-ink-muted'))}>
                {countByDay[d]} kişi
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Gün kartı ── */}
      <section className="mb-4 overflow-hidden rounded-2xl border bg-card">
        <div className="px-4 pt-3.5 pb-2.5">
          <p className="font-bold first-letter:uppercase">{cardTitle}</p>
          <p className="text-[0.78rem] text-ink-secondary">
            {working.length} kişi çalışıyor · {fmtHoursTr(totalNet).replace(' s', ' saat')}
            {working.length > 0 && ` · ${formatTime(working[0].asgn.start_time)}–${fmtHour(axisEnd)}:00`}
          </p>
          {holiday && (
            <p className="text-[0.78rem] font-semibold text-warning">
              {holiday.half_day ? `Arife (13:00 sonrası tatil) — ${holiday.name}` : `Resmi tatil — ${holiday.name}`}
            </p>
          )}
        </div>

        {working.length > 0 ? (
          <>
            {/* Eksen + saatlik yoğunluk */}
            <div className="grid grid-cols-[1fr_56%] gap-x-2 px-4 pb-1.5">
              <span />
              <div>
                <div className="relative h-3.5">
                  {ticks.map((t) => (
                    <span
                      key={t}
                      className={cn('absolute text-[0.62rem] leading-[14px] text-ink-secondary', t !== axisStart && (t === axisEnd ? '-translate-x-full' : '-translate-x-1/2'))}
                      style={{ left: pct(t) }}
                    >
                      {fmtHour(t)}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex h-1 gap-[2px]" aria-label="Saatlik çalışan sayısı">
                  {coverage.map((c, i) => (
                    <span
                      key={i}
                      title={`${fmtHour(axisStart + i * 60)}:00 — ${c} kişi`}
                      className="flex-1 rounded-[2px]"
                      style={{ backgroundColor: c === 0 ? C.dangerFill : tint(C.brand, 0.2 + 0.6 * (c / maxCov)) }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {working.map((r) => {
              const kindTone = SHIFT_KIND_TONES[shiftKindOf(r.asgn.shift_templates?.name, r.asgn.start_time, r.asgn.end_time)]
              const warnColor = r.warn === 'over' || r.warn === 'off' ? C.danger : r.warn === 'partial' ? C.warning : null
              return (
                <Row
                  key={r.emp.id}
                  readOnly={readOnly}
                  onClick={() => onCellClick(r.emp, selectedDay)}
                  className="grid w-full grid-cols-[1fr_56%] items-center gap-x-2 border-t px-4 py-2.5 text-left"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <PersonAvatar name={r.emp.full_name} size={30} />
                    <div className="min-w-0">
                      <p className="truncate text-[0.82rem] font-bold">
                        {shortName(r.emp.full_name)}
                        {r.emp.employment_type === 'part_time' && <span className="ml-1 text-[0.6rem] font-bold text-plum">PT</span>}
                      </p>
                      <p className="truncate text-[0.68rem] text-ink-secondary">{r.emp.role}</p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-1">
                      <span className="text-[0.8rem] font-bold tabular-nums" style={{ color: warnColor ?? kindTone.text }}>
                        {formatTime(r.asgn.start_time)} – {formatTime(r.asgn.end_time)}
                      </span>
                      {warnColor && <TriangleAlert className="size-3.5" style={{ color: warnColor }} />}
                    </div>
                    <div className="relative h-2 rounded-full bg-surface-muted">
                      {nowMins !== null && (
                        <span className="absolute -top-[3px] -bottom-[3px] z-[1] w-0.5 rounded-sm bg-ink" style={{ left: pct(nowMins) }} />
                      )}
                      <span
                        className="absolute inset-y-0 rounded-full"
                        style={{
                          backgroundColor: warnColor ?? kindTone.fill,
                          left: pct(r.span[0]),
                          width: `${((r.span[1] - r.span[0]) / axisLen) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </Row>
              )
            })}
          </>
        ) : (
          <p className="px-4 pt-2 pb-5 text-sm text-ink-secondary">Bu gün için planlanmış vardiya yok.</p>
        )}
      </section>

      {/* ── Çalışmayanlar ── */}
      {off.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <h3 className="px-4 pt-3 pb-1.5 text-[0.85rem] font-bold">Çalışmayanlar ({off.length})</h3>
          {off.map(({ emp, kind }) => {
            const meta = OFF_META[kind]
            const Icon = meta.icon
            return (
              <Row
                key={emp.id}
                readOnly={readOnly}
                onClick={() => onCellClick(emp, selectedDay)}
                className="flex min-h-12 w-full items-center justify-between gap-2 border-t px-4 py-2 text-left"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <PersonAvatar name={emp.full_name} size={28} />
                  <span className="truncate text-[0.82rem] font-semibold">{emp.full_name}</span>
                </div>
                <span className={cn('flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[0.7rem] font-semibold', meta.className)}>
                  <Icon className="size-3.5" />
                  {kind === 'unassigned' && !readOnly ? 'Vardiya ekle' : meta.label}
                </span>
              </Row>
            )
          })}
        </section>
      )}
    </div>
  )
}
