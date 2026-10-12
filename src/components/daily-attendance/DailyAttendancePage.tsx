'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { fetchDailyShifts } from '@/lib/attendanceRepository'
import { EmployeeAttendanceRow } from './EmployeeAttendanceRow'
import { formatDateTurkish, formatDayNameTurkish } from '@/lib/dateUtils'
import { PageHeader, StatCardsSkeleton, ListSkeleton } from '@/components/common'
import { useLoadedKey } from '@/hooks/useLoadedKey'

export function DailyAttendancePage() {
  const today = new Date()
  const [entries, setEntries] = useState<DailyShiftEntry[]>([])
  const [loading, setLoading] = useState(true)
  const { isFirstLoad, markLoaded } = useLoadedKey()
  const [error, setError] = useState<string | null>(null)
  // FAZ 8: last refresh time for display
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const loadShifts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDailyShifts(today)
      setEntries(data)
      setLastRefreshed(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vardiyalar yüklenemedi.')
    } finally {
      setLoading(false)
      markLoaded()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markLoaded])

  useEffect(() => {
    void loadShifts() // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadShifts])

  const handleRecordChange = (shiftId: string, updatedRecord: AttendanceRecord) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.shiftAssignment.id === shiftId
          ? { ...entry, attendanceRecord: updatedRecord }
          : entry
      )
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
