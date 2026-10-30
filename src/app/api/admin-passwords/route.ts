/**
 * GET  /api/admin-passwords — aktif adminler ve admin giriş şifresi durumu (yalnızca Admin)
 * POST /api/admin-passwords — bir adminin giriş şifresini belirler / değiştirir (yalnızca Admin)
 *
 * Admin girişi (/login/admin) e-posta kodundan önce bu şifreyi ister — bkz. @/lib/auth/adminLogin.
 * Şifresi olmayan admin giriş yapamaz; ilk şifreyi başka bir admin buradan (ya da sahibi
 * scripts/set-admin-password.mjs ile) belirler.
 *
 * POST body: { employee_id: string, password: string, current_password?: string }
 *   Kendi şifresini değiştiren admin mevcut şifresini de girer (açık bırakılmış oturum
 *   ele geçirilse bile şifre değiştirilemesin). Başka bir adminin şifresi doğrudan belirlenir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, notFound, readJson, serverError, tooManyRequests } from '@/lib/apiErrors'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { isEffectivelyActive } from '@/lib/employment'
import { accessLevelOf } from '@/lib/auth/roles'
import { adminPasswordProblem, setAdminPassword, verifyAdminPassword } from '@/lib/auth/adminPassword'
import { checkRateLimit } from '@/lib/rateLimiter'
import { logAudit } from '@/lib/auditLog'
import type { AdminPasswordRow } from '@/types/adminPassword'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  try {
    const admin = createAdminClient()
    const { data: roles, error: rolesErr } = await admin.from('roles').select('id').eq('access_level', ACCESS.ADMIN)
    if (rolesErr) throw rolesErr
    const roleIds = (roles ?? []).map((r) => r.id as string)
    if (roleIds.length === 0) return NextResponse.json({ admins: [] })

    const { data: employees, error: empErr } = await admin
      .from('employees')
      .select('id, full_name, email, active, termination_date')
      .in('role_id', roleIds)
      .eq('active', true)
      .order('full_name')
    if (empErr) throw empErr
    const active = (employees ?? []).filter((e) => isEffectivelyActive(e))

    const ids = active.map((e) => e.id as string)
    const { data: creds, error: credErr } = ids.length
      ? await admin.from('admin_credentials').select('employee_id, updated_at').in('employee_id', ids)
      : { data: [], error: null }
    if (credErr) throw credErr
    const updatedAt = new Map((creds ?? []).map((c) => [c.employee_id as string, c.updated_at as string]))

    const admins: AdminPasswordRow[] = active.map((e) => ({
      id: e.id as string,
      full_name: e.full_name as string,
      email: e.email as string | null,
      has_password: updatedAt.has(e.id as string),
      password_updated_at: updatedAt.get(e.id as string) ?? null,
      is_self: e.id === auth.employee.id,
    }))
    return NextResponse.json({ admins })
  } catch (err) {
    return serverError('GET /api/admin-passwords', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response
  const actor = auth.employee

  const body = await readJson<{ employee_id?: unknown; password?: unknown; current_password?: unknown }>(req)
  if (!body || typeof body.employee_id !== 'string') return badRequest('Geçersiz istek gövdesi.')
  const problem = adminPasswordProblem(body.password)
  if (problem) return badRequest(problem, 'INVALID_PASSWORD')
  const password = body.password as string
  const isSelf = body.employee_id === actor.id

  const rate = await checkRateLimit(`admin_pw_set:${actor.id}`, 10, 15 * 60 * 1000, { failClosed: true })
  if (!rate.allowed) return tooManyRequests()

  try {
    const admin = createAdminClient()
    const { data: target, error: targetErr } = await admin
      .from('employees')
      .select('id, active, termination_date, roles ( access_level )')
      .eq('id', body.employee_id)
      .maybeSingle()
    if (targetErr) throw targetErr
    if (!target || !isEffectivelyActive(target) || accessLevelOf(target.roles) !== ACCESS.ADMIN) {
      return notFound('Aktif admin bulunamadı.')
    }

    if (isSelf && !(await verifyAdminPassword(admin, actor.id, body.current_password))) {
      return badRequest('Mevcut admin şifreniz hatalı.', 'INVALID_CURRENT_PASSWORD')
    }

    await setAdminPassword(admin, target.id as string, password, actor.id)
    await logAudit({
      actorId: actor.id,
      storeId: null,
      action: 'employee.admin_password_set',
      entityType: 'employee',
      entityId: target.id as string,
      // Şifre ya da özeti asla kayda yazılmaz
      after: { self: isSelf },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return serverError('POST /api/admin-passwords', err)
  }
}
