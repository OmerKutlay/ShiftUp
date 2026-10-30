'use client'

/**
 * PushDiagnosticsPanel — anlık bildirim zincirinin adım adım teşhisi (Mağaza Müdürü+).
 *
 * GET /api/push/diagnostics'in `steps` listesini durum rozetli bir Item listesiyle gösterir; ilk
 * başarısız adımın ipucu ne yapılacağını söyler (çoğunlukla scripts/setup-push.sh).
 * Bu cihazın aboneliği sunucuda kayıtlı mı diye kontrol için endpoint de gönderilir.
 *
 * collapsible: başlıktaki düğmeyle açılır ve ancak o zaman yüklenir (varsayılan: hep açık).
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronDown, CircleCheck, CircleX, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item'
import { StatusBadge } from '@/components/common'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
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

/** Adım durumu: renk tek başına değil, metin rozetiyle de iletilir */
function StepBadge({ ok }: { ok: boolean | null }) {
  if (ok === true) return <StatusBadge tone="success" label="Tamam" />
  if (ok === false) return <StatusBadge tone="danger" label="Eksik" />
  return <StatusBadge tone="neutral" label="Bilinmiyor" />
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
  const okCount = steps?.filter((s) => s.ok === true).length ?? 0

  return (
    <Card className="gap-5 shadow-xs">
      <CardHeader className="px-4 md:px-6">
        <CardTitle className="flex items-center gap-2">
          Bildirim teşhisi
          {steps && (
            <Badge variant="secondary" className="tabular-nums">{okCount}/{steps.length}</Badge>
          )}
        </CardTitle>
        <CardDescription>Bildirimler telefona gelmiyorsa hangi adımın eksik olduğunu gösterir.</CardDescription>
        <CardAction className="flex gap-1">
          {open && (
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || shouldLoad}>
              {loading ? <Spinner /> : <RefreshCw />}
              <span className="max-sm:sr-only">Yenile</span>
            </Button>
          )}
          {collapsible && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Teşhisi gizle' : 'Teşhisi göster'}
            >
              <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
            </Button>
          )}
        </CardAction>
      </CardHeader>

      {open && (
        <CardContent className="flex flex-col gap-4 px-4 md:px-6">
          {error && (
            <Alert variant="destructive">
              <CircleX />
              <AlertTitle>Teşhis bilgisi alınamadı</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {firstFailure && (
            <Alert variant="destructive">
              <CircleX />
              <AlertTitle>Sorun: {firstFailure.label}</AlertTitle>
              {firstFailure.hint && <AlertDescription className="[overflow-wrap:anywhere]">{firstFailure.hint}</AlertDescription>}
            </Alert>
          )}
          {steps && steps.length > 0 && steps.every((s) => s.ok === true) && (
            <Alert tone="success">
              <CircleCheck />
              <AlertTitle>Sunucu tarafında eksik görünmüyor</AlertTitle>
              <AlertDescription>
                Bildirim gelmiyorsa telefonun bildirim ayarlarını ve pil tasarrufunu kontrol edin.
              </AlertDescription>
            </Alert>
          )}

          {(shouldLoad || (loading && !steps)) && (
            <div role="status" aria-label="Yükleniyor" className="flex flex-col gap-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-5 rounded-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {steps && (
            <ItemGroup className="rounded-lg border">
              {steps.map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && <ItemSeparator />}
                  <Item size="sm" className={cn('rounded-none', s === firstFailure && 'bg-destructive/5')}>
                    <ItemContent className="min-w-0">
                      <ItemTitle className={cn('w-full', s === firstFailure && 'text-destructive')}>{s.label}</ItemTitle>
                      {s.hint && (
                        <ItemDescription className="line-clamp-none [overflow-wrap:anywhere]">{s.hint}</ItemDescription>
                      )}
                    </ItemContent>
                    <ItemActions className="self-start">
                      <StepBadge ok={s.ok} />
                    </ItemActions>
                  </Item>
                </Fragment>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      )}
    </Card>
  )
}
