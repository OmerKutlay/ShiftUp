'use client'
/**
 * WorkforcePage — FAZ 11 + FAZ WT
 * Availability, Açık Vardiyalar, Vardiya Takası, Haftalık Planlama (manager+)
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Tabs, Tab, Alert,
} from '@mui/material'
import GroupsIcon from '@mui/icons-material/Groups'
import PeopleIcon from '@mui/icons-material/People'
import WorkIcon from '@mui/icons-material/Work'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import CalendarViewWeekIcon from '@mui/icons-material/CalendarViewWeek'
import { AvailabilityEditor } from './AvailabilityEditor'
import { OpenShiftsPanel } from './OpenShiftsPanel'
import { ShiftSwapPanel } from './ShiftSwapPanel'
import { WorkforcePlanningPanel } from './WorkforcePlanningPanel'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { fetchActiveEmployees } from '@/lib/employeeRepository'
import { fetchWeeklyAssignments } from '@/lib/scheduleRepository'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { PageHeader, ListSkeleton } from '@/components/common'
import { useLoadedKey } from '@/hooks/useLoadedKey'

export function WorkforcePage() {
  const [tab, setTab] = useState(0)
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignmentWithDetails[]>([])
  const { isFirstLoad, markLoaded } = useLoadedKey()
  const [error, setError] = useState<string | null>(null)

  const { employee: authEmployee } = useAuth()
  const isManager = hasRole(
    authEmployee?.roles?.name ?? authEmployee?.role_name ?? null,
    MANAGER_ROLES
  )

  const load = useCallback(async () => {
    setError(null)
    try {
      const [emps, asgns] = await Promise.all([
        fetchActiveEmployees(),
        fetchWeeklyAssignments(new Date()),
      ])
      setEmployees(emps)
      setAssignments(asgns)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası.')
    } finally {
      markLoaded()
    }
  }, [markLoaded])

  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <PageHeader
        icon={GroupsIcon}
        overline="Planlama"
        title="İş Gücü Planlama"
        subtitle="Müsaitlik, açık vardiyalar ve vardiya takaslarını yönetin"
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as number)}
        sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab
          icon={<PeopleIcon fontSize="small" />}
          iconPosition="start"
          label="Müsaitlik"
          sx={{ fontSize: '0.82rem', minHeight: 44 }}
        />
        <Tab
          icon={<WorkIcon fontSize="small" />}
          iconPosition="start"
          label="Açık Vardiyalar"
          sx={{ fontSize: '0.82rem', minHeight: 44 }}
        />
        <Tab
          icon={<SwapHorizIcon fontSize="small" />}
          iconPosition="start"
          label="Vardiya Takası"
          sx={{ fontSize: '0.82rem', minHeight: 44 }}
        />
        {/* Haftalık Planlama yalnızca manager+ için görünür */}
        {isManager && (
          <Tab
            icon={<CalendarViewWeekIcon fontSize="small" />}
            iconPosition="start"
            label="Haftalık Plan"
            sx={{ fontSize: '0.82rem', minHeight: 44 }}
          />
        )}
      </Tabs>

      {/* Çalışan/vardiya verisi gelene kadar yalnızca bunlara bağımlı sekmeler skeleton gösterir */}
      {isFirstLoad && (tab === 0 || tab === 2) && <ListSkeleton count={5} actions={1} />}
      {!isFirstLoad && tab === 0 && employees.length > 0 && <AvailabilityEditor employees={employees} />}
      {tab === 1 && <OpenShiftsPanel />}
      {!isFirstLoad && tab === 2 && <ShiftSwapPanel
        employees={employees}
        assignments={assignments}
        currentEmployeeId={authEmployee?.id ?? null}
        isManager={isManager}
      />}
      {/* Tab index 3 yalnızca isManager=true iken render edilir */}
      {tab === 3 && isManager && <WorkforcePlanningPanel />}
    </Box>
  )
}
