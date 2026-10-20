'use client'

/**
 * PushPrompt — oturum açıkken "Bildirimleri aç" önerisi (tek dokunuşla izin + abonelik).
 *
 * Tarayıcılar bildirim iznini yalnızca kullanıcı dokunuşuyla verir (iOS'ta şart), bu yüzden
 * izin otomatik alınamaz; bunun yerine kullanıcıyı ayar aratmadan karşılayan bir kart gösterilir.
 * İzin bir kez verildiyse sonraki girişlerde abonelik sessizce yenilenir (syncSubscription).
 *
 * Gösterilir: izin henüz sorulmamışsa ('default'), kurulu PWA'da (standalone) veya masaüstünde.
 * Mobil tarayıcı sekmesinde gösterilmez — orada InstallPrompt önce kurulumu önerir.
 * Gösterilmez: /login, /qr-kiosk, oturum yoksa ya da son 3 gün içinde "Şimdi değil" dendiyse.
 */
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { BellRing } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { isDismissedRecently, isInstallPromptHiddenPath, useIsStandalone } from '@/lib/pwa/install'
import { BottomPromptCard, PromptIcon } from './BottomPromptCard'
import { useIsNarrow } from './useIsNarrow'

const DISMISS_KEY = 'shiftup.pushPrompt.dismissedAt'
const DISMISS_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000

function readDismissed(): boolean {
  try {
    return isDismissedRecently(window.localStorage.getItem(DISMISS_KEY), Date.now(), DISMISS_INTERVAL_MS)
  } catch {
    return false
  }
}

function markDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    /* depolama yoksa yalnızca bu oturum için gizlenir */
  }
}

export function PushPrompt() {
  const isMobile = useIsNarrow()
  const pathname = usePathname()
  const { status } = useAuth()
  const isStandalone = useIsStandalone()
  const [dismissed, setDismissed] = useState(() =>
    typeof window === 'undefined' ? true : readDismissed()
  )

  const eligible =
    status === 'authenticated' &&
    !dismissed &&
    (isStandalone || !isMobile) &&
    !isInstallPromptHiddenPath(pathname)

  // Push durumu (/api/push/config) yalnızca uygun olduğunda sorgulanır
  if (!eligible) return null
  return (
    <PushPromptCard
      onDismiss={() => {
        markDismissed()
        setDismissed(true)
      }}
    />
  )
}

function PushPromptCard({ onDismiss }: { onDismiss: () => void }) {
  const { status, busy, error, enable } = usePushSubscription()
  const open = status === 'default' || (busy && status !== 'subscribed')
  if (!open) return null

  return (
    <BottomPromptCard
      titleId="push-prompt-title"
      title="Bildirimleri aç"
      onClose={onDismiss}
      media={
        <PromptIcon>
          <BellRing />
        </PromptIcon>
      }
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
            Şimdi değil
          </Button>
          <Button size="sm" onClick={() => void enable()} disabled={busy}>
            {busy && <Spinner />}
            Aç
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {error ??
          'İzin talepleri, onaylar ve vardiya hatırlatmaları uygulama kapalıyken de telefonunuza gelsin.'}
      </p>
    </BottomPromptCard>
  )
}
