'use client'

/**
 * useWeeklySchedule — haftalık plan ekranının veri katmanı (SWR).
 *
 * - Her kaynak kendi anahtarıyla önbelleğe alınır; hafta değiştiğinde eski haftanın
 *   geç gelen yanıtı yeni haftanın verisinin üstüne yazamaz.
 * - İzinler yalnızca görüntülenen hafta aralığı için çekilir.
 * - Müsaitlik verisi yalnızca düzenleme modunda (yönetici) çekilir.
 */
import { useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { format } from 'date-fns'
import { fetchActiveEmployees } from '@/lib/api/employees'
import { fetchActiveShiftTemplates } from '@/lib/api/shiftTemplates'
import { fetchWeeklyAssignments, getWeekDays } from '@/lib/api/schedule'
import { apiFetch } from '@/lib/api/http'
import { addDaysToDateString } from '@/lib/dateUtils'
import type { DayOfWeek, EmployeeAvailability } from '@/types/workforce'

export type AvailabilityMap = Map<string, Map<DayOfWeek, EmployeeAvailability[]>>

interface ApprovedLeave {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  leave_type: string
}

export function useWeeklySchedule(currentWeek: Date, { readOnly = false } = {}) {
  const weekKey = format(currentWeek, 'yyyy-MM-dd')
  const weekDays = useMemo(() => getWeekDays(currentWeek), [currentWeek])
  const from = weekDays[0]
  const to = weekDays[6]

  const employeesQ = useSWR('employees:active', fetchActiveEmployees)
  const templatesQ = useSWR('shift-templates:active', fetchActiveShiftTemplates)
  const assignmentsQ = useSWR(['shifts:week', weekKey], () => fetchWeeklyAssignments(currentWeek))
  const leavesQ = useSWR(`/api/leave?status=approved&from=${from}&to=${to}`, (url: string) =>
    apiFetch<{ requests: ApprovedLeave[] }>(url)
  )
  const availabilityQ = useSWR(readOnly ? null : '/api/availability?all=true', (url: string) =>
    apiFetch<{ availability: EmployeeAvailability[] }>(url)
  )

  // "employee_id:YYYY-MM-DD" anahtarlı izin haritaları
  const { approvedLeaveMap, leaveDayToId, restDayMap } = useMemo(() => {
    const leaveSet = new Set<string>()
    const idMap = new Map<string, string>()
    const restSet = new Set<string>()
    for (const lr of leavesQ.data?.requests ?? []) {
      const end = lr.end_date.slice(0, 10)
      for (let d = lr.start_date.slice(0, 10); d <= end; d = addDaysToDateString(d, 1)) {
        if (d < from || d > to) continue
        const key = `${lr.employee_id}:${d}`
        leaveSet.add(key)
        idMap.set(key, lr.id)
        if (lr.leave_type === 'weekly_rest') restSet.add(key)
      }
    }
    return { approvedLeaveMap: leaveSet, leaveDayToId: idMap, restDayMap: restSet }
  }, [leavesQ.data, from, to])

  // employeeId → DayOfWeek → kayıtlar
  const availabilityMap: AvailabilityMap = useMemo(() => {
    const aMap: AvailabilityMap = new Map()
    for (const av of availabilityQ.data?.availability ?? []) {
      if (!aMap.has(av.employee_id)) aMap.set(av.employee_id, new Map())
      const empMap = aMap.get(av.employee_id)!
      if (!empMap.has(av.day_of_week)) empMap.set(av.day_of_week, [])
      empMap.get(av.day_of_week)!.push(av)
    }
    return aMap
  }, [availabilityQ.data])

  const { mutate: mutateAssignments } = assignmentsQ
  const { mutate: mutateLeaves } = leavesQ

  /** Kayıt / silme sonrası haftanın vardiya ve izin verisini tazeler */
  const reload = useCallback(async () => {
    await Promise.all([mutateAssignments(), mutateLeaves()])
  }, [mutateAssignments, mutateLeaves])

  const error =
    employeesQ.error ?? templatesQ.error ?? assignmentsQ.error ?? leavesQ.error ?? null

  return {
    weekKey,
    weekDays,
    employees: employeesQ.data ?? [],
    templates: templatesQ.data ?? [],
    assignments: assignmentsQ.data ?? [],
    approvedLeaveMap,
    leaveDayToId,
    restDayMap,
    availabilityMap,
    /** Bu haftanın verisi henüz hiç gelmedi (skeleton göster) */
    isFirstLoad: !assignmentsQ.data && !assignmentsQ.error,
    error: error ? (error instanceof Error ? error.message : 'Yükleme hatası.') : null,
    reload,
  }
}
