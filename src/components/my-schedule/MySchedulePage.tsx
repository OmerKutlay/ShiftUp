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
 *
 * Çevrimdışı: son başarılı aylık yanıtlar (en fazla SNAPSHOT_MONTHS ay) çalışan id'siyle
 * localStorage'a yazılır; ağ yokken bunlardan, "son güncelleme" uyarısıyla salt-okunur gösterilir.
 */
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import {
  Box, Typography, Paper, Alert, Button,
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
import { apiFetch, ApiError } from '@/lib/api/http'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  getSnapshot, getSnapshotOwner, setSnapshot, formatSnapshotTime, SNAPSHOT_MAX_AGE_MS,
} from '@/lib/pwa/offlineSnapshot'
import { C, tint } from '@/lib/palette'

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

// ─── Çevrimdışı anlık görüntü ─────────────────────────────────

const SNAPSHOT_NAME = 'my-schedule'
/** Saklanan en fazla ay sayısı (en son görüntülenenler) */
const SNAPSHOT_MONTHS = 3

interface MyScheduleSnapshot {
  profile: { full_name: string; role: string }
  /** Her ay kendi kayıt zamanıyla tutulur (son güncelleme o aya aittir) */
  months: { month: string; savedAt: string; rows: DayEntry[] }[]
}

function readScheduleSnapshot(ownerId: string | null) {
  const snap = getSnapshot<MyScheduleSnapshot>(SNAPSHOT_NAME, ownerId)
  if (!snap || !Array.isArray(snap.data?.months)) return null
  // Süresi dolmuş aylar (SNAPSHOT_MAX_AGE_MS) gösterilmez
  const now = Date.now()
  const months = snap.data.months.filter((m) => now - Date.parse(m.savedAt) <= SNAPSHOT_MAX_AGE_MS)
  return { ...snap, data: { ...snap.data, months } }
}

/** Başarılı aylık yanıtı anlık görüntüye ekler (aynı ay varsa değiştirir, en yeni başta) */
function saveScheduleSnapshot(
  ownerId: string,
  profile: MyScheduleSnapshot['profile'],
  month: string,
  rows: DayEntry[],
) {
  const entry = { month, savedAt: new Date().toISOString(), rows }
  const prev = readScheduleSnapshot(ownerId)?.data.months ?? []
  const months = [entry, ...prev.filter((m) => m.month !== month)].slice(0, SNAPSHOT_MONTHS)
  // Boyut sınırı aşılırsa yalnızca bu ayı saklamayı dene
  if (!setSnapshot<MyScheduleSnapshot>(SNAPSHOT_NAME, ownerId, { profile, months })) {
    setSnapshot<MyScheduleSnapshot>(SNAPSHOT_NAME, ownerId, { profile, months: [entry] })
  }
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

const STATUS_LABELS: Record<string, string> = {
  clocked_out: 'Tamamlandı',
  working: 'Devam Ediyor',
  on_break: 'Molada',
  working_after_break: 'Devam Ediyor',
  absent: 'Gelmedi',
  upcoming: 'Bekleniyor',
  planned: 'Planlandı',
}
const STATUS_COLORS: Record<string, string> = {
  clocked_out: C.success,
  working: C.brand,
  on_break: C.warning,
  working_after_break: C.brand,
  absent: C.danger,
  upcoming: C.inkMuted,
  planned: C.neutral,
}

/**
 * Kayıt yoksa (shift_waiting) vardiyanın zamanına göre anlamlı durum: ileri tarihli vardiya
 * "Planlandı", bugün bitiş saati geçmemişse "Bekleniyor", ancak vardiya geçmişte kaldıysa "Gelmedi".
 */
function displayStatus(entry: DayEntry, now: Date): string {
  if (entry.status !== 'shift_waiting') return entry.status
  const todayStr = format(now, 'yyyy-MM-dd')
  if (entry.work_date > todayStr) return 'planned'
  if (entry.work_date === todayStr) {
    const nowHm = format(now, 'HH:mm')
    const end = entry.end_time.slice(0, 5)
    // Gece yarısını geçen vardiya (bitiş ≤ başlangıç) bugün içinde bitmez
    if (end <= entry.start_time.slice(0, 5) || nowHm < end) return 'upcoming'
  }
  return 'absent'
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
      borderRadius: 2, bgcolor: C.surface,
    }}>
      <Typography variant="caption" color="text.disabled" display="block" mb={0.5}>{label}</Typography>
      <Typography variant="h6" fontWeight={800} color={color ?? 'text.primary'}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  )
}

// ─── Gün kartı ────────────────────────────────────────────────

