'use client'

/**
 * TimesheetPanel — aylık puantaj: KPI kartları, kişi şeritleri + takvim detayı ("Kişiler")
 * ya da çalışan × gün kod tablosu ("Tablo"), Excel indirme.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  Alert, Box, Button, ButtonBase, Chip, InputAdornment, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import SearchIcon from '@mui/icons-material/Search'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import { apiFetch } from '@/lib/api/http'
import { monthDays, TIMESHEET_CODE_LABELS, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'
import { turkeyToday } from '@/lib/dateUtils'
import { PeriodStepper, SegmentedControl, TableSkeleton } from '@/components/common'
import type { PublicHoliday } from '@/types/holiday'
import { C, tint } from '@/lib/palette'
import { PersonCard, PersonDetail, PersonRow, PEOPLE_COLUMNS, StripAxis, StripLegend } from './TimesheetPeople'
import { hoursLabel, monthLabel, shiftMonth, summarizeTimesheet, type TimesheetKpis } from './timesheetSummary'

// Yeni UI puantaj lejantı: çalıştı yeşil, resmi tatilde çalıştı kiremit, devamsız kırmızı …
const CODE_COLOR: Partial<Record<TimesheetCode, string>> = {
  'Ç': C.success,
  'RTÇ': C.brand,
  'HT': C.inkMuted,
  'RT': C.warning,
  'Yİ': C.info,
  'Rİ': C.plum,
  'Üİ': C.inkMuted,
  'Mİ': C.plum,
  'D': C.danger,
  'P': C.neutral,
}

type View = 'people' | 'table'

export function TimesheetPanel() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const today = turkeyToday()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [view, setView] = useState<View>('people')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Mobil: kişi takvimi açık mı (liste yerine tam ekran detay) */
  const [detailOpen, setDetailOpen] = useState(false)

  const { data, error, isLoading } = useSWR(
    `/api/reports/timesheet?month=${month}`,
    (url: string) => apiFetch<{ rows: TimesheetRow[]; holidays: PublicHoliday[] }>(url)
  )
  const days = monthDays(month)
  const rows = useMemo(() => data?.rows ?? [], [data])
  const kpis = useMemo(() => summarizeTimesheet(rows, month, today), [rows, month, today])
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr-TR')
    return q ? rows.filter((r) => r.employee.full_name.toLocaleLowerCase('tr-TR').includes(q)) : rows
  }, [rows, query])
  const selected = rows.find((r) => r.employee.id === selectedId) ?? filtered[0] ?? null
  const monthText = monthLabel(month)
  // Bugün bu ayda değilse şeritte çerçeveli gün olmaz
  const stripToday = today.startsWith(month) ? today : ''

  const changeMonth = (n: number) => {
    setMonth((m) => shiftMonth(m, n))
    setDetailOpen(false)
  }

  // ── Mobil kişi takvimi ──
  if (isMobile && detailOpen && selected) {
    return (
      <Box>
        <ButtonBase
          onClick={() => setDetailOpen(false)}
          sx={{ gap: 0.5, mb: 1.5, py: 0.5, fontFamily: 'inherit', fontWeight: 600, fontSize: '0.95rem', borderRadius: 1 }}
        >
          <ChevronLeftIcon fontSize="small" /> Aylık puantaj
        </ButtonBase>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: '16px' }}>
          <PersonDetail row={selected} days={days} today={stripToday} monthText={monthText} compact />
        </Paper>
      </Box>
    )
  }

  return (
    <Box>
      {/* Araç çubuğu */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <PeriodStepper
          label={monthText}
          onPrev={() => changeMonth(-1)}
          onNext={() => changeMonth(1)}
          prevLabel="Önceki ay"
          nextLabel="Sonraki ay"
          minLabelWidth={110}
        />
        {!isMobile && (
          <SegmentedControl
            aria-label="Görünüm"
            value={view}
            onChange={setView}
            options={[{ value: 'people', label: 'Kişiler' }, { value: 'table', label: 'Tablo' }]}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<FileDownloadOutlinedIcon />}
          href={`/api/reports/timesheet?month=${month}&format=xlsx`}
          disabled={!data}
          sx={{ minHeight: 40 }}
        >
          {isMobile ? 'Excel' : 'Excel olarak indir'}
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error instanceof Error ? error.message : 'Puantaj yüklenemedi.'}</Alert>}

      {kpis.missingConsent.length > 0 && (
        <Box
          role="status"
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap',
            bgcolor: C.warningSoft, color: C.warning, borderRadius: '12px', px: 2, py: 1.25, mb: 2,
          }}
        >
          <WarningAmberIcon sx={{ fontSize: 18 }} />
          <Typography fontSize="0.8rem" sx={{ flex: 1, minWidth: 200, color: C.ink }}>
            {isMobile ? (
              <b>{kpis.missingConsent.length} kişinin fazla çalışma onayı eksik</b>
            ) : (
              <>
                <b>Fazla çalışma onayı eksik:</b> {kpis.missingConsent.join(', ')} — İş Kanunu Md. 41 gereği yazılı onay gerekir.
              </>
            )}
          </Typography>
          {!isMobile && (
            <Typography
              component={Link}
              href="/employees"
              fontSize="0.8rem"
              fontWeight={700}
              sx={{ color: C.ink, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              Çalışanlara git →
            </Typography>
          )}
        </Box>
      )}

      {isLoading && !data && <TableSkeleton rows={6} />}

      {data && (
        <>
          <KpiCards kpis={kpis} isMobile={isMobile} />

          {view === 'table' && !isMobile ? (
            <CodeTable rows={filtered} days={days} holidays={data.holidays} />
          ) : isMobile ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {filtered.map((r) => (
                <PersonCard
                  key={r.employee.id}
                  row={r}
                  days={days}
                  today={stripToday}
                  onOpen={() => {
                    setSelectedId(r.employee.id)
                    setDetailOpen(true)
                    window.scrollTo({ top: 0 })
                  }}
                />
              ))}
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { md: '1fr', lg: 'minmax(0, 1fr) 380px' }, gap: 2, alignItems: 'start' }}>
              <Paper variant="outlined" sx={{ borderRadius: '16px', overflow: 'hidden' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, pt: 1.75, pb: 1 }}>
                  <Typography fontWeight={700} fontSize="0.9rem">Ekip</Typography>
                  <Typography fontSize="0.75rem" color="text.secondary" sx={{ flex: 1 }}>Ayın her günü bir kutu</Typography>
                  <TextField
                    size="small"
                    placeholder="Çalışan ara…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    slotProps={{
                      htmlInput: { 'aria-label': 'Çalışan ara' },
                      input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
                    }}
                    sx={{ width: 220, '& .MuiInputBase-root': { height: 36, fontSize: '0.8rem' } }}
                  />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: PEOPLE_COLUMNS, columnGap: 2, px: 2, pb: 0.5 }}>
                  <span />
                  <StripAxis days={days} today={stripToday} />
                  <span />
                </Box>
                {filtered.map((r) => (
                  <PersonRow
                    key={r.employee.id}
                    row={r}
                    days={days}
                    today={stripToday}
                    selected={selected?.employee.id === r.employee.id}
                    onSelect={() => setSelectedId(r.employee.id)}
                  />
                ))}
                {filtered.length === 0 && (
                  <Typography fontSize="0.85rem" color="text.secondary" sx={{ px: 2, py: 3, borderTop: '1px solid', borderColor: 'divider' }}>
                    Eşleşen çalışan yok.
                  </Typography>
                )}
                <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                  <StripLegend today={today} />
                </Box>
              </Paper>
              {selected && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: '16px', position: { lg: 'sticky' }, top: { lg: 16 } }}>
                  <PersonDetail row={selected} days={days} today={stripToday} monthText={monthText} />
                </Paper>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

