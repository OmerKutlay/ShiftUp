'use client'

import { SWRConfig } from 'swr'
import { swrConfig } from '@/lib/api/swr'
import { AuthProvider } from '@/context/AuthContext'
import { AppShellWrapper } from '@/components/layout/AppShellWrapper'
import { ConfirmProvider } from '@/components/common/ConfirmDialog'
import { PwaLayer } from '@/components/pwa/PwaLayer'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={swrConfig}>
      <ConfirmProvider>
        <AuthProvider>
          <AppShellWrapper>{children}</AppShellWrapper>
          <PwaLayer />
        </AuthProvider>
      </ConfirmProvider>
    </SWRConfig>
  )
}