function DayCard({ entry, isToday }: { entry: DayEntry; isToday: boolean }) {
  const status = displayStatus(entry, new Date())
  const statusColor = STATUS_COLORS[status] ?? C.inkMuted
  const plannedMins = shiftDurationMins(entry.start_time, entry.end_time)
  const workedMins = entry.worked_minutes ?? 0

  return (
    <Paper elevation={0} sx={{
      p: 1.5,
      border: '1px solid',
      borderColor: isToday ? 'primary.main' : 'divider',
      borderRadius: 2,
      bgcolor: isToday ? tint(C.brand, 0.06) : C.surface,
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
            height: 20, fontSize: '0.7rem',
            bgcolor: tint(C.warning, 0.15), color: C.warning,
          }} />
        ) : (
          <Chip
            label={STATUS_LABELS[status] ?? status}
            size="small"
            sx={{
              height: 20, fontSize: '0.7rem',
              bgcolor: `${statusColor}20`, color: statusColor,
              border: '1px solid', borderColor: `${statusColor}40`,
            }}
          />
        )}
      </Box>

      {/* Planlanan saat */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <AccessTimeIcon sx={{ fontSize: 11, color: 'text.disabled' }} />
        <Typography variant="caption" color="text.secondary" fontSize="0.75rem">
          Plan: {entry.start_time.slice(0, 5)} – {entry.end_time.slice(0, 5)}
          {' '}({fmtMins(plannedMins)})
        </Typography>
      </Box>

      {/* Gerçekleşen — sadece clocked_out */}
      {entry.status === 'clocked_out' && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <CheckCircleIcon sx={{ fontSize: 11, color: C.success }} />
            <Typography variant="caption" color="text.secondary" fontSize="0.75rem">
              Giriş: {fmtTime(entry.clock_in_at)} → Çıkış: {fmtTime(entry.clock_out_at)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              label={`Çalışma: ${fmtMins(entry.worked_minutes)}`}
              size="small"
              sx={{
                height: 20, fontSize: '0.7rem',
                bgcolor: tint(C.success, 0.12), color: C.success,
              }}
            />
            {(entry.break_minutes ?? 0) > 0 && (
              <Chip
                label={`Mola: ${fmtMins(entry.break_minutes)}`}
                size="small"
                sx={{
                  height: 20, fontSize: '0.7rem',
                  bgcolor: tint(C.warning, 0.12), color: C.warning,
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
                  bgcolor: tint(C.ink, 0.06),
                  '& .MuiLinearProgress-bar': { bgcolor: C.success, borderRadius: 2 },
                }}
              />
            </Box>
          )}
        </>
      )}

      {/* Gelmedi */}
      {status === 'absent' && !entry.is_on_leave && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
          <CancelIcon sx={{ fontSize: 11, color: C.danger }} />
          <Typography variant="caption" color="error.main" fontSize="0.75rem">
            Kayıt oluşturulmadı
          </Typography>
        </Box>
      )}
    </Paper>
  )
}

// ─── Ana Bileşen ──────────────────────────────────────────────

