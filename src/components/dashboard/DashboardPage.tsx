'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Paper,
  Stack,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  Button,
} from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import PeopleIcon from '@mui/icons-material/People'
import LoginIcon from '@mui/icons-material/Login'
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast'
import LogoutIcon from '@mui/icons-material/Logout'
import BeachAccessIcon from '@mui/icons-material/BeachAccess'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useRouter } from 'next/navigation'
import { formatDateTurkish, formatDayNameTurkish } from '@/lib/dateUtils'
import { LEAVE_TYPE_LABELS } from '@/types/leave'

// ─── Types ───────────────────────────────────────────────────

interface DashboardStats {
  active_employees: number
  today_shifts: number
  currently_working: number
  on_break: number
  clocked_out: number
  no_show: number
  pending_leaves: number
}

interface RosterEntry {
  employee_id: string
  full_name: string
  role: string
  start_time: string
  end_time: string
  attendance_status: string
  clock_in_at: string | null
  clock_out_at: string | null
}

interface PendingLeave {
  id: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employees: any
}

interface DashboardData {
  stats: DashboardStats
  today_roster: RosterEntry[]
  pending_leaves: PendingLeave[]
}

// ─── Constants ───────────────────────────────────────────────

const ATTENDANCE_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  shift_waiting: { label: 'Bekleniyor', color: '#94a3b8', icon: null },
  working: { label: 'Çalışıyor', color: '#10b981', icon: <LoginIcon sx={{ fontSize: 14 }} /> },
  on_break: { label: 'Molada', color: '#f59e0b', icon: <FreeBreakfastIcon sx={{ fontSize: 14 }} /> },
  working_after_break: { label: 'Çalışıyor', color: '#10b981', icon: <LoginIcon sx={{ fontSize: 14 }} /> },
  clocked_out: { label: 'Çıkış Yaptı', color: '#818cf8', icon: <LogoutIcon sx={{ fontSize: 14 }} /> },
}

