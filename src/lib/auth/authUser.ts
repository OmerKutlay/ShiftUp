/**
 * authUser.ts — Employee ↔ Supabase Auth kullanıcısı eşlemesi
 *
 * Çalışanlar employees tablosuna eklenirken Supabase Auth kullanıcısı oluşturulmaz.
 * OTP gönderilmeden önce bu helper çağrılır:
 *   - auth_user_id yoksa → auth kullanıcısı oluşturulur (veya email ile bulunur) ve bağlanır
 *   - auth_user_id var ama email değişmişse → auth kullanıcısının email'i güncellenir
 *
 * Böylece signInWithOtp({ shouldCreateUser: false }) güvenle çağrılabilir;
 * Supabase hiçbir zaman employee olmayan birine hesap açmaz.
 *
 * Yalnızca server-side (service role) kullanım içindir.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js'

export interface EmployeeAuthRow {
  id: string
  email: string
  auth_user_id: string | null
}

export type EnsureAuthUserResult =
  | { ok: true; authUserId: string }
  | { ok: false; reason: 'AUTH_USER_CONFLICT' | 'AUTH_PROVISION_FAILED' }

/** auth.users içinde email ile kullanıcı arar (admin API'de doğrudan email lookup yok) */
async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const perPage = 1000
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const match = data.users.find((u) => u.email?.toLowerCase() === email)
    if (match) return match
    if (data.users.length < perPage) return null
  }
}

export async function ensureAuthUserForEmployee(
  admin: SupabaseClient,
  employee: EmployeeAuthRow
): Promise<EnsureAuthUserResult> {
  const email = employee.email.trim().toLowerCase()

  try {
    // ── Zaten bağlı: email senkron mu? ─────────────────────────
    if (employee.auth_user_id) {
      const { data, error } = await admin.auth.admin.getUserById(employee.auth_user_id)
      if (!error && data.user) {
        if (data.user.email?.toLowerCase() !== email) {
          const { error: updateError } = await admin.auth.admin.updateUserById(data.user.id, {
            email,
            email_confirm: true,
          })
          if (updateError) {
            console.error('[ensureAuthUser] email update failed:', updateError.message)
            return { ok: false, reason: 'AUTH_PROVISION_FAILED' }
          }
        }
        return { ok: true, authUserId: data.user.id }
      }
      // Bağlı kullanıcı silinmiş — aşağıda yeniden oluşturulur
    }

    // ── Bağlı değil: oluştur veya mevcut auth kullanıcısını bul ─
    let authUserId: string
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { employee_id: employee.id },
    })

    if (created?.user) {
      authUserId = created.user.id
    } else {
      // Email zaten auth.users'ta kayıtlı (ör. önceki bir deneme) → onu bağla
      const existing = await findAuthUserByEmail(admin, email)
      if (!existing) {
        console.error('[ensureAuthUser] createUser failed:', createError?.message)
        return { ok: false, reason: 'AUTH_PROVISION_FAILED' }
      }
      authUserId = existing.id
    }

    const { error: linkError } = await admin
      .from('employees')
      .update({ auth_user_id: authUserId })
      .eq('id', employee.id)

    if (linkError) {
      // 23505: bu auth kullanıcısı başka bir employee'a bağlı
      if (linkError.code === '23505') return { ok: false, reason: 'AUTH_USER_CONFLICT' }
      console.error('[ensureAuthUser] link failed:', linkError.message)
      return { ok: false, reason: 'AUTH_PROVISION_FAILED' }
    }

    return { ok: true, authUserId }
  } catch (err) {
    console.error('[ensureAuthUser]', err)
    return { ok: false, reason: 'AUTH_PROVISION_FAILED' }
  }
}
