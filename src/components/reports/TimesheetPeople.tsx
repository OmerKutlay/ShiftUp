'use client'

/**
 * TimesheetPeople — aylık puantajın "Kişiler" görünümü (yeni UI):
 * her çalışan için ayın günlerinden oluşan renkli şerit + seçilen kişinin takvim detayı.
 */
import { Box, ButtonBase, Chip, Paper, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { PersonAvatar } from '@/components/common'
import { C } from '@/lib/palette'
import { TIMESHEET_CODE_LABELS, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'
import { dayOfWeekFromDateString } from '@/lib/dateUtils'
import {
  CALENDAR_TONE, STRIP_TONE, codeCounts, hoursLabel, leaveTotal, planLabel,
} from './timesheetSummary'

// ─── Şerit ────────────────────────────────────────────────────

export function DayStrip({ row, days, today, height = 18 }: {
  row: TimesheetRow; days: string[]; today: string; height?: number
}) {
  return (
    <Box sx={{ display: 'flex', gap: '2px', minWidth: 0 }} aria-hidden>
      {days.map((d) => {
        const tone = STRIP_TONE[row.days[d] ?? '']
        const isToday = d === today
        return (
          <Box
            key={d}
            sx={{
              flex: 1,
              minWidth: 0,
              height,
              borderRadius: '3px',
              bgcolor: tone.bg,
              border: tone.border ? `1px ${tone.dashed ? 'dashed' : 'solid'} ${tone.border}` : undefined,
              boxSizing: 'border-box',
              outline: isToday ? `1.5px solid ${C.brand}` : undefined,
              outlineOffset: 1,
            }}
          />
        )
      })}
    </Box>
  )
}

/** Şerit üstü/altı gün numaraları: 1, 8, 15, 22, 29 ya da (mobil) 1 · bugün · son gün */
export function StripAxis({ days, today, compact }: { days: string[]; today: string; compact?: boolean }) {
  const ticks = compact
    ? [0, days.indexOf(today), days.length - 1].filter((i, k, a) => i >= 0 && a.indexOf(i) === k)
    : [0, 7, 14, 21, 28].filter((i) => i < days.length)
  return (
    <Box sx={{ position: 'relative', height: 14 }} aria-hidden>
      {ticks.map((i) => {
        const isToday = days[i] === today && compact
        const pct = ((i + 0.5) / days.length) * 100
        const edge = i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'mid'
        return (
          <Typography
            key={i}
            component="span"
            sx={{
              position: 'absolute',
              left: edge === 'end' ? undefined : `${pct}%`,
              right: edge === 'end' ? 0 : undefined,
              transform: edge === 'mid' ? 'translateX(-50%)' : edge === 'start' ? 'translateX(-50%)' : undefined,
              fontSize: '0.65rem',
              lineHeight: '14px',
              color: isToday ? 'primary.main' : 'text.disabled',
              fontWeight: isToday ? 700 : 500,
              whiteSpace: 'nowrap',
            }}
          >
            {Number(days[i].slice(8))}
            {isToday && ' · bugün'}
          </Typography>
        )
      })}
    </Box>
  )
}

// ─── Rozetler ─────────────────────────────────────────────────

const badgeSx = { height: 20, fontSize: '0.68rem', fontWeight: 600, borderRadius: '6px', '& .MuiChip-label': { px: 0.75 } }

export function RowBadges({ row, justify = 'flex-end' }: { row: TimesheetRow; justify?: 'flex-end' | 'flex-start' }) {
  const leave = leaveTotal(row)
  if (!row.overtimeMins && !row.absentDays && !leave) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: justify }}>
      {row.overtimeMins > 0 && (
        <Chip
          size="small"
          label={`+${hoursLabel(row.overtimeMins)} s fazla${row.overtimeWithoutConsent ? ' · onay yok' : ''}`}
          sx={{
            ...badgeSx,
            bgcolor: row.overtimeWithoutConsent ? C.warningSoft : C.surfaceMuted,
            color: row.overtimeWithoutConsent ? C.warning : C.inkSecondary,
          }}
        />
      )}
      {row.absentDays > 0 && (
        <Chip size="small" label={`${row.absentDays} devamsız`} sx={{ ...badgeSx, bgcolor: C.dangerSoft, color: C.danger }} />
      )}
      {leave > 0 && (
        <Chip size="small" label={`${leave} gün izin`} sx={{ ...badgeSx, bgcolor: C.infoSoft, color: C.info }} />
      )}
    </Box>
  )
}

