/**
 * PATCH  /api/employees/[id] — çalışanı günceller (Müdür Yardımcısı+).
 * DELETE /api/employees/[id] — çalışanı kalıcı olarak siler (Mağaza Müdürü+).
 *
 * Mağaza kapsamı: hedef çalışan aktif mağazada olmalıdır; değilse 404 (başka mağazanın
 * çalışanının varlığı sızdırılmaz).
 *
 * Mağaza transferi: PATCH gövdesinde store_id yalnızca Admin içindir; hedef mağaza var ve
 * aktif olmalı. Vardiyalar mağazaya bağlı kaldığından, eski mağazada bugün ve sonrasına
 * ait vardiyası olan çalışan taşınamaz (409 HAS_FUTURE_SHIFTS) — önce o vardiyalar silinmelidir.
 *
 * Hiyerarşi: Yönetici herkesi; diğer yöneticiler yalnızca kendinden düşük
 * roldeki çalışanları yönetebilir. E-posta değişikliği bağlı Supabase Auth
 * kullanıcısına da yansıtılır (yalnızca yetkili yönetici yapabilir).
 *
 * Vardiya/devam/izin/mesai kaydı olan çalışan silinemez (409 HAS_RECORDS);
 * UI bu durumda "İşten çıkış" akışını önerir (bkz. ./offboarding).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS, accessLevelOf, canManageRole, forbidden } from '@/lib/auth'
import { isActiveStore, updateEmployee } from '@/lib/employeeRepository'
import { validateEmployeeInput } from '@/lib/employeeValidation'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { canSwitchStore } from '@/lib/storeScope'
import { turkeyToday } from '@/lib/dateUtils'
import { logAudit } from '@/lib/auditLog'
import { addLateJoinerRecipient } from '@/lib/announcementService'

type Ctx = { params: Promise<{ id: string }> }

/** Hedef çalışan — yalnızca verilen (aktif) mağazadaysa döner; başka mağazadaysa null */
async function loadTarget(id: string, storeId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('id, full_name, email, active, auth_user_id, role_id, store_id, termination_date, roles ( access_level )')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { ...data, access_level: accessLevelOf(data.roles) }
}

