'use client'
/**
 * WorkforcePage — FAZ 11
 * Availability, Open Shifts, Shift Swap sekmeli dashboard.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Tabs, Tab, CircularProgress, Alert,
} from '@mui/material'
import PeopleIcon from '@mui/icons-material/People'
import WorkIcon from '@mui/icons-material/Work'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { AvailabilityEditor } from './AvailabilityEditor'
import { OpenShiftsPanel } from './OpenShiftsPanel'
import { ShiftSwapPanel } from './ShiftSwapPanel'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { fetchActiveEmployees } from '@/lib/employeeRepository'
import { fetchWeeklyAssignments } from '@/lib/scheduleRepository'

export function WorkforcePage() {
  const [tab, setTab] = useState(0)
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignmentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
      <CircularProgress />
    </Box>
  )

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>
        İş Gücü Planlama
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as number)}
        sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab icon={<PeopleIcon fontSize="small" />} iconPosition="start" label="Müsaitlik" sx={{ fontSize: '0.82rem', minHeight: 44 }} />
        <Tab icon={<WorkIcon fontSize="small" />} iconPosition="start" label="Açık Vardiyalar" sx={{ fontSize: '0.82rem', minHeight: 44 }} />
        <Tab icon={<SwapHorizIcon fontSize="small" />} iconPosition="start" label="Vardiya Takası" sx={{ fontSize: '0.82rem', minHeight: 44 }} />
      </Tabs>

      {tab === 0 && employees.length > 0 && <AvailabilityEditor employees={employees} />}
      {tab === 1 && <OpenShiftsPanel employees={employees} />}
      {tab === 2 && <ShiftSwapPanel employees={employees} assignments={assignments} />}
    </Box>
  )
}
