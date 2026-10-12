'use client'

import { Box, Typography } from '@mui/material'
import WorkIcon from '@mui/icons-material/Work'
import { OpenShiftsPanel } from './OpenShiftsPanel'

export function OpenShiftsPage() {
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <WorkIcon sx={{ color: 'primary.main', fontSize: 28 }} />
        <Typography variant="h6" fontWeight={800}>
          Açık Vardiyalar
        </Typography>
      </Box>
      <OpenShiftsPanel />
    </Box>
  )
}
