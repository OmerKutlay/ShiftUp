/**
 * PATCH  /api/employees/[id] — çalışanı günceller (Müdür Yardımcısı+).
 * DELETE /api/employees/[id] — çalışanı kalıcı olarak siler (Mağaza Müdürü+).
 *
 * Hiyerarşi: Yönetici herkesi; diğer yöneticiler yalnızca kendinden düşük
 * roldeki çalışanları yönetebilir. E-posta değişikliği bağlı Supabase Auth
 * kullanıcısına da yansıtılır (yalnızca yetkili yönetici yapabilir).
 *
 * Bağlı vardiya/devam kaydı olan çalışan silinemez (FK RESTRICT → 409);
 * UI bu durumda pasifleştirme önerir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES, canManageRole, forbidden } from '@/lib/auth'
import { updateEmployee } from '@/lib/employeeRepository'
import { validateEmployeeInput } from '@/lib/employeeValidation'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { logAudit } from '@/lib/auditLog'

type Ctx = { params: Promise<{ id: string }> }

async function loadTarget(id: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('id, full_name, email, active, auth_user_id, role_id, roles ( name )')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const roleName = (data.roles as unknown as { name: string } | null)?.name ?? null
  return { ...data, role_name: roleName }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz çalışan ID.')

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  try {
    const target = await loadTarget(id)
    if (!target) return notFound('Çalışan bulunamadı.')

    const isSelf = id === auth.employee.id
    if (!isSelf && !canManageRole(auth.employee.role_name, target.role_name)) {
      return forbidden('Bu çalışanı düzenleme yetkiniz yok.')
    }
    // Kendi hesabında rol/aktiflik/e-posta değiştirilemez (ad/pozisyon serbest)
    const normEmail = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null)
    if (
      isSelf &&
      ((body.role_id !== undefined && body.role_id !== target.role_id) ||
        (body.active !== undefined && body.active !== target.active) ||
        (body.email !== undefined && normEmail(body.email) !== (target.email ?? null)))
    ) {
      return forbidden('Kendi rolünüzü, e-postanızı veya durumunuzu değiştiremezsiniz.')
    }

    if (isSelf) {
      delete body.role_id
      delete body.active
      delete body.email
    }

    const result = await validateEmployeeInput(body, auth.employee.role_name, true)
    if ('error' in result) return badRequest(result.error)
    if (Object.keys(result.payload).length === 0) return badRequest('Güncellenecek alan yok.')

    const emailChanged =
      result.payload.email !== undefined && result.payload.email !== (target.email ?? null)

    const employee = await updateEmployee(id, result.payload)

    // Auth kullanıcısını senkron tut (e-posta değişti / pasifleştirildi)
    if (target.auth_user_id) {
      const admin = createAdminClient()
      if (emailChanged && result.payload.email) {
        const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, {
          email: result.payload.email,
          email_confirm: true,
        })
        if (error) console.error('[PATCH /api/employees/[id]] auth email sync:', error.message)
      }
      if (emailChanged || result.payload.active === false) {
        // Açık oturumları sonlandır
        await admin.auth.admin.signOut(target.auth_user_id).catch(() => undefined)
      }
    }

    await logAudit({
      actorId: auth.employee.id,
      action: 'employee.update',
      entityType: 'employee',
      entityId: id,
      before: { email: target.email, active: target.active, role_id: target.role_id },
      after: result.payload,
    })

    return NextResponse.json({ employee })
  } catch (err) {
    if (err instanceof Error && /duplicate|unique|23505/i.test(err.message)) {
      return conflict('Bu e-posta adresi başka bir çalışana ait.', 'DUPLICATE_EMAIL')
    }
    return serverError('PATCH /api/employees/[id]', err)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  // Authorization: en az Mağaza Müdürü yetkisi gerekir
  const auth = await requireMinRole(req, ROLES.MAGAZA_MUDURU)
  if ('response' in auth) return auth.response

  try {
    const { id } = await params

    if (!isUuid(id)) {
      return badRequest('Geçersiz çalışan ID.', 'MISSING_ID')
    }

    if (id === auth.employee.id) {
      return badRequest('Kendi hesabınızı silemezsiniz.', 'SELF_DELETE')
    }

    const admin = createAdminClient()

    const employee = await loadTarget(id)
    if (!employee) return notFound('Çalışan bulunamadı.')

    if (!canManageRole(auth.employee.role_name, employee.role_name)) {
      return forbidden('Bu çalışanı silme yetkiniz yok.')
    }

    const { error: deleteError } = await admin
      .from('employees')
      .delete()
      .eq('id', id)

    if (deleteError) {
      // FK ihlali — bağlı kayıtlar var
      if (deleteError.code === '23503') {
        return conflict(
          'Bu çalışanın bağlı vardiya veya devam kayıtları var. Silmek yerine pasifleştirmeyi deneyin.',
          'FK_VIOLATION'
        )
      }
      return serverError('DELETE /api/employees/[id]', deleteError)
    }

    // Supabase Auth kullanıcısını da sil (varsa)
    if (employee.auth_user_id) {
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(employee.auth_user_id)
      if (authDeleteError) {
        // Auth silme başarısız olsa bile employee kaydı silindi — log at, hata verme
        console.error('[DELETE /api/employees] Auth user delete failed:', authDeleteError.message)
      }
    }

    await logAudit({
      actorId: auth.employee.id,
      action: 'employee.delete',
      entityType: 'employee',
      entityId: id,
      before: { full_name: employee.full_name, email: employee.email },
    })

    return NextResponse.json({ success: true, deleted_id: id })
  } catch (err) {
    return serverError('DELETE /api/employees/[id]', err)
  }
}
