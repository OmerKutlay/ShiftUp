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
  const { employee } = await apiFetch<{ employee: Employee }>(
    `/api/employees/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: payload }
  )
  return employee
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
