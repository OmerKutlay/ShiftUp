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
import type { RoleName } from './roles'

export interface SessionEmployee {
  id: string
  full_name: string
  email: string | null
  role: string          // serbest metin (unvan)
  role_id: string | null
  role_name: RoleName | null  // roles tablosundan gelen yapılandırılmış rol
  active: boolean
}

const EMPLOYEE_SELECT = `
  id,
  full_name,
  email,
  role,
  role_id,
  active,
  roles ( name )
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

      if (!cookieVal) return null

      let employeeId: string
      try {
        const parsed = JSON.parse(cookieVal) as { employeeId?: string }
        if (!parsed.employeeId) return null
        employeeId = parsed.employeeId
      } catch {
        return null
      }

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
  // Supabase nested select: roles → { name } veya null
  const roleName = data.roles?.name ?? null
  return {
    id: data.id as string,
    full_name: data.full_name as string,
    email: data.email as string | null,
    role: data.role as string,
    role_id: data.role_id as string | null,
    role_name: roleName as RoleName | null,
    active: data.active as boolean,
  }
}
