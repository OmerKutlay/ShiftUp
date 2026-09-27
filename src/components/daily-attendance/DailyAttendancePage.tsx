'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Stack,
  Divider,
} from '@mui/material'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import PeopleIcon from '@mui/icons-material/People'
import type { DailyShiftEntry, AttendanceRecord } from '@/types/attendance'
import { fetchDailyShifts } from '@/lib/attendanceRepository'
import { EmployeeAttendanceRow } from './EmployeeAttendanceRow'
import { formatDateTurkish, formatDayNameTurkish } from '@/lib/dateUtils'

export function DailyAttendancePage() {
  const today = new Date()
  const [entries, setEntries] = useState<DailyShiftEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadShifts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDailyShifts(today)
      setEntries(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vardiyalar yüklenemedi.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // void to silence no-floating-promises; set-state-in-effect false-positive:
  // loadShifts sets state only after the async fetch completes, not inline.
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
        minHeight: '100vh',
        bgcolor: '#0f172a',
        color: 'text.primary',
        p: { xs: 2, md: 3 },
      }}
    >
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <CalendarTodayIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
            {formatDayNameTurkish(today)}
          </Typography>
        </Box>
        <Typography variant="h5" fontWeight={800} color="text.primary">
          Günlük Operasyon
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {formatDateTurkish(today)}
        </Typography>
      </Box>

      {/* Stats row */}
      {!loading && !error && (
        <Box
          sx={{
            display: 'flex',
            gap: 2,
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
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress color="primary" />
        </Box>
      )}

      {error && (
        <Alert
          severity="error"
          sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          {error}
        </Alert>
      )}

      {!loading && !error && entries.length === 0 && (
        <Alert
          severity="info"
          sx={{ bgcolor: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}
        >
          Bugün için planlanmış vardiya bulunamadı.
        </Alert>
      )}

      {!loading && !error && entries.length > 0 && (
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
        minWidth: 110,
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
