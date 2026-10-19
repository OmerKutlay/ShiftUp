'use client'

import { Box } from '@mui/material'
import { OpenShiftsPanel } from './OpenShiftsPanel'
import { PageHeader } from '@/components/common'

export function OpenShiftsPage() {
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 800, mx: 'auto' }}>
      <PageHeader
        title="Açık Vardiyalar"
        subtitle="Boşta kalan vardiyaları görüntüleyin ve üstlenin"
      />
      <OpenShiftsPanel />
    </Box>
  )
}
