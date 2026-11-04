/**
 * Client tarafı haftalık plan API'si — /api/shifts
 */
import { format } from 'date-fns'
import { apiFetch } from './http'
import type {
  ShiftAssignmentWithDetails,
  CreateShiftAssignmentPayload,
  UpdateShiftAssignmentPayload,
} from '@/types/schedule'

export { getWeekRange, getWeekDays, timesOverlap } from '@/lib/scheduleUtils'

export async function fetchWeeklyAssignments(
  weekDate: Date,
  init?: { signal?: AbortSignal }
): Promise<ShiftAssignmentWithDetails[]> {
  const { assignments } = await apiFetch<{ assignments: ShiftAssignmentWithDetails[] }>(
    `/api/shifts?week=${format(weekDate, 'yyyy-MM-dd')}`,
    { signal: init?.signal }
  )
  return assignments
}

export interface ShiftSaveOptions {
  /** Yönetici İş Kanunu ihlallerini açıkça onayladı */
  acknowledgeViolations?: boolean
  /** Haftalık tatil gününe bilerek vardiya ("Bu gün çalışsın") — bu durum için ayrıca onay sorulmaz */
  weeklyRestWork?: boolean
}

const saveFlags = (o: ShiftSaveOptions) => ({
  acknowledge_violations: o.acknowledgeViolations === true,
  ...(o.weeklyRestWork ? { weekly_rest_work: true } : {}),
})

/**
 * Yeni vardiya atar. employeeActive parametresi geriye dönük imza uyumluluğu için
 * korunur; asıl kontrol sunucuda yapılır.
 */
export async function createShiftAssignment(
  payload: CreateShiftAssignmentPayload,
  _employeeActive?: boolean,
  options: ShiftSaveOptions = {}
): Promise<ShiftAssignmentWithDetails> {
  const { assignment } = await apiFetch<{ assignment: ShiftAssignmentWithDetails }>('/api/shifts', {
    method: 'POST',
    body: { ...payload, ...saveFlags(options) },
  })
  return assignment
}

export async function updateShiftAssignment(
  id: string,
  _employeeId: string,
  _workDate: string,
  payload: UpdateShiftAssignmentPayload,
  options: ShiftSaveOptions = {}
): Promise<ShiftAssignmentWithDetails> {
  const { assignment } = await apiFetch<{ assignment: ShiftAssignmentWithDetails }>(
    `/api/shifts/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: { ...payload, ...saveFlags(options) } }
  )
  return assignment
}

export async function deleteShiftAssignment(id: string): Promise<void> {
  await apiFetch(`/api/shifts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
