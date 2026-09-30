'use client'

import { ThemeProvider, CssBaseline } from '@mui/material'
import { theme } from '@/lib/theme'
import { ActiveEmployeeProvider } from '@/context/ActiveEmployeeContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ActiveEmployeeProvider>
        {children}
      </ActiveEmployeeProvider>
    </ThemeProvider>
  )
}
