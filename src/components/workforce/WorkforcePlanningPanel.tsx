'use client'
/**
 * WorkforcePlanningPanel — Haftalık Vardiya Planlayıcı
 *
 * İki mod:
 *   1. "Mevcut Plan" sekmesi — DB'deki mevcut shift_assignments özeti (önceki davranış)
 *   2. "Taslak Oluştur" sekmesi — kural tabanlı engine ile draft plan + onay akışı
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, Chip, CircularProgress, Alert,
  IconButton, Tooltip, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Button, Tabs, Tab,
  Divider, Badge,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import TodayIcon from '@mui/icons-material/Today'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import WorkOutlineIcon from '@mui/icons-material/WorkOutline'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import RefreshIcon from '@mui/icons-material/Refresh'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { format, addWeeks, subWeeks, startOfWeek } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWeekSummary, DaySummary, WorkingTimeViolation } from '@/lib/workingTimeService'
import { shiftDurationMins, netWorkMins } from '@/lib/workingTimeService'
import type { OpenShift } from '@/types/workforce'
import type { PlannerResult, DraftAssignment, EmployeeDraftStats, PlanWarning } from '@/lib/workforcePlanner'
import { PART_TIME_RULES } from '@/types/employee'
import { ScheduleGridSkeleton } from '@/components/common'
import { useLoadedKey } from '@/hooks/useLoadedKey'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanningResponse {
  weekStart: string
  weekEnd: string
  weekDays: string[]
  config: { minRestHours: number; maxDailyWorkHours: number; maxWeeklyWorkHours: number }
  summaries: EmployeeWeekSummary[]
  openShiftsThisWeek: OpenShift[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
  return `${days[d.getDay()]} ${d.getDate()}`
}

function formatMins(mins: number): string {
  if (mins === 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}s` : `${h}s${m}dk`
}

/** Vardiyanın mola hakkı (brüt − net) */
function breakMinsOf(start: string, end: string): number {
  return shiftDurationMins(start, end) - netWorkMins(start, end)
}

/** "7s net · 1s mola" satırı */
function NetBreakLine({ netMins, breakMins, color }: { netMins: number; breakMins: number; color: string }) {
  return (
    <Typography variant="caption" sx={{ display: 'block', fontSize: '0.6rem', whiteSpace: 'nowrap' }}>
      <Box component="span" sx={{ color, fontWeight: 700 }}>{formatMins(netMins)} net</Box>
      <Box component="span" sx={{ color: '#94a3b8' }}> · {formatMins(breakMins)} mola</Box>
    </Typography>
  )
}

const SHIFT_KIND_COLORS: Record<string, string> = {
  opening: '#14b8a6',
  closing: '#f97316',
  full:    '#a855f7',
  mid:     '#3b82f6',
  custom:  '#64748b',
}

const SHIFT_KIND_LABELS: Record<string, string> = {
  opening: 'Açılış',
  closing: 'Kapanış',
  full:    'Full',
  mid:     'Ortacı',
  custom:  'Özel',
}

// ─── Mevcut plan hücre ────────────────────────────────────────────────────────

function DayCellContent({ day }: { day: DaySummary }) {
  if (day.isLeave) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
        <EventBusyIcon sx={{ fontSize: 14, color: '#94a3b8' }} />
        <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.65rem' }}>İzinli</Typography>
      </Box>
    )
  }
  if (day.shifts.length === 0)
    return <Typography variant="caption" sx={{ color: '#475569', fontSize: '0.7rem' }}>—</Typography>

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {day.shifts.map((s, i) => (
        <Typography key={i} variant="caption"
          sx={{ fontSize: '0.7rem', color: '#e2e8f0', whiteSpace: 'nowrap' }}>
          {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
        </Typography>
      ))}
      {day.totalMins > 0 && (
        <NetBreakLine
          netMins={day.totalMins}
          breakMins={day.shifts.reduce((s, x) => s + breakMinsOf(x.start_time, x.end_time), 0)}
          color="#14b8a6"
        />
      )}
    </Box>
  )
}

