'use client'

/**
 * MySchedulePage — Kişisel Çalışma Özeti
 *
 * Giriş yapmış çalışanın seçili aydaki:
 *   - Toplam planlanan vardiya saati
 *   - Toplam gerçekleşen çalışma saati (mola hariç, attendance_records'dan)
 *   - Toplam mola süresi
 *   - Çalışma günü sayısı
 *   - Devamsızlık sayısı (shift_waiting)
 *   - Takvim görünümü (her günün kartı)
 *
 * Çalışan bu ekrandan maaş hesabı yapabilmek için saatlerini görebilir.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box, Typography, Paper, Alert,
  Chip, Divider, Stack, IconButton, Tooltip, LinearProgress,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast'
import TodayIcon from '@mui/icons-material/Today'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import { format, startOfMonth, endOfMonth, addMonths, subMonths, getDaysInMonth, parseISO } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useAuth } from '@/context/AuthContext'
import { PageHeader, PageSkeleton, StatCardsSkeleton, DayBlocksSkeleton } from '@/components/common'
import { shiftDurationMins } from '@/lib/workingTimeService'
import { useLoadedKey } from '@/hooks/useLoadedKey'

// ─── Types ────────────────────────────────────────────────────

interface DayEntry {
  work_date: string
  start_time: string
  end_time: string
  shift_name: string | null
  status: string
  clock_in_at: string | null
  clock_out_at: string | null
  break_start_at: string | null
  break_end_at: string | null
  worked_minutes: number | null
  break_minutes: number | null
  is_on_leave: boolean
  is_manual_correction?: boolean
}

// ─── Yardımcılar ──────────────────────────────────────────────

function fmtMins(mins: number | null): string {
  if (mins === null || mins === 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (m === 0) return `${h}s`
  return `${h}s ${m}dk`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch { return '—' }
}

function diffMins(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const d = (new Date(to).getTime() - new Date(from).getTime()) / 60000
  return Math.max(0, Math.round(d))
}

const STATUS_LABELS: Record<string, string> = {
  clocked_out: 'Tamamlandı',
  working: 'Devam Ediyor',
  on_break: 'Molada',
  working_after_break: 'Devam Ediyor',
  shift_waiting: 'Gelmedi',
}
const STATUS_COLORS: Record<string, string> = {
  clocked_out: '#10b981',
  working: '#14b8a6',
  on_break: '#f59e0b',
  working_after_break: '#14b8a6',
  shift_waiting: '#ef4444',
}

// ─── Stat kartı ───────────────────────────────────────────────

function StatCard({ label, value, sub, color }: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <Paper elevation={0} sx={{
      p: 2, flex: 1, minWidth: 110,
      border: '1px solid', borderColor: 'divider',
      borderRadius: 2, bgcolor: 'rgba(30,41,59,0.5)',
    }}>
      <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>{label}</Typography>
      <Typography variant="h6" fontWeight={800} color={color ?? 'text.primary'}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  )
}

// ─── Gün kartı ────────────────────────────────────────────────

function DayCard({ entry, isToday }: { entry: DayEntry; isToday: boolean }) {
  const statusColor = STATUS_COLORS[entry.status] ?? '#94a3b8'
  const plannedMins = shiftDurationMins(entry.start_time, entry.end_time)
  const workedMins = entry.worked_minutes ?? 0

  return (
    <Paper elevation={0} sx={{
      p: 1.5,
      border: '1px solid',
      borderColor: isToday ? 'primary.main' : 'divider',
      borderRadius: 2,
      bgcolor: isToday ? 'rgba(20,184,166,0.06)' : 'rgba(30,41,59,0.4)',
    }}>
      {/* Tarih + durum */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Typography variant="caption" fontWeight={700} color={isToday ? 'primary.main' : 'text.primary'}>
            {format(parseISO(entry.work_date), 'd MMMM', { locale: tr })}
          </Typography>
          <Typography variant="caption" color="text.disabled" display="block" fontSize="0.65rem">
            {format(parseISO(entry.work_date), 'EEEE', { locale: tr })}
          </Typography>
        </Box>
        {entry.is_on_leave ? (
          <Chip label="İzin" size="small" sx={{
            height: 18, fontSize: '0.62rem',
            bgcolor: 'rgba(251,191,36,0.15)', color: '#fbbf24',
          }} />
        ) : (
          <Chip
            label={STATUS_LABELS[entry.status] ?? entry.status}
            size="small"
            sx={{
              height: 18, fontSize: '0.62rem',
              bgcolor: `${statusColor}20`, color: statusColor,
              border: '1px solid', borderColor: `${statusColor}40`,
            }}
          />
        )}
      </Box>

      {/* Planlanan saat */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <AccessTimeIcon sx={{ fontSize: 11, color: 'text.disabled' }} />
        <Typography variant="caption" color="text.secondary" fontSize="0.68rem">
          Plan: {entry.start_time.slice(0, 5)} – {entry.end_time.slice(0, 5)}
          {' '}({fmtMins(plannedMins)})
        </Typography>
      </Box>

      {/* Gerçekleşen — sadece clocked_out */}
      {entry.status === 'clocked_out' && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <CheckCircleIcon sx={{ fontSize: 11, color: '#10b981' }} />
            <Typography variant="caption" color="text.secondary" fontSize="0.68rem">
              Giriş: {fmtTime(entry.clock_in_at)} → Çıkış: {fmtTime(entry.clock_out_at)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={`Çalışma: ${fmtMins(entry.worked_minutes)}`}
              size="small"
              sx={{
                height: 16, fontSize: '0.62rem',
                bgcolor: 'rgba(16,185,129,0.12)', color: '#10b981',
              }}
            />
            {(entry.break_minutes ?? 0) > 0 && (
              <Chip
                label={`Mola: ${fmtMins(entry.break_minutes)}`}
                size="small"
                sx={{
                  height: 16, fontSize: '0.62rem',
                  bgcolor: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                }}
              />
            )}
          </Box>

          {/* Gerçekleşen / Planlanan progress */}
          {plannedMins > 0 && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, (workedMins / plannedMins) * 100)}
                sx={{
                  height: 3, borderRadius: 2,
                  bgcolor: 'rgba(255,255,255,0.06)',
                  '& .MuiLinearProgress-bar': { bgcolor: '#10b981', borderRadius: 2 },
                }}
              />
            </Box>
          )}
        </>
      )}

      {/* Gelmedi */}
      {entry.status === 'shift_waiting' && !entry.is_on_leave && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
          <CancelIcon sx={{ fontSize: 11, color: '#ef4444' }} />
          <Typography variant="caption" color="error.main" fontSize="0.68rem">
            Kayıt oluşturulmadı
          </Typography>
        </Box>
      )}
    </Paper>
  )
}

