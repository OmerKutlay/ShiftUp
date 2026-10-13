'use client'

/**
 * AppShellWrapper — Pathname'e göre AppShell'i koşullu gösterir.
 * /login gibi public sayfalar ve tam ekran kiosk (/qr-kiosk) AppShell'siz render edilir.
 */
import { usePathname } from 'next/navigation'
import { AppShell } from './AppShell'

const NO_SHELL_PATHS = ['/login', '/qr-kiosk']

export function AppShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (NO_SHELL_PATHS.includes(pathname)) {
    return <>{children}</>
  }

  return <AppShell>{children}</AppShell>
}
