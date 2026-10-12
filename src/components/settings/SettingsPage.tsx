'use client'

/**
 * SettingsPage — mağaza konumu, resmi tatil takvimi ve denetim kaydı (Mağaza Müdürü+).
 */
import { useState } from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import { PageHeader } from '@/components/common'
import { StoreLocationPage } from './StoreLocationPage'
import { HolidaysPanel } from './HolidaysPanel'
import { AuditLogPanel } from './AuditLogPanel'

export function SettingsPage() {
  const [tab, setTab] = useState(0)
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      <PageHeader icon={SettingsIcon} overline="Yönetim" title="Ayarlar" subtitle="Mağaza konumu, resmi tatiller ve denetim kaydı" />
      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab label="Mağaza Konumu" />
        <Tab label="Resmi Tatiller" />
        <Tab label="Denetim Kaydı" />
      </Tabs>
      {tab === 0 && <StoreLocationPage embedded />}
      {tab === 1 && <HolidaysPanel />}
      {tab === 2 && <AuditLogPanel />}
    </Box>
  )
}
