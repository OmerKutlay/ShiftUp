'use client'

/**
 * OvertimePanel — yıllık fazla çalışma takibi (İş K. Md. 41): 270 saat sınırı ve yazılı onay.
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  Alert, Box, FormControl, InputLabel, LinearProgress, MenuItem, Paper, Select,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { apiFetch } from '@/lib/api/http'
import type { OvertimeSummary } from '@/lib/overtime'
import { ANNUAL_OVERTIME_CAP_HOURS } from '@/lib/laborLaw'
import { formatShortDateTr, turkeyToday } from '@/lib/dateUtils'
import { TableSkeleton } from '@/components/common'
import { StatusBadge } from '@/components/common'

const hours = (mins: number) => (Math.round((mins / 60) * 10) / 10).toLocaleString('tr-TR')

export function OvertimePanel() {
  const currentYear = Number(turkeyToday().slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const { data, error, isLoading } = useSWR(`/api/reports/overtime?year=${year}`, (url: string) =>
    apiFetch<{ summaries: OvertimeSummary[] }>(url)
  )
  const rows = (data?.summaries ?? []).filter((s) => s.totalOvertimeMins > 0)

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ width: 140 }}>
          <InputLabel>Yıl</InputLabel>
          <Select value={year} label="Yıl" onChange={(e) => setYear(Number(e.target.value))}>
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <MenuItem key={y} value={y}>{y}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary">
          Haftalık 45 saati aşan net fiili çalışma fazla çalışmadır; yıllık üst sınır {ANNUAL_OVERTIME_CAP_HOURS} saat,
          ücreti %50 zamlıdır ve çalışanın yazılı onayı gerekir.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error instanceof Error ? error.message : 'Rapor yüklenemedi.'}</Alert>}
      {isLoading && !data && <TableSkeleton rows={5} />}
      {data && rows.length === 0 && <Alert severity="success">{year} yılında fazla çalışma kaydı yok.</Alert>}

      {rows.length > 0 && (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Çalışan</TableCell>
                <TableCell align="right">Fazla çalışma (s)</TableCell>
                <TableCell sx={{ minWidth: 180 }}>Yıllık sınır ({ANNUAL_OVERTIME_CAP_HOURS} s)</TableCell>
                <TableCell align="right">Hafta sayısı</TableCell>
                <TableCell>Yazılı onay</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.employee_id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{s.full_name}</TableCell>
                  <TableCell align="right">{hours(s.totalOvertimeMins)}</TableCell>
                  <TableCell>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, s.capRatio * 100)}
                      color={s.overCap ? 'error' : s.capRatio > 0.8 ? 'warning' : 'primary'}
                      sx={{ height: 8, borderRadius: 4 }}
                      aria-label={`Yıllık sınırın %${Math.round(s.capRatio * 100)}'i`}
                    />
                    <Typography variant="caption" color={s.overCap ? 'error.main' : 'text.secondary'}>
                      %{Math.round(s.capRatio * 100)}{s.overCap && ' — sınır aşıldı'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{s.weeks.length}</TableCell>
                  <TableCell>
                    {s.consent_at
                      ? <StatusBadge tone="success" label={`Var · ${formatShortDateTr(s.consent_at.slice(0, 10))}`} />
                      : <StatusBadge tone="warning" label="Yok" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
