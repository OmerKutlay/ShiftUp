'use client'
/**
 * WorkforcePlanTables — İş Gücü > Haftalık Plan ekranının "Mevcut Plan" ve "Taslak" tabloları.
 *
 * 7 gün sütunu dar ekrana sıkıştırılınca hücre içerikleri komşu hücrelere taşıyordu; burada her
 * sütunun en az bir genişliği var, sığmazsa tablo yatay kayar ve çalışan sütunu sabit kalır.
 * Hücreler tek bakışta okunacak kadar sade: saat + net süre; ayrıntı ipucunda.
 */
import type { ReactNode } from 'react'
import {
  Box, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWeekSummary, DaySummary, WorkingTimeViolation } from '@/lib/workingTimeService'
import { shiftDurationMins, netWorkMins } from '@/lib/workingTimeService'
import type { PlannerResult, DraftAssignment } from '@/lib/workforcePlanner'
import { PART_TIME_RULES } from '@/types/employee'
import { C, SHIFT_KIND_TONES, tint } from '@/lib/palette'

// ─── Ölçüler ──────────────────────────────────────────────────

const NAME_W = 132
const DAY_W = 84
const TOTAL_W = 72
const LAST_W = 60
const TABLE_MIN_W = NAME_W + 7 * DAY_W + TOTAL_W + LAST_W
/** Yarı saydam zemin üstünde sabit sütunun arkası görünmesin */
const STICKY_BG = C.surface
const HEAD_BG = C.surfaceAlt

// ─── Yardımcılar ──────────────────────────────────────────────

