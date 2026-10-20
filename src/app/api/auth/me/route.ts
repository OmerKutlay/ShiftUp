/**
 * GET /api/auth/me
 *
 * Mevcut session'dan authenticated employee kaydını döner.
 *
 * AUTH_MODE=development → dev_auth_session cookie'sinden employeeId okur
 * AUTH_MODE=production  → Supabase Auth cookie session'dan auth.uid() okur
 *
 * AuthContext tarafından her sayfa yüklemesinde çağrılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH, DEV_SESSION_COOKIE } from '@/lib/authConfig'
import { verifyDevSession } from '@/lib/auth/devSession'

const EMPLOYEE_SELECT = `
  id,
  full_name,
  email,
  role_id,
  active,
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
`

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminClient()

    if (IS_DEV_AUTH) {
      // ── Development: cookie'den employeeId oku ──────────────
      // İmzalı çerez — değiştirilmiş / süresi dolmuş çerez reddedilir
      const session = verifyDevSession(req.cookies.get(DEV_SESSION_COOKIE)?.value)
      if (!session) {
        return NextResponse.json({ employee: null }, { status: 401 })
      }
      const employeeId = session.employeeId

      const { data: employee } = await admin
        .from('employees')
        .select(EMPLOYEE_SELECT)
        .eq('id', employeeId)
        .maybeSingle()

      if (!employee || !employee.active) {
        return NextResponse.json({ employee: null }, { status: 403 })
      }

      return NextResponse.json({ employee })
    }

    // ── Production: Supabase Auth cookie session ─────────────
    // Bu blok yalnızca AUTH_MODE=production'da çalışır
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ employee: null }, { status: 401 })
    }

    const { data: employee } = await admin
      .from('employees')
      .select(EMPLOYEE_SELECT)
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!employee || !employee.active) {
      return NextResponse.json({ employee: null }, { status: 403 })
    }

    return NextResponse.json({ employee })
  } catch (err) {
    console.error('[GET /api/auth/me]', err)
    return NextResponse.json({ employee: null }, { status: 500 })
  }
}
