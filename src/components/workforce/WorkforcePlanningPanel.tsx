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
  AlertCircle, CalendarCheck, CheckCircle2, Info, Loader2, RefreshCw, TriangleAlert, WandSparkles,
} from 'lucide-react'
import { format, addWeeks, subWeeks, startOfWeek } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWeekSummary } from '@/lib/workingTimeService'
import type { OpenShift } from '@/types/workforce'
import type { PlannerResult, PlanWarning } from '@/lib/workforcePlanner'
import { PeriodStepper, ScheduleGridSkeleton, StatCard, StatGrid, useConfirm } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CurrentPlanTable, DraftPlanTable } from './WorkforcePlanTables'
import { apiFetch, ApiError } from '@/lib/api/http'
import { C } from '@/lib/palette'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanningResponse {
  weekStart: string
  weekEnd: string
  weekDays: string[]
  config: { minRestHours: number; maxDailyWorkHours: number; maxWeeklyWorkHours: number }
  summaries: EmployeeWeekSummary[]
  openShiftsThisWeek: OpenShift[]
}

type PlanTab = 'current' | 'draft'

const HARD_VIOLATION_HINT = 'Kritik kural ihlalleri var. Önce "Yeniden Oluştur" ile planı düzeltin.'

// ─── Plan uyarı listesi ───────────────────────────────────────────────────────

function WarningList({ warnings }: { warnings: PlanWarning[] }) {
  if (warnings.length === 0) return null
  const errors  = warnings.filter((w) => w.level === 'error')
  const infos   = warnings.filter((w) => w.level !== 'error')
  return (
    <div className="flex flex-col gap-2">
      {errors.map((w, i) => (
        <Alert key={i} tone="danger" className="py-2.5">
          <TriangleAlert />
          <AlertDescription className="text-[0.8rem] text-ink">{w.message}</AlertDescription>
        </Alert>
      ))}
      {infos.map((w, i) => (
        <Alert key={i} tone={w.level === 'warning' ? 'warning' : 'info'} className="py-2.5">
          {w.level === 'warning' ? <TriangleAlert /> : <Info />}
          <AlertDescription className="text-[0.8rem] text-ink">{w.message}</AlertDescription>
        </Alert>
      ))}
    </div>
  )
}

