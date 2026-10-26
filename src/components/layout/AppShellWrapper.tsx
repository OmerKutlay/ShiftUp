'use client'

/**
 * AppShellWrapper — Pathname'e göre AppShell'i koşullu gösterir.
 * /login gibi public sayfalar ve tam ekran kiosk (/qr-kiosk) AppShell'siz render edilir.
 * /gizlilik oturumsuz da açılır: oturum varsa kabukla, yoksa kabuksuz gösterilir.
 */
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { AppShell } from './AppShell'

const NO_SHELL_PATHS = ['/login', '/qr-kiosk']
const SHELL_WHEN_SIGNED_IN = ['/gizlilik']

export function AppShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { status } = useAuth()

  if (
    NO_SHELL_PATHS.includes(pathname) ||
    (SHELL_WHEN_SIGNED_IN.includes(pathname) && status !== 'authenticated')
  ) {
    return <>{children}</>
  }

  return <AppShell>{children}</AppShell>
}
