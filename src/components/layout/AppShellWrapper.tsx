'use client'

/**
 * AppShellWrapper — Pathname'e göre AppShell'i koşullu gösterir.
 * /login gibi public sayfalar, tam ekran kiosk (/qr-kiosk) ve plan çıktısı (/schedule/print) AppShell'siz render edilir.
 * /gizlilik oturumsuz da açılır: kabuksuz yalnızca oturum kesin yokken (signed-out); yüklenirken / sunucuya ulaşılamazken kabukla.
 */
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { AppShell } from './AppShell'

const NO_SHELL_PATHS = ['/login', '/qr-kiosk', '/schedule/print']
const SHELL_WHEN_SIGNED_IN = ['/gizlilik']

export function AppShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { status, sessionCheck } = useAuth()

  if (
    NO_SHELL_PATHS.includes(pathname) ||
    (SHELL_WHEN_SIGNED_IN.includes(pathname) && status === 'unauthenticated' && sessionCheck?.result !== 'unreachable')
  ) {
    return <>{children}</>
  }

  return <AppShell>{children}</AppShell>
}
