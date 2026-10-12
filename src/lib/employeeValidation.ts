/**
 * employeeValidation — çalışan oluşturma/güncelleme girdilerinin sunucu doğrulaması.
 */
import { canManageRole } from '@/lib/auth/roles'
import { fetchRoles } from '@/lib/employeeRepository'
import { isUuid, isValidEmail } from '@/lib/validation'
import type { CreateEmployeePayload } from '@/types/employee'

const EMPLOYMENT_TYPES = ['full_time', 'part_time'] as const

/** Oluşturma/güncelleme gövdesini doğrular; hata mesajı ya da temiz payload döner */
export async function validateEmployeeInput(
  body: Record<string, unknown>,
  actorRole: string | null,
  partial: boolean
): Promise<{ error: string } | { payload: Partial<CreateEmployeePayload> }> {
  const payload: Partial<CreateEmployeePayload> = {}

  if (!partial || body.full_name !== undefined) {
    if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.length > 120) {
      return { error: 'Ad soyad zorunludur (en fazla 120 karakter).' }
    }
    payload.full_name = body.full_name.trim()
  }
  if (!partial || body.role !== undefined) {
    if (typeof body.role !== 'string' || !body.role.trim() || body.role.length > 80) {
      return { error: 'Pozisyon zorunludur (en fazla 80 karakter).' }
    }
    payload.role = body.role.trim()
  }
  if (body.email !== undefined) {
    if (body.email === null || body.email === '') {
      payload.email = null
    } else if (!isValidEmail(body.email)) {
      return { error: 'Geçersiz e-posta adresi.' }
    } else {
      payload.email = body.email.trim().toLowerCase()
    }
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { error: 'active alanı boolean olmalıdır.' }
    payload.active = body.active
  }
  if (!partial || body.employment_type !== undefined) {
    const et = body.employment_type ?? 'full_time'
    if (!EMPLOYMENT_TYPES.includes(et as (typeof EMPLOYMENT_TYPES)[number])) {
      return { error: 'Geçersiz çalışma tipi.' }
    }
    payload.employment_type = et as CreateEmployeePayload['employment_type']
  }
  if (!partial || body.role_id !== undefined) {
    if (!isUuid(body.role_id)) return { error: 'Geçerli bir sistem rolü seçin.' }
    const roles = await fetchRoles()
    const role = roles.find((r) => r.id === body.role_id)
    if (!role) return { error: 'Seçilen rol bulunamadı.' }
    if (!canManageRole(actorRole, role.name)) {
      return { error: `"${role.name}" rolünü atama yetkiniz yok.` }
    }
    payload.role_id = role.id
  }

  return { payload }
}

