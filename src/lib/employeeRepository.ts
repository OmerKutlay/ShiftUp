/**
 * employeeRepository — employees / roles veri katmanı (yalnızca server).
 * Client bileşenleri '@/lib/api/employees' üzerinden API'yi çağırır.
 */
import { isTerminatedAsOf } from '@/lib/employment'
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

/** Mağazanın tüm çalışanlarını (pasifler dahil) rol bilgisiyle birlikte getirir */
export async function fetchEmployees(storeId: string): Promise<EmployeeWithRole[]> {
  const { data, error } = await db
    .from('employees')
    .select(`
      id,
      full_name,
      email,
      role_id,
      active,
      store_id,
      employment_type,
      hire_date,
      termination_date,
      termination_reason,
      termination_note,
      terminated_at,
      termination_leave_balance,
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
    .eq('store_id', storeId)
    .order('full_name', { ascending: true })

  if (error) throw new Error(`Çalışanlar yüklenemedi: ${error.message}`)
  return (data ?? []) as unknown as EmployeeWithRole[]
}

/** Mağazanın aktif çalışanları (vardiya planı için) — kiosk cihaz hesapları hariç */
export async function fetchActiveEmployees(storeId: string): Promise<EmployeeWithRole[]> {
  const { data, error } = await db
    .from('employees')
    .select(`
      id,
      full_name,
      role_id,
      active,
      store_id,
      employment_type,
      hire_date,
      termination_date,
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
    .eq('store_id', storeId)
    .eq('active', true)
    .or(NOT_KIOSK_FILTER)
    .order('full_name', { ascending: true })

  if (error) throw new Error(`Aktif çalışanlar yüklenemedi: ${error.message}`)
  // Son çalışma günü geçenler cron çalışmasa da aktif sayılmaz
  return ((data ?? []) as unknown as EmployeeWithRole[]).filter((e) => !isTerminatedAsOf(e))
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
      store_id,
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

/** Yeni çalışan oluşturur — mağaza (store_id) çağıran tarafından doğrulanmış olmalıdır */
export async function createEmployee(
  payload: CreateEmployeePayload & { store_id: string }
): Promise<Employee> {
  const { data, error } = await db
    .from('employees')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Çalışan oluşturulamadı: ${error.message}`)
  return data as Employee
}

/** Mağaza var ve aktif mi? (çalışan ekleme / transfer hedefi doğrulaması) */
export async function isActiveStore(storeId: string): Promise<boolean> {
  const { data, error } = await db
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error(`Mağaza yüklenemedi: ${error.message}`)
  return !!data
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
