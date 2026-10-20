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
 * NOT: 'next/headers' dynamic import kullanılır — top-level import
 * Next.js'in modülü Client Component chain'i olarak işaretlemesine yol açar.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH, DEV_SESSION_COOKIE } from '@/lib/authConfig'
import { verifyDevSession } from './devSession'
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
}

const EMPLOYEE_SELECT = `
  id,
  full_name,
  email,
  role_id,
  active,
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
  req?: { cookies: { get(name: string): { value: string } | undefined } }
): Promise<SessionEmployee | null> {
  try {
    const admin = createAdminClient()

    if (IS_DEV_AUTH) {
      // Dev: cookie'den employeeId oku
      let cookieVal: string | undefined

      if (req) {
        cookieVal = req.cookies.get(DEV_SESSION_COOKIE)?.value
      } else {
        // next/headers dynamic import — top-level import yapmak modülü bozar
        const { cookies } = await import('next/headers')
        const cookieStore = await cookies()
        cookieVal = cookieStore.get(DEV_SESSION_COOKIE)?.value
      }

      // İmzalı çerez — değiştirilmiş / süresi dolmuş çerez reddedilir
      const session = verifyDevSession(cookieVal)
      if (!session) return null
      const employeeId = session.employeeId

      const { data } = await admin
        .from('employees')
        .select(EMPLOYEE_SELECT)
        .eq('id', employeeId)
        .maybeSingle()

      if (!data || !data.active) return null

      return mapToSessionEmployee(data)
    }

    // Production: Supabase Auth
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await admin
      .from('employees')
      .select(EMPLOYEE_SELECT)
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!data || !data.active) return null

    return mapToSessionEmployee(data)
  } catch {
    return null
  }
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
  }
}
