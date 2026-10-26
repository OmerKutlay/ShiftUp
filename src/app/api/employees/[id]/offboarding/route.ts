/**
 * İşten ayrılış (offboarding) — /api/employees/[id]/offboarding
 *
 * GET    ?date=YYYY-MM-DD — önizleme (Müdür+): silinecek vardiyalar, iptal edilecek talepler, izin bakiyesi
 * POST   — ayrılışı uygular (Müdür+): { last_day, reason, note?, convert_to_open_shifts? }
 * DELETE — ayrılışı geri alır (yalnızca Admin); silinen vardiyalar geri gelmez
 *
 * Kurallar: hedef aktif mağazada olmalı (değilse 404); kimse kendini çıkaramaz; Admin dışında
 * kendi seviyesindeki veya üstündeki çalışan çıkarılamaz (canManageRole).
 * Son çalışma günü dahildir; hesap ertesi gün pasifleşir (bkz. src/lib/employment.ts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS, accessLevelOf, canManageRole, forbidden } from '@/lib/auth'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { turkeyToday } from '@/lib/dateUtils'
import { logAudit } from '@/lib/auditLog'
import { isTerminationReason } from '@/types/employee'
import {
  applyOffboarding, buildOffboardingPreview, undoOffboarding, validateLastDay,
  type TerminationTarget,
} from '@/lib/employeeOffboarding'

type Ctx = { params: Promise<{ id: string }> }

async function loadTarget(id: string, storeId: string) {
  const { data, error } = await createAdminClient()
    .from('employees')
    .select('id, full_name, hire_date, birth_date, store_id, active, termination_date, termination_reason, roles ( access_level )')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as TerminationTarget & { active: boolean; termination_reason: string | null; roles: unknown }
  return { ...row, access_level: accessLevelOf(row.roles as never) }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response
  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz çalışan ID.')

  try {
    const target = await loadTarget(id, auth.employee.store_id)
    if (!target) return notFound('Çalışan bulunamadı.')
    if (id === auth.employee.id) return forbidden('Kendi işten çıkışınızı başlatamazsınız.')
    if (!canManageRole(auth.employee.access_level, target.access_level)) {
      return forbidden('Bu çalışanın işten çıkışını yapma yetkiniz yok.')
    }
    const date = req.nextUrl.searchParams.get('date') ?? turkeyToday()
    const invalid = validateLastDay(date, target.hire_date)
    if (invalid) return badRequest(invalid)

    const preview = await buildOffboardingPreview(createAdminClient(), target, date)
    return NextResponse.json({ preview })
  } catch (err) {
    return serverError('GET /api/employees/[id]/offboarding', err)
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response
  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz çalışan ID.')

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  try {
    const target = await loadTarget(id, auth.employee.store_id)
    if (!target) return notFound('Çalışan bulunamadı.')
    if (id === auth.employee.id) return forbidden('Kendi işten çıkışınızı başlatamazsınız.')
    if (!canManageRole(auth.employee.access_level, target.access_level)) {
      return forbidden('Bu çalışanın işten çıkışını yapma yetkiniz yok.')
    }
    if (target.termination_date) {
      return conflict('Bu çalışanın işten çıkışı zaten kayıtlı. Değiştirmek için önce (Admin) geri alınmalıdır.', 'ALREADY_TERMINATED')
    }
    if (!target.active) {
      return conflict('Pasif çalışan için işten çıkış başlatılamaz.', 'EMPLOYEE_INACTIVE')
    }

    const invalid = validateLastDay(body.last_day, target.hire_date)
    if (invalid) return badRequest(invalid)
    if (!isTerminationReason(body.reason)) return badRequest('Geçerli bir işten çıkış nedeni seçin.')
    let note: string | null = null
    if (body.note !== undefined && body.note !== null && body.note !== '') {
      if (typeof body.note !== 'string' || body.note.length > 500) return badRequest('Not en fazla 500 karakter olabilir.')
      note = body.note.trim() || null
    }
    const convert = body.convert_to_open_shifts === true

    const result = await applyOffboarding(createAdminClient(), {
      emp: target,
      actorId: auth.employee.id,
      lastDay: body.last_day as string,
      reason: body.reason,
      note,
      convertToOpenShifts: convert,
    })
    if (!result) return conflict('Bu çalışanın işten çıkışı zaten kayıtlı.', 'ALREADY_TERMINATED')

    await logAudit({
      actorId: auth.employee.id,
      storeId: auth.employee.store_id,
      action: 'employee.terminate',
      entityType: 'employee',
      entityId: id,
      before: { active: target.active },
      after: {
        termination_date: body.last_day,
        termination_reason: body.reason,
        termination_note: note,
        termination_leave_balance: result.leave_balance,
        active: !result.deactivated_now,
        shifts_deleted: result.shifts_deleted,
        shifts_converted: result.shifts_converted,
        leave_cancelled: result.leave_cancelled,
        time_corrections_cancelled: result.time_corrections_cancelled,
        swaps_cancelled: result.swaps_cancelled,
      },
    })

    return NextResponse.json({ result })
  } catch (err) {
    return serverError('POST /api/employees/[id]/offboarding', err)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response
  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz çalışan ID.')

  try {
    const target = await loadTarget(id, auth.employee.store_id)
    if (!target) return notFound('Çalışan bulunamadı.')
    if (!target.termination_date) return conflict('Bu çalışanın işten çıkışı kayıtlı değil.', 'NOT_TERMINATED')

    const ok = await undoOffboarding(createAdminClient(), id)
    if (!ok) return conflict('Bu çalışanın işten çıkışı kayıtlı değil.', 'NOT_TERMINATED')

    await logAudit({
      actorId: auth.employee.id,
      storeId: auth.employee.store_id,
      action: 'employee.terminate_undo',
      entityType: 'employee',
      entityId: id,
      before: { termination_date: target.termination_date, termination_reason: target.termination_reason, active: target.active },
      after: { termination_date: null, active: true },
      note: 'Silinen vardiyalar geri yüklenmedi.',
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return serverError('DELETE /api/employees/[id]/offboarding', err)
  }
}
