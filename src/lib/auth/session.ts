/**
 * session.ts — Server-side current employee erişimi
 *
 * API route'larında ve Server Component'lerde kullanılır.
 * Client-side için useAuth() hook'u kullanılır.
 *
 * AUTH_MODE=development → dev_auth_session cookie
 * AUTH_MODE=production  → Supabase Auth cookie
 *
 * Dönen tip: SessionEmployee | null
 * null → unauthenticated
 *
 * Aktif mağaza (store_id) burada belirlenir — bkz. @/lib/storeScope.
 *
 * NOT: 'next/headers' dynamic import kullanılır — top-level import
 * Next.js'in modülü Client Component chain'i olarak işaretlemesine yol açar.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH, DEV_SESSION_COOKIE } from '@/lib/authConfig'
import { ACTIVE_STORE_COOKIE, resolveActiveStoreId } from '@/lib/storeScope'
import { verifyDevSession } from './devSession'
import { isSessionExpired } from './sessionAge'
import { accessLevelOf, type AccessLevel } from './roles'

export interface SessionEmployee {
  id: string
  full_name: string
  email: string | null
  role_id: string | null
  /** Sistem rolünün adı — yalnızca gösterim */
  role_name: string | null
  /** Yetki seviyesi (roles.access_level) — tüm yetki kontrolleri bununla yapılır */
  access_level: AccessLevel | null
  active: boolean
  /** Çalışanın kayıtlı olduğu (ana) mağaza */
  home_store_id: string
  /**
   * Aktif mağaza — tüm veri erişimi bununla sınırlanır.
   * Admin için seçili mağaza (ACTIVE_STORE_COOKIE), diğerleri için ana mağaza.
   */
  store_id: string
}

type CookieReader = { cookies: { get(name: string): { value: string } | undefined } }

const EMPLOYEE_SELECT = `
  id,
  full_name,
  email,
  role_id,
  active,
  store_id,
  roles ( name, access_level )
` as const

/**
 * Mevcut request'ten authenticated employee'ı döner.
 * Unauthenticated veya pasif employee için null döner.
 *
 * Kullanım (API Route):
 *   const employee = await getCurrentEmployee(request)
 *   if (!employee) return unauthorized()
 */
export async function getCurrentEmployee(
  // NextRequest veya undefined — undefined ise next/headers cookies() kullanılır
  req?: CookieReader
): Promise<SessionEmployee | null> {
  try {
    const admin = createAdminClient()
    const readCookie = async (name: string): Promise<string | undefined> => {
      if (req) return req.cookies.get(name)?.value
      // next/headers dynamic import — top-level import yapmak modülü bozar
      const { cookies } = await import('next/headers')
      return (await cookies()).get(name)?.value
    }

    if (IS_DEV_AUTH) {
      // Dev: imzalı çerezden employeeId oku — değiştirilmiş / süresi dolmuş çerez reddedilir
      const session = verifyDevSession(await readCookie(DEV_SESSION_COOKIE))
      if (!session) return null
      const employeeId = session.employeeId

      const { data } = await admin
        .from('employees')
        .select(EMPLOYEE_SELECT)
        .eq('id', employeeId)
        .maybeSingle()

      if (!data || !data.active) return null

      return withActiveStore(admin, mapToSessionEmployee(data), await readCookie(ACTIVE_STORE_COOKIE))
    }

    // Production: Supabase Auth
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // Girişten 30 gün geçtiyse oturum kesin kapanır (bkz. sessionAge)
    const { data: { session } } = await supabase.auth.getSession()
    if (isSessionExpired(session?.access_token, user.last_sign_in_at)) {
      await supabase.auth.signOut().catch(() => {})
      return null
    }

    const { data } = await admin
      .from('employees')
      .select(EMPLOYEE_SELECT)
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!data || !data.active) return null

    return withActiveStore(admin, mapToSessionEmployee(data), await readCookie(ACTIVE_STORE_COOKIE))
  } catch {
    return null
  }
}

async function withActiveStore(
  admin: ReturnType<typeof createAdminClient>,
  employee: SessionEmployee,
  requestedStoreId: string | undefined
): Promise<SessionEmployee> {
  const storeId = await resolveActiveStoreId(admin, {
    homeStoreId: employee.home_store_id,
    accessLevel: employee.access_level,
    requestedStoreId,
  })
  return { ...employee, store_id: storeId }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapToSessionEmployee(data: any): SessionEmployee {
  // Supabase nested select: roles → { name, access_level } veya null
  const roles = Array.isArray(data.roles) ? data.roles[0] : data.roles
  return {
    id: data.id as string,
    full_name: data.full_name as string,
    email: data.email as string | null,
    role_id: data.role_id as string | null,
    role_name: (roles?.name as string | undefined) ?? null,
    access_level: accessLevelOf(roles),
    active: data.active as boolean,
    home_store_id: data.store_id as string,
    store_id: data.store_id as string,
  }
}
