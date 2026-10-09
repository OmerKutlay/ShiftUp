'use client'

import { ThemeProvider, CssBaseline } from '@mui/material'
import { theme } from '@/lib/theme'
import { AuthProvider } from '@/context/AuthContext'
import { ActiveEmployeeProvider } from '@/context/ActiveEmployeeContext'
import { AppShellWrapper } from '@/components/layout/AppShellWrapper'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <ActiveEmployeeProvider>
          <AppShellWrapper>{children}</AppShellWrapper>
        </ActiveEmployeeProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