// ─── Ana Bileşen ──────────────────────────────────────────────

export function MySchedulePage() {
  const { employee, status: authStatus } = useAuth()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [entries, setEntries] = useState<DayEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd')
  const monthLabel = format(currentMonth, 'MMMM yyyy', { locale: tr })
  // Skeleton yalnızca bu ay ilk kez yüklenirken; sayfaya geri dönüşte veri ekranda kalır
  const monthKey = `${employee?.id ?? ''}:${monthStart}`
  const { isFirstLoad, markLoaded } = useLoadedKey(monthKey)

  // ── Veri çek ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!employee) return
    setError(null)
    try {
      // shift_assignments + attendance_records join için rapor endpoint'ini kullan
      const params = new URLSearchParams({
        employee_id: employee.id,
        date_from: monthStart,
        date_to: monthEnd,
      })
      const res = await fetch(`/api/reports/my?${params.toString()}`, {
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        setError(d.error ?? 'Veriler yüklenemedi.')
        return
      }
      const data = (await res.json()) as { rows: DayEntry[] }
      setEntries(data.rows ?? [])
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      markLoaded(monthKey)
    }
  }, [employee, monthStart, monthEnd, monthKey, markLoaded])

  useEffect(() => {
    if (authStatus === 'authenticated' && employee) {
      void load()
    }
  }, [authStatus, employee, load])

  // ── Özet hesapla ─────────────────────────────────────────────
  const summary = useMemo(() => {
    let plannedMins = 0
    let workedMins = 0
    let breakMins = 0
    let workedDays = 0
    let noShowDays = 0
    let leaveDays = 0

    for (const e of entries) {
      if (e.is_on_leave) { leaveDays++; continue }
      plannedMins += shiftDurationMins(e.start_time, e.end_time)
      if (e.status === 'clocked_out') {
        workedMins += e.worked_minutes ?? 0
        breakMins += e.break_minutes ?? 0
        workedDays++
      } else if (e.status === 'shift_waiting') {
        noShowDays++
      }
    }

    return { plannedMins, workedMins, breakMins, workedDays, noShowDays, leaveDays }
  }, [entries])

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const daysInMonth = getDaysInMonth(currentMonth)

  // ─── Auth guard ───────────────────────────────────────────────
  if (authStatus === 'loading') {
    return <PageSkeleton stats={4} rows={6} maxWidth={900} />
  }
  if (authStatus === 'unauthenticated' || !employee) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Bu sayfayı görmek için giriş yapmanız gerekiyor.</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>

      <PageHeader
        icon={CalendarMonthIcon}
        overline="Kişisel"
        title="Çalışma Özetim"
        subtitle={`${employee.full_name} · ${employee.role}`}
      />

      {/* Ay navigasyonu */}
      <Paper elevation={0} sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 2, py: 1.25, mb: 3,
        border: '1px solid', borderColor: 'divider', borderRadius: 2,
        bgcolor: 'rgba(30,41,59,0.5)',
      }}>
        <Tooltip title="Önceki ay">
          <IconButton size="small" onClick={() => setCurrentMonth((m) => subMonths(m, 1))}>
            <ChevronLeftIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TodayIcon sx={{ fontSize: 16, color: 'primary.main' }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ textTransform: 'capitalize' }}>
            {monthLabel}
          </Typography>
        </Box>
        <Tooltip title="Sonraki ay">
          <IconButton
            size="small"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            disabled={addMonths(currentMonth, 1) > new Date()}
          >
            <ChevronRightIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      {/* Özet stat kartları */}
      {isFirstLoad ? <StatCardsSkeleton count={4} /> : (
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
        <StatCard
          label="Planlanan Saat"
          value={fmtMins(summary.plannedMins)}
          sub={`${entries.filter(e => !e.is_on_leave).length} vardiya`}
          color="primary.main"
        />
        <StatCard
          label="Çalışılan Saat"
          value={fmtMins(summary.workedMins)}
          sub={`${summary.workedDays} gün tamamlandı`}
          color="#10b981"
        />
        <StatCard
          label="Mola Süresi"
          value={fmtMins(summary.breakMins)}
          color="#f59e0b"
        />
        <StatCard
          label="Devamsızlık"
          value={String(summary.noShowDays)}
          sub="gün"
          color={summary.noShowDays > 0 ? '#ef4444' : 'text.secondary'}
        />
        {summary.leaveDays > 0 && (
          <StatCard
            label="İzin Günü"
            value={String(summary.leaveDays)}
            sub="gün"
            color="#fbbf24"
          />
        )}
      </Stack>
      )}

      {/* Planlanan vs gerçekleşen progress */}
      {!isFirstLoad && summary.plannedMins > 0 && (
        <Paper elevation={0} sx={{
          p: 2, mb: 3,
          border: '1px solid', borderColor: 'divider', borderRadius: 2,
          bgcolor: 'rgba(30,41,59,0.5)',
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <AccessTimeIcon sx={{ fontSize: 14, color: 'primary.main' }} />
              <Typography variant="caption" fontWeight={600}>Aylık Tamamlanma</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {fmtMins(summary.workedMins)} / {fmtMins(summary.plannedMins)}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, (summary.workedMins / summary.plannedMins) * 100)}
            sx={{
              height: 6, borderRadius: 3,
              bgcolor: 'rgba(255,255,255,0.06)',
              '& .MuiLinearProgress-bar': { bgcolor: '#10b981', borderRadius: 3 },
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75 }}>
            <Typography variant="caption" color="text.disabled" fontSize="0.65rem">
              {Math.round((summary.workedMins / summary.plannedMins) * 100)}% tamamlandı
            </Typography>
            <Typography variant="caption" color="text.disabled" fontSize="0.65rem">
              {daysInMonth} günlük ay
            </Typography>
          </Box>
        </Paper>
      )}

      <Divider sx={{ mb: 2.5, borderColor: 'rgba(255,255,255,0.08)' }} />

      {/* Günlük liste */}
      {isFirstLoad ? (
        <DayBlocksSkeleton count={7} />
      ) : error ? (
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      ) : entries.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <EventBusyIcon sx={{ fontSize: 48, color: 'text.disabled', opacity: 0.4, mb: 1 }} />
          <Typography variant="body2" color="text.secondary">
            Bu ay için vardiya kaydı bulunmuyor.
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <FreeBreakfastIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
            <Typography variant="caption" color="text.disabled">
              {entries.length} vardiya — tıklayarak detay göremezsiniz, bu sadece özet görünümdür
            </Typography>
          </Box>
          <Stack spacing={1}>
            {entries.map((entry) => (
              <DayCard
                key={entry.work_date}
                entry={entry}
                isToday={entry.work_date === todayStr}
              />
            ))}
          </Stack>
        </>
      )}
    </Box>
  )
}