// ─── Stat Card ────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  icon,
  onClick,
}: {
  label: string
  value: number
  color: string
  icon: React.ReactNode
  onClick?: () => void
}) {
  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        p: { xs: 2, md: 2.5 },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        flex: '1 1 0',
        minWidth: { xs: 'calc(50% - 6px)', sm: 140 },
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s',
        '&:hover': onClick ? { borderColor: 'primary.dark' } : {},
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box sx={{ color, opacity: 0.8 }}>{icon}</Box>
        <Typography variant="caption" color="text.secondary" fontSize="0.7rem">
          {label}
        </Typography>
      </Box>
      <Typography variant="h5" fontWeight={800} sx={{ color, lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Paper>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export function DashboardPage() {
  const today = new Date()
  const router = useRouter()

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard')
      if (!res.ok) throw new Error('Dashboard verisi alınamadı.')
      const json = await res.json() as DashboardData
      setData(json)
      setLastRefreshed(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const stats = data?.stats
  const roster = data?.today_roster ?? []
  const pendingLeaves = data?.pending_leaves ?? []

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <DashboardIcon sx={{ fontSize: 18, color: 'primary.main' }} />
            <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
              {formatDayNameTurkish(today)}
            </Typography>
          </Box>
          <Typography variant="h5" fontWeight={800}>Genel Bakış</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {formatDateTurkish(today)}
          </Typography>
          {lastRefreshed && (
            <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.25 }}>
              Son güncelleme: {lastRefreshed.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </Typography>
          )}
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
          onClick={() => void load()}
          disabled={loading}
          sx={{ alignSelf: 'flex-start', fontSize: '0.75rem' }}
        >
          Yenile
        </Button>
      </Box>

      {error && (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void load()}>Tekrar Dene</Button>}
          sx={{ mb: 2 }}
        >
          {error}
        </Alert>
      )}

      {/* Stats */}
      {stats && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 3 }}>
          <StatCard
            label="Aktif Çalışan"
            value={stats.active_employees}
            color="#94a3b8"
            icon={<PeopleIcon sx={{ fontSize: 16 }} />}
            onClick={() => router.push('/employees')}
          />
          <StatCard
            label="Bugün Vardiyalı"
            value={stats.today_shifts}
            color="#60a5fa"
            icon={<LoginIcon sx={{ fontSize: 16 }} />}
            onClick={() => router.push('/')}
          />
          <StatCard
            label="Çalışıyor"
            value={stats.currently_working}
            color="#10b981"
            icon={<LoginIcon sx={{ fontSize: 16 }} />}
          />
          <StatCard
            label="Molada"
            value={stats.on_break}
            color="#f59e0b"
            icon={<FreeBreakfastIcon sx={{ fontSize: 16 }} />}
          />
          <StatCard
            label="Çıkış Yaptı"
            value={stats.clocked_out}
            color="#818cf8"
            icon={<LogoutIcon sx={{ fontSize: 16 }} />}
          />
          {stats.pending_leaves > 0 && (
            <StatCard
              label="İzin Bekliyor"
              value={stats.pending_leaves}
              color="#f59e0b"
              icon={<BeachAccessIcon sx={{ fontSize: 16 }} />}
              onClick={() => router.push('/leave')}
            />
          )}
        </Box>
      )}

      <Divider sx={{ mb: 3, borderColor: 'rgba(255,255,255,0.08)' }} />

      {loading && !data && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress color="primary" />
        </Box>
      )}

      {/* Two column layout: Bugünkü kadro + Onay bekleyenler */}
      {data && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 380px' }, gap: 3 }}>

          {/* Bugünkü Kadro */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle1" fontWeight={700}>Bugünkü Kadro</Typography>
              <Button
                size="small"
                variant="text"
                onClick={() => router.push('/')}
                sx={{ fontSize: '0.75rem', color: 'primary.main' }}
              >
                Detay →
              </Button>
            </Box>

            {roster.length === 0 ? (
              <Alert severity="info">Bugün için planlanmış vardiya yok.</Alert>
            ) : (
              <Stack spacing={1}>
                {roster.map((entry) => {
                  const cfg = ATTENDANCE_STATUS_CONFIG[entry.attendance_status] ??
                    ATTENDANCE_STATUS_CONFIG.shift_waiting
                  return (
                    <Paper
                      key={entry.employee_id + entry.start_time}
                      elevation={0}
                      sx={{
                        p: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        bgcolor: 'background.paper',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                      }}
                    >
                      {/* Avatar */}
                      <Box
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          bgcolor: `${cfg.color}15`,
                          border: `2px solid ${cfg.color}30`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          color: cfg.color,
                          fontSize: '0.85rem',
                          flexShrink: 0,
                        }}
                      >
                        {entry.full_name.charAt(0)}
                      </Box>

                      {/* Name + role */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" fontWeight={700} noWrap>{entry.full_name}</Typography>
                        <Typography variant="caption" color="text.secondary" display="block" noWrap fontSize="0.65rem">
                          {entry.role} · {entry.start_time.slice(0, 5)}–{entry.end_time.slice(0, 5)}
                        </Typography>
                      </Box>

                      {/* Status */}
                      <Chip
                        label={cfg.label}
                        size="small"
                        sx={{
                          bgcolor: `${cfg.color}20`,
                          color: cfg.color,
                          border: `1px solid ${cfg.color}40`,
                          fontWeight: 700,
                          fontSize: '0.6rem',
                          height: 20,
                        }}
                      />
                    </Paper>
                  )
                })}
              </Stack>
            )}
          </Box>

          {/* Onay Bekleyen İzinler */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" fontWeight={700}>Onay Bekleyenler</Typography>
                {pendingLeaves.length > 0 && (
                  <Chip
                    label={pendingLeaves.length}
                    size="small"
                    sx={{ height: 18, fontSize: '0.6rem', bgcolor: '#f59e0b20', color: '#f59e0b', border: '1px solid #f59e0b40' }}
                  />
                )}
              </Box>
              <Button
                size="small"
                variant="text"
                onClick={() => router.push('/leave')}
                sx={{ fontSize: '0.75rem', color: 'primary.main' }}
              >
                Tümü →
              </Button>
            </Box>

            {pendingLeaves.length === 0 ? (
              <Alert severity="success" sx={{ fontSize: '0.8rem' }}>
                Onay bekleyen talep yok ✓
              </Alert>
            ) : (
              <Stack spacing={1}>
                {pendingLeaves.map((leave) => {
                  const emp = leave.employees as { full_name: string; role: string } | null
                  return (
                    <Paper
                      key={leave.id}
                      elevation={0}
                      sx={{
                        p: 1.5,
                        border: '1px solid rgba(245,158,11,0.25)',
                        borderRadius: 2,
                        bgcolor: 'rgba(245,158,11,0.04)',
                        cursor: 'pointer',
                        '&:hover': { borderColor: 'rgba(245,158,11,0.5)' },
                        transition: 'border-color 0.15s',
                      }}
                      onClick={() => router.push('/leave')}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" fontWeight={700}>{emp?.full_name ?? '—'}</Typography>
                        <Chip
                          label={LEAVE_TYPE_LABELS[leave.leave_type as keyof typeof LEAVE_TYPE_LABELS] ?? leave.leave_type}
                          size="small"
                          sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {leave.start_date} – {leave.end_date}
                      </Typography>
                    </Paper>
                  )
                })}
              </Stack>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}
