'use client'

import { ThemeProvider, CssBaseline } from '@mui/material'
import { SWRConfig } from 'swr'
import { swrConfig } from '@/lib/api/swr'
import { theme } from '@/lib/theme'
import { AuthProvider } from '@/context/AuthContext'
import { AppShellWrapper } from '@/components/layout/AppShellWrapper'
import { ConfirmProvider } from '@/components/common/ConfirmDialog'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SWRConfig value={swrConfig}>
        <ConfirmProvider>
          <AuthProvider>
            <AppShellWrapper>{children}</AppShellWrapper>
          </AuthProvider>
        </ConfirmProvider>
      </SWRConfig>
    </ThemeProvider>
  )
}
