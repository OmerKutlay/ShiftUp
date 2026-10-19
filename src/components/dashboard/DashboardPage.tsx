'use client'

import useSWR from 'swr'
import { useLastUpdated } from '@/hooks/useLastUpdated'
import {
  Box,
  Typography,
  CircularProgress,
  Skeleton,
  Alert,
  Button,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { formatDateTurkish, formatDayNameTurkish, formatDateRangeTr } from '@/lib/dateUtils'
import { LEAVE_TYPE_LABELS } from '@/types/leave'
import {
  PageHeader, StatCardsSkeleton, ListSkeleton, PersonAvatar, SectionCard, SectionRow, EmptyRow,
  StatCard, StatGrid, StatusBadge, type BadgeTone,
} from '@/components/common'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { useAuth } from '@/context/AuthContext'
import { C, SHIFT_KIND_TONES } from '@/lib/palette'

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

const ATTENDANCE_STATUS_CONFIG: Record<string, { label: string; tone: BadgeTone }> = {
  shift_waiting: { label: 'Bekleniyor', tone: 'neutral' },
  working: { label: 'Çalışıyor', tone: 'success' },
  on_break: { label: 'Molada', tone: 'warning' },
  working_after_break: { label: 'Çalışıyor', tone: 'success' },
  clocked_out: { label: 'Çıkış yaptı', tone: 'plum' },
}

// ─── Main Page ────────────────────────────────────────────────

export function DashboardPage() {
  const today = new Date()
  const { employee } = useAuth()

  const { data, error: loadError, isValidating: loading, mutate } = useSWR<DashboardData>('/api/dashboard')
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Yükleme hatası.') : null
  const load = () => mutate()
  // SWR yanıt zamanını tutmaz; veri her değiştiğinde "son güncelleme" anını al
  const lastRefreshed = useLastUpdated(data)

  const stats = data?.stats
  const roster = data?.today_roster ?? []
  const pendingLeaves = data?.pending_leaves ?? []
  const hour = today.getHours()
  const firstName = employee?.full_name.split(/\s+/)[0]
  const greeting = `${hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'}${firstName ? `, ${firstName}` : ''}`

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: 'text.primary' }}>
      <PageHeader
        overline={greeting}
        title="Genel bakış"
        subtitle={`${formatDayNameTurkish(today)}, ${formatDateTurkish(today)}`}
        meta={lastRefreshed && `Son güncelleme: ${lastRefreshed.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`}
        actions={
          <Button
            variant="outlined"
            color="inherit"
            startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => void load()}
            disabled={loading}
            sx={{ minHeight: 40, borderColor: 'divider', bgcolor: 'background.paper' }}
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
        <StatGrid min={140}>
          <StatCard label="Bugün vardiyalı" value={stats.today_shifts} note={`${stats.active_employees} aktif çalışan`} href="/" />
          <StatCard label="Şu an çalışıyor" value={stats.currently_working} valueColor={C.success} />
          <StatCard label="Molada" value={stats.on_break} valueColor={stats.on_break ? C.warning : undefined} />
          <StatCard label="Çıkış yaptı" value={stats.clocked_out} />
          <StatCard
            label="Gelmedi"
            value={stats.no_show}
            valueColor={stats.no_show ? C.danger : undefined}
            note={stats.no_show ? 'günlük operasyondan takip edin' : 'herkes zamanında'}
          />
          <StatCard
            label="İzin bekliyor"
            value={stats.pending_leaves}
            valueColor={stats.pending_leaves ? C.warning : undefined}
            note={stats.pending_leaves ? 'onayınızı bekliyor' : 'bekleyen talep yok'}
            href="/leave"
          />
        </StatGrid>
      )}

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

      {/* İki sütun: bugünkü kadro + onay bekleyenler */}
      {data && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 380px' }, gap: 2, alignItems: 'start' }}>
          <SectionCard title="Bugünkü kadro" count={roster.length} action={{ label: 'Günlük operasyon →', href: '/' }}>
            {roster.length === 0 ? (
              <EmptyRow>Bugün için planlanmış vardiya yok.</EmptyRow>
            ) : (
              roster.map((entry) => {
                const cfg = ATTENDANCE_STATUS_CONFIG[entry.attendance_status] ?? ATTENDANCE_STATUS_CONFIG.shift_waiting
                const tone = SHIFT_KIND_TONES[shiftKindOf(undefined, entry.start_time, entry.end_time)]
                return (
                  <SectionRow key={entry.employee_id + entry.start_time}>
                    <PersonAvatar name={entry.full_name} size={34} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontSize="0.85rem" fontWeight={700} noWrap>{entry.full_name}</Typography>
                      <Typography fontSize="0.72rem" color="text.secondary" noWrap>{entry.role}</Typography>
                    </Box>
                    <Typography
                      fontSize="0.78rem" fontWeight={700}
                      sx={{ color: tone.text, bgcolor: tone.soft, px: 1, py: 0.5, borderRadius: '8px', fontVariantNumeric: 'tabular-nums', display: { xs: 'none', sm: 'block' } }}
                    >
                      {entry.start_time.slice(0, 5)} – {entry.end_time.slice(0, 5)}
                    </Typography>
                    <StatusBadge tone={cfg.tone} label={cfg.label} className="min-w-[82px]" />
                  </SectionRow>
                )
              })
            )}
          </SectionCard>

          <SectionCard title="Onay bekleyenler" count={pendingLeaves.length} action={{ label: 'Tümü →', href: '/leave' }}>
            {pendingLeaves.length === 0 ? (
              <EmptyRow>Onay bekleyen talep yok.</EmptyRow>
            ) : (
              pendingLeaves.map((leave) => {
                const emp = leave.employees as { full_name: string; role: string } | null
                return (
                  <SectionRow key={leave.id} href="/leave">
                    <PersonAvatar name={emp?.full_name ?? '?'} size={34} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontSize="0.85rem" fontWeight={700} noWrap>{emp?.full_name ?? '—'}</Typography>
                      <Typography fontSize="0.72rem" color="text.secondary" noWrap>
                        {formatDateRangeTr(leave.start_date, leave.end_date)}
                      </Typography>
                    </Box>
                    <StatusBadge
                      tone="warning"
                      label={LEAVE_TYPE_LABELS[leave.leave_type as keyof typeof LEAVE_TYPE_LABELS] ?? leave.leave_type}
                    />
                  </SectionRow>
                )
              })
            )}
          </SectionCard>
        </Box>
      )}
    </Box>
  )
}
