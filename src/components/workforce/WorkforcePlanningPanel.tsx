'use client'
/**
 * WorkforcePlanningPanel — Haftalık Vardiya Planlayıcı
 *
 * İki mod:
 *   1. "Mevcut Plan" sekmesi — DB'deki mevcut shift_assignments özeti (önceki davranış)
 *   2. "Taslak Oluştur" sekmesi — kural tabanlı engine ile draft plan + onay akışı
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  Box, Typography, Chip, CircularProgress, Alert,
  IconButton, Tooltip, Stack, Button, Tabs, Tab, Divider,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import TodayIcon from '@mui/icons-material/Today'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import WorkOutlineIcon from '@mui/icons-material/WorkOutline'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import RefreshIcon from '@mui/icons-material/Refresh'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { format, addWeeks, subWeeks, startOfWeek } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWeekSummary } from '@/lib/workingTimeService'
import type { OpenShift } from '@/types/workforce'
import type { PlannerResult, PlanWarning } from '@/lib/workforcePlanner'
import { ScheduleGridSkeleton } from '@/components/common'
import { CurrentPlanTable, DraftPlanTable } from './WorkforcePlanTables'
import { apiFetch, ApiError } from '@/lib/api/http'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanningResponse {
  weekStart: string
  weekEnd: string
  weekDays: string[]
  config: { minRestHours: number; maxDailyWorkHours: number; maxWeeklyWorkHours: number }
  summaries: EmployeeWeekSummary[]
  openShiftsThisWeek: OpenShift[]
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

  // Mevcut plan (SWR — hafta değişince eski haftanın yanıtı yenisinin üstüne yazamaz)
  const planQ = useSWR(`/api/workforce/planning?week=${weekKey}`, (url: string) => apiFetch<PlanningResponse>(url))
  const planData = planQ.data ?? null
  const isFirstLoad = !planQ.data && !planQ.error
  const planError = planQ.error
    ? planQ.error instanceof ApiError && (planQ.error.status === 401 || planQ.error.status === 403)
      ? 'Erişim yetkiniz yok.'
      : planQ.error instanceof Error ? planQ.error.message : 'Yükleme hatası.'
    : null

  // Draft state
  const [draft, setDraft]         = useState<PlannerResult | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError]   = useState<string | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyResult, setApplyResult] = useState<{ created: number; replaced: number; skipped: number; restDays?: number; errors: string[] } | null>(null)

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
        void planQ.mutate()
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

              <CurrentPlanTable
                weekDays={planData.weekDays}
                summaries={planData.summaries}
                maxWeeklyWorkHours={planData.config.maxWeeklyWorkHours}
              />
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
          <DraftPlanTable draft={draft} weekDays={draftWeekDays} />

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
