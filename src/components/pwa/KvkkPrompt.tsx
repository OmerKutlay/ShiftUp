'use client'

/**
 * KvkkPrompt — güncel aydınlatma metnini henüz onaylamamış çalışana alt kart (KVKK m.10).
 *
 * Engelleyici DEĞİL: uygulama ve QR okutma çalışmaya devam eder (devam kaydı yasal yükümlülük).
 * Kalıcı kapatılamaz — "Sonra" yalnızca bu sayfa oturumu için gizler, yenilemede kart döner.
 * Bu bir rıza kutusu değildir; "Okudum, bilgilendirildim" yalnızca bilgilendirme teyididir.
 * Gösterilmez: oturum yoksa, kiosk hesabında, /login, /qr-kiosk, /gizlilik ve QR okutma sayfasında.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { acknowledgeKvkkNotice, fetchKvkkAckStatus, KVKK_ACK_KEY } from '@/lib/api/kvkk'
import { isKioskRole } from '@/lib/auth/roles'
import { PRIVACY_PATH } from '@/lib/kvkk'
import { isInstallPromptHiddenPath } from '@/lib/pwa/install'
import { SCAN_HREF } from '@/components/layout/navItems'
import { BottomPromptCard, PromptIcon } from './BottomPromptCard'

export function KvkkPrompt({ onVisibleChange }: { onVisibleChange?: (visible: boolean) => void }) {
  const pathname = usePathname()
  const { status, employee } = useAuth()
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hiddenPath =
    isInstallPromptHiddenPath(pathname) || pathname === PRIVACY_PATH || pathname === SCAN_HREF
  const eligible =
    status === 'authenticated' && !isKioskRole(employee?.roles?.access_level) && !hiddenPath
  const { data, mutate } = useSWR(eligible ? KVKK_ACK_KEY : null, fetchKvkkAckStatus, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  const visible = eligible && !!data && !data.acknowledged && !hidden
  useEffect(() => {
    onVisibleChange?.(visible)
    return () => onVisibleChange?.(false)
  }, [visible, onVisibleChange])
  if (!visible || !data) return null

  async function acknowledge() {
    setBusy(true)
    setError(null)
    try {
      await mutate(acknowledgeKvkkNotice(data!.version), { revalidate: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi, tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomPromptCard
      titleId="kvkk-prompt-title"
      title="Kişisel verileriniz hakkında bilgilendirme"
      onClose={() => setHidden(true)}
      closeDisabled={busy}
      media={<PromptIcon><ShieldCheck /></PromptIcon>}
      actions={
        <Button size="sm" onClick={() => void acknowledge()} disabled={busy}>
          {busy && <Spinner />}
          Okudum, bilgilendirildim
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {error ?? (
          <>
            Vardiya, devam ve konum (yalnızca QR okuttuğunuz anda) verilerinizin nasıl işlendiğini{' '}
            <Link href={PRIVACY_PATH} prefetch={false} className="underline underline-offset-2 hover:text-foreground">
              aydınlatma metninde
            </Link>{' '}
            okuyabilirsiniz. Bu bir rıza değil, bilgilendirmedir.
          </>
        )}
      </p>
    </BottomPromptCard>
  )
}