export function formatMins(mins: number): string {
  if (mins === 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}s` : `${h}s ${m}dk`
}

const hhmm = (t: string) => t.slice(0, 5)

export const SHIFT_KIND_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(SHIFT_KIND_TONES).map(([kind, tone]) => [kind, tone.text]),
)

const SHIFT_KIND_LABELS: Record<string, string> = {
  opening: 'Açılış',
  closing: 'Kapanış',
  full: 'Full',
  mid: 'Ortacı',
  custom: 'Özel',
}

const headCell: SxProps<Theme> = {
  color: 'text.secondary', fontSize: '0.72rem', fontWeight: 700, borderColor: 'divider',
  bgcolor: HEAD_BG, py: 0.75, px: 0.5, lineHeight: 1.3,
}
const bodyCell: SxProps<Theme> = { borderColor: 'divider', py: 1, px: 0.5, verticalAlign: 'middle', overflow: 'hidden' }
const stickyCell: SxProps<Theme> = { position: 'sticky', left: 0, zIndex: 1, bgcolor: STICKY_BG, borderRight: '1px solid', borderRightColor: 'divider' }

function TableFrame({ weekDays, totalLabel, lastLabel, children }: {
  weekDays: string[]; totalLabel: string; lastLabel: ReactNode; children: ReactNode
}) {
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  return (
    <TableContainer component={Paper}
      sx={{ bgcolor: tint(C.canvas, 0.8), border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
      <Table size="small" sx={{ tableLayout: 'fixed', minWidth: TABLE_MIN_W }}>
        <colgroup>
          <col style={{ width: NAME_W }} />
          {weekDays.map((d) => <col key={d} style={{ minWidth: DAY_W }} />)}
          <col style={{ width: TOTAL_W }} />
          <col style={{ width: LAST_W }} />
        </colgroup>
        <TableHead>
          <TableRow>
            <TableCell sx={[headCell, stickyCell, { bgcolor: HEAD_BG, zIndex: 2, px: 1.5 }] as SxProps<Theme>}>Çalışan</TableCell>
            {weekDays.map((d) => {
              const isToday = d === todayStr
              const date = new Date(`${d}T00:00:00`)
              return (
                <TableCell key={d} align="center" sx={[headCell, isToday && { color: 'primary.main', bgcolor: C.brandSoft }] as SxProps<Theme>}>
                  <Box component="span" sx={{ display: 'block' }}>
                    {format(date, 'EEE', { locale: tr }).replace(/^./, (c) => c.toLocaleUpperCase('tr-TR'))}
                  </Box>
                  <Box component="span" sx={{ display: 'block', fontWeight: 500, fontSize: '0.68rem', opacity: 0.8 }}>
                    {format(date, 'd MMM', { locale: tr })}
                  </Box>
                </TableCell>
              )
            })}
            <TableCell align="center" sx={[headCell, { color: 'primary.main' }] as SxProps<Theme>}>{totalLabel}</TableCell>
            <TableCell align="center" sx={headCell}>{lastLabel}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </TableContainer>
  )
}

function EmploymentChip({ type }: { type: 'full_time' | 'part_time' }) {
  const pt = type === 'part_time'
  return (
    <Chip label={pt ? 'Yarı zamanlı' : 'Tam zamanlı'} size="small"
      sx={{
        height: 16, fontSize: '0.6rem', fontWeight: 700, '& .MuiChip-label': { px: 0.6 },
        bgcolor: pt ? tint(C.plum, 0.15) : tint(C.brand, 0.12),
        color: pt ? C.plum : 'primary.main',
      }} />
  )
}

function NameCell({ name, sub }: { name: string; sub: ReactNode }) {
  return (
    <TableCell sx={[bodyCell, stickyCell, { px: 1.5 }] as SxProps<Theme>}>
      <Typography fontSize="0.8rem" fontWeight={700} noWrap title={name}>{name}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.4, flexWrap: 'wrap' }}>{sub}</Box>
    </TableCell>
  )
}

/** Hücre gövdesi: saat aralığı + net süre. Taşmaz; ayrıntı ipucunda. */
function ShiftLines({ shifts, netMins, color, tooltip }: {
  shifts: { start: string; end: string }[]; netMins: number; color: string; tooltip: ReactNode
}) {
  return (
    <Tooltip title={tooltip} arrow placement="top">
      <Box sx={{ cursor: 'default', minWidth: 0 }}>
        {shifts.map((s, i) => (
          <Typography key={i} fontSize="0.75rem" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 }}>
            {s.start}–{s.end}
          </Typography>
        ))}
        <Typography fontSize="0.68rem" fontWeight={700} sx={{ color, mt: 0.25 }}>{formatMins(netMins)} net</Typography>
      </Box>
    </Tooltip>
  )
}

const Dash = () => <Typography fontSize="0.8rem" sx={{ color: C.neutral }}>—</Typography>

// ─── Mevcut plan ──────────────────────────────────────────────

function CurrentDayCell({ day }: { day: DaySummary | undefined }) {
  if (!day) return <Dash />
  if (day.isLeave) {
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: C.warning }}>
        <EventBusyIcon sx={{ fontSize: 14 }} />
        <Typography fontSize="0.72rem" fontWeight={600}>İzinli</Typography>
      </Box>
    )
  }
  if (day.shifts.length === 0) return <Dash />
  const gross = day.shifts.reduce((s, x) => s + shiftDurationMins(x.start_time, x.end_time), 0)
  return (
    <ShiftLines
      shifts={day.shifts.map((s) => ({ start: hhmm(s.start_time), end: hhmm(s.end_time) }))}
      netMins={day.totalMins}
      color={C.brand}
      tooltip={`Brüt ${formatMins(gross)} · Mola ${formatMins(gross - day.totalMins)} · Net ${formatMins(day.totalMins)}`}
    />
  )
}

function ViolationBadge({ violations }: { violations: WorkingTimeViolation[] }) {
  if (violations.length === 0) return <Typography fontSize="0.75rem" sx={{ color: 'text.disabled' }}>—</Typography>
  const color = violations.some((v) => v.severity === 'error') ? C.danger : C.warning
  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line', fontSize: '0.75rem' }}>{violations.map((v) => `• ${v.message}`).join('\n')}</Box>} arrow>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'default', color }}>
        <WarningAmberIcon sx={{ fontSize: 15 }} />
        <Typography fontSize="0.78rem" fontWeight={700}>{violations.length}</Typography>
      </Box>
    </Tooltip>
  )
}

export function CurrentPlanTable({ weekDays, summaries, maxWeeklyWorkHours }: {
  weekDays: string[]; summaries: EmployeeWeekSummary[]; maxWeeklyWorkHours: number
}) {
  return (
    <TableFrame weekDays={weekDays} totalLabel="Toplam" lastLabel="İhlal">
      {summaries.map((s) => {
        const hasError = s.violations.some((v) => v.severity === 'error')
        const hasWarn = s.violations.some((v) => v.severity === 'warning')
        const maxH = s.employment_type === 'part_time' ? PART_TIME_RULES.maxWeeklyHours : maxWeeklyWorkHours
        const isOver = s.totalWeeklyMins > maxH * 60
        return (
          <TableRow key={s.employeeId} sx={{
            '&:last-child td': { borderBottom: 0 },
            bgcolor: hasError ? tint(C.danger, 0.05) : hasWarn ? tint(C.warning, 0.05) : 'transparent',
          }}>
            <NameCell name={s.employeeName} sub={<>
              <EmploymentChip type={s.employment_type} />
              {s.employment_type === 'part_time' && (
                <Typography fontSize="0.65rem" sx={{ color: s.weeklyWorkDays > PART_TIME_RULES.maxWeeklyDays ? C.danger : 'text.secondary' }}>
                  {s.weeklyWorkDays}/{PART_TIME_RULES.maxWeeklyDays} gün
                </Typography>
              )}
            </>} />
            {weekDays.map((d) => (
              <TableCell key={d} align="center" sx={bodyCell}><CurrentDayCell day={s.days[d]} /></TableCell>
            ))}
            <TableCell align="center" sx={bodyCell}>
              <Typography fontSize="0.8rem" fontWeight={700}
                sx={{ color: isOver ? C.danger : s.totalWeeklyMins > 0 ? 'primary.main' : 'text.disabled' }}>
                {formatMins(s.totalWeeklyMins)}
              </Typography>
              <Typography fontSize="0.62rem" sx={{ color: 'text.secondary' }}>/ {maxH}s</Typography>
            </TableCell>
            <TableCell align="center" sx={bodyCell}><ViolationBadge violations={s.violations} /></TableCell>
          </TableRow>
        )
      })}
      {summaries.length === 0 && (
        <TableRow>
          <TableCell colSpan={weekDays.length + 3} sx={{ borderColor: 'divider', py: 4, color: 'text.secondary', fontSize: '0.82rem', textAlign: 'center' }}>
            Bu hafta için vardiya planı bulunamadı.
          </TableCell>
        </TableRow>
      )}
    </TableFrame>
  )
}

// ─── Taslak ───────────────────────────────────────────────────

function DraftDayCell({ assign }: { assign: DraftAssignment | undefined }) {
  if (!assign) return <Dash />
  const color = SHIFT_KIND_COLORS[assign.shift_kind] ?? C.neutral
  const gross = shiftDurationMins(assign.start_time, assign.end_time)
  const net = netWorkMins(assign.start_time, assign.end_time)
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{
        display: 'inline-block', px: 0.75, borderRadius: 0.75, mb: 0.4, maxWidth: '100%',
        bgcolor: `${color}22`, border: `1px solid ${color}55`,
      }}>
        <Typography fontSize="0.66rem" fontWeight={700} noWrap sx={{ color, lineHeight: '16px' }}>
          {SHIFT_KIND_LABELS[assign.shift_kind] ?? 'Vardiya'}
        </Typography>
      </Box>
      <ShiftLines
        shifts={[{ start: hhmm(assign.start_time), end: hhmm(assign.end_time) }]}
        netMins={net}
        color={color}
        tooltip={<Box sx={{ fontSize: '0.72rem' }}>
          <Box>Brüt {formatMins(gross)} · Mola {formatMins(gross - net)} · Net {formatMins(net)}</Box>
          {assign.reason && <Box sx={{ color: C.inkMuted, mt: 0.25 }}>{assign.reason}</Box>}
        </Box>}
      />
    </Box>
  )
}

export function DraftPlanTable({ draft, weekDays }: { draft: PlannerResult; weekDays: string[] }) {
  const stats = Object.values(draft.stats).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'tr'))
  return (
    <TableFrame
      weekDays={weekDays}
      totalLabel="Toplam"
      lastLabel={<Tooltip title="Açılış / Kapanış vardiyası sayısı" arrow><span>A / K</span></Tooltip>}
    >
      {stats.map((stat) => {
        const byDate: Record<string, DraftAssignment> = {}
        for (const a of stat.assignments) byDate[a.work_date] = a
        const targetH = stat.employment_type === 'part_time' ? PART_TIME_RULES.maxWeeklyHours : 45
        const pct = Math.min(100, Math.round((stat.totalMins / (targetH * 60)) * 100))
        const color = pct >= 95 ? C.success : pct >= 80 ? C.brand : pct >= 60 ? C.warning : C.inkMuted
        return (
          <TableRow key={stat.employeeId} sx={{ '&:last-child td': { borderBottom: 0 } }}>
            <NameCell name={stat.employeeName} sub={<>
              <EmploymentChip type={stat.employment_type} />
              <Typography fontSize="0.65rem" sx={{ color: 'text.secondary' }}>{stat.workDays} gün</Typography>
            </>} />
            {weekDays.map((d) => (
              <TableCell key={d} align="center" sx={bodyCell}><DraftDayCell assign={byDate[d]} /></TableCell>
            ))}
            <TableCell align="center" sx={bodyCell}>
              <Tooltip title={`Hedef: ${targetH}s`} placement="top">
                <Box>
                  <Typography fontSize="0.8rem" fontWeight={700} sx={{ color }}>{formatMins(stat.totalMins)}</Typography>
                  <Typography fontSize="0.62rem" sx={{ color: 'text.secondary' }}>%{pct}</Typography>
                </Box>
              </Tooltip>
            </TableCell>
            <TableCell align="center" sx={bodyCell}>
              <Tooltip title={`Açılış: ${stat.openingCount} · Kapanış: ${stat.closingCount} · Full: ${stat.fullCount}`} placement="top">
                <Typography fontSize="0.75rem" fontWeight={700} sx={{ cursor: 'default' }}>
                  <Box component="span" sx={{ color: SHIFT_KIND_COLORS.opening }}>{stat.openingCount}</Box>
                  <Box component="span" sx={{ color: 'text.disabled' }}> / </Box>
                  <Box component="span" sx={{ color: SHIFT_KIND_COLORS.closing }}>{stat.closingCount}</Box>
                </Typography>
              </Tooltip>
            </TableCell>
          </TableRow>
        )
      })}
    </TableFrame>
  )
}
