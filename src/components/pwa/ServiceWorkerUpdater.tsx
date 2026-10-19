'use client'

/**
 * ServiceWorkerUpdater — SW kaydı + "Yeni sürüm hazır" uyarısı.
 *
 * Yeni SW kendiliğinden etkinleşmez (açık formlar/kamera sürüm ortasında bozulmasın); kullanıcı
 * "Güncelle"ye basınca bekleyen SW etkinleşir ve sayfa bir kez yenilenir.
 * Kayıt/dev davranışı: src/lib/pwa/registerServiceWorker.ts
 */
import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
      // Mobilde alt navigasyonun ve taşan QR butonunun üstünde kalsın
      className="fixed left-1/2 z-[1400] flex w-max max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-2xl border bg-card py-2 pr-2 pl-3.5 text-ink shadow-[0_8px_24px_rgb(43_33_27/0.14)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200 bottom-[calc(var(--overlay-offset)+env(safe-area-inset-bottom))] md:bottom-6"
      style={{ '--overlay-offset': `${BOTTOM_NAV_OVERLAY_OFFSET}px` } as React.CSSProperties}
    >
      <RefreshCw className="size-4 shrink-0 text-brand" aria-hidden />
      <span className="text-sm font-semibold">Yeni sürüm hazır</span>
      <Button size="sm" onClick={handleUpdate} disabled={updating} className="ml-1 h-8">
        {updating && <Loader2 className="animate-spin" />}
        Güncelle
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Kapat"
        onClick={() => setDismissed(true)}
        disabled={updating}
        className="size-8 text-ink-secondary"
      >
        <X />
      </Button>
    </div>
  )
}