/** "Onayla ve aktar" — kritik ihlal varken devre dışı; nedeni ipucunda */
function ApplyButton({ draft, loading, onApply }: { draft: PlannerResult; loading: boolean; onApply: () => void }) {
  const button = (
    <Button
      className="bg-success text-white hover:bg-success/90"
      onClick={onApply}
      disabled={loading || draft.hasHardViolation}
    >
      {loading ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
      {loading ? 'Aktarılıyor…' : 'Onayla ve Haftalık Plana Aktar'}
    </Button>
  )
  if (!draft.hasHardViolation) return button
  return (
    <Tooltip>
      {/* Devre dışı buton olay almaz — ipucu sarmalayıcıya bağlanır */}
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-[10px]">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{HARD_VIOLATION_HINT}</TooltipContent>
    </Tooltip>
  )
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export function WorkforcePlanningPanel() {
  const confirm = useConfirm()
  const [weekRef, setWeekRef] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [activeTab, setActiveTab] = useState<PlanTab>('current')
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
      setActiveTab('draft')
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
    if (!acknowledge && existingShifts > 0 && !(await confirm({
      title: 'Mevcut Plan Değiştirilecek',
      message: `Bu haftanın mevcut planı (${existingShifts} vardiya) silinip yeni planla değiştirilecek.`,
      footer: 'Giriş/çıkış kaydı olan ve izinli işaretli vardiyalar korunur. Devam edilsin mi?',
      confirmText: 'Planı Değiştir',
    }))) return
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
        if (result.code === 'WORKING_TIME_VIOLATION' && await confirm({
          title: 'İş Kanunu İhlali',
          message: 'Plan aşağıdaki İş Kanunu kurallarını ihlal ediyor:',
          items: result.violations ?? [],
          footer: 'Yine de uygulansın mı?',
          confirmText: 'Yine de Uygula',
        })) {
          setApplyLoading(false)
          return applyDraft(true)
        }
        setGenError(result.error ?? 'Uygulama sırasında hata oluştu.')
        return
      }
      setApplyResult(result)
      if (result.created > 0 || result.replaced > 0) {
        void planQ.mutate()
        setActiveTab('current')
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
    setActiveTab('current')
  }
  const prevWeek = () => changeWeek(subWeeks(weekRef, 1))
  const nextWeek = () => changeWeek(addWeeks(weekRef, 1))
  const thisWeek = () => changeWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))

  const weekLabel = planData
    ? `${format(new Date(planData.weekStart), 'd MMM', { locale: tr })} – ${format(new Date(planData.weekEnd), 'd MMM yyyy', { locale: tr })}`
    : format(weekRef, "'Hafta' d MMM", { locale: tr })

  const draftWeekDays = draft?.weekDays ?? planData?.weekDays ?? []
  const draftErrors = draft?.warnings.filter((w) => w.level === 'error').length ?? 0
  const draftInfos = draft?.warnings.filter((w) => w.level === 'info').length ?? 0
  const violationCount = planData?.summaries.reduce((n, s) => n + s.violations.length, 0) ?? 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Hafta navigasyonu */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PeriodStepper
          label={weekLabel}
          onPrev={prevWeek}
          onNext={nextWeek}
          prevLabel="Önceki hafta"
          nextLabel="Sonraki hafta"
          minLabelWidth={168}
        />
        <Button variant="ghost" size="icon" onClick={thisWeek} aria-label="Bu hafta" title="Bu hafta" className="text-ink-secondary">
          <CalendarCheck />
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Taslak oluştur / yeniden oluştur */}
          <Button variant="outline" onClick={() => void generate()} disabled={genLoading || applyLoading}>
            {genLoading ? <Loader2 className="animate-spin" /> : <WandSparkles />}
            {draft ? 'Yeniden Oluştur' : 'Haftalık Plan Oluştur'}
          </Button>

          {/* Onayla ve aktar */}
          {draft && !applyResult && (
            <ApplyButton draft={draft} loading={applyLoading} onApply={() => void applyDraft()} />
          )}
        </div>
      </div>

      {/* Hata mesajları */}
      {genError && (
        <Alert tone="danger" className="mb-3">
          <AlertCircle />
          <AlertDescription className="text-ink">{genError}</AlertDescription>
        </Alert>
      )}

      {/* Onay sonucu */}
      {applyResult && (
        <Alert tone={applyResult.errors.length > 0 ? 'warning' : 'success'} className="mb-3">
          {applyResult.errors.length > 0 ? <TriangleAlert /> : <CheckCircle2 />}
          <AlertDescription className="block text-ink">
            {applyResult.created} atama oluşturuldu
            {applyResult.replaced > 0 && `, eski plandan ${applyResult.replaced} vardiya kaldırıldı`}
            {applyResult.skipped > 0 && `, giriş/çıkış veya izin kaydı olan ${applyResult.skipped} vardiya korundu`}
            {!!applyResult.restDays && `, ${applyResult.restDays} gün haftalık tatil olarak işaretlendi`}.
            {applyResult.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {applyResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Sekme */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PlanTab)}>
        <TabsList>
          <TabsTrigger value="current">Mevcut plan</TabsTrigger>
          <TabsTrigger value="draft" disabled={!draft}>
            Taslak
            {draft?.hasHardViolation && <TriangleAlert className="size-3.5 text-danger" aria-label="Kritik ihlal" />}
          </TabsTrigger>
        </TabsList>

        {/* ── SEKMESİ 0: Mevcut Plan ── */}
        <TabsContent value="current">
          {planError && (
            <Alert tone={planError.includes('yetki') ? 'warning' : 'danger'} className="mb-4">
              <AlertCircle />
              <AlertDescription className="text-ink">{planError}</AlertDescription>
            </Alert>
          )}

          {isFirstLoad && (
            <ScheduleGridSkeleton rows={6} />
          )}

          {!isFirstLoad && planData && (
            <>
              <StatGrid min={140}>
                <StatCard label="Çalışan" value={planData.summaries.length} />
                <StatCard
                  label="Dinlenme / haftalık maks."
                  value={`${planData.config.minRestHours}s / ${planData.config.maxWeeklyWorkHours}s`}
                  note="İş Kanunu sınırları"
                />
                <StatCard
                  label="Açık vardiya"
                  value={planData.openShiftsThisWeek.length}
                  valueColor={planData.openShiftsThisWeek.length > 0 ? C.warning : undefined}
                  note="bu hafta"
                />
                <StatCard
                  label="İhlal"
                  value={violationCount}
                  valueColor={violationCount > 0 ? C.danger : C.success}
                  note={violationCount > 0 ? 'ayrıntı tabloda' : 'her şey yolunda'}
                />
              </StatGrid>

              <CurrentPlanTable
                weekDays={planData.weekDays}
                summaries={planData.summaries}
                maxWeeklyWorkHours={planData.config.maxWeeklyWorkHours}
              />
            </>
          )}
        </TabsContent>

        {/* ── SEKMESİ 1: Taslak Plan ── */}
        {draft && (
          <TabsContent value="draft" className="flex flex-col gap-4">
            {/* Durum banner */}
            <Alert tone={draft.hasHardViolation ? 'danger' : 'success'}>
              {draft.hasHardViolation ? <TriangleAlert /> : <CheckCircle2 />}
              <AlertDescription className="text-ink">
                {draft.hasHardViolation
                  ? `Plan geçersiz: ${draftErrors} kritik kural ihlali var. Aşağıdaki hataları gidermeden plan onaylanamaz.`
                  : 'Taslak plan geçerli. İnceleyip onaylayabilirsiniz.'}
              </AlertDescription>
            </Alert>

            {/* Özet istatistikler */}
            <StatGrid min={140} className="mb-0 md:mb-0">
              <StatCard label="Atama" value={draft.assignments.length} />
              <StatCard label="Kritik uyarı" value={draftErrors} valueColor={draftErrors > 0 ? C.danger : C.success} />
              <StatCard label="Bilgi" value={draftInfos} />
            </StatGrid>

            {/* Uyarı listesi */}
            <WarningList warnings={draft.warnings} />

            {/* Taslak tablo */}
            <DraftPlanTable draft={draft} weekDays={draftWeekDays} />

            {/* Onay butonu (tablo altında da) */}
            {!applyResult && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {draft.hasHardViolation && (
                  <p className="mr-auto flex items-center gap-1.5 text-xs font-medium text-danger">
                    <TriangleAlert className="size-3.5" />
                    Kritik ihlaller giderilmeden plan onaylanamaz.
                  </p>
                )}
                <Button variant="outline" onClick={() => void generate()} disabled={genLoading}>
                  <RefreshCw />
                  Yeniden Oluştur
                </Button>
                <ApplyButton draft={draft} loading={applyLoading} onApply={() => void applyDraft()} />
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
