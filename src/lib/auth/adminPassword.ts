/**
 * adminPassword — Admin girişinde e-posta kodundan önce istenen şifre (admin başına).
 *
 * Şifre yalnızca bcrypt özeti olarak admin_credentials tablosunda durur; özet hesaplama ve
 * karşılaştırma veritabanındaki fonksiyonlarda yapılır (pgcrypto — Worker CPU'sunu harcamaz).
 * Bkz. supabase/migrations/20261031100000_admin_login_password.sql
 */
import type { createAdminClient } from '@/lib/supabaseAdmin'

type AdminClient = ReturnType<typeof createAdminClient>

export const ADMIN_PASSWORD_MIN_LENGTH = 10
/** bcrypt 72 bayttan sonrasını yok sayar */
export const ADMIN_PASSWORD_MAX_BYTES = 72
/** Doğrulamaya gönderilecek en uzun girdi (karakter) — uzun gövdeyle DB'yi yormamak için */
const VERIFY_MAX_LENGTH = 200

/** Kayıt bulunamadığında doğrulamaya verilen kimlik: DB yine bir bcrypt hesaplar (sabit süre) */
const NO_EMPLOYEE_ID = '00000000-0000-0000-0000-000000000000'

/** Yeni şifre kurala uyuyor mu? Uymuyorsa kullanıcıya gösterilecek mesaj */
export function adminPasswordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return `Şifre en az ${ADMIN_PASSWORD_MIN_LENGTH} karakter olmalı.`
  }
  if (new TextEncoder().encode(password).length > ADMIN_PASSWORD_MAX_BYTES) {
    return 'Şifre çok uzun (en fazla 72 bayt).'
  }
  if (password.trim() !== password) return 'Şifre boşlukla başlayıp bitemez.'
  return null
}

/**
 * Şifre bu çalışanın admin şifresi mi? employeeId null ise (hesap yok / admin değil) de DB'ye
 * gidilir ve false döner — yanıt süresi hesabın varlığını ele vermez.
 */
export async function verifyAdminPassword(
  admin: AdminClient,
  employeeId: string | null,
  password: unknown
): Promise<boolean> {
  const pw = typeof password === 'string' ? password.slice(0, VERIFY_MAX_LENGTH) : ''
  const { data, error } = await admin.rpc('verify_admin_password', {
    p_employee_id: employeeId ?? NO_EMPLOYEE_ID,
    p_password: pw,
  })
  if (error) throw error
  return employeeId !== null && data === true
}

export async function setAdminPassword(
  admin: AdminClient,
  employeeId: string,
  password: string,
  actorId: string | null
): Promise<void> {
  const { error } = await admin.rpc('set_admin_password', {
    p_employee_id: employeeId,
    p_password: password,
    p_actor_id: actorId,
  })
  if (error) throw error
}
