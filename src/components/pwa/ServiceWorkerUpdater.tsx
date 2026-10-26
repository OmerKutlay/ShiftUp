'use client'

/**
 * ServiceWorkerUpdater — SW kaydı + "Yeni sürüm hazır" uyarısı.
 *
 * Yeni SW kendiliğinden etkinleşmez (açık formlar/kamera sürüm ortasında bozulmasın); kullanıcı
 * "Güncelle"ye basınca bekleyen SW etkinleşir ve sayfa bir kez yenilenir.
 * Kayıt/dev davranışı: src/lib/pwa/registerServiceWorker.ts
 */
import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { applyUpdate, registerServiceWorker } from '@/lib/pwa/registerServiceWorker'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'

interface Props {
  /** Uyarı görünürlüğü değişince (PwaLayer diğer alt kartları bu sırada gizler) */
  onVisibleChange?: (visible: boolean) => void
}

export function ServiceWorkerUpdater({ onVisibleChange }: Props) {
  const [waitingReg, setWaitingReg] = useState<ServiceWorkerRegistration | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => registerServiceWorker({ onUpdateReady: setWaitingReg }), [])

  const open = !!waitingReg && !dismissed

  useEffect(() => {
    onVisibleChange?.(open)
  }, [open, onVisibleChange])

  const handleUpdate = () => {
    if (!waitingReg) return
    setUpdating(true)
    applyUpdate(waitingReg)
  }

  if (!open) return null

  return (
    <div
      role="status"
      aria-live="polite"
      // Mobilde alt navigasyonun ve taşan QR düğmesinin üstünde kalsın
      className="print-hide fixed left-1/2 z-[1400] flex w-max max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-popover py-2 pr-2 pl-3 text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-200 bottom-[calc(var(--overlay-offset)+var(--safe-bottom))] md:bottom-6"
      style={{ '--overlay-offset': `${BOTTOM_NAV_OVERLAY_OFFSET}px` } as React.CSSProperties}
    >
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted [&_svg]:size-4">
        <RefreshCw />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">Yeni sürüm hazır</span>
        <span className="text-xs text-muted-foreground max-sm:hidden">Güncellemek sayfayı bir kez yeniler.</span>
      </span>
      <Button size="sm" onClick={handleUpdate} disabled={updating} className="ml-1">
        {updating && <Spinner />}
        Güncelle
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Kapat"
        onClick={() => setDismissed(true)}
        disabled={updating}
        className="text-muted-foreground"
      >
        <X />
      </Button>
    </div>
  )
}
