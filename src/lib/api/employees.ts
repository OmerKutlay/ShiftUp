/**
 * Client tarafı çalışan API'si — /api/employees, /api/roles
 */
import { apiFetch } from './http'
import type {
  Employee,
  EmployeeWithRole,
  Role,
  CreateEmployeePayload,
  UpdateEmployeePayload,
  TerminationReason,
} from '@/types/employee'

export async function fetchRoles(): Promise<Role[]> {
  const { roles } = await apiFetch<{ roles: Role[] }>('/api/roles')
  return roles
}

/** Tüm çalışanlar (rol bilgisiyle) */
export async function fetchEmployees(): Promise<EmployeeWithRole[]> {
  const { employees } = await apiFetch<{ employees: EmployeeWithRole[] }>('/api/employees')
  return employees
}

/** Sadece aktif çalışanlar */
export async function fetchActiveEmployees(): Promise<EmployeeWithRole[]> {
  const { employees } = await apiFetch<{ employees: EmployeeWithRole[] }>('/api/employees?active=true')
  return employees
}

export async function createEmployee(payload: CreateEmployeePayload): Promise<Employee> {
  const { employee } = await apiFetch<{ employee: Employee }>('/api/employees', {
    method: 'POST',
    body: payload,
  })
  return employee
}

export async function updateEmployee(id: string, payload: UpdateEmployeePayload): Promise<Employee> {
  return (await updateEmployeeWithTransfer(id, payload)).employee
}

/** Mağaza transferinde eski mağazadan silinen vardiya / iptal edilen takas sayısını da döner */
export async function updateEmployeeWithTransfer(
  id: string,
  payload: UpdateEmployeePayload
): Promise<{ employee: Employee; transfer?: { shifts_deleted: number; swaps_cancelled: number } }> {
  return apiFetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
}

export function deactivateEmployee(id: string): Promise<Employee> {
  return updateEmployee(id, { active: false })
}

export function activateEmployee(id: string): Promise<Employee> {
  return updateEmployee(id, { active: true })
}

/**
 * Çalışanı kalıcı olarak siler. Bağlı kayıtlar varsa ApiError(code: FK_VIOLATION).
 */
export async function deleteEmployee(id: string): Promise<void> {
  await apiFetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ─── İşten ayrılış ───────────────────────────────────────────

export interface OffboardingShiftInfo {
  id: string
  store_id: string
  store_name: string | null
  work_date: string
  start_time: string
  end_time: string
  is_on_leave: boolean
  has_attendance: boolean
  can_convert: boolean
}

export interface OffboardingPreview {
  last_day: string
  deactivates_now: boolean
  future_shifts: OffboardingShiftInfo[]
  attendance_conflict_date: string | null
  pending_leave: number
  future_approved_leave: number
  pending_time_corrections: number
  pending_swaps: number
  leave_balance: { known: boolean; entitlement_days: number; used_days: number; remaining_days: number; scope: string; note: string }
}

export interface OffboardingInput {
  last_day: string
  reason: TerminationReason
  note?: string
  convert_to_open_shifts?: boolean
}

export async function fetchOffboardingPreview(id: string, date: string): Promise<OffboardingPreview> {
  const { preview } = await apiFetch<{ preview: OffboardingPreview }>(
    `/api/employees/${encodeURIComponent(id)}/offboarding?date=${encodeURIComponent(date)}`
  )
  return preview
}

export async function offboardEmployee(id: string, input: OffboardingInput): Promise<void> {
  await apiFetch(`/api/employees/${encodeURIComponent(id)}/offboarding`, { method: 'POST', body: input })
}

/** Yalnızca Admin: ayrılışı geri alır (silinen vardiyalar geri gelmez) */
export async function undoOffboarding(id: string): Promise<void> {
  await apiFetch(`/api/employees/${encodeURIComponent(id)}/offboarding`, { method: 'DELETE' })
}
