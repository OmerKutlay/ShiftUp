'use client'

import { Button, Box, CircularProgress } from '@mui/material'
import LoginIcon from '@mui/icons-material/Login'
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import LogoutIcon from '@mui/icons-material/Logout'
import type { AttendanceStatus } from '@/types/attendance'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import { getAllowedActions } from '@/lib/attendanceStateMachine'

interface Props {
  status: AttendanceStatus
  loading: boolean
  onAction: (action: AttendanceAction) => void
}

const ACTION_CONFIG: Record<
  AttendanceAction,
  { label: string; icon: React.ReactNode; color: 'success' | 'warning' | 'info' | 'error' }
> = {
  clock_in: {
    label: 'Giriş Yap',
    icon: <LoginIcon fontSize="small" />,
    color: 'success',
  },
  start_break: {
    label: 'Molaya Çık',
    icon: <FreeBreakfastIcon fontSize="small" />,
    color: 'warning',
  },
  end_break: {
    label: 'Moladan Dön',
    icon: <PlayArrowIcon fontSize="small" />,
    color: 'info',
  },
  clock_out: {
    label: 'Çıkış Yap',
    icon: <LogoutIcon fontSize="small" />,
    color: 'error',
  },
}

export function AttendanceActions({ status, loading, onAction }: Props) {
  const allowedActions = getAllowedActions(status)

  if (allowedActions.length === 0) {
    return null
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
    {allowedActions.map((action: AttendanceAction) => {
        const config = ACTION_CONFIG[action]
        return (
          <Button
            key={action}
            size="small"
            variant="outlined"
            color={config.color}
            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : config.icon}
            disabled={loading}
            onClick={() => onAction(action)}
            sx={{
              fontSize: '0.75rem',
              py: 0.75,
              px: 1.5,
              minHeight: 40,    // theme override'ın üzerine: burada 40px yeterli
              minWidth: 'unset',
              whiteSpace: 'nowrap',
            }}
          >
            {config.label}
          </Button>
        )
      })}
    </Box>
  )
}
