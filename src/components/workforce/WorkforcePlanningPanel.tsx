'use client'
/**
 * WorkforcePlanningPanel — Haftalık vardiya planlayıcı (yönetici).
 *
 * Araç çubuğu: hafta gezgini · "Plan oluştur" / "Yeniden oluştur" · "Planı uygula".
 * İki görünüm:
 *   1. "Mevcut plan" — DB'deki shift_assignments özeti (KPI + ihlaller + tablo)
 *   2. "Taslak" — kural tabanlı motorun ürettiği plan (KPI + uyarılar + tablo) ve onay akışı
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  CalendarCheck2, CheckCircle2, Clock3, Info, RefreshCw, ShieldAlert, TriangleAlert, Users, WandSparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { format, addWeeks, subWeeks, startOfWeek } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWeekSummary } from '@/lib/workingTimeService'
import type { OpenShift } from '@/types/workforce'
import type { PlannerResult, PlanWarning } from '@/lib/workforcePlanner'
import { PeriodStepper, StatCard, StatCards, useConfirm } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CurrentPlanTable, DraftPlanTable } from './WorkforcePlanTables'
import { KindLegend } from './workforceShared'
import { apiFetch, ApiError } from '@/lib/api/http'
import { useIsMobile } from '@/hooks/useIsMobile'

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
type ApplyResult = { created: number; replaced: number; skipped: number; restDays?: number; errors: string[] }

const HARD_VIOLATION_HINT = 'Kritik kural ihlalleri var. Önce "Yeniden oluştur" ile planı düzeltin.'

const fmtHours = (mins: number) => `${(mins / 60).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} s`
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)

// ─── Plan uyarı listesi ───────────────────────────────────────────────────────

/** Kritik ihlaller tek tek, uyarı ve bilgi notları gruplanmış Alert'ler olarak */
function WarningList({ warnings }: { warnings: PlanWarning[] }) {
  if (warnings.length === 0) return null
  const errors = warnings.filter((w) => w.level === 'error')
  const warns = warnings.filter((w) => w.level === 'warning')
  const infos = warnings.filter((w) => w.level === 'info')
  return (
    <div className="flex flex-col gap-3">
      {errors.map((w, i) => (
        <Alert key={`e${i}`} variant="destructive">
          <TriangleAlert />
          <AlertTitle>Kritik ihlal</AlertTitle>
          <AlertDescription>{w.message}</AlertDescription>
        </Alert>
      ))}
      {warns.length > 0 && (
        <Alert tone="warning">
          <TriangleAlert />
          <AlertTitle>{warns.length} uyarı</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">{warns.map((w, i) => <li key={i}>{w.message.trim()}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
      {infos.length > 0 && (
        <Alert tone="info">
          <Info />
          <AlertTitle>{infos.length} bilgi notu</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">{infos.map((w, i) => <li key={i}>{w.message.trim()}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

/** "Planı uygula" — kritik ihlal varken devre dışı; nedeni ipucunda */
function ApplyButton({ draft, loading, onApply }: { draft: PlannerResult; loading: boolean; onApply: () => void }) {
  const button = (
    <Button onClick={onApply} disabled={loading || draft.hasHardViolation}>
      {loading ? <Spinner /> : <CheckCircle2 />}
      {loading ? 'Uygulanıyor…' : 'Planı uygula'}
    </Button>
  )
  if (!draft.hasHardViolation) return button
  return (
    <Tooltip>
      {/* Devre dışı buton olay almaz — ipucu sarmalayıcıya bağlanır */}
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{HARD_VIOLATION_HINT}</TooltipContent>
    </Tooltip>
  )
}

function PlanSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  )
}

// ─── Ana bileşen ──────────────────────────────────────────────────────────────

export function WorkforcePlanningPanel() {
  const confirm = useConfirm()
  const isMobile = useIsMobile()
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
  const [draft, setDraft] = useState<PlannerResult | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)

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
    finally { setGenLoading(false) }
  }

  // ── Taslağı uygula ────────────────────────────────────────────────────────
  const applyDraft = async (acknowledge = false) => {
    if (!draft) return
    // Client-side guard: geçersiz plan onaylanamaz (sunucu ayrıca kendi doğrulamasını yapar)
    if (draft.hasHardViolation) {
      setGenError('Plan kritik kural ihlalleri içeriyor. Onaylamadan önce planı yeniden oluşturun.')
      return
    }
    // Uygulamadan önce onay: haftada kayıtlı plan varsa yenisiyle değiştirileceği belirtilir
    const existingShifts = planData?.summaries.reduce(
      (n, s) => n + Object.values(s.days).reduce((m, d) => m + d.shifts.length, 0), 0,
    ) ?? 0
    if (!acknowledge && !(await confirm(existingShifts > 0
      ? {
        title: 'Mevcut plan değiştirilecek',
        message: `Bu haftanın mevcut planı (${existingShifts} vardiya) silinip ${draft.assignments.length} atamalık taslakla değiştirilecek.`,
        footer: 'Giriş/çıkış kaydı olan ve izinli işaretli vardiyalar korunur. Devam edilsin mi?',
        confirmText: 'Planı değiştir',
      }
      : {
        title: 'Plan uygulansın mı?',
        message: `${draft.assignments.length} atama haftalık plana aktarılacak.`,
        confirmText: 'Planı uygula',
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
      const result = await res.json() as ApplyResult & { error?: string; code?: string; violations?: string[] }
      if (!res.ok) {
        // Sunucu yasal ihlal buldu — yönetici açıkça onaylarsa tekrar gönder
        if (result.code === 'WORKING_TIME_VIOLATION' && await confirm({
          title: 'İş Kanunu ihlali',
          message: 'Plan aşağıdaki İş Kanunu kurallarını ihlal ediyor:',
          items: result.violations ?? [],
          footer: 'Yine de uygulansın mı?',
          confirmText: 'Yine de uygula',
        })) {
          setApplyLoading(false)
          return applyDraft(true)
        }
        setGenError(result.error ?? 'Uygulama sırasında hata oluştu.')
        return
      }
      setApplyResult(result)
      toast.success('Plan uygulandı', { description: `${result.created} atama oluşturuldu` })
      if (result.created > 0 || result.replaced > 0) {
        void planQ.mutate()
        setActiveTab('current')
      }
    } catch { setGenError('Uygulama sırasında bağlantı hatası.') }
    finally { setApplyLoading(false) }
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
  const isThisWeek = weekKey === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const weekLabel = planData
    ? `${format(new Date(planData.weekStart), 'd MMM', { locale: tr })} – ${format(new Date(planData.weekEnd), 'd MMM yyyy', { locale: tr })}`
    : format(weekRef, "'Hafta' d MMM", { locale: tr })

  // ── Mevcut plan metrikleri ──
  const summaries = planData?.summaries ?? []
  const plannedPeople = summaries.filter((s) => s.totalWeeklyMins > 0 || Object.values(s.days).some((d) => d.isLeave)).length
  const currentCoverage = pctOf(plannedPeople, summaries.length)
  const currentMins = summaries.reduce((n, s) => n + s.totalWeeklyMins, 0)
  const violators = summaries.filter((s) => s.violations.length > 0)
  const violationCount = violators.reduce((n, s) => n + s.violations.length, 0)
  const hasHardViolation = violators.some((s) => s.violations.some((v) => v.severity === 'error'))
  const openShiftCount = planData?.openShiftsThisWeek.length ?? 0

  // ── Taslak metrikleri ──
  const draftWeekDays = draft?.weekDays ?? planData?.weekDays ?? []
  const draftStats = draft ? Object.values(draft.stats) : []
  const draftErrors = draft?.warnings.filter((w) => w.level === 'error').length ?? 0
  const draftWarns = draft?.warnings.filter((w) => w.level !== 'error').length ?? 0
  const draftMins = draftStats.reduce((n, s) => n + s.totalMins, 0)
  const draftPeople = draftStats.filter((s) => s.assignments.length > 0).length
  const draftCoverage = pctOf(draftPeople, draftStats.length)

  const tableCard = (title: string, description: string, table: React.ReactNode) => (
    <Card className="gap-0 overflow-hidden py-0 shadow-xs">
      <CardHeader className="border-b py-4 [.border-b]:pb-4">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {!isMobile && <CardAction className="self-center"><KindLegend kinds={['opening', 'mid', 'closing', 'full']} /></CardAction>}
      </CardHeader>
      <CardContent className="px-0">{table}</CardContent>
    </Card>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Araç çubuğu: hafta + eylemler */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2">
          <PeriodStepper
            label={weekLabel}
            onPrev={prevWeek}
            onNext={nextWeek}
            prevLabel="Önceki hafta"
            nextLabel="Sonraki hafta"
            minLabelWidth={176}
          />
          <Button variant="outline" onClick={thisWeek} disabled={isThisWeek} aria-label="Bu hafta" className="max-sm:size-9 max-sm:px-0">
            <CalendarCheck2 />
            <span className="max-sm:sr-only">Bu hafta</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button variant="outline" onClick={() => void generate()} disabled={genLoading || applyLoading} className="max-sm:flex-1">
            {genLoading ? <Spinner /> : draft ? <RefreshCw /> : <WandSparkles />}
            {draft ? 'Yeniden oluştur' : 'Taslak plan oluştur'}
          </Button>
          {draft && !applyResult && (
            <ApplyButton draft={draft} loading={applyLoading} onApply={() => void applyDraft()} />
          )}
        </div>
      </div>

      {/* Hata mesajları */}
      {genError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>İşlem tamamlanamadı</AlertTitle>
          <AlertDescription>{genError}</AlertDescription>
        </Alert>
      )}

      {/* Onay sonucu */}
      {applyResult && (
        <Alert tone={applyResult.errors.length > 0 ? 'warning' : 'success'}>
          {applyResult.errors.length > 0 ? <TriangleAlert /> : <CheckCircle2 />}
          <AlertTitle>{applyResult.errors.length > 0 ? 'Plan kısmen uygulandı' : 'Plan uygulandı'}</AlertTitle>
          <AlertDescription className="block">
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PlanTab)} className="gap-4 md:gap-6">
        <TabsList>
          <TabsTrigger value="current">Mevcut plan</TabsTrigger>
          <TabsTrigger value="draft" disabled={!draft}>
            Taslak
            {draft && (draft.hasHardViolation
              ? <TriangleAlert className="size-3.5 text-destructive" aria-label="Kritik ihlal" />
              : <Badge variant="secondary" className="tabular-nums">{draft.assignments.length}</Badge>)}
          </TabsTrigger>
        </TabsList>

        {/* ── Mevcut plan ── */}
        <TabsContent value="current" className="flex flex-col gap-4 md:gap-6">
          {planError && (
            <Alert variant={planError.includes('yetki') ? 'default' : 'destructive'} tone={planError.includes('yetki') ? 'warning' : undefined}>
              <TriangleAlert />
              <AlertTitle>Plan yüklenemedi</AlertTitle>
              <AlertDescription>{planError}</AlertDescription>
            </Alert>
          )}

          {isFirstLoad && <PlanSkeleton />}

          {!isFirstLoad && planData && (
            <>
              <StatCards>
                <StatCard
                  icon={<Users />}
                  label="Kapsam"
                  value={currentCoverage === null ? '—' : `%${currentCoverage}`}
                  hint={`${plannedPeople}/${summaries.length} çalışan planlandı`}
                />
                <StatCard
                  icon={<Clock3 />}
                  label="Planlanan saat"
                  value={fmtHours(currentMins)}
                  hint={`Kişi başı maks. ${planData.config.maxWeeklyWorkHours}s · dinlenme ${planData.config.minRestHours}s`}
                />
                <StatCard
                  icon={<CalendarCheck2 />}
                  label="Açık vardiya"
                  value={openShiftCount}
                  valueClassName={openShiftCount > 0 ? 'text-warning' : undefined}
                  hint={openShiftCount > 0 ? 'Doldurulmayı bekliyor' : 'Açık vardiya yok'}
                />
                <StatCard
                  icon={<ShieldAlert />}
                  label="Kural ihlali"
                  value={violationCount}
                  valueClassName={violationCount > 0 ? 'text-destructive' : undefined}
                  badge={<Badge tone={violationCount > 0 ? 'danger' : 'success'}>{violationCount > 0 ? 'Dikkat' : 'Sorun yok'}</Badge>}
                  hint={violationCount > 0 ? `${violators.length} çalışanda` : 'İş Kanunu sınırları içinde'}
                />
              </StatCards>

              {violators.length > 0 && (
                <Alert variant={hasHardViolation ? 'destructive' : 'default'} tone={hasHardViolation ? undefined : 'warning'}>
                  <TriangleAlert />
                  <AlertTitle>{violators.length} çalışanda kural ihlali</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {violators.flatMap((s) => s.violations.map((v, i) => (
                        <li key={`${s.employeeId}-${i}`}><span className="font-medium">{s.employeeName}:</span> {v.message}</li>
                      )))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {summaries.length === 0 ? (
                <Card className="py-0 shadow-xs">
                  <Empty className="py-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><CalendarCheck2 /></EmptyMedia>
                      <EmptyTitle>Bu hafta için plan yok</EmptyTitle>
                      <EmptyDescription>Kurallara uygun bir taslak oluşturup inceledikten sonra uygulayabilirsiniz.</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button onClick={() => void generate()} disabled={genLoading}>
                        {genLoading ? <Spinner /> : <WandSparkles />}
                        Taslak plan oluştur
                      </Button>
                    </EmptyContent>
                  </Empty>
                </Card>
              ) : tableCard(
                'Haftalık plan',
                `${weekLabel} · net çalışma süreleri`,
                <CurrentPlanTable
                  weekDays={planData.weekDays}
                  summaries={summaries}
                  maxWeeklyWorkHours={planData.config.maxWeeklyWorkHours}
                />
              )}
            </>
          )}
        </TabsContent>

        {/* ── Taslak ── */}
        {draft && (
          <TabsContent value="draft" className="flex flex-col gap-4 md:gap-6">
            <Alert variant={draft.hasHardViolation ? 'destructive' : 'default'} tone={draft.hasHardViolation ? undefined : 'success'}>
              {draft.hasHardViolation ? <TriangleAlert /> : <CheckCircle2 />}
              <AlertTitle>{draft.hasHardViolation ? 'Taslak onaylanamaz' : 'Taslak geçerli'}</AlertTitle>
              <AlertDescription>
                {draft.hasHardViolation
                  ? `${draftErrors} kritik kural ihlali var. Aşağıdaki hataları gidermeden plan uygulanamaz.`
                  : 'Kritik kural ihlali yok. Uyarıları ve tabloyu inceleyip planı uygulayabilirsiniz.'}
              </AlertDescription>
            </Alert>

            <StatCards>
              <StatCard
                icon={<Users />}
                label="Kapsam"
                value={draftCoverage === null ? '—' : `%${draftCoverage}`}
                hint={`${draftPeople}/${draftStats.length} çalışana vardiya atandı`}
              />
              <StatCard
                icon={<Clock3 />}
                label="Planlanan saat"
                value={fmtHours(draftMins)}
                hint={`${draft.assignments.length} atama`}
              />
              <StatCard
                icon={<ShieldAlert />}
                label="Kritik ihlal"
                value={draftErrors}
                valueClassName={draftErrors > 0 ? 'text-destructive' : undefined}
                badge={<Badge tone={draftErrors > 0 ? 'danger' : 'success'}>{draftErrors > 0 ? 'Engelliyor' : 'Yok'}</Badge>}
                hint={draftErrors > 0 ? 'Plan uygulanamaz' : 'Plan uygulanabilir'}
              />
              <StatCard
                icon={<TriangleAlert />}
                label="Uyarı ve not"
                value={draftWarns}
                valueClassName={draftWarns > 0 ? 'text-warning' : undefined}
                hint="Uygulamayı engellemez"
              />
            </StatCards>

            <WarningList warnings={draft.warnings} />

            {tableCard(
              'Taslak plan',
              `${format(new Date(`${draft.weekStart}T12:00:00`), 'd MMM', { locale: tr })} – ${format(new Date(`${draft.weekEnd}T12:00:00`), 'd MMM yyyy', { locale: tr })} · kilitli vardiyalar değiştirilemez`,
              <DraftPlanTable draft={draft} weekDays={draftWeekDays} />
            )}

            {/* Onay çubuğu (tablo altında da) */}
            {!applyResult && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {draft.hasHardViolation && (
                  <p className="flex items-center gap-1.5 text-sm text-destructive sm:mr-auto">
                    <TriangleAlert className="size-4" />
                    Kritik ihlaller giderilmeden plan uygulanamaz.
                  </p>
                )}
                <Button variant="outline" onClick={() => void generate()} disabled={genLoading}>
                  {genLoading ? <Spinner /> : <RefreshCw />}
                  Yeniden oluştur
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
