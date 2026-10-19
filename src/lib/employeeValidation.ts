/**
 * employeeValidation — çalışan oluşturma/güncelleme girdilerinin sunucu doğrulaması.
 */
import { canManageRole, type AccessLevel } from '@/lib/auth/roles'
import { fetchRoles } from '@/lib/employeeRepository'
import { isUuid, isValidDate, isValidEmail } from '@/lib/validation'
import type { CreateEmployeePayload } from '@/types/employee'

const EMPLOYMENT_TYPES = ['full_time', 'part_time'] as const

const FIELD_LABELS = {
  hire_date: 'İşe giriş tarihi',
  birth_date: 'Doğum tarihi',
  overtime_consent_at: 'Fazla çalışma onay tarihi',
} as const

/** Oluşturma/güncelleme gövdesini doğrular; hata mesajı ya da temiz payload döner */
export async function validateEmployeeInput(
  body: Record<string, unknown>,
  actorLevel: AccessLevel | null,
  partial: boolean
): Promise<{ error: string } | { payload: Partial<CreateEmployeePayload> }> {
  const payload: Partial<CreateEmployeePayload> = {}

  if (!partial || body.full_name !== undefined) {
    if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.length > 120) {
      return { error: 'Ad soyad zorunludur (en fazla 120 karakter).' }
    }
    payload.full_name = body.full_name.trim()
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
  // Sistem rolü zorunlu: yetki ve vardiya planındaki görev yalnızca rolden okunur
  if (!partial || body.role_id !== undefined) {
    if (!isUuid(body.role_id)) return { error: 'Sistem rolü zorunludur.' }
    const roles = await fetchRoles()
    const role = roles.find((r) => r.id === body.role_id)
    if (!role) return { error: 'Seçilen rol bulunamadı.' }
    if (!canManageRole(actorLevel, role.access_level)) {
      return { error: `"${role.name}" rolünü atama yetkiniz yok.` }
    }
    payload.role_id = role.id
  }

  // Özlük tarihleri — yıllık izin hakkı (Md. 53) ve fazla çalışma onayı (Md. 41/8)
  const today = new Date().toISOString().slice(0, 10)
  for (const field of ['hire_date', 'birth_date', 'overtime_consent_at'] as const) {
    const v = body[field]
    if (v === undefined) continue
    if (v === null || v === '') {
      payload[field] = null
      continue
    }
    if (!isValidDate(v)) return { error: `${FIELD_LABELS[field]} geçersiz (YYYY-MM-DD).` }
    if (field === 'birth_date' && v >= today) return { error: 'Doğum tarihi geçmişte olmalıdır.' }
    payload[field] = v
  }

  return { payload }
}

