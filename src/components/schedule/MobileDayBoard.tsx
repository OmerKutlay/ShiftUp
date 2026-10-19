'use client'

/**
 * MobileDayBoard — haftalık planın telefon görünümü: seçilen günün tüm vardiyaları
 * ortak bir saat ekseninde (Gantt) alt alta. 7 sütunlu tablo dar ekranda okunmadığı için
 * mobilde varsayılan görünüm budur; haftalık tablo ayrıca seçilebilir.
 */
import { useMemo } from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type EventBusyIcon from '@mui/icons-material/EventBusy'
import WeekendOutlinedIcon from '@mui/icons-material/WeekendOutlined'
import FlightTakeoffOutlinedIcon from '@mui/icons-material/FlightTakeoffOutlined'
import BlockIcon from '@mui/icons-material/Block'
import AddIcon from '@mui/icons-material/Add'
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

const OFF_META: Record<OffKind, { label: string; color: string; bg: string; icon: typeof EventBusyIcon }> = {
  leave: { label: 'İzinli', color: C.success, bg: C.successSoft, icon: FlightTakeoffOutlinedIcon },
  rest: { label: 'Tatil', color: C.inkSecondary, bg: C.surfaceMuted, icon: WeekendOutlinedIcon },
  unavailable: { label: 'Müsait değil', color: C.danger, bg: C.dangerSoft, icon: BlockIcon },
  unassigned: { label: 'Vardiya yok', color: C.neutral, bg: C.surfaceAlt, icon: AddIcon },
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

  const TRACK_COL = '56%'
  const dayLabel = format(new Date(`${selectedDay}T00:00:00`), 'd MMMM', { locale: tr })
  const cardTitle = selectedDay === todayStr ? `Bugün, ${dayLabel}` : dayTitle
  const shortName = (n: string) => {
    const p = n.trim().split(/\s+/)
    return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : n
  }

  return (
    <Box>
      {/* ── Gün şeridi ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 2 }}>
        {weekDays.map((d, i) => {
          const sel = d === selectedDay
          const isToday = d === todayStr
          const h = holidayMap.get(d)
          const accent = sel ? C.white : isToday ? C.brand : h ? C.warning : undefined
          return (
            <ButtonBase
              key={d}
              onClick={() => onSelectDay(d)}
              aria-pressed={sel}
              aria-label={`${format(new Date(`${d}T00:00:00`), 'd MMMM EEEE', { locale: tr })}, ${countByDay[d]} kişi`}
              sx={{
                flexDirection: 'column', py: 0.75, borderRadius: '12px', fontFamily: 'inherit',
                bgcolor: sel ? 'primary.main' : 'transparent',
                color: accent ?? 'text.primary',
                boxShadow: sel ? `0 4px 10px ${tint(C.brand, 0.25)}` : undefined,
              }}
            >
              <Typography fontSize="0.68rem" fontWeight={600} color={accent ?? 'text.secondary'}>
                {DAY_LABELS[i]}
              </Typography>
              <Typography fontSize="1.05rem" fontWeight={700} lineHeight={1.25}>
                {Number(d.slice(8))}
              </Typography>
              <Typography fontSize="0.6rem" color={accent ?? (countByDay[d] ? 'text.secondary' : 'text.disabled')} fontWeight={h ? 700 : 400}>
                {countByDay[d]} kişi
              </Typography>
            </ButtonBase>
          )
        })}
      </Box>

      {/* ── Gün kartı ── */}
      <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '16px', overflow: 'hidden', mb: 2 }}>
        <Box sx={{ px: 2, pt: 1.75, pb: 1.25 }}>
          <Typography fontWeight={700} fontSize="1rem" sx={{ '&::first-letter': { textTransform: 'uppercase' } }}>
            {cardTitle}
          </Typography>
          <Typography fontSize="0.78rem" color="text.secondary">
            {working.length} kişi çalışıyor · {fmtHoursTr(totalNet).replace(' s', ' saat')}
            {working.length > 0 && ` · ${formatTime(working[0].asgn.start_time)}–${fmtHour(axisEnd)}:00`}
          </Typography>
          {holiday && (
            <Typography fontSize="0.78rem" sx={{ color: C.warning, fontWeight: 600 }}>
              {holiday.half_day ? `Arife (13:00 sonrası tatil) — ${holiday.name}` : `Resmi tatil — ${holiday.name}`}
            </Typography>
          )}
        </Box>

        {working.length > 0 ? (
          <>
            {/* Eksen + saatlik yoğunluk */}
            <Box sx={{ display: 'grid', gridTemplateColumns: `1fr ${TRACK_COL}`, columnGap: 1, px: 2, pb: 0.75 }}>
              <span />
              <Box>
                <Box sx={{ position: 'relative', height: 14 }}>
                  {ticks.map((t) => (
                    <Typography key={t} fontSize="0.62rem" color="text.secondary"
                      sx={{ position: 'absolute', left: pct(t), transform: t === axisStart ? 'none' : t === axisEnd ? 'translateX(-100%)' : 'translateX(-50%)', lineHeight: '14px' }}>
                      {fmtHour(t)}
                    </Typography>
                  ))}
                </Box>
                <Box sx={{ display: 'flex', gap: '2px', height: 4, mt: 0.5 }} aria-label="Saatlik çalışan sayısı">
                  {coverage.map((c, i) => (
                    <Box key={i} title={`${fmtHour(axisStart + i * 60)}:00 — ${c} kişi`}
                      sx={{ flex: 1, borderRadius: '2px', bgcolor: c === 0 ? C.dangerFill : tint(C.brand, 0.2 + 0.6 * (c / maxCov)) }} />
                  ))}
                </Box>
              </Box>
            </Box>

            {working.map((r) => {
              const kindTone = SHIFT_KIND_TONES[shiftKindOf(r.asgn.shift_templates?.name, r.asgn.start_time, r.asgn.end_time)]
              const warnColor = r.warn === 'over' || r.warn === 'off' ? C.danger : r.warn === 'partial' ? C.warning : null
              return (
                <ButtonBase
                  key={r.emp.id}
                  onClick={() => onCellClick(r.emp, selectedDay)}
                  disabled={readOnly}
                  sx={{
                    display: 'grid', gridTemplateColumns: `1fr ${TRACK_COL}`, alignItems: 'center', columnGap: 1,
                    width: '100%', textAlign: 'left', px: 2, py: 1.1, fontFamily: 'inherit',
                    borderTop: '1px solid', borderColor: 'divider',
                    '&.Mui-disabled': { opacity: 1 },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <PersonAvatar name={r.emp.full_name} size={30} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontSize="0.82rem" fontWeight={700} noWrap>
                        {shortName(r.emp.full_name)}
                        {r.emp.employment_type === 'part_time' && (
                          <Box component="span" sx={{ ml: 0.5, fontSize: '0.6rem', color: C.plum, fontWeight: 700 }}>PT</Box>
                        )}
                      </Typography>
                      <Typography fontSize="0.68rem" color="text.secondary" noWrap>{r.emp.role}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      <Typography fontSize="0.8rem" fontWeight={700} color={warnColor ?? kindTone.text} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(r.asgn.start_time)} – {formatTime(r.asgn.end_time)}
                      </Typography>
                      {warnColor && <WarningAmberIcon sx={{ fontSize: 14, color: warnColor }} />}
                    </Box>
                    <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: C.surfaceMuted }}>
                      {nowMins !== null && (
                        <Box sx={{ position: 'absolute', top: -3, bottom: -3, left: pct(nowMins), width: '2px', borderRadius: 1, bgcolor: C.ink, zIndex: 1 }} />
                      )}
                      <Box sx={{
                        position: 'absolute', top: 0, bottom: 0, borderRadius: 4, bgcolor: warnColor ?? kindTone.fill,
                        left: pct(r.span[0]), width: `${((r.span[1] - r.span[0]) / axisLen) * 100}%`,
                      }} />
                    </Box>
                  </Box>
                </ButtonBase>
              )
            })}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2.5, pt: 1 }}>
            Bu gün için planlanmış vardiya yok.
          </Typography>
        )}
      </Box>

      {/* ── Çalışmayanlar ── */}
      {off.length > 0 && (
        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '16px', overflow: 'hidden' }}>
          <Typography fontSize="0.85rem" fontWeight={700} sx={{ px: 2, pt: 1.5, pb: 0.75 }}>
            Çalışmayanlar ({off.length})
          </Typography>
          {off.map(({ emp, kind }) => {
            const meta = OFF_META[kind]
            const Icon = meta.icon
            return (
              <ButtonBase
                key={emp.id}
                onClick={() => onCellClick(emp, selectedDay)}
                disabled={readOnly}
                sx={{
                  display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 1,
                  px: 2, py: 1, minHeight: 48, textAlign: 'left', fontFamily: 'inherit',
                  borderTop: '1px solid', borderColor: 'divider',
                  '&.Mui-disabled': { opacity: 1 },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <PersonAvatar name={emp.full_name} size={28} />
                  <Typography fontSize="0.82rem" fontWeight={600} noWrap>{emp.full_name}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: meta.color, bgcolor: meta.bg, px: 1, py: 0.25, borderRadius: '6px', flexShrink: 0 }}>
                  <Icon sx={{ fontSize: 13 }} />
                  <Typography fontSize="0.7rem" fontWeight={600}>
                    {kind === 'unassigned' && !readOnly ? 'Vardiya ekle' : meta.label}
                  </Typography>
                </Box>
              </ButtonBase>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