// ─── Kişi satırı (masaüstü) ───────────────────────────────────

export const PEOPLE_COLUMNS = { xs: '1fr', md: 'minmax(150px, 190px) 1fr 176px' }

export function PersonRow({ row, days, today, selected, onSelect }: {
  row: TimesheetRow; days: string[]; today: string; selected: boolean; onSelect: () => void
}) {
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${row.employee.full_name} — ${hoursLabel(row.workedMins)} saat`}
      sx={{
        display: 'grid',
        gridTemplateColumns: PEOPLE_COLUMNS,
        alignItems: 'center',
        columnGap: 2,
        width: '100%',
        textAlign: 'left',
        px: 2,
        py: 1.25,
        fontFamily: 'inherit',
        borderTop: '1px solid',
        borderColor: 'divider',
        position: 'relative',
        bgcolor: selected ? C.brandSoft : 'transparent',
        '&:hover': { bgcolor: selected ? C.brandSoft : 'action.hover' },
        '&::before': selected
          ? { content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, bgcolor: 'primary.main' }
          : undefined,
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.light', outlineOffset: -2 },
      }}
    >
      <PersonName row={row} />
      <DayStrip row={row} days={days} today={today} />
      <Box sx={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
        <Typography fontWeight={700} fontSize="0.9rem">{hoursLabel(row.workedMins)} s</Typography>
        <RowBadges row={row} />
      </Box>
    </ButtonBase>
  )
}

function PersonName({ row }: { row: TimesheetRow }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
      <PersonAvatar name={row.employee.full_name} size={32} />
      <Box sx={{ minWidth: 0 }}>
        <Typography fontWeight={700} fontSize="0.85rem" noWrap>{row.employee.full_name}</Typography>
        <Typography fontSize="0.72rem" color="text.secondary" noWrap>{row.employee.role_name}</Typography>
      </Box>
    </Box>
  )
}

// ─── Kişi kartı (mobil) ───────────────────────────────────────

export function PersonCard({ row, days, today, onOpen }: {
  row: TimesheetRow; days: string[]; today: string; onOpen: () => void
}) {
  return (
    <Paper
      component={ButtonBase}
      onClick={onOpen}
      variant="outlined"
      aria-label={`${row.employee.full_name} — ${hoursLabel(row.workedMins)} saat, takvimi aç`}
      sx={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        p: 1.5,
        borderRadius: '14px',
        fontFamily: 'inherit',
        borderColor: row.overtimeWithoutConsent ? C.dangerFill : 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}><PersonName row={row} /></Box>
        <Typography fontWeight={700} fontSize="0.9rem">{hoursLabel(row.workedMins)} s</Typography>
        <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />
      </Box>
      <DayStrip row={row} days={days} today={today} height={14} />
      <Box sx={{ mt: 0.5 }}><StripAxis days={days} today={today} compact /></Box>
      <Box sx={{ mt: 0.75 }}><RowBadges row={row} justify="flex-start" /></Box>
    </Paper>
  )
}

// ─── Lejant ───────────────────────────────────────────────────

const LEGEND: Array<Exclude<TimesheetCode, ''>> = ['Ç', 'HT', 'Yİ', 'Rİ', 'D', 'RT', 'RTÇ', 'P']

export function StripLegend({ today }: { today: string }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.75, alignItems: 'center' }}>
      {LEGEND.map((c) => <LegendItem key={c} code={c} />)}
      <Typography fontSize="0.72rem" color="text.secondary">
        Çerçeveli gün: bugün ({Number(today.slice(8))} {monthName(today)})
      </Typography>
    </Box>
  )
}

function LegendItem({ code }: { code: Exclude<TimesheetCode, ''> }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <LegendDot code={code} />
      <Typography fontSize="0.72rem" color="text.secondary">{TIMESHEET_CODE_LABELS[code]}</Typography>
    </Box>
  )
}

function LegendDot({ code }: { code: TimesheetCode }) {
  const tone = STRIP_TONE[code]
  return (
    <Box
      aria-hidden
      sx={{
        width: 10, height: 10, borderRadius: '3px', bgcolor: tone.bg, flexShrink: 0, boxSizing: 'border-box',
        border: tone.border ? `1px ${tone.dashed ? 'dashed' : 'solid'} ${tone.border}` : undefined,
      }}
    />
  )
}

const monthName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('tr-TR', { month: 'long', timeZone: 'UTC' })

// ─── Kişi detayı: takvim ──────────────────────────────────────

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const WEEKDAYS_SHORT = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']

export function PersonDetail({ row, days, today, monthText, compact }: {
  row: TimesheetRow; days: string[]; today: string; monthText: string; compact?: boolean
}) {
  const lead = (dayOfWeekFromDateString(days[0]) + 6) % 7
  const stats: Array<{ label: string; value: string; color?: string }> = [
    { label: 'Net', value: `${hoursLabel(row.workedMins)} s` },
    { label: 'Fazla', value: `${hoursLabel(row.overtimeMins)} s`, color: row.overtimeMins > 0 ? C.warning : undefined },
    { label: 'Gece', value: `${hoursLabel(row.nightMins)} s` },
    { label: 'SGK', value: `${row.sgkDays} gün` },
  ]

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <PersonAvatar name={row.employee.full_name} size={compact ? 44 : 40} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} fontSize={compact ? '1.1rem' : '1rem'} noWrap>{row.employee.full_name}</Typography>
          <Typography fontSize="0.78rem" color="text.secondary" noWrap>{[row.employee.role_name, monthText].filter(Boolean).join(' · ')}</Typography>
        </Box>
        {row.overtimeWithoutConsent && (
          <Chip size="small" label="Onay yok" sx={{ ...badgeSx, bgcolor: C.dangerSoft, color: C.danger }} />
        )}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, mb: 2 }}>
        {stats.map((s) => (
          <Box key={s.label} sx={{ bgcolor: C.surfaceAlt, borderRadius: '10px', px: 1.25, py: 1 }}>
            <Typography fontSize="0.7rem" color="text.secondary">{s.label}</Typography>
            <Typography fontWeight={700} fontSize="0.95rem" color={s.color ?? 'text.primary'} noWrap>{s.value}</Typography>
          </Box>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' }}>
        {(compact ? WEEKDAYS_SHORT : WEEKDAYS).map((w) => (
          <Typography key={w} fontSize="0.68rem" color="text.secondary" textAlign="center" sx={{ pb: 0.5 }}>
            {w}
          </Typography>
        ))}
        {Array.from({ length: lead }).map((_, i) => <Box key={`b${i}`} />)}
        {days.map((d) => <CalendarCell key={d} row={row} date={d} today={today} compact={compact} />)}
      </Box>

      <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {codeCounts(row).map(({ code, count }) => (
          <Box key={code} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LegendDot code={code} />
            <Typography fontSize="0.8rem" sx={{ flex: 1 }}>{TIMESHEET_CODE_LABELS[code]}</Typography>
            <Typography fontSize="0.8rem" fontWeight={700}>{count} gün</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function CalendarCell({ row, date, today, compact }: { row: TimesheetRow; date: string; today: string; compact?: boolean }) {
  const code = row.days[date] ?? ''
  const tone = CALENDAR_TONE[code]
  const mins = row.dayMins?.[date]
  const plan = row.dayPlan?.[date]
  const value = mins !== undefined ? `${hoursLabel(mins)}${compact ? '' : ' s'}` : code === 'P' && plan ? planLabel(plan) : tone.label
  const isToday = date === today
  return (
    <Box
      title={code ? TIMESHEET_CODE_LABELS[code] : undefined}
      sx={{
        minHeight: compact ? 48 : 44,
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: '8px',
        px: 0.625,
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        bgcolor: tone.bg,
        color: tone.fg,
        boxSizing: 'border-box',
        border: tone.dashed
          ? `1px dashed ${C.sand}`
          : code === 'D' ? `1px solid ${C.dangerFill}` : code === '' ? `1px solid ${C.border}` : '1px solid transparent',
        boxShadow: isToday ? `inset 3px 0 0 ${C.brand}` : undefined,
      }}
    >
      <Typography fontSize="0.65rem" fontWeight={600} lineHeight={1.2} sx={{ opacity: 0.85 }}>{Number(date.slice(8))}</Typography>
      <Typography fontSize={value.length > 6 ? '0.62rem' : '0.72rem'} fontWeight={700} lineHeight={1.15}>
        {value}
      </Typography>
    </Box>
  )
}
