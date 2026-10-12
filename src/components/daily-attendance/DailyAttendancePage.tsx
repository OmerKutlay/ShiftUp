'use client'

import useSWR from 'swr'
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Stack,
  Divider,
  Button,
} from '@mui/material'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import PeopleIcon from '@mui/icons-material/People'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { DailyShiftEntry, AttendanceRecord } from '@/types/attendance'
import { fetchDailyShifts } from '@/lib/api/attendance'
import { EmployeeAttendanceRow } from './EmployeeAttendanceRow'
import { formatDateTurkish, formatDayNameTurkish } from '@/lib/dateUtils'
import { PageHeader, StatCardsSkeleton, ListSkeleton } from '@/components/common'
import { useLastUpdated } from '@/hooks/useLastUpdated'

export function DailyAttendancePage() {
  const today = new Date()
  const { data, error: loadError, isValidating: loading, mutate } = useSWR('attendance:daily', fetchDailyShifts)
  const entries: DailyShiftEntry[] = data?.entries ?? []
  const isFirstLoad = !data && !loadError
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Vardiyalar yüklenemedi.') : null
  const lastRefreshed = useLastUpdated(data)
  const loadShifts = () => mutate()

  // Manuel işlem sonrası yalnızca ilgili satır güncellenir (listeyi yeniden çekmeden)
  const handleRecordChange = (shiftId: string, updatedRecord: AttendanceRecord) => {
    void mutate(
      (prev) => prev && {
        ...prev,
        entries: prev.entries.map((entry) =>
          entry.shiftAssignment.id === shiftId ? { ...entry, attendanceRecord: updatedRecord } : entry
        ),
      },
      { revalidate: false }
    )
  }

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
        minHeight: '100dvh',
        bgcolor: '#0f172a',
        color: 'text.primary',
        p: { xs: 2, md: 3 },
      }}
    >
      <PageHeader
        icon={CalendarTodayIcon}
        overline={formatDayNameTurkish(today)}
        title="Günlük Operasyon"
        subtitle={formatDateTurkish(today)}
        meta={lastRefreshed && `Son güncelleme: ${lastRefreshed.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`}
        actions={
          /* FAZ 8: Manual refresh button */
          <Button
            size="small"
            variant="outlined"
            startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => void loadShifts()}
            disabled={loading}
            sx={{ fontSize: '0.75rem' }}
          >
            Yenile
          </Button>
        }
      />

      {/* Stats row */}
      {isFirstLoad && <StatCardsSkeleton count={4} />}
      {!isFirstLoad && !error && (
      <Box
          sx={{
            display: 'flex',
            gap: 1.5,
            mb: 3,
            flexWrap: 'wrap',
          }}
        >
          <StatCard
            label="Toplam Vardiya"
            value={entries.length}
            icon={<PeopleIcon sx={{ fontSize: 18 }} />}
            color="#94a3b8"
          />
          <StatCard label="Çalışıyor" value={workingCount} color="#10b981" />
          <StatCard label="Molada" value={onBreakCount} color="#f59e0b" />
          <StatCard label="Çıkış Yaptı" value={clockedOutCount} color="#818cf8" />
        </Box>
      )}

      <Divider sx={{ mb: 3, borderColor: 'rgba(255,255,255,0.08)' }} />

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
          sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          {error}
        </Alert>
      )}

      {!isFirstLoad && !error && entries.length === 0 && (
        <Alert
          severity="info"
          sx={{ bgcolor: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}
        >
          Bugün için planlanmış vardiya bulunamadı.
        </Alert>
      )}

      {entries.length > 0 && (
        <Stack spacing={1.5}>
          {entries.map((entry) => (
            <EmployeeAttendanceRow
              key={entry.shiftAssignment.id}
              entry={entry}
              onRecordChange={handleRecordChange}
            />
          ))}
        </Stack>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------
function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string
  value: number
  color: string
  icon?: React.ReactNode
}) {
  return (
    <Box
      sx={{
        px: 2,
        py: 1.5,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        // xs: kart yarısı genişlikte — 2 kart yan yana; sm+: sabit minWidth
        minWidth: { xs: 'calc(50% - 6px)', sm: 110 },
        flex: '1 1 0',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
        {icon && <Box sx={{ color }}>{icon}</Box>}
        <Typography variant="caption" color="text.secondary" fontSize="0.7rem">
          {label}
        </Typography>
      </Box>
      <Typography variant="h6" fontWeight={800} sx={{ color, lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  )
}
