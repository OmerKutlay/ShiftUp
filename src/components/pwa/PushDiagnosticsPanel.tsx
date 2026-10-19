'use client'

/**
 * PushDiagnosticsPanel — anlık bildirim zincirinin adım adım teşhisi (Mağaza Müdürü+).
 *
 * GET /api/push/diagnostics'in `steps` listesini ✓ / ✗ / ? simgeleriyle gösterir; ilk
 * başarısız adımın ipucu ne yapılacağını söyler (çoğunlukla scripts/setup-push.sh).
 * Bu cihazın aboneliği sunucuda kayıtlı mı diye kontrol için endpoint de gönderilir.
 *
 * collapsible: başlığa tıklanınca açılır ve ancak o zaman yüklenir (varsayılan: hep açık).
 */
import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, CircleCheck, CircleHelp, CircleX, Loader2, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api/http'
import { getCurrentSubscription } from '@/lib/pwa/push'
import type { PushDiagnosticStep } from '@/lib/pushDiagnostics'

interface DiagnosticsResponse {
  steps: PushDiagnosticStep[]
}

interface Props {
  collapsible?: boolean
}

/** Teşhis isteği; bu cihazın endpoint'i (destek yoksa / abone değilse) gönderilmez */
async function fetchDiagnostics(): Promise<{ steps: PushDiagnosticStep[] } | { error: string }> {
  try {
    const sub = await getCurrentSubscription().catch(() => null)
    const qs = sub?.endpoint ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''
    const res = await apiFetch<DiagnosticsResponse>(`/api/push/diagnostics${qs}`)
    return { steps: res.steps }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Teşhis bilgisi alınamadı.' }
  }
}

function StepIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <CircleCheck className="size-[18px] text-success" aria-label="Tamam" />
  if (ok === false) return <CircleX className="size-[18px] text-danger" aria-label="Sorun" />
  return <CircleHelp className="size-[18px] text-ink-muted" aria-label="Bilinmiyor" />
}

export function PushDiagnosticsPanel({ collapsible = false }: Props) {
  const [open, setOpen] = useState(!collapsible)
  const [steps, setSteps] = useState<PushDiagnosticStep[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Hata önceden temizlenmez: aksi halde ilk yükleme efekti de tetiklenirdi
    setLoading(true)
    const result = await fetchDiagnostics()
    if ('steps' in result) {
      setSteps(result.steps)
      setError(null)
    } else setError(result.error)
    setLoading(false)
  }, [])

  // İlk açılışta bir kez yükle; sonrası "Yenile" ile
  const shouldLoad = open && steps === null && error === null
  useEffect(() => {
    if (!shouldLoad) return
    let cancelled = false
    void fetchDiagnostics().then((result) => {
      if (cancelled) return
      if ('steps' in result) setSteps(result.steps)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [shouldLoad])

  const firstFailure = steps?.find((s) => s.ok === false)

  const header = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">Bildirim teşhisi</span>
        <span className="block text-xs text-ink-secondary">
          Bildirimler telefona gelmiyorsa hangi adımın eksik olduğunu gösterir.
        </span>
      </span>
      {collapsible && (
        <ChevronDown className={cn('size-5 shrink-0 text-ink-secondary transition-transform', open && 'rotate-180')} />
      )}
    </>
  )
  const headerCls = 'flex w-full items-center gap-2 px-4 py-3 text-left'

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(headerCls, 'outline-none hover:bg-muted/60 focus-visible:bg-muted')}
        >
          {header}
        </button>
      ) : (
        <div className={headerCls}>{header}</div>
      )}

      {open && (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {error && (
            <Alert tone="danger">
              <CircleX />
              <AlertDescription className="text-ink">{error}</AlertDescription>
            </Alert>
          )}
          {(shouldLoad || (loading && !steps)) && (
            <div className="flex justify-center py-4">
              <Loader2 className="size-6 animate-spin text-ink-muted" aria-label="Yükleniyor" />
            </div>
          )}
          {steps && (
            <ul className="flex flex-col">
              {steps.map((s) => (
                <li key={s.key} className="flex items-start gap-2.5 py-1.5">
                  <span className="mt-px flex shrink-0">
                    <StepIcon ok={s.ok} />
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block text-sm text-ink', s === firstFailure ? 'font-bold' : 'font-medium')}>
                      {s.label}
                    </span>
                    {s.hint && (
                      <span className={cn('block text-xs [overflow-wrap:anywhere]', s.ok === false ? 'text-warning' : 'text-ink-secondary')}>
                        {s.hint}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {steps && steps.every((s) => s.ok === true) && (
            <Alert tone="success">
              <CircleCheck />
              <AlertDescription className="text-ink">
                Sunucu tarafında eksik görünmüyor. Bildirim gelmiyorsa telefonun bildirim ayarlarını ve pil tasarrufunu kontrol edin.
              </AlertDescription>
            </Alert>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="-ml-2.5 self-start"
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Yenile
          </Button>
        </div>
      )}
    </section>
  )
}