/** Çalışanın silinmesi halinde kaybolacak kayıtları var mı? */
async function hasEmployeeRecords(employeeId: string): Promise<boolean> {
  const admin = createAdminClient()
  for (const table of ['shift_assignments', 'attendance_records', 'leave_requests', 'manual_time_correction_requests']) {
    const { count, error } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', employeeId)
    if (error) throw error
    if ((count ?? 0) > 0) return true
  }
  return false
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz çalışan ID.')

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  try {
    const activeStoreId = auth.employee.store_id
    const target = await loadTarget(id, activeStoreId)
    if (!target) return notFound('Çalışan bulunamadı.')

    const isSelf = id === auth.employee.id
    if (!isSelf && !canManageRole(auth.employee.access_level, target.access_level)) {
      return forbidden('Bu çalışanı düzenleme yetkiniz yok.')
    }
    // Kendi hesabında rol/aktiflik/e-posta/mağaza değiştirilemez (ad serbest)
    const normEmail = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null)
    if (
      isSelf &&
      ((body.role_id !== undefined && body.role_id !== target.role_id) ||
        (body.active !== undefined && body.active !== target.active) ||
        (body.email !== undefined && normEmail(body.email) !== (target.email ?? null)) ||
        (body.store_id !== undefined && body.store_id !== target.store_id))
    ) {
      return forbidden('Kendi rolünüzü, e-postanızı, mağazanızı veya durumunuzu değiştiremezsiniz.')
    }

    if (isSelf) {
      delete body.role_id
      delete body.active
      delete body.email
      delete body.store_id
    }

    // Mağaza transferi — yalnızca Admin; hedef mağaza var ve aktif olmalı
    let transferTo: string | null = null
    if (body.store_id !== undefined && body.store_id !== null && body.store_id !== target.store_id) {
      if (!canSwitchStore(auth.employee.access_level)) {
        return forbidden('Çalışanı başka mağazaya taşıma yetkiniz yok.')
      }
      if (!isUuid(body.store_id)) return badRequest('Geçersiz mağaza ID.')
      if (target.termination_date) {
        return conflict('İşten çıkışı kayıtlı çalışan başka mağazaya taşınamaz.', 'TERMINATED')
      }
      if (!(await isActiveStore(body.store_id))) {
        return notFound('Hedef mağaza bulunamadı veya aktif değil.', 'STORE_NOT_FOUND')
      }
      // Vardiyalar eski mağazada kalır: bugün ve sonrası için vardiyası varsa taşıma yapılmaz
      const { data: futureShifts, error: fsErr } = await createAdminClient()
        .from('shift_assignments')
        .select('id')
        .eq('employee_id', id)
        .eq('store_id', target.store_id)
        .gte('work_date', turkeyToday())
        .limit(1)
      if (fsErr) throw fsErr
      if (futureShifts && futureShifts.length > 0) {
        return conflict(
          'Bu çalışanın bugün veya sonrası için vardiyası var. Başka mağazaya taşımadan önce gelecekteki vardiyalarını silin.',
          'HAS_FUTURE_SHIFTS'
        )
      }
      transferTo = body.store_id
    }
    // Transfer dışında store_id doğrulayıcıya/güncellemeye taşınmaz
    delete body.store_id

    const result = await validateEmployeeInput(body, auth.employee.access_level, true)
    if ('error' in result) return badRequest(result.error)
    if (transferTo) result.payload.store_id = transferTo
    if (Object.keys(result.payload).length === 0) return badRequest('Güncellenecek alan yok.')
    // İşten çıkışı kayıtlı çalışan elle aktifleştirilemez; ayrılış önce (Admin) geri alınmalı
    if (result.payload.active === true && target.termination_date) {
      return conflict('Bu çalışanın işten çıkışı kayıtlı. Aktifleştirmek için önce işten çıkışı geri alın.', 'TERMINATED')
    }

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
      storeId: activeStoreId,
      action: 'employee.update',
      entityType: 'employee',
      entityId: id,
      before: { email: target.email, active: target.active, role_id: target.role_id, store_id: target.store_id },
      after: result.payload,
    })
    if (transferTo) {
      // Yeni mağazanın sabit / onay zorunlu duyurularına alıcı olarak eklenir; hata transferi bozmaz
      await addLateJoinerRecipient(createAdminClient(), id).catch((e) =>
        console.error('[PATCH /api/employees/[id]] duyuru alıcı ekleme', e))
      // Transfer hem eski hem yeni mağazanın denetim kaydında görünür
      for (const storeId of new Set([activeStoreId, transferTo])) {
        await logAudit({
          actorId: auth.employee.id,
          storeId,
          action: 'employee.transfer',
          entityType: 'employee',
          entityId: id,
          before: { store_id: target.store_id },
          after: { store_id: transferTo },
        })
      }
    }

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
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
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

    const employee = await loadTarget(id, auth.employee.store_id)
    if (!employee) return notFound('Çalışan bulunamadı.')

    if (!canManageRole(auth.employee.access_level, employee.access_level)) {
      return forbidden('Bu çalışanı silme yetkiniz yok.')
    }

    // Yasal kayıtlar (vardiya, devam, izin, mesai) korunur: geçmişi olan çalışan silinmez,
    // "İşten çıkış" akışı kullanılır. Yalnızca hiçbir kaydı olmayan (ör. yanlış eklenmiş) çalışan silinebilir.
    if (employee.termination_date || (await hasEmployeeRecords(id))) {
      return conflict(
        'Bu çalışanın vardiya, devam veya izin kayıtları var; yasal kayıtlar korunduğu için silinemez. Bunun yerine "İşten çıkış" işlemini kullanın.',
        'HAS_RECORDS'
      )
    }

    const { error: deleteError } = await admin
      .from('employees')
      .delete()
      .eq('id', id)
      .eq('store_id', auth.employee.store_id)

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
      storeId: auth.employee.store_id,
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