export function MySchedulePage() {
  const { employee, status: authStatus, sessionCheck } = useAuth()
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd')
  const monthLabel = format(currentMonth, 'MMMM yyyy', { locale: tr })
  // ── Veri (SWR) — ay değişince eski ayın geç gelen yanıtı yenisinin üstüne yazamaz ──
  const reportKey = authStatus === 'authenticated' && employee
    ? `/api/reports/my?${new URLSearchParams({ date_from: monthStart, date_to: monthEnd })}`
    : null
  // Yanıt, ait olduğu URL ile birlikte tutulur: keepPreviousData önceki ayı döndürürken
  // çevrimdışı görünümde yanlış aya ait veri gösterilmesin
  const reportQ = useSWR(
    reportKey,
    async (url: string) => ({ url, ...(await apiFetch<{ rows: DayEntry[] }>(url)) }),
    {
      onSuccess: (data) => {
        if (!employee) return
        const month = new URL(data.url, 'http://x').searchParams.get('date_from')
        if (month) {
          saveScheduleSnapshot(employee.id, { full_name: employee.full_name, role: employee.role }, month, data.rows)
        }
      },
    },
  )

  // ── Çevrimdışı ───────────────────────────────────────────────
  // Ağ hatası (sunucuya ulaşılamadı) ya da navigator.onLine=false → anlık görüntüden göster.
  // Sunucunun döndürdüğü hata (ApiError) çevrimdışı sayılmaz; olduğu gibi gösterilir.
  const online = useOnlineStatus()
  // Çevrimdışı açılışta /api/auth/me'ye ulaşılamaz (oturum "yok" görünür) → cihazdaki sahibin
  // anlık görüntüsü kullanılır. Sahip çıkışta / başka kullanıcı girişinde silinir.
  // Oturum sunucuya ulaşılamadığı için bilinmiyorsa (ağ hatası / 5xx) da cihaz sahibinin
  // anlık görüntüsü gösterilir; sunucu oturumu kesin reddettiyse görüntüler zaten silinmiştir
  const offlineMode =
    authStatus === 'unauthenticated' && (!online || sessionCheck?.result === 'unreachable')
  const networkFailed =
    !online || offlineMode || (!!reportQ.error && !(reportQ.error instanceof ApiError))
  const ownerId = employee?.id ?? (offlineMode ? getSnapshotOwner() : null)
  const snapshot = useMemo(
    () => (networkFailed ? readScheduleSnapshot(ownerId) : null),
    [networkFailed, ownerId],
  )
  const snapshotMonth = snapshot?.data.months.find((m) => m.month === monthStart) ?? null
  const liveData = networkFailed && reportQ.data?.url !== reportKey ? undefined : reportQ.data

  const entries = useMemo(() => snapshotMonth?.rows ?? liveData?.rows ?? [], [snapshotMonth, liveData])
  const isFirstLoad = !snapshotMonth && !liveData && !reportQ.error && !networkFailed
  const error = snapshotMonth || liveData
    ? null
    : networkFailed
      ? 'Çevrimdışısınız — bu ay için kaydedilmiş veri yok. Bağlantı gelince yeniden yüklenir.'
      : reportQ.error ? (reportQ.error instanceof Error ? reportQ.error.message : 'Veriler yüklenemedi.') : null

  // ── Özet hesapla ─────────────────────────────────────────────
  const summary = useMemo(() => {
    const now = new Date()
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
      } else if (displayStatus(e, now) === 'absent') {
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
  const profile = employee ?? (offlineMode ? snapshot?.data.profile : null)
  if (!profile) {
    return (
      <Box sx={{ p: 3 }}>
        {offlineMode ? (
          <Alert severity="warning">Çevrimdışısınız — bu cihazda kayıtlı çalışma özeti bulunmuyor. Bağlantı gelince tekrar deneyin.</Alert>
        ) : (
          <Alert severity="warning">Bu sayfayı görmek için giriş yapmanız gerekiyor.</Alert>
        )}
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>

      <PageHeader
        icon={CalendarMonthIcon}
        overline="Kişisel"
        title="Çalışma Özetim"
        subtitle={`${profile.full_name} · ${profile.role}`}
      />

      {snapshotMonth && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Çevrimdışı — son güncelleme: {formatSnapshotTime(snapshotMonth.savedAt)}
        </Alert>
      )}

      {/* Ay navigasyonu */}
      <Paper elevation={0} sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 2, py: 1.25, mb: 3,
        border: '1px solid', borderColor: 'divider', borderRadius: 2,
        bgcolor: C.surface,
      }}>
        <Tooltip title="Önceki ay">
          <IconButton size="small" onClick={() => setCurrentMonth((m) => subMonths(m, 1))} aria-label="Önceki ay">
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
            aria-label="Sonraki ay"
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
          color={C.success}
        />
        <StatCard
          label="Mola Süresi"
          value={fmtMins(summary.breakMins)}
          color={C.warning}
        />
        <StatCard
          label="Devamsızlık"
          value={String(summary.noShowDays)}
          sub="gün"
          color={summary.noShowDays > 0 ? C.danger : 'text.secondary'}
        />
        {summary.leaveDays > 0 && (
          <StatCard
            label="İzin Günü"
            value={String(summary.leaveDays)}
            sub="gün"
            color={C.warning}
          />
        )}
      </Stack>
      )}

      {/* Planlanan vs gerçekleşen progress */}
      {!isFirstLoad && summary.plannedMins > 0 && (
        <Paper elevation={0} sx={{
          p: 2, mb: 3,
          border: '1px solid', borderColor: 'divider', borderRadius: 2,
          bgcolor: C.surface,
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
              bgcolor: tint(C.ink, 0.06),
              '& .MuiLinearProgress-bar': { bgcolor: C.success, borderRadius: 3 },
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

      <Divider sx={{ mb: 2.5, borderColor: tint(C.ink, 0.08) }} />

      {/* Günlük liste */}
      {isFirstLoad ? (
        <DayBlocksSkeleton count={7} />
      ) : error ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void reportQ.mutate()}>Tekrar Dene</Button>}>{error}</Alert>
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
