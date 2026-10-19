'use client'

import useSWR from 'swr'
import { useLastUpdated } from '@/hooks/useLastUpdated'
import {
  Box,
  Typography,
  Paper,
  Stack,
  Chip,
  CircularProgress,
  Skeleton,
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
import { formatDateTurkish, formatDayNameTurkish, formatDateRangeTr } from '@/lib/dateUtils'
import { LEAVE_TYPE_LABELS } from '@/types/leave'
import { PageHeader, StatCardsSkeleton, ListSkeleton } from '@/components/common'
import { C, tint } from '@/lib/palette'

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
  shift_waiting: { label: 'Bekleniyor', color: C.inkMuted, icon: null },
  working: { label: 'Çalışıyor', color: C.success, icon: <LoginIcon sx={{ fontSize: 14 }} /> },
  on_break: { label: 'Molada', color: C.warning, icon: <FreeBreakfastIcon sx={{ fontSize: 14 }} /> },
  working_after_break: { label: 'Çalışıyor', color: C.success, icon: <LoginIcon sx={{ fontSize: 14 }} /> },
  clocked_out: { label: 'Çıkış Yaptı', color: C.plum, icon: <LogoutIcon sx={{ fontSize: 14 }} /> },
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

  const { data, error: loadError, isValidating: loading, mutate } = useSWR<DashboardData>('/api/dashboard')
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Yükleme hatası.') : null
  const load = () => mutate()
  // SWR yanıt zamanını tutmaz; veri her değiştiğinde "son güncelleme" anını al
  const lastRefreshed = useLastUpdated(data)

  const stats = data?.stats
  const roster = data?.today_roster ?? []
  const pendingLeaves = data?.pending_leaves ?? []

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>
      <PageHeader
        icon={DashboardIcon}
        overline={formatDayNameTurkish(today)}
        title="Genel Bakış"
        subtitle={formatDateTurkish(today)}
        meta={lastRefreshed && `Son güncelleme: ${lastRefreshed.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`}
        actions={
          <Button
            size="small"
            variant="outlined"
            startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => void load()}
            disabled={loading}
            sx={{ fontSize: '0.75rem' }}
          >
            Yenile
          </Button>
        }
      />

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
      {loading && !data && <StatCardsSkeleton count={5} />}
      {stats && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 3 }}>
          <StatCard
            label="Aktif Çalışan"
            value={stats.active_employees}
            color={C.inkMuted}
            icon={<PeopleIcon sx={{ fontSize: 16 }} />}
            onClick={() => router.push('/employees')}
          />
          <StatCard
            label="Bugün Vardiyalı"
            value={stats.today_shifts}
            color={C.info}
            icon={<LoginIcon sx={{ fontSize: 16 }} />}
            onClick={() => router.push('/')}
          />
          <StatCard
            label="Çalışıyor"
            value={stats.currently_working}
            color={C.success}
            icon={<LoginIcon sx={{ fontSize: 16 }} />}
          />
          <StatCard
            label="Molada"
            value={stats.on_break}
            color={C.warning}
            icon={<FreeBreakfastIcon sx={{ fontSize: 16 }} />}
          />
          <StatCard
            label="Çıkış Yaptı"
            value={stats.clocked_out}
            color={C.plum}
            icon={<LogoutIcon sx={{ fontSize: 16 }} />}
          />
          {stats.pending_leaves > 0 && (
            <StatCard
              label="İzin Bekliyor"
              value={stats.pending_leaves}
              color={C.warning}
              icon={<BeachAccessIcon sx={{ fontSize: 16 }} />}
              onClick={() => router.push('/leave')}
            />
          )}
        </Box>
      )}

      <Divider sx={{ mb: 3, borderColor: tint(C.ink, 0.08) }} />

      {loading && !data && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 380px' }, gap: 3 }}>
          <Box>
            <Skeleton variant="text" width={130} sx={{ fontSize: '1rem', mb: 2 }} />
            <ListSkeleton count={5} actions={1} dense />
          </Box>
          <Box>
            <Skeleton variant="text" width={150} sx={{ fontSize: '1rem', mb: 2 }} />
            <ListSkeleton count={3} avatar={false} actions={1} dense />
          </Box>
        </Box>
      )}

      {/* Two column layout: Bugünkü kadro + Onay bekleyenler */}
      {data && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 380px' }, gap: 3 }}>

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
                        <Typography variant="caption" fontWeight={700} noWrap display="block">{entry.full_name}</Typography>
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
                    sx={{ height: 18, fontSize: '0.6rem', bgcolor: '#f59e0b20', color: C.warning, border: '1px solid #f59e0b40' }}
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
                        border: `1px solid ${tint(C.warning, 0.25)}`,
                        borderRadius: 2,
                        bgcolor: tint(C.warning, 0.04),
                        cursor: 'pointer',
                        '&:hover': { borderColor: tint(C.warning, 0.5) },
                        transition: 'border-color 0.15s',
                      }}
                      onClick={() => router.push('/leave')}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" fontWeight={700}>{emp?.full_name ?? '—'}</Typography>
                        <Chip
                          label={LEAVE_TYPE_LABELS[leave.leave_type as keyof typeof LEAVE_TYPE_LABELS] ?? leave.leave_type}
                          size="small"
                          sx={{ height: 18, fontSize: '0.6rem', bgcolor: tint(C.plum, 0.12), color: C.plum, border: `1px solid ${tint(C.plum, 0.3)}` }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateRangeTr(leave.start_date, leave.end_date)}
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
