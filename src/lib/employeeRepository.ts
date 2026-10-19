/**
 * employeeRepository — employees / roles veri katmanı (yalnızca server).
 * Client bileşenleri '@/lib/api/employees' üzerinden API'yi çağırır.
 */
import { db } from '@/lib/db'
import { NOT_KIOSK_FILTER } from '@/lib/auth/roles'
import type {
  Employee,
  EmployeeWithRole,
  Role,
  CreateEmployeePayload,
  UpdateEmployeePayload,
} from '@/types/employee'

// ============================================================
// Roles
// ============================================================

/** Tüm rolleri getirir (kullanıcı arayüzü için dropdown vb.) */
export async function fetchRoles(): Promise<Role[]> {
  const { data, error } = await db
    .from('roles')
    .select('id, name, description, access_level, planning_group, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw new Error(`Roller yüklenemedi: ${error.message}`)
  return (data ?? []) as Role[]
}

// ============================================================
// Employees
// ============================================================

/** Tüm çalışanları rol bilgisiyle birlikte getirir */
export async function fetchEmployees(): Promise<EmployeeWithRole[]> {
  const { data, error } = await db
    .from('employees')
    .select(`
      id,
      full_name,
      email,
      role_id,
      active,
      employment_type,
      hire_date,
      birth_date,
      overtime_consent_at,
      auth_user_id,
      created_at,
      updated_at,
      roles (
        id,
        name,
        description,
        access_level,
        planning_group,
        sort_order,
        created_at
      )
    `)
    .order('full_name', { ascending: true })

  if (error) throw new Error(`Çalışanlar yüklenemedi: ${error.message}`)
  return (data ?? []) as unknown as EmployeeWithRole[]
}

/** Sadece aktif çalışanları getirir (vardiya planı için) — kiosk cihaz hesapları hariç */
export async function fetchActiveEmployees(): Promise<EmployeeWithRole[]> {
  const { data, error } = await db
    .from('employees')
    .select(`
      id,
      full_name,
      role_id,
      active,
      employment_type,
      hire_date,
      birth_date,
      overtime_consent_at,
      created_at,
      updated_at,
      roles (
        id,
        name,
        description,
        access_level,
        planning_group,
        sort_order,
        created_at
      )
    `)
    .eq('active', true)
    .or(NOT_KIOSK_FILTER)
    .order('full_name', { ascending: true })

  if (error) throw new Error(`Aktif çalışanlar yüklenemedi: ${error.message}`)
  return (data ?? []) as unknown as EmployeeWithRole[]
}

/** Tek çalışanı id ile getirir */
export async function fetchEmployeeById(id: string): Promise<EmployeeWithRole | null> {
  const { data, error } = await db
    .from('employees')
    .select(`
      id,
      full_name,
      role_id,
      active,
      employment_type,
      hire_date,
      birth_date,
      overtime_consent_at,
      created_at,
      updated_at,
      roles (
        id,
        name,
        description,
        access_level,
        planning_group,
        sort_order,
        created_at
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Çalışan yüklenemedi: ${error.message}`)
  return data as unknown as EmployeeWithRole | null
}

/** Yeni çalışan oluşturur */
export async function createEmployee(payload: CreateEmployeePayload): Promise<Employee> {
  const { data, error } = await db
    .from('employees')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Çalışan oluşturulamadı: ${error.message}`)
  return data as Employee
}

/**
 * Çalışanı günceller.
 * Hard delete yok — pasif yapmak için active: false kullanılır.
 * Geçmiş vardiya ve attendance kayıtları korunur.
 */
export async function updateEmployee(
  id: string,
  payload: UpdateEmployeePayload
): Promise<Employee> {
  const { data, error } = await db
    .from('employees')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Çalışan güncellenemedi: ${error.message}`)
  return data as Employee
}

/**
 * Çalışanı pasif yapar (soft delete).
 * Geçmiş kayıtlar korunur, yeni vardiyalara dahil edilmez.
 */
export async function deactivateEmployee(id: string): Promise<Employee> {
  return updateEmployee(id, { active: false })
}

export async function activateEmployee(id: string): Promise<Employee> {
  return updateEmployee(id, { active: true })
}
