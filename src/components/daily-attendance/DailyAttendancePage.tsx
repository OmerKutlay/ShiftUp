'use client'

import useSWR from 'swr'
import {
  Box,
  CircularProgress,
  Alert,
  Button,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { DailyShiftEntry } from '@/types/attendance'
import { fetchDailyShifts } from '@/lib/api/attendance'
import { EmployeeAttendanceRow } from './EmployeeAttendanceRow'
import { formatDateTurkish, formatDayNameTurkish } from '@/lib/dateUtils'
import { PageHeader, StatCardsSkeleton, ListSkeleton, SectionCard, StatCard, StatGrid } from '@/components/common'
import { useLastUpdated } from '@/hooks/useLastUpdated'
import { C } from '@/lib/palette'

export function DailyAttendancePage() {
  const today = new Date()
  const { data, error: loadError, isValidating: loading, mutate } = useSWR('attendance:daily', fetchDailyShifts)
  const entries: DailyShiftEntry[] = data?.entries ?? []
  const isFirstLoad = !data && !loadError
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Vardiyalar yüklenemedi.') : null
  const lastRefreshed = useLastUpdated(data)
  const loadShifts = () => mutate()

  // Stats
  const workingCount = entries.filter(
    (e) =>
      e.attendanceRecord?.status === 'working' ||
      e.attendanceRecord?.status === 'working_after_break'
  ).length
  const onBreakCount = entries.filter((e) => e.attendanceRecord?.status === 'on_break').length
  const clockedOutCount = entries.filter(
    (e) => e.attendanceRecord?.status === 'clocked_out'
  ).length

  return (
    <Box
      sx={{
        color: 'text.primary',
        p: { xs: 2, md: 3 },
      }}
    >
      <PageHeader
        overline={formatDayNameTurkish(today)}
        title="Günlük operasyon"
        subtitle={formatDateTurkish(today)}
        meta={lastRefreshed && `Son güncelleme: ${lastRefreshed.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`}
        actions={
          /* FAZ 8: Manual refresh button */
          <Button
            variant="outlined"
            color="inherit"
            startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => void loadShifts()}
            disabled={loading}
            sx={{ minHeight: 40, borderColor: 'divider', bgcolor: 'background.paper' }}
          >
            Yenile
          </Button>
        }
      />

      {/* Stats row */}
      {isFirstLoad && <StatCardsSkeleton count={4} />}
      {!isFirstLoad && !error && (
        <StatGrid min={140}>
          <StatCard label="Toplam vardiya" value={entries.length} />
          <StatCard label="Çalışıyor" value={workingCount} valueColor={C.success} />
          <StatCard label="Molada" value={onBreakCount} valueColor={onBreakCount ? C.warning : undefined} />
          <StatCard label="Çıkış yaptı" value={clockedOutCount} />
        </StatGrid>
      )}

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={5} actions={2} />}

      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadShifts()}>
              Tekrar Dene
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {!isFirstLoad && !error && entries.length === 0 && (
        <Alert severity="info">Bugün için planlanmış vardiya bulunamadı.</Alert>
      )}

      {entries.length > 0 && (
        <SectionCard title="Bugünkü vardiyalar" count={entries.length} subtitle="Giriş, mola ve çıkış QR okutmayla işlenir">
          {entries.map((entry) => (
            <EmployeeAttendanceRow key={entry.shiftAssignment.id} entry={entry} />
          ))}
        </SectionCard>
      )}
    </Box>
  )
}