function ViolationBadge({ violations }: { violations: WorkingTimeViolation[] }) {
  if (violations.length === 0) return null
  const worst = violations.find((v) => v.severity === 'error')
  const color = worst ? '#ef4444' : '#eab308'
  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line', fontSize: '0.75rem' }}>
      {violations.map((v) => v.message).join('\n')}
    </Box>} arrow>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'default' }}>
        <WarningAmberIcon sx={{ fontSize: 14, color }} />
        <Typography variant="caption" sx={{ color, fontSize: '0.7rem' }}>{violations.length}</Typography>
      </Box>
    </Tooltip>
  )
}

// ─── Draft plan hücre ─────────────────────────────────────────────────────────

function DraftCell({ assign }: { assign: DraftAssignment | undefined }) {
  if (!assign) return <Typography variant="caption" sx={{ color: '#475569', fontSize: '0.7rem' }}>—</Typography>

  const color = SHIFT_KIND_COLORS[assign.shift_kind] ?? '#64748b'
  const label = SHIFT_KIND_LABELS[assign.shift_kind] ?? assign.shift_kind
  const grossMins = shiftDurationMins(assign.start_time, assign.end_time)
  const netMins   = netWorkMins(assign.start_time, assign.end_time)

  return (
    <Tooltip title={
      <Box sx={{ fontSize: '0.72rem' }}>
        <Box>{assign.start_time}–{assign.end_time}</Box>
        <Box>Brüt {formatMins(grossMins)} · Mola {formatMins(grossMins - netMins)} · Net {formatMins(netMins)}</Box>
        <Box sx={{ color: '#94a3b8', mt: 0.25 }}>{assign.reason}</Box>
      </Box>
    } arrow placement="top">
      <Box sx={{ cursor: 'default' }}>
        <Box sx={{ display: 'inline-block', px: 0.75, py: 0.15, borderRadius: 0.75,
          bgcolor: `${color}20`, border: `1px solid ${color}40` }}>
          <Typography variant="caption" sx={{ fontSize: '0.68rem', color, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {label}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.62rem', color: '#94a3b8', mt: 0.15, whiteSpace: 'nowrap' }}>
          {assign.start_time}–{assign.end_time}
        </Typography>
        <NetBreakLine netMins={netMins} breakMins={grossMins - netMins} color={color} />
      </Box>
    </Tooltip>
  )
}

// ─── Plan uyarı listesi ───────────────────────────────────────────────────────

function WarningList({ warnings }: { warnings: PlanWarning[] }) {
  if (warnings.length === 0) return null
  const errors  = warnings.filter((w) => w.level === 'error')
  const infos   = warnings.filter((w) => w.level !== 'error')
  return (
    <Stack spacing={0.75} sx={{ mt: 1.5 }}>
      {errors.map((w, i) => (
        <Alert key={i} severity="error" icon={<WarningAmberIcon fontSize="small" />}
          sx={{ py: 0.25, fontSize: '0.75rem', '& .MuiAlert-message': { py: 0.5 } }}>
          {w.message}
        </Alert>
      ))}
      {infos.map((w, i) => (
        <Alert key={i} severity={w.level === 'warning' ? 'warning' : 'info'}
          icon={<InfoOutlinedIcon fontSize="small" />}
          sx={{ py: 0.25, fontSize: '0.75rem', '& .MuiAlert-message': { py: 0.5 } }}>
          {w.message}
        </Alert>
      ))}
    </Stack>
  )
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export function WorkforcePlanningPanel() {
  const [weekRef, setWeekRef] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [activeTab, setActiveTab] = useState(0)
  // Skeleton yalnızca bu hafta ilk kez yüklenirken; sayfaya geri dönüşte plan ekranda kalır
  const weekKey = format(weekRef, 'yyyy-MM-dd')
  const { isFirstLoad, markLoaded } = useLoadedKey(weekKey)

  // Mevcut plan state
  const [planData, setPlanData]   = useState<PlanningResponse | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)

  // Draft state
  const [draft, setDraft]         = useState<PlannerResult | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError]   = useState<string | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyResult, setApplyResult] = useState<{ created: number; replaced: number; skipped: number; restDays?: number; errors: string[] } | null>(null)

  // ── Mevcut plan yükle ──────────────────────────────────────────────────────
  const loadCurrentPlan = useCallback(async (date: Date) => {
    setPlanError(null)
    const week = format(date, 'yyyy-MM-dd')
    try {
      const res  = await fetch(`/api/workforce/planning?week=${week}`, { credentials: 'same-origin' })
      if (res.status === 403 || res.status === 401) { setPlanError('Erişim yetkiniz yok.'); return }
      if (!res.ok) { const j = await res.json() as { error?: string }; setPlanError(j.error ?? 'Yükleme hatası.'); return }
      setPlanData(await res.json() as PlanningResponse)
    } catch { setPlanError('Bağlantı hatası.') }
    finally  { markLoaded(week) }
  }, [markLoaded])

  useEffect(() => { void loadCurrentPlan(weekRef) }, [loadCurrentPlan, weekRef])


  // ── Taslak üret ───────────────────────────────────────────────────────────
  const generate = async () => {
    // Önceki taslak ve sonuçları temizle
    setDraft(null)
    setGenError(null)
    setApplyResult(null)
    setGenLoading(true)
    try {
      const res = await fetch('/api/workforce/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ week: format(weekRef, 'yyyy-MM-dd') }),
      })
      if (!res.ok) { const j = await res.json() as { error?: string }; setGenError(j.error ?? 'Hata.'); return }
      setDraft(await res.json() as PlannerResult)
      setActiveTab(1)
    } catch { setGenError('Bağlantı hatası.') }
    finally  { setGenLoading(false) }
  }

  // ── Taslağı uygula ────────────────────────────────────────────────────────
  const applyDraft = async (acknowledge = false) => {
    if (!draft) return
    // Client-side guard: geçersiz plan onaylanamaz (sunucu ayrıca kendi doğrulamasını yapar)
    if (draft.hasHardViolation) {
      setGenError('Plan kritik kural ihlalleri içeriyor. Onaylamadan önce planı yeniden oluşturun.')
      return
    }
    // Haftada kayıtlı plan varsa yenisiyle değiştirileceğini onaylat
    const existingShifts = planData?.summaries.reduce(
      (n, s) => n + Object.values(s.days).reduce((m, d) => m + d.shifts.length, 0), 0,
    ) ?? 0
    if (!acknowledge && existingShifts > 0 && !window.confirm(
      `Bu haftanın mevcut planı (${existingShifts} vardiya) silinip yeni planla değiştirilecek.\n\n` +
      'Giriş/çıkış kaydı olan ve izinli işaretli vardiyalar korunur. Devam edilsin mi?',
    )) return
    setApplyLoading(true)
    try {
      const res = await fetch('/api/workforce/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          assignments: draft.assignments,
          weekStart: draft.weekStart,
          acknowledge_violations: acknowledge,
        }),
      })
      const result = await res.json() as {
        created: number; replaced: number; skipped: number; restDays?: number; errors: string[]
        error?: string; code?: string; violations?: string[]
      }
      if (!res.ok) {
        // Sunucu yasal ihlal buldu — yönetici açıkça onaylarsa tekrar gönder
        if (result.code === 'WORKING_TIME_VIOLATION' && window.confirm(
          'Plan aşağıdaki İş Kanunu kurallarını ihlal ediyor:\n\n' +
          (result.violations ?? []).map((v) => `• ${v}`).join('\n') +
          '\n\nYine de uygulansın mı?',
        )) {
          setApplyLoading(false)
          return applyDraft(true)
        }
        setGenError(result.error ?? 'Uygulama sırasında hata oluştu.')
        return
      }
      setApplyResult(result)
      if (result.created > 0 || result.replaced > 0) {
        void loadCurrentPlan(weekRef)
        setActiveTab(0)
      }
    } catch { setGenError('Uygulama sırasında bağlantı hatası.') }
    finally  { setApplyLoading(false) }
  }

  // Hafta değişince draft'ı sıfırla — effect yerine handler'da: keep-alive ile sayfaya geri
  // dönüldüğünde effect'ler yeniden çalışır ve oluşturulmuş taslak kaybolurdu
  const changeWeek = (next: Date) => {
    setWeekRef(next)
    setDraft(null)
    setGenError(null)
    setApplyResult(null)
  }
  const prevWeek = () => changeWeek(subWeeks(weekRef, 1))
  const nextWeek = () => changeWeek(addWeeks(weekRef, 1))
  const thisWeek = () => changeWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))

  const weekLabel = planData
    ? `${format(new Date(planData.weekStart), 'd MMM', { locale: tr })} – ${format(new Date(planData.weekEnd), 'd MMM yyyy', { locale: tr })}`
    : format(weekRef, "'Hafta' d MMM", { locale: tr })

  const draftWeekDays = draft?.weekDays ?? planData?.weekDays ?? []

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box>
      {/* Hafta navigasyonu */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <IconButton size="small" onClick={prevWeek} aria-label="Önceki hafta" sx={{ color: 'text.secondary' }}>
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="body2" fontWeight={600} sx={{ minWidth: 200, textAlign: 'center' }}>
          {weekLabel}
        </Typography>
        <IconButton size="small" onClick={nextWeek} aria-label="Sonraki hafta" sx={{ color: 'text.secondary' }}>
          <ChevronRightIcon />
        </IconButton>
        <Tooltip title="Bu hafta">
          <IconButton size="small" onClick={thisWeek} aria-label="Bu hafta" sx={{ color: 'text.secondary' }}>
            <TodayIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Taslak oluştur / yeniden oluştur */}
          <Button
            size="small"
            variant="outlined"
            startIcon={genLoading ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon fontSize="small" />}
            onClick={() => void generate()}
            disabled={genLoading || applyLoading}
            sx={{ fontSize: '0.75rem', borderColor: 'primary.main', color: 'primary.main' }}
          >
            {draft ? 'Yeniden Oluştur' : 'Haftalık Plan Oluştur'}
          </Button>

          {/* Onayla ve aktar */}
          {draft && !applyResult && (
            <Tooltip
              title={draft.hasHardViolation ? 'Kritik kural ihlalleri var. Önce "Yeniden Oluştur" ile planı düzeltin.' : ''}
              arrow
            >
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={applyLoading ? <CircularProgress size={14} color="inherit" /> : <CheckCircleIcon fontSize="small" />}
                  onClick={() => void applyDraft()}
                  disabled={applyLoading || draft.hasHardViolation}
                >
                  {applyLoading ? 'Aktarılıyor…' : 'Onayla ve Haftalık Plana Aktar'}
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Hata mesajları */}
      {genError && <Alert severity="error" sx={{ mb: 1.5 }}>{genError}</Alert>}

      {/* Onay sonucu */}
      {applyResult && (
        <Alert
          severity={applyResult.errors.length > 0 ? 'warning' : 'success'}
          sx={{ mb: 1.5, fontSize: '0.8rem' }}
        >
          {applyResult.created} atama oluşturuldu
          {applyResult.replaced > 0 && `, eski plandan ${applyResult.replaced} vardiya kaldırıldı`}
          {applyResult.skipped > 0 && `, giriş/çıkış veya izin kaydı olan ${applyResult.skipped} vardiya korundu`}
          {!!applyResult.restDays && `, ${applyResult.restDays} gün haftalık tatil olarak işaretlendi`}.
          {applyResult.errors.length > 0 && (
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {applyResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </Box>
          )}
        </Alert>
      )}

      {/* Sekme */}
      <Tabs
        value={activeTab}
        onChange={(_, v: number) => setActiveTab(v)}
        sx={{ mb: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36, fontSize: '0.78rem', py: 0.75 } }}
      >
        <Tab label="Mevcut Plan" />
        <Tab
          label={
            draft
              ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <span>Taslak</span>
                  {draft.hasHardViolation && (
                    <WarningAmberIcon sx={{ fontSize: 14, color: '#ef4444' }} />
                  )}
                  <Chip label="DRAFT" size="small"
                    sx={{ height: 16, fontSize: '0.58rem', fontWeight: 700, bgcolor: 'rgba(234,179,8,0.15)', color: '#eab308',
                      '& .MuiChip-label': { px: 0.6 } }} />
                </Box>
              : 'Taslak'
          }
          disabled={!draft}
        />
      </Tabs>

      {/* ── SEKMESİ 0: Mevcut Plan ── */}
      {activeTab === 0 && (
        <>
          {planError && <Alert severity={planError.includes('yetki') ? 'warning' : 'error'} sx={{ mb: 2 }}>{planError}</Alert>}

          {isFirstLoad && (
            <ScheduleGridSkeleton rows={6} />
          )}

          {!isFirstLoad && planData && (
            <>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                {[
                  `${planData.summaries.length} çalışan`,
                  `Min. dinlenme: ${planData.config.minRestHours}s`,
                  `Haftalık maks: ${planData.config.maxWeeklyWorkHours}s`,
                ].map((label) => (
                  <Chip key={label} label={label} size="small" variant="outlined"
                    sx={{ fontSize: '0.68rem', color: 'text.secondary', borderColor: 'divider' }} />
                ))}
                {planData.openShiftsThisWeek.length > 0 && (
                  <Chip size="small" icon={<WorkOutlineIcon sx={{ fontSize: '12px !important' }} />}
                    label={`${planData.openShiftsThisWeek.length} açık vardiya`}
                    sx={{ fontSize: '0.7rem', bgcolor: 'rgba(234,179,8,0.1)', color: '#eab308' }} />
                )}
                {planData.summaries.some((s) => s.violations.length > 0) && (
                  <Chip size="small" icon={<WarningAmberIcon sx={{ fontSize: '12px !important' }} />}
                    label={`${planData.summaries.reduce((n, s) => n + s.violations.length, 0)} ihlal`}
                    color="error" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                )}
              </Box>

              <TableContainer component={Paper}
                sx={{ bgcolor: 'rgba(15,23,42,0.8)', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Table size="small" sx={{ tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 140, color: 'text.secondary', fontSize: '0.72rem', fontWeight: 700,
                        borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)', py: 1 }}>Çalışan</TableCell>
                      {planData.weekDays.map((d) => (
                        <TableCell key={d} align="center"
                          sx={{ color: 'text.secondary', fontSize: '0.72rem', fontWeight: 700,
                            borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)', py: 1, px: 0.5 }}>
                          {dayLabel(d)}
                        </TableCell>
                      ))}
                      <TableCell align="center" sx={{ width: 64, color: 'primary.main', fontSize: '0.72rem', fontWeight: 700,
                        borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)', py: 1 }}>Toplam</TableCell>
                      <TableCell align="center" sx={{ width: 52, color: 'text.secondary', fontSize: '0.72rem', fontWeight: 700,
                        borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)', py: 1 }}>İhlal</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {planData.summaries.map((summary) => {
                      const hasError = summary.violations.some((v) => v.severity === 'error')
                      const hasWarn  = summary.violations.some((v) => v.severity === 'warning')
                      return (
                        <TableRow key={summary.employeeId} sx={{
                          '&:last-child td': { borderBottom: 0 },
                          bgcolor: hasError ? 'rgba(239,68,68,0.04)' : hasWarn ? 'rgba(234,179,8,0.04)' : 'transparent',
                          '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                        }}>
                          <TableCell sx={{ borderColor: 'divider', py: 1 }}>
                            <Typography variant="caption" fontWeight={600}
                              sx={{ fontSize: '0.75rem', color: 'text.primary', lineHeight: 1.2, display: 'block' }}>
                              {summary.employeeName}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.4, flexWrap: 'wrap' }}>
                              <Chip label={summary.employment_type === 'part_time' ? 'PT' : 'FT'} size="small"
                                sx={{ height: 14, fontSize: '0.58rem', fontWeight: 700, '& .MuiChip-label': { px: 0.6 },
                                  bgcolor: summary.employment_type === 'part_time' ? 'rgba(99,102,241,0.15)' : 'rgba(20,184,166,0.12)',
                                  color: summary.employment_type === 'part_time' ? '#818cf8' : 'primary.main' }} />
                              {summary.employment_type === 'part_time' && (
                                <Typography variant="caption"
                                  sx={{ fontSize: '0.62rem',
                                    color: summary.weeklyWorkDays > PART_TIME_RULES.maxWeeklyDays ? '#ef4444' : 'text.disabled' }}>
                                  {summary.weeklyWorkDays}g/{PART_TIME_RULES.maxWeeklyDays}g
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                          {planData.weekDays.map((d) => {
                            const day = summary.days[d]
                            return (
                              <TableCell key={d} align="center"
                                sx={{ borderColor: 'divider', py: 0.75, px: 0.5, verticalAlign: 'top' }}>
                                {day ? <DayCellContent day={day} /> : <Typography variant="caption" sx={{ color: '#475569' }}>—</Typography>}
                              </TableCell>
                            )
                          })}
                          <TableCell align="center" sx={{ borderColor: 'divider', py: 1 }}>
                            {(() => {
                              const maxMins = summary.employment_type === 'part_time'
                                ? PART_TIME_RULES.maxWeeklyHours * 60
                                : planData.config.maxWeeklyWorkHours * 60
                              const isOver = summary.totalWeeklyMins > maxMins
                              return (
                                <Box>
                                  <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 700, display: 'block',
                                    color: isOver ? '#ef4444' : summary.totalWeeklyMins > 0 ? 'primary.main' : 'text.disabled' }}>
                                    {formatMins(summary.totalWeeklyMins)}
                                  </Typography>
                                  <Typography variant="caption" sx={{ fontSize: '0.58rem', color: 'text.disabled', display: 'block' }}>
                                    /{summary.employment_type === 'part_time' ? `${PART_TIME_RULES.maxWeeklyHours}s` : `${planData.config.maxWeeklyWorkHours}s`}
                                  </Typography>
                                </Box>
                              )
                            })()}
                          </TableCell>
                          <TableCell align="center" sx={{ borderColor: 'divider', py: 1 }}>
                            <ViolationBadge violations={summary.violations} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {planData.summaries.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={planData.weekDays.length + 3} align="center"
                          sx={{ borderColor: 'divider', py: 4, color: 'text.secondary', fontSize: '0.82rem' }}>
                          Bu hafta için vardiya planı bulunamadı.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </>
      )}

      {/* ── SEKMESİ 1: Taslak Plan ── */}
      {activeTab === 1 && draft && (
        <>
          {/* Durum banner */}
          <Alert
            severity={draft.hasHardViolation ? 'error' : 'success'}
            sx={{ mb: 1.5, fontSize: '0.8rem' }}
            icon={draft.hasHardViolation ? <WarningAmberIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />}
          >
            {draft.hasHardViolation
              ? `Plan geçersiz: ${draft.warnings.filter((w) => w.level === 'error').length} kritik kural ihlali var. Aşağıdaki hataları gidermeden plan onaylanamaz.`
              : 'Taslak plan geçerli. İnceleyip onaylayabilirsiniz.'}
          </Alert>

          {/* Özet istatistikler */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            <Chip size="small" label={`${draft.assignments.length} atama`}
              sx={{ fontSize: '0.7rem', bgcolor: 'rgba(20,184,166,0.1)', color: 'primary.main' }} />
            <Chip size="small"
              label={`${draft.warnings.filter((w) => w.level === 'error').length} kritik uyarı`}
              color={draft.warnings.some((w) => w.level === 'error') ? 'error' : 'default'}
              variant="outlined" sx={{ fontSize: '0.7rem' }} />
            <Chip size="small"
              label={`${draft.warnings.filter((w) => w.level === 'info').length} bilgi`}
              variant="outlined" sx={{ fontSize: '0.7rem', color: 'text.secondary', borderColor: 'divider' }} />
          </Box>

          {/* Uyarı listesi */}
          <WarningList warnings={draft.warnings} />

          <Divider sx={{ my: 1.5, borderColor: 'divider' }} />

          {/* Taslak tablo */}
          <TableContainer component={Paper}
            sx={{ bgcolor: 'rgba(15,23,42,0.8)', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Table size="small" sx={{ tableLayout: 'fixed' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 140, color: 'text.secondary', fontSize: '0.72rem', fontWeight: 700,
                    borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)', py: 1 }}>Çalışan</TableCell>
                  {draftWeekDays.map((d) => (
                    <TableCell key={d} align="center"
                      sx={{ color: 'text.secondary', fontSize: '0.72rem', fontWeight: 700,
                        borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)', py: 1, px: 0.5 }}>
                      {dayLabel(d)}
                    </TableCell>
                  ))}
                  <TableCell align="center"
                    sx={{ width: 64, color: 'primary.main', fontSize: '0.72rem', fontWeight: 700,
                      borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)', py: 1 }}>Toplam</TableCell>
                  <TableCell align="center"
                    sx={{ width: 52, color: 'text.secondary', fontSize: '0.72rem', fontWeight: 700,
                      borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)', py: 1 }}>G/K</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.values(draft.stats).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'tr')).map((stat) => {
                  const assignByDate: Record<string, DraftAssignment> = {}
                  for (const a of stat.assignments) assignByDate[a.work_date] = a

                  return (
                    <TableRow key={stat.employeeId} sx={{
                      '&:last-child td': { borderBottom: 0 },
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                    }}>
                      <TableCell sx={{ borderColor: 'divider', py: 1 }}>
                        <Typography variant="caption" fontWeight={600}
                          sx={{ fontSize: '0.75rem', color: 'text.primary', lineHeight: 1.2, display: 'block' }}>
                          {stat.employeeName}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.4, flexWrap: 'wrap', alignItems: 'center' }}>
                          <Chip label={stat.employment_type === 'part_time' ? 'PT' : 'FT'} size="small"
                            sx={{ height: 14, fontSize: '0.58rem', fontWeight: 700, '& .MuiChip-label': { px: 0.6 },
                              bgcolor: stat.employment_type === 'part_time' ? 'rgba(99,102,241,0.15)' : 'rgba(20,184,166,0.12)',
                              color: stat.employment_type === 'part_time' ? '#818cf8' : 'primary.main' }} />
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>
                            {stat.workDays}g
                          </Typography>
                        </Box>
                      </TableCell>

                      {draftWeekDays.map((d) => (
                        <TableCell key={d} align="center"
                          sx={{ borderColor: 'divider', py: 0.75, px: 0.5, verticalAlign: 'top' }}>
                          <DraftCell assign={assignByDate[d]} />
                        </TableCell>
                      ))}

                      {/* Toplam saat */}
                      <TableCell align="center" sx={{ borderColor: 'divider', py: 1 }}>
                        {(() => {
                          const target = stat.employment_type === 'part_time' ? PART_TIME_RULES.maxWeeklyHours * 60 : 45 * 60
                          const pct = Math.min(100, Math.round(stat.totalMins / target * 100))
                          const color = pct >= 95 ? '#22c55e' : pct >= 80 ? '#14b8a6' : pct >= 60 ? '#eab308' : '#94a3b8'
                          return (
                            <Tooltip title={`Hedef: ${stat.employment_type === 'part_time' ? 30 : 45}s`} placement="top">
                              <Box>
                                <Typography variant="caption"
                                  sx={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', color }}>
                                  {formatMins(stat.totalMins)}
                                </Typography>
                                <Typography variant="caption"
                                  sx={{ fontSize: '0.58rem', color: 'text.disabled', display: 'block' }}>
                                  %{pct}
                                </Typography>
                              </Box>
                            </Tooltip>
                          )
                        })()}
                      </TableCell>

                      {/* Opening / Closing sayısı */}
                      <TableCell align="center" sx={{ borderColor: 'divider', py: 1 }}>
                        <Tooltip title={`Opening: ${stat.openingCount} / Closing: ${stat.closingCount} / Full: ${stat.fullCount}`} placement="top">
                          <Box>
                            <Typography variant="caption"
                              sx={{ fontSize: '0.65rem', color: SHIFT_KIND_COLORS.opening, display: 'block' }}>
                              {stat.openingCount}A
                            </Typography>
                            <Typography variant="caption"
                              sx={{ fontSize: '0.65rem', color: SHIFT_KIND_COLORS.closing, display: 'block' }}>
                              {stat.closingCount}K
                            </Typography>
                          </Box>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Onay butonu (tablo altında da) */}
          {!applyResult && (
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {draft.hasHardViolation && (
                <Typography variant="caption" sx={{ color: '#ef4444', fontSize: '0.72rem', mr: 'auto' }}>
                  ⚠ Kritik ihlaller giderilmeden plan onaylanamaz.
                </Typography>
              )}
              <Button variant="outlined" size="small"
                startIcon={<RefreshIcon fontSize="small" />}
                onClick={() => void generate()} disabled={genLoading}
                sx={{ fontSize: '0.75rem' }}>
                Yeniden Oluştur
              </Button>
              <Tooltip
                title={draft.hasHardViolation ? 'Kritik kural ihlalleri var. Önce "Yeniden Oluştur" ile planı düzeltin.' : ''}
                arrow
              >
                <span>
                  <Button variant="contained" color="success" size="small"
                    startIcon={applyLoading ? <CircularProgress size={14} color="inherit" /> : <CheckCircleIcon fontSize="small" />}
                    onClick={() => void applyDraft()}
                    disabled={applyLoading || draft.hasHardViolation}
                    sx={{ fontSize: '0.75rem' }}>
                    {applyLoading ? 'Aktarılıyor…' : 'Onayla ve Haftalık Plana Aktar'}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
