'use client'

/**
 * TimesheetPanel — aylık puantaj (çalışan × gün kodları) + Excel indirme.
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { apiFetch } from '@/lib/api/http'
import { monthDays, TIMESHEET_CODE_LABELS, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'
import { turkeyToday } from '@/lib/dateUtils'
import { MonthField, TableSkeleton } from '@/components/common'
import type { PublicHoliday } from '@/types/holiday'
import { C, tint } from '@/lib/palette'

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

const hours = (mins: number) => (Math.round((mins / 60) * 10) / 10).toLocaleString('tr-TR')

export function TimesheetPanel() {
  const [month, setMonth] = useState(turkeyToday().slice(0, 7))
  const { data, error, isLoading } = useSWR(
    /^\d{4}-\d{2}$/.test(month) ? `/api/reports/timesheet?month=${month}` : null,
    (url: string) => apiFetch<{ rows: TimesheetRow[]; holidays: PublicHoliday[] }>(url)
  )
  const days = /^\d{4}-\d{2}$/.test(month) ? monthDays(month) : []
  const holidays = new Map((data?.holidays ?? []).map((h) => [h.date, h]))
  const missingConsent = (data?.rows ?? []).filter((r) => r.overtimeWithoutConsent)

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <MonthField
          label="Ay"
          size="small"
          value={month}
          onChange={setMonth}
          sx={{ width: 180 }}
        />
        <Button
          variant="contained"
          startIcon={<DownloadIcon />}
          href={`/api/reports/timesheet?month=${month}&format=xlsx`}
          disabled={!data}
        >
          Excel olarak indir
        </Button>
        {/* Masaüstü: tek satır açıklama; mobil: taranabilir küçük çiftler */}
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
          Kodlar: {Object.entries(TIMESHEET_CODE_LABELS).map(([k, v]) => `${k} ${v}`).join(' · ')}
        </Typography>
        <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Kodlar:</Typography>
          {Object.entries(TIMESHEET_CODE_LABELS).map(([k, v]) => (
            <Chip
              key={k}
              size="small"
              variant="outlined"
              label={<><b style={{ color: CODE_COLOR[k as TimesheetCode] }}>{k}</b> {v}</>}
              sx={{ height: 22, fontSize: '0.68rem' }}
            />
          ))}
        </Box>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error instanceof Error ? error.message : 'Puantaj yüklenemedi.'}</Alert>}
      {missingConsent.length > 0 && (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
          Fazla çalışması olan ancak yazılı onayı kayıtlı olmayan çalışanlar (İş K. Md. 41):{' '}
          <strong>{missingConsent.map((r) => r.employee.full_name).join(', ')}</strong>. Onay tarihi Çalışanlar ekranından girilir.
        </Alert>
      )}

      {isLoading && !data && <TableSkeleton rows={6} />}

      {data && (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, maxHeight: '70dvh' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper', minWidth: { xs: 104, sm: 160 }, maxWidth: { xs: 104, sm: 'none' } }}>Çalışan</TableCell>
                {days.map((d) => {
                  const h = holidays.get(d)
                  return (
                    <Tooltip key={d} title={h ? h.name : ''} enterTouchDelay={0} leaveTouchDelay={3000}>
                      <TableCell align="center" sx={{ px: 0.5, minWidth: 34, bgcolor: h && !h.half_day ? tint(C.warning, 0.15) : undefined }}>
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
              {data.rows.map((r) => (
                <TableRow key={r.employee.id} hover>
                  <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', fontWeight: 600, minWidth: { xs: 104, sm: 160 }, maxWidth: { xs: 104, sm: 'none' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  <TableCell align="right">{hours(r.workedMins)}</TableCell>
                  <TableCell align="right">
                    {r.overtimeMins > 0 ? (
                      <Chip
                        size="small"
                        label={hours(r.overtimeMins)}
                        color={r.overtimeWithoutConsent ? 'warning' : 'default'}
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    ) : '—'}
                  </TableCell>
                  <TableCell align="right">{r.nightMins > 0 ? hours(r.nightMins) : '—'}</TableCell>
                  <TableCell align="right">{r.holidayWorkedDays || '—'}</TableCell>
                  <TableCell align="right">{r.sgkDays}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
