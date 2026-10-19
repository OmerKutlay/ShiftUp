'use client'

/**
 * WeekGrid — haftalık plan tablosu (yeni UI): rol gruplu satırlar, gün sütunları,
 * "Bu hafta" özet sütunu ve günlük kişi sayısı satırı.
 * compact=true → mobil hafta görünümü (başlangıç saatli mini kutular).
 */
import { Fragment } from 'react'
import { Box, Typography } from '@mui/material'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWithRole } from '@/types/employee'
import type { WeeklyScheduleEntry } from '@/types/schedule'
import type { PublicHoliday } from '@/types/holiday'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { PersonAvatar } from '@/components/common'
import { C } from '@/lib/palette'
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
  const colBg = (i: number) => (i === todayIdx ? C.brandSoft : undefined)
  const cellPad = compact ? 0.375 : 0.5

  const row = { display: 'grid', gridTemplateColumns: cols, alignItems: 'stretch' } as const
  const nameCell = {
    position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper',
    display: 'flex', alignItems: 'center', gap: compact ? 0.75 : 1.25, minWidth: 0,
    py: compact ? 0.75 : 1, pr: 1,
  } as const

  return (
    <Box sx={{ overflowX: 'auto', overscrollBehaviorX: 'contain' }}>
      <Box sx={{ minWidth: compact ? undefined : nameW + 7 * 108 + 150 }}>
        {/* Başlık */}
        <Box sx={{ ...row, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ ...nameCell, alignItems: 'flex-end', pb: 1 }}>
            {!compact && <Typography fontSize="0.75rem" color="text.secondary">Ekip</Typography>}
          </Box>
          {weekDays.map((d, i) => {
            const isToday = i === todayIdx
            const holiday = holidayMap.get(d)
            const top = isToday ? 'Bugün' : DAY_NAMES[i]
            const tag = holiday ? (holiday.half_day ? 'arife' : 'tatil') : null
            const accent = isToday ? 'primary.main' : holiday ? C.warning : undefined
            return (
              <Box
                key={d}
                data-today={isToday || undefined}
                title={holiday ? `Resmi tatil: ${holiday.name}${holiday.half_day ? ' (13:00 sonrası)' : ''}` : undefined}
                sx={{
                  bgcolor: colBg(i), px: compact ? 0 : 1, pt: compact ? 0.75 : 1.25, pb: 1,
                  textAlign: compact ? 'center' : 'left', borderRadius: '10px 10px 0 0',
                }}
              >
                {compact ? (
                  <>
                    <Typography fontSize="0.62rem" color={accent ?? 'text.secondary'}>{DAY_SHORT[i]}</Typography>
                    <Typography fontSize="0.85rem" fontWeight={700} color={accent ?? 'text.primary'}>{Number(d.slice(8))}</Typography>
                  </>
                ) : (
                  <>
                    <Typography fontSize="0.72rem" color={accent ?? 'text.secondary'} fontWeight={isToday || tag ? 600 : 400} noWrap>
                      {top}{tag && ` · ${tag}`}
                    </Typography>
                    <Typography fontSize="0.95rem" fontWeight={700} color={isToday ? 'primary.main' : 'text.primary'} noWrap>
                      {format(new Date(`${d}T00:00:00`), 'd MMMM', { locale: tr })}
                    </Typography>
                  </>
                )}
              </Box>
            )
          })}
          <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: compact ? 'center' : 'flex-start', px: compact ? 0 : 1.5, pb: 1 }}>
            <Typography fontSize={compact ? '0.62rem' : '0.75rem'} color="text.secondary">{compact ? 'saat' : 'Bu hafta'}</Typography>
          </Box>
        </Box>

        {/* Gruplar */}
        {groups.map((g) => (
          <Fragment key={g.key}>
            {!compact && (
              <Box sx={{ ...row, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ ...nameCell, py: 1.25 }}>
                  <Typography fontSize="0.8rem" fontWeight={700}>{g.label}</Typography>
                  <Typography fontSize="0.72rem" color="text.secondary">{g.entries.length} kişi</Typography>
                </Box>
                {weekDays.map((d, i) => <Box key={d} sx={{ bgcolor: colBg(i) }} />)}
                <Box />
              </Box>
            )}
            {g.entries.map((entry) => {
              const stats = statsMap.get(entry.employee.id)
              const emp = entry.employee
              const roleText = [emp.role, emp.employment_type === 'part_time' && (compact ? 'PT' : 'yarı zamanlı')].filter(Boolean).join(' · ')
              const rest = stats?.restViolations.length ?? 0
              const over = stats ? stats.totalMins > weeklyLimitMins(stats, config) : false
              return (
                <Box key={emp.id} sx={{ ...row, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Box sx={nameCell}>
                    <PersonAvatar name={emp.full_name} size={compact ? 24 : 32} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontSize={compact ? '0.75rem' : '0.85rem'} fontWeight={700} noWrap>
                        {compact ? emp.full_name.split(/\s+/)[0] : emp.full_name}
                      </Typography>
                      <Typography fontSize={compact ? '0.62rem' : '0.7rem'} color="text.secondary" noWrap>{roleText}</Typography>
                    </Box>
                  </Box>
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
                      <Box key={d} sx={{ bgcolor: colBg(i), p: cellPad, display: 'flex', alignItems: 'center', minWidth: 0 }}>
                        {compact ? <MiniShiftCell {...cellProps} /> : <ShiftCell {...cellProps} />}
                      </Box>
                    )
                  })}
                  {compact ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, pr: 0.25 }}>
                      {(rest > 0 || over) && <Box aria-label="Uyarı" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: C.dangerFill }} />}
                      <Typography fontSize="0.75rem" fontWeight={700} color={over ? C.danger : 'text.primary'}>
                        {stats ? (Math.round(stats.totalMins / 6) / 10).toLocaleString('tr-TR') : '—'}
                      </Typography>
                    </Box>
                  ) : (
                    <SummaryCell stats={stats} config={config} />
                  )}
                </Box>
              )
            })}
          </Fragment>
        ))}

        {/* Günlük kişi sayısı */}
        {!compact && (
          <Box sx={row}>
            <Box sx={{ ...nameCell, py: 1.5, color: 'text.secondary', '& svg': { fontSize: 16 } }}>
              <StorefrontOutlinedIcon />
              <Typography fontSize="0.78rem" color="text.secondary">Mağazada</Typography>
            </Box>
            {counts.map((c, i) => (
              <Box key={weekDays[i]} sx={{ bgcolor: colBg(i), px: 1, display: 'flex', alignItems: 'center', borderRadius: '0 0 10px 10px' }}>
                {isLow(c) ? (
                  <Typography fontSize="0.75rem" fontWeight={700} sx={{ bgcolor: C.warningSoft, color: C.warning, px: 0.75, py: 0.25, borderRadius: '6px' }}>
                    {c} kişi · az
                  </Typography>
                ) : (
                  <Typography fontSize="0.8rem" fontWeight={600}>{c} kişi</Typography>
                )}
              </Box>
            ))}
            <Box sx={{ px: 1.5, display: 'flex', alignItems: 'center' }}>
              <Typography fontSize="0.85rem" fontWeight={700}>{fmtHoursTr(totalMins).replace(' s', ' saat')}</Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
