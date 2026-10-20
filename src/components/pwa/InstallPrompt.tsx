'use client'

/**
 * InstallPrompt — "ShiftUp'ı ana ekrana ekle" önerisi (yalnızca mobil genişlikte).
 *
 * - Android / Chromium: yakalanan `beforeinstallprompt` ile "Yükle" butonu tarayıcının kurulum
 *   penceresini açar.
 * - iOS Safari: kurulum API'si yok; Paylaş → "Ana Ekrana Ekle" adımları anlatılır. iOS'ta web
 *   bildirimleri yalnızca ana ekrana eklenmiş uygulamada çalıştığı için bu ayrıca belirtilir.
 *
 * Gösterilmez: zaten kurulu (standalone) açıldıysa, /login ve /qr-kiosk'ta, oturum yoksa ya da
 * kullanıcı son 7 gün içinde kapattıysa (bkz. src/lib/pwa/install.ts).
 */
import { useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Share, Download } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import {
  isInstallPromptHiddenPath,
  isIosSafari,
  markInstallDismissed,
  promptInstall,
  readInstallDismissed,
  useInstallPromptEvent,
  useIsStandalone,
} from '@/lib/pwa/install'
import { BottomPromptCard } from './BottomPromptCard'
import { useIsNarrow } from './useIsNarrow'

const noopSubscribe = () => () => {}

export function InstallPrompt() {
  const isMobile = useIsNarrow()
  const pathname = usePathname()
  const { status } = useAuth()
  const isStandalone = useIsStandalone()
  const installEvent = useInstallPromptEvent()
  // Sunucuda ve hydration'da false — UA yalnızca istemcide okunur
  const iosSafari = useSyncExternalStore(
    noopSubscribe,
    () => isIosSafari(),
    () => false
  )
  // localStorage yalnızca istemcide; sunucuda "kapatılmış" sayılır → hiçbir şey render edilmez
  const [dismissed, setDismissed] = useState(() =>
    typeof window === 'undefined' ? true : readInstallDismissed()
  )

  const variant: 'android' | 'ios' | null = installEvent ? 'android' : iosSafari ? 'ios' : null
  const open =
    variant !== null &&
    isMobile &&
    !dismissed &&
    !isStandalone &&
    status === 'authenticated' &&
    !isInstallPromptHiddenPath(pathname)

  const dismiss = () => {
    markInstallDismissed()
    setDismissed(true)
  }

  const handleInstall = async () => {
    const outcome = await promptInstall()
    // Kurulum penceresini reddettiyse 7 gün tekrar sorma; kabul ettiyse olay zaten temizlendi
    if (outcome === 'dismissed') dismiss()
  }

  if (!open) return null

  return (
    <BottomPromptCard
      titleId="install-prompt-title"
      title={<>ShiftUp&apos;ı ana ekrana ekle</>}
      onClose={dismiss}
      media={
        // eslint-disable-next-line @next/next/no-img-element -- statik simge, optimizasyon gerekmez
        <img src="/icon-192.png" alt="" className="size-10 rounded-xl" />
      }
      actions={
        variant === 'android' ? (
          <>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Şimdi değil
            </Button>
            <Button size="sm" onClick={handleInstall}>
              <Download />
              Yükle
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={dismiss}>
            Anladım
          </Button>
        )
      }
    >
      {variant === 'android' ? (
        <p className="mt-1 text-sm text-ink-secondary">
          Tek dokunuşla açılır, tam ekran çalışır ve bildirimleri kaçırmazsınız.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-secondary">
            iPhone&apos;da bildirim alabilmek için ShiftUp&apos;ın ana ekrana eklenmesi gerekir.
          </p>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-ink">
            <li>
              Alttaki{' '}
              <span className="font-semibold whitespace-nowrap">
                Paylaş <Share className="inline size-3.5 align-[-2px]" aria-hidden />
              </span>{' '}
              simgesine dokunun
            </li>
            <li>
              <span className="font-semibold">&quot;Ana Ekrana Ekle&quot;</span> seçeneğini seçin
            </li>
          </ol>
        </>
      )}
    </BottomPromptCard>
  )
}