// ─── KPI kartları ─────────────────────────────────────────────

function KpiCards({ kpis, isMobile }: { kpis: TimesheetKpis; isMobile: boolean }) {
  const consentNote = kpis.missingConsent.length > 0 ? `${kpis.missingConsent.length} kişide onay eksik` : 'onaylar tamam'
  const cards = [
    {
      label: isMobile ? 'Net çalışma' : 'Toplam net çalışma',
      value: `${hoursLabel(kpis.netMins)} s`,
      note: isMobile
        ? `${kpis.people} çalışan`
        : [`${kpis.people} çalışan`, kpis.daysLeft !== null && `ay sonuna ${kpis.daysLeft} gün`].filter(Boolean).join(' · '),
    },
    {
      label: 'Fazla çalışma',
      value: `${hoursLabel(kpis.overtimeMins)} s`,
      note: isMobile ? consentNote : `${kpis.overtimePeople} çalışan · ${consentNote}`,
    },
    {
      label: 'Devamsızlık',
      value: `${kpis.absentDays} gün`,
      note: kpis.absentNames.length === 0
        ? 'devamsızlık yok'
        : kpis.absentNames.slice(0, 3).join(', ') + (kpis.absentNames.length > 3 ? ` +${kpis.absentNames.length - 3}` : ''),
    },
    {
      label: 'İzin ve rapor',
      value: `${kpis.leaveDays} gün`,
      note: `${kpis.annualLeaveDays} yıllık izin · ${kpis.sickDays} rapor`,
    },
  ]
  const shown = isMobile ? cards.slice(0, 2) : cards
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: { xs: 1.25, md: 2 }, mb: 2 }}>
      {shown.map((c) => (
        <Paper key={c.label} variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: '14px', minWidth: 0 }}>
          <Typography fontSize="0.78rem" color="text.secondary">{c.label}</Typography>
          <Typography fontWeight={700} sx={{ fontSize: { xs: '1.35rem', md: '1.6rem' }, lineHeight: 1.3, my: 0.25 }} noWrap>
            {c.value}
          </Typography>
          <Typography fontSize="0.72rem" color="text.secondary" noWrap>{c.note}</Typography>
        </Paper>
      ))}
    </Box>
  )
}

