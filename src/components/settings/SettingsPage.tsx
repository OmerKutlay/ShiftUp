'use client'

/**
 * SettingsPage — mağaza konumu, resmi tatil takvimi, denetim kaydı ve anlık bildirim
 * teşhisi (Mağaza Müdürü+).
 */
import { useState } from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import { PageHeader } from '@/components/common'
import { StoreLocationPage } from './StoreLocationPage'
import { HolidaysPanel } from './HolidaysPanel'
import { AuditLogPanel } from './AuditLogPanel'
import { PushPermissionCard } from '@/components/pwa/PushPermissionCard'
import { PushDiagnosticsPanel } from '@/components/pwa/PushDiagnosticsPanel'

export function SettingsPage() {
  const [tab, setTab] = useState(0)
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: 'text.primary' }}>
      <PageHeader title="Ayarlar" subtitle="Mağaza konumu, resmi tatiller, denetim kaydı ve bildirimler" />
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
        <Tab label="Bildirimler" />
      </Tabs>
      {tab === 0 && <StoreLocationPage embedded />}
      {tab === 1 && <HolidaysPanel />}
      {tab === 2 && <AuditLogPanel />}
      {tab === 3 && (
        <Box sx={{ maxWidth: 640 }}>
          <PushPermissionCard />
          <PushDiagnosticsPanel />
        </Box>
      )}
    </Box>
  )
}
