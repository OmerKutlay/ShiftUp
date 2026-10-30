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
import { isEffectivelyActive } from '@/lib/employment'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH, DEV_SESSION_COOKIE } from '@/lib/authConfig'
import { verifyDevSession } from '@/lib/auth/devSession'
import { isSessionExpired, sessionIdOf } from '@/lib/auth/sessionAge'
import { ADMIN_VERIFIED_COOKIE, devSessionId, passesAdminLogin } from '@/lib/auth/adminLogin'
import { accessLevelOf } from '@/lib/auth/roles'
import { ACTIVE_STORE_COOKIE, canSwitchStore, resolveActiveStoreId } from '@/lib/storeScope'
import type { StoreContextInfo } from '@/types/store'

const EMPLOYEE_SELECT = `
  id,
  full_name,
  email,
  role_id,
  active,
  store_id,
  termination_date,
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

      if (!employee || !isEffectivelyActive(employee)) {
        return NextResponse.json({ employee: null }, { status: 403 })
      }
      if (!(await passesAdminLoginFor(employee, req, devSessionId(session.createdAt)))) {
        return adminLoginRequired()
      }

      return NextResponse.json({ employee, store: await storeContext(admin, employee, req) })
    }

    // ── Production: Supabase Auth cookie session ─────────────
    // Bu blok yalnızca AUTH_MODE=production'da çalışır
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ employee: null }, { status: 401 })
    }

    // Girişten 30 gün geçtiyse oturum kesin kapanır (bkz. sessionAge)
    const { data: { session } } = await supabase.auth.getSession()
    if (isSessionExpired(session?.access_token, user.last_sign_in_at)) {
      await supabase.auth.signOut().catch(() => {})
      return NextResponse.json({ employee: null }, { status: 401 })
    }

    const { data: employee } = await admin
      .from('employees')
      .select(EMPLOYEE_SELECT)
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!employee || !isEffectivelyActive(employee)) {
      return NextResponse.json({ employee: null }, { status: 403 })
    }
    if (!(await passesAdminLoginFor(employee, req, sessionIdOf(session?.access_token)))) {
      return adminLoginRequired()
    }

    return NextResponse.json({ employee, store: await storeContext(admin, employee, req) })
  } catch (err) {
    console.error('[GET /api/auth/me]', err)
    return NextResponse.json({ employee: null }, { status: 500 })
  }
}

/** Admin hesabı yalnızca admin girişiyle (şifre + kod) açılmış oturumda geçerlidir — bkz. adminLogin */
function passesAdminLoginFor(
  employee: { id: string; roles: unknown },
  req: NextRequest,
  sessionId: string | null
): Promise<boolean> {
  return passesAdminLogin(accessLevelOf(employee.roles), req.cookies.get(ADMIN_VERIFIED_COOKIE)?.value, employee.id, sessionId)
}

function adminLoginRequired() {
  return NextResponse.json({ employee: null, reason: 'ADMIN_LOGIN_REQUIRED' }, { status: 401 })
}

/** Aktif mağaza bağlamı (admin: çerezdeki seçim; diğerleri: ana mağaza) */
async function storeContext(
  admin: ReturnType<typeof createAdminClient>,
  employee: { store_id: string; roles: unknown },
  req: NextRequest
): Promise<StoreContextInfo | null> {
  const accessLevel = accessLevelOf(employee.roles)
  const activeId = await resolveActiveStoreId(admin, {
    homeStoreId: employee.store_id,
    accessLevel,
    requestedStoreId: req.cookies.get(ACTIVE_STORE_COOKIE)?.value,
  })
  const { data } = await admin.from('stores').select('id, name').eq('id', activeId).maybeSingle()
  if (!data) return null
  return {
    active: data as { id: string; name: string },
    home_store_id: employee.store_id,
    can_switch: canSwitchStore(accessLevel),
  }
}
