'use client'

/**
 * useWeeklySchedule — haftalık plan ekranının veri katmanı (SWR).
 *
 * - Her kaynak kendi anahtarıyla önbelleğe alınır; hafta değiştiğinde eski haftanın
 *   geç gelen yanıtı yeni haftanın verisinin üstüne yazamaz.
 * - İzinler yalnızca görüntülenen hafta aralığı için çekilir.
 * - Müsaitlik verisi yalnızca düzenleme modunda (yönetici) çekilir.
 * - Haftalık tatil gününde (izinli işaretli olmayan) vardiya varsa o gün "hafta tatilinde çalışma"dır:
 *   restWorkMap'e girer, tatil/izin haritalarından çıkarılır — tablo, sayaçlar ve çıktılar onu vardiya gibi gösterir.
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
import type { PublicHoliday } from '@/types/holiday'
import { useLeaveTypes } from '@/lib/api/leaveTypes'
import { leaveTypeName } from '@/types/leave'

export type AvailabilityMap = Map<string, Map<DayOfWeek, EmployeeAvailability[]>>

interface ApprovedLeave {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  leave_type: string
  leave_type_def_id?: string | null
  recurrence_id?: string | null
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
  const holidaysQ = useSWR(`/api/holidays?from=${from}&to=${to}`, (url: string) =>
    apiFetch<{ holidays: PublicHoliday[] }>(url)
  )
  const availabilityQ = useSWR(readOnly ? null : '/api/availability?all=true', (url: string) =>
    apiFetch<{ availability: EmployeeAvailability[] }>(url)
  )

  // Ayarlar › İzin türleri: izinli hücrelerde türün adı
  const { byId: leaveTypesById, active: activeLeaveTypes } = useLeaveTypes()

  // "employee_id:YYYY-MM-DD" anahtarlı izin haritaları
  const {
    approvedLeaveMap: leaveMapAll, leaveDayToId, restDayMap: restMapAll, recurringRestMap: recurringMapAll,
    multiDayLeaveIds, leaveLabelMap, leaveDefMap,
  } = useMemo(() => {
    const leaveSet = new Set<string>()
    const idMap = new Map<string, string>()
    const restSet = new Set<string>()
    const recurringSet = new Set<string>()
    const multiDay = new Set<string>()
    const labels = new Map<string, string>()
    const defs = new Map<string, string | null>()
    for (const lr of leavesQ.data?.requests ?? []) {
      const end = lr.end_date.slice(0, 10)
      if (lr.start_date.slice(0, 10) !== end) multiDay.add(lr.id)
      for (let d = lr.start_date.slice(0, 10); d <= end; d = addDaysToDateString(d, 1)) {
        if (d < from || d > to) continue
        const key = `${lr.employee_id}:${d}`
        leaveSet.add(key)
        idMap.set(key, lr.id)
        if (lr.leave_type === 'weekly_rest') {
          restSet.add(key)
          if (lr.recurrence_id) recurringSet.add(key)
        } else {
          labels.set(key, leaveTypeName(lr, leaveTypesById))
          defs.set(key, lr.leave_type_def_id ?? null)
        }
      }
    }
    return {
      approvedLeaveMap: leaveSet, leaveDayToId: idMap, restDayMap: restSet, recurringRestMap: recurringSet,
      multiDayLeaveIds: multiDay, leaveLabelMap: labels, leaveDefMap: defs,
    }
  }, [leavesQ.data, from, to, leaveTypesById])

  // Hafta tatilinde çalışma: tatil günündeki vardiya
  const { approvedLeaveMap, restDayMap, recurringRestMap, restWorkMap } = useMemo(() => {
    const restWork = new Set<string>()
    for (const a of assignmentsQ.data ?? []) {
      const key = `${a.employee_id}:${a.work_date}`
      if (!a.is_on_leave && restMapAll.has(key)) restWork.add(key)
    }
    if (restWork.size === 0) {
      return { approvedLeaveMap: leaveMapAll, restDayMap: restMapAll, recurringRestMap: recurringMapAll, restWorkMap: restWork }
    }
    const without = (s: Set<string>) => new Set([...s].filter((k) => !restWork.has(k)))
    return {
      approvedLeaveMap: without(leaveMapAll), restDayMap: without(restMapAll), recurringRestMap: without(recurringMapAll),
      restWorkMap: restWork,
    }
  }, [assignmentsQ.data, leaveMapAll, restMapAll, recurringMapAll])

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

  const holidayMap = useMemo(
    () => new Map((holidaysQ.data?.holidays ?? []).map((h) => [h.date, h])),
    [holidaysQ.data]
  )

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
    /** Her hafta tekrarlayan tatil günleri (restDayMap alt kümesi) */
    recurringRestMap,
    /** Haftalık tatil gününe verilmiş vardiyalar (hafta tatilinde çalışma); restDayMap / approvedLeaveMap'te yok */
    restWorkMap,
    /** İzinli günlerin (haftalık tatil dışı) tür adı ve tür tanımı */
    leaveLabelMap,
    leaveDefMap,
    /** Planda atanabilen (aktif) izin türleri */
    leaveTypes: activeLeaveTypes,
    /** Birden fazla günü kapsayan izin / tatil kayıtları (silinince tüm aralık gider) */
    multiDayLeaveIds,
    availabilityMap,
    /** Tarih → resmi tatil */
    holidayMap,
    /** Bu haftanın verisi henüz hiç gelmedi (skeleton göster) */
    isFirstLoad: !assignmentsQ.data && !assignmentsQ.error,
    /** Kaynak bazında "yüklendi" (veri geldi ya da hata verdi) ve hata durumu — yazdırma sayfası kullanır */
    settled: {
      assignments: !!assignmentsQ.data || !!assignmentsQ.error,
      employees: !!employeesQ.data || !!employeesQ.error,
      leaves: !!leavesQ.data || !!leavesQ.error,
      holidays: !!holidaysQ.data || !!holidaysQ.error,
    },
    failed: {
      assignments: !!assignmentsQ.error,
      employees: !!employeesQ.error,
      leaves: !!leavesQ.error,
      holidays: !!holidaysQ.error,
    },
    error: error ? (error instanceof Error ? error.message : 'Yükleme hatası.') : null,
    reload,
  }
}
