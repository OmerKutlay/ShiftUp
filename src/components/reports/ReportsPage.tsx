'use client'

/**
 * ReportsPage — Raporlar: devam raporu, aylık puantaj (Excel) ve yıllık fazla çalışma.
 */
import { useState } from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import { PageHeader } from '@/components/common'
import { AttendanceReportsPage } from './AttendanceReportsPage'
import { TimesheetPanel } from './TimesheetPanel'
import { OvertimePanel } from './OvertimePanel'

export function ReportsPage() {
  const [tab, setTab] = useState(0)
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: 'text.primary' }}>
      <PageHeader
        title="Raporlar"
        subtitle="Ekibin devamı, aylık puantaj ve fazla çalışma takibi"
      />
      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab label="Devam raporu" />
        <Tab label="Aylık puantaj" />
        <Tab label="Fazla çalışma" />
      </Tabs>
      {tab === 0 && <AttendanceReportsPage embedded />}
      {tab === 1 && <TimesheetPanel />}
      {tab === 2 && <OvertimePanel />}
    </Box>
  )
}
