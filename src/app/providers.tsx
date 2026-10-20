'use client'

import { SWRConfig } from 'swr'
import { swrConfig } from '@/lib/api/swr'
import { AuthProvider } from '@/context/AuthContext'
import { AppShellWrapper } from '@/components/layout/AppShellWrapper'
import { ConfirmProvider } from '@/components/common/ConfirmDialog'
import { PwaLayer } from '@/components/pwa/PwaLayer'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={swrConfig}>
      <TooltipProvider delayDuration={300}>
        <ConfirmProvider>
          <AuthProvider>
            <AppShellWrapper>{children}</AppShellWrapper>
            <PwaLayer />
            {/* Mobilde üst barın altında (iOS üst kenar bulanıklığına girmesin) */}
            <Toaster
              position="top-center"
              richColors
              closeButton
              mobileOffset={{ top: 'calc(var(--app-top) + 64px)' }}
            />
          </AuthProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </SWRConfig>
  )
}
