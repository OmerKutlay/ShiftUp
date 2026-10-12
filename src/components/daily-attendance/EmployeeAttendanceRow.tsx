'use client'

import { useState } from 'react'
import {
  Box,
  Typography,
  Paper,
  Chip,
  Snackbar,
  Alert,
  Divider,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import type { DailyShiftEntry, AttendanceRecord } from '@/types/attendance'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import { AttendanceStatusChip } from './AttendanceStatusChip'
import { AttendanceActions } from './AttendanceActions'
import { performManualAttendanceAction } from '@/lib/api/attendance'
import { formatInTimeZone } from '@/lib/dateUtils'

interface Props {
  entry: DailyShiftEntry
  onRecordChange: (shiftId: string, record: AttendanceRecord) => void
}

export function EmployeeAttendanceRow({ entry, onRecordChange }: Props) {
  const { employee, shiftAssignment, attendanceRecord } = entry
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  const currentStatus = attendanceRecord?.status ?? 'shift_waiting'

  const handleAction = async (action: AttendanceAction) => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const updatedRecord = await performManualAttendanceAction(shiftAssignment.id, action)
      onRecordChange(shiftAssignment.id, updatedRecord)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, md: 2.5 },
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          '&:hover': { borderColor: 'primary.dark' },
          transition: 'border-color 0.2s',
        }}
      >
        {isMobile ? (
          // Mobile layout: stacked
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="subtitle2" fontWeight={700} color="text.primary">
                  {employee.full_name}
                </Typography>
                <Chip
                  label={employee.role}
                  size="small"
                  sx={{
                    mt: 0.5,
                    bgcolor: 'rgba(99,102,241,0.15)',
                    color: '#818cf8',
                    borderColor: 'rgba(99,102,241,0.3)',
                    fontSize: '0.65rem',
                    height: 20,
                    border: '1px solid',
                  }}
                />
              </Box>
              <AttendanceStatusChip status={currentStatus} />
            </Box>
            <TimeInfo shiftAssignment={shiftAssignment} attendanceRecord={attendanceRecord} />
            <AttendanceActions status={currentStatus} loading={loading} onAction={handleAction} />
          </Box>
        ) : (
          // Desktop layout: 3-column
          <Box
            sx={{
              display: 'grid',
              // Sabit aksiyon sütunu: buton sayısı değişse de satırlar arası hizalama korunur
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 250px',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {/* Col 1: Employee info */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  bgcolor: 'rgba(20,184,166,0.15)',
                  border: '2px solid rgba(20,184,166,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  color: 'primary.main',
                  fontSize: '0.9rem',
                  flexShrink: 0,
                }}
              >
                {employee.full_name.charAt(0)}
              </Box>
              <Box>
                <Typography variant="subtitle2" fontWeight={700} color="text.primary">
                  {employee.full_name}
                </Typography>
                <Chip
                  label={employee.role}
                  size="small"
                  sx={{
                    mt: 0.25,
                    bgcolor: 'rgba(99,102,241,0.15)',
                    color: '#818cf8',
                    borderColor: 'rgba(99,102,241,0.3)',
                    fontSize: '0.65rem',
                    height: 20,
                    border: '1px solid',
                  }}
                />
              </Box>
            </Box>

            {/* Col 2: Shift & attendance times + status */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75 }}>
              <AttendanceStatusChip status={currentStatus} />
              <TimeInfo shiftAssignment={shiftAssignment} attendanceRecord={attendanceRecord} />
            </Box>

            {/* Col 3: Actions */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <AttendanceActions status={currentStatus} loading={loading} onAction={handleAction} />
            </Box>
          </Box>
        )}
      </Paper>

      <Snackbar
        open={!!errorMsg}
        autoHideDuration={4000}
        onClose={() => setErrorMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMsg(null)} sx={{ width: '100%' }}>
          {errorMsg}
        </Alert>
      </Snackbar>
    </>
  )
}

// ---------------------------------------------------------------
// Sub-component: time information
// ---------------------------------------------------------------
function TimeInfo({
  shiftAssignment,
  attendanceRecord,
}: {
  shiftAssignment: DailyShiftEntry['shiftAssignment']
  attendanceRecord: AttendanceRecord | null
}) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
      {/* Planned shift times */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
        <Typography variant="caption" color="text.secondary">
          {shiftAssignment.start_time.slice(0, 5)} – {shiftAssignment.end_time.slice(0, 5)}
        </Typography>
      </Box>

      {attendanceRecord && (
        <>
          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          {attendanceRecord.clock_in_at && (
            <TimeField label="Giriş" value={attendanceRecord.clock_in_at} color="#10b981" />
          )}
          {attendanceRecord.break_start_at && (
            <TimeField label="Mola" value={attendanceRecord.break_start_at} color="#f59e0b" />
          )}
          {attendanceRecord.break_end_at && (
            <TimeField label="Dönüş" value={attendanceRecord.break_end_at} color="#60a5fa" />
          )}
          {attendanceRecord.clock_out_at && (
            <TimeField label="Çıkış" value={attendanceRecord.clock_out_at} color="#818cf8" />
          )}
        </>
      )}
    </Box>
  )
}

function TimeField({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
      <Box component="span" sx={{ color, fontWeight: 600 }}>
        {label}:{' '}
      </Box>
      {formatInTimeZone(value)}
    </Typography>
  )
}
