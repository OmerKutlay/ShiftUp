import type { Metadata } from 'next'
import { WifiOff } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Çevrimdışı',
}

/**
 * Service worker'ın ağ yokken sayfa gezinmelerinde gösterdiği yedek sayfa.
 * Statik olarak önbelleğe alınır (bkz. src/lib/pwa/serviceWorkerSource.ts).
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center p-4 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-warning-soft text-warning">
        <WifiOff className="size-6" aria-hidden />
      </span>
      <h1 className="text-xl font-bold text-ink">İnternet bağlantısı yok</h1>
      <p className="mt-2 max-w-[360px] text-sm text-ink-secondary">
        Giriş/çıkış ve vardiya bilgileri için bağlantı gerekiyor. Bağlantı geri geldiğinde sayfayı yenileyin.
      </p>
    </div>
  )
}