// ─── Tablo görünümü: çalışan × gün kodları ────────────────────

function CodeTable({ rows, days, holidays: holidayList }: { rows: TimesheetRow[]; days: string[]; holidays: PublicHoliday[] }) {
  const holidays = new Map(holidayList.map((h) => [h.date, h]))
  return (
    <>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        Kodlar: {Object.entries(TIMESHEET_CODE_LABELS).map(([k, v]) => `${k} ${v}`).join(' · ')}
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '16px', maxHeight: '70dvh' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper', minWidth: 160 }}>Çalışan</TableCell>
              {days.map((d) => {
                const h = holidays.get(d)
                return (
                  <Tooltip key={d} title={h ? h.name : ''} enterTouchDelay={0} leaveTouchDelay={3000}>
                    <TableCell align="center" sx={{ px: 0.5, minWidth: 34, bgcolor: h && !h.half_day ? C.warningSoft : 'background.paper' }}>
                      {Number(d.slice(8))}
                    </TableCell>
                  </Tooltip>
                )
              })}
              <TableCell align="right">Net s</TableCell>
              <TableCell align="right">Fazla s</TableCell>
              <TableCell align="right">Gece s</TableCell>
              <TableCell align="right">RT gün</TableCell>
              <TableCell align="right">SGK</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.employee.id} hover>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', fontWeight: 600, minWidth: 160, whiteSpace: 'nowrap' }}>
                  {r.employee.full_name}
                </TableCell>
                {days.map((d) => {
                  const code = r.days[d] ?? ''
                  return (
                    <TableCell key={d} align="center" sx={{ px: 0.25, fontSize: '0.7rem', fontWeight: 700, color: CODE_COLOR[code] }}>
                      {code}
                    </TableCell>
                  )
                })}
                <TableCell align="right">{hoursLabel(r.workedMins)}</TableCell>
                <TableCell align="right">
                  {r.overtimeMins > 0 ? (
                    <Chip
                      size="small"
                      label={hoursLabel(r.overtimeMins)}
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        bgcolor: r.overtimeWithoutConsent ? C.warningSoft : tint(C.ink, 0.06),
                        color: r.overtimeWithoutConsent ? C.warning : 'text.primary',
                      }}
                    />
                  ) : '—'}
                </TableCell>
                <TableCell align="right">{r.nightMins > 0 ? hoursLabel(r.nightMins) : '—'}</TableCell>
                <TableCell align="right">{r.holidayWorkedDays || '—'}</TableCell>
                <TableCell align="right">{r.sgkDays}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  )
}
