'use client'

/**
 * MobileDayBoard — haftalık planın telefon görünümü: seçilen günün tüm vardiyaları
 * ortak bir saat ekseninde (Gantt) alt alta. 7 sütunlu tablo dar ekranda okunmadığı için
 * mobilde varsayılan görünüm budur; haftalık tablo ayrıca seçilebilir.
 */
import { useMemo } from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import WeekendIcon from '@mui/icons-material/Weekend'
import BlockIcon from '@mui/icons-material/Block'
import AddIcon from '@mui/icons-material/Add'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { formatTime } from '@/types/shiftTemplate'
import { netWorkMins } from '@/lib/workingTimeService'
import { DAY_LABELS, fmtHours, shiftDisplayName, getAvailStatus, type AvailabilityMap, type AvailStatus } from './scheduleHelpers'

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

const OFF_META: Record<OffKind, { label: string; color: string; icon: typeof EventBusyIcon }> = {
  leave: { label: 'İzinli', color: '#fbbf24', icon: EventBusyIcon },
  rest: { label: 'Hafta tatili', color: '#818cf8', icon: WeekendIcon },
  unavailable: { label: 'Müsait değil', color: '#f87171', icon: BlockIcon },
  unassigned: { label: 'Vardiya yok', color: '#64748b', icon: AddIcon },
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

/** Başlangıç saatine göre renk: sabah / öğle / akşam — aynı ekipteki kişiler göz ucuyla gruplanır */
function shiftColor(startMins: number): string {
  if (startMins < 12 * 60) return '#14b8a6'
  if (startMins < 15 * 60) return '#6366f1'
  return '#a855f7'
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

  const TRACK_COL = '58%'

  return (
    <Box>
      {/* ── Gün şeridi ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 2 }}>
        {weekDays.map((d, i) => {
          const sel = d === selectedDay
          const isToday = d === todayStr
          const h = holidayMap.get(d)
          return (
            <ButtonBase
              key={d}
              onClick={() => onSelectDay(d)}
              aria-pressed={sel}
              aria-label={`${format(new Date(`${d}T00:00:00`), 'd MMMM EEEE', { locale: tr })}, ${countByDay[d]} kişi`}
              sx={{
                flexDirection: 'column', py: 0.75, borderRadius: 2, position: 'relative',
                border: '1px solid', borderColor: sel ? 'primary.main' : isToday ? 'rgba(20,184,166,0.4)' : 'divider',
                bgcolor: sel ? 'rgba(20,184,166,0.15)' : 'transparent',
              }}
            >
              <Typography fontSize="0.68rem" fontWeight={600} color={sel || isToday ? 'primary.main' : 'text.secondary'}>
                {DAY_LABELS[i]}
              </Typography>
              <Typography fontSize="1rem" fontWeight={800} lineHeight={1.2} color={sel ? 'text.primary' : 'text.secondary'}>
                {Number(d.slice(8))}
              </Typography>
              <Typography fontSize="0.62rem" color={countByDay[d] ? 'text.secondary' : 'text.disabled'}>
                {countByDay[d]} kişi
              </Typography>
              {h && (
                <Box sx={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', bgcolor: '#eab308' }} />
              )}
            </ButtonBase>
          )
        })}
      </Box>

      {/* ── Gün özeti ── */}
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ '&::first-letter': { textTransform: 'uppercase' } }}>
          {dayTitle}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {working.length} kişi çalışıyor · toplam {fmtHours(totalNet)} net
          {working.length > 0 && ` · ${formatTime(working[0].asgn.start_time)}–${fmtHour(axisEnd)}:00`}
        </Typography>
        {holiday && (
          <Typography variant="body2" sx={{ color: '#eab308', fontWeight: 600 }}>
            {holiday.half_day ? `Arife (13:00 sonrası tatil) — ${holiday.name}` : `Resmi tatil — ${holiday.name}`}
          </Typography>
        )}
      </Box>

      {/* ── Çalışanlar (Gantt) ── */}
      {working.length > 0 && (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', mb: 2 }}>
          {/* Eksen başlığı + saatlik yoğunluk */}
          <Box sx={{ display: 'grid', gridTemplateColumns: `1fr ${TRACK_COL}`, px: 1.5, pt: 1, pb: 0.75, bgcolor: 'rgba(15,23,42,0.6)', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography fontSize="0.7rem" color="text.secondary" fontWeight={600} sx={{ alignSelf: 'end' }}>Çalışan</Typography>
            <Box>
              <Box sx={{ position: 'relative', height: 14 }}>
                {ticks.map((t) => (
                  <Typography key={t} fontSize="0.65rem" color="text.secondary"
                    sx={{ position: 'absolute', left: pct(t), transform: t === axisStart ? 'none' : t === axisEnd ? 'translateX(-100%)' : 'translateX(-50%)', lineHeight: '14px' }}>
                    {fmtHour(t)}
                  </Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: '1px', height: 6, mt: 0.5 }} aria-label="Saatlik çalışan sayısı">
                {coverage.map((c, i) => (
                  <Box key={i} title={`${fmtHour(axisStart + i * 60)}:00 — ${c} kişi`}
                    sx={{ flex: 1, borderRadius: '1px', bgcolor: c === 0 ? 'rgba(239,68,68,0.35)' : `rgba(20,184,166,${0.2 + 0.7 * (c / maxCov)})` }} />
                ))}
              </Box>
            </Box>
          </Box>

          {working.map((r, idx) => {
            const color = r.warn === 'over' || r.warn === 'off' ? '#ef4444' : r.warn === 'partial' ? '#eab308' : shiftColor(r.span[0])
            return (
              <ButtonBase
                key={r.emp.id}
                onClick={() => onCellClick(r.emp, selectedDay)}
                disabled={readOnly}
                sx={{
                  display: 'grid', gridTemplateColumns: `1fr ${TRACK_COL}`, alignItems: 'center', columnGap: 1,
                  width: '100%', textAlign: 'left', px: 1.5, py: 1.1,
                  borderTop: idx === 0 ? 'none' : '1px solid', borderColor: 'divider',
                  '&.Mui-disabled': { opacity: 1 },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontSize="0.85rem" fontWeight={700} noWrap>
                    {r.emp.full_name}
                    {r.emp.employment_type === 'part_time' && (
                      <Box component="span" sx={{ ml: 0.5, fontSize: '0.6rem', color: '#818cf8', fontWeight: 700 }}>PT</Box>
                    )}
                  </Typography>
                  <Typography fontSize="0.7rem" color="text.secondary" noWrap>{r.emp.role}</Typography>
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                    <Typography fontSize="0.8rem" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(r.asgn.start_time)}–{formatTime(r.asgn.end_time)}
                    </Typography>
                    {r.warn && <WarningAmberIcon sx={{ fontSize: 14, color }} />}
                    <Typography fontSize="0.68rem" color="text.secondary" noWrap sx={{ ml: 'auto' }}>
                      {shiftDisplayName(r.asgn.shift_templates?.name, r.asgn.start_time, r.asgn.end_time)}
                    </Typography>
                  </Box>
                  <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: 'rgba(148,163,184,0.12)' }}>
                    {/* Eksen saatleriyle hizalı ince çizgiler — çubuğun hangi saate denk geldiği okunsun */}
                    {ticks.slice(1, -1).map((t) => (
                      <Box key={t} sx={{ position: 'absolute', top: -2, bottom: -2, left: pct(t), width: '1px', bgcolor: 'rgba(148,163,184,0.18)' }} />
                    ))}
                    {nowMins !== null && (
                      <Box sx={{ position: 'absolute', top: -3, bottom: -3, left: pct(nowMins), width: '2px', bgcolor: '#f1f5f9', opacity: 0.7, zIndex: 1 }} />
                    )}
                    <Box sx={{
                      position: 'absolute', top: 0, bottom: 0, borderRadius: 4, bgcolor: color,
                      left: pct(r.span[0]), width: `${((r.span[1] - r.span[0]) / axisLen) * 100}%`,
                    }} />
                  </Box>
                </Box>
              </ButtonBase>
            )
          })}
        </Box>
      )}

      {working.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, py: 3, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
          Bu gün için planlanmış vardiya yok.
        </Typography>
      )}

      {/* ── Çalışmayanlar ── */}
      {off.length > 0 && (
        <>
          <Typography fontSize="0.75rem" fontWeight={700} color="text.secondary" sx={{ mb: 0.75 }}>
            Çalışmayanlar ({off.length})
          </Typography>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            {off.map(({ emp, kind }, idx) => {
              const meta = OFF_META[kind]
              const Icon = meta.icon
              return (
                <ButtonBase
                  key={emp.id}
                  onClick={() => onCellClick(emp, selectedDay)}
                  disabled={readOnly}
                  sx={{
                    display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center',
                    px: 1.5, py: 1, minHeight: 44, textAlign: 'left',
                    borderTop: idx === 0 ? 'none' : '1px solid', borderColor: 'divider',
                    '&.Mui-disabled': { opacity: 1 },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontSize="0.82rem" fontWeight={600} noWrap>{emp.full_name}</Typography>
                    <Typography fontSize="0.68rem" color="text.secondary" noWrap>{emp.role}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: meta.color, flexShrink: 0 }}>
                    <Icon sx={{ fontSize: 14 }} />
                    <Typography fontSize="0.72rem" fontWeight={600}>
                      {kind === 'unassigned' && !readOnly ? 'Vardiya ekle' : meta.label}
                    </Typography>
                  </Box>
                </ButtonBase>
              )
            })}
          </Box>
        </>
      )}
    </Box>
  )
}
