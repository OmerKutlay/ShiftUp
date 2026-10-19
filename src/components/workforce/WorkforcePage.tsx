'use client'
/**
 * WorkforcePage — FAZ 11 + FAZ WT
 * Availability, Açık Vardiyalar, Vardiya Takası, Haftalık Planlama (manager+)
 */
import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, ArrowLeftRight, Briefcase, CalendarRange, Users } from 'lucide-react'
import { AvailabilityEditor } from './AvailabilityEditor'
import { OpenShiftsPanel } from './OpenShiftsPanel'
import { ShiftSwapPanel } from './ShiftSwapPanel'
import { WorkforcePlanningPanel } from './WorkforcePlanningPanel'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { fetchActiveEmployees } from '@/lib/api/employees'
import { fetchWeeklyAssignments } from '@/lib/api/schedule'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { PageHeader, ListSkeleton } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLoadedKey } from '@/hooks/useLoadedKey'

type WorkforceTab = 'availability' | 'open-shifts' | 'swap' | 'plan'

export function WorkforcePage() {
  const [tab, setTab] = useState<WorkforceTab>('availability')
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
    <div className="p-4 md:p-6">
      <PageHeader
        title="İş gücü planlama"
        subtitle="Müsaitlik, açık vardiyalar ve vardiya takaslarını yönetin"
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          <AlertCircle />
          <AlertDescription className="text-ink">{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as WorkforceTab)} className="gap-5">
        <TabsList>
          <TabsTrigger value="availability"><Users className="size-4" />Müsaitlik</TabsTrigger>
          <TabsTrigger value="open-shifts"><Briefcase className="size-4" />Açık vardiyalar</TabsTrigger>
          <TabsTrigger value="swap"><ArrowLeftRight className="size-4" />Vardiya takası</TabsTrigger>
          {/* Haftalık planlama yalnızca manager+ için görünür */}
          {isManager && (
            <TabsTrigger value="plan"><CalendarRange className="size-4" />Haftalık plan</TabsTrigger>
          )}
        </TabsList>

        {/* Çalışan/vardiya verisi gelene kadar yalnızca bunlara bağımlı sekmeler skeleton gösterir */}
        <TabsContent value="availability">
          {isFirstLoad ? (
            <ListSkeleton count={5} actions={1} />
          ) : authEmployee && (
            <AvailabilityEditor employees={employees} currentEmployeeId={authEmployee.id} isManager={isManager} />
          )}
        </TabsContent>
        <TabsContent value="open-shifts">
          <OpenShiftsPanel />
        </TabsContent>
        <TabsContent value="swap">
          {isFirstLoad ? (
            <ListSkeleton count={5} actions={1} />
          ) : (
            <ShiftSwapPanel
              employees={employees}
              assignments={assignments}
              currentEmployeeId={authEmployee?.id ?? null}
              isManager={isManager}
            />
          )}
        </TabsContent>
        {/* Planlama paneli yalnızca isManager=true iken render edilir */}
        {isManager && (
          <TabsContent value="plan">
            <WorkforcePlanningPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
