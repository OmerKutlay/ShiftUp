import type { Metadata } from 'next'
import { WifiOff } from 'lucide-react'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RetryButton } from './RetryButton'

export const metadata: Metadata = {
  title: 'Çevrimdışı',
}

/**
 * Service worker'ın ağ yokken sayfa gezinmelerinde gösterdiği yedek sayfa.
 * Statik olarak önbelleğe alınır (bkz. src/lib/pwa/serviceWorkerSource.ts).
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WifiOff aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            <h1>İnternet bağlantısı yok</h1>
          </EmptyTitle>
          <EmptyDescription>
            Giriş/çıkış ve vardiya bilgileri için bağlantı gerekiyor. Bağlantı geri geldiğinde sayfayı yenileyin.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <RetryButton />
        </EmptyContent>
      </Empty>
    </div>
  )
}
