/**
 * PATCH  /api/shifts/[id] — vardiya saatini/şablonunu günceller (Müdür Yardımcısı+)
 * DELETE /api/shifts/[id] — vardiyayı siler (Müdür Yardımcısı+). Devam kaydı olan
 *                           vardiya silinemez (çalışılmış saatler korunur).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { updateShiftAssignment, deleteShiftAssignment } from '@/lib/scheduleRepository'
import { ShiftConflictError } from '@/types/schedule'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid, isValidTime } from '@/lib/validation'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { logAudit } from '@/lib/auditLog'
import { checkAssignmentRules } from '@/lib/shiftAssignmentRules'
import type { UpdateShiftAssignmentPayload } from '@/types/schedule'

type Ctx = { params: Promise<{ id: string }> }

async function loadShift(id: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('shift_assignments')
    .select('id, employee_id, work_date, start_time, end_time, shift_template_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz vardiya ID.')

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  const payload: UpdateShiftAssignmentPayload = {}
  if (body.shift_template_id !== undefined) {
    if (body.shift_template_id !== null && !isUuid(body.shift_template_id)) {
      return badRequest('Geçersiz vardiya şablonu.')
    }
    payload.shift_template_id = body.shift_template_id as string | null
  }
  if (body.start_time !== undefined || body.end_time !== undefined) {
    if (!isValidTime(body.start_time) || !isValidTime(body.end_time)) {
      return badRequest('Başlangıç ve bitiş saati birlikte, HH:MM formatında gönderilmelidir.')
    }
    if (body.start_time.slice(0, 5) === body.end_time.slice(0, 5)) {
      return badRequest('Başlangıç ve bitiş saati aynı olamaz.')
    }
    payload.start_time = body.start_time.slice(0, 5)
    payload.end_time = body.end_time.slice(0, 5)
  }
  if (Object.keys(payload).length === 0) return badRequest('Güncellenecek alan yok.')

  try {
    const shift = await loadShift(id)
    if (!shift) return notFound('Vardiya bulunamadı.')

    let violations: string[] = []
    if (payload.start_time && payload.end_time) {
      const rules = await checkAssignmentRules(
        createAdminClient(), shift.employee_id,
        { work_date: shift.work_date, start_time: payload.start_time, end_time: payload.end_time },
        [id]
      )
      const blockers = rules.blockers.filter((b) => !b.includes('çakışıyor'))
      if (blockers.length > 0) return conflict(blockers.join(' '), 'ASSIGNMENT_BLOCKED')
      violations = rules.violations.map((v) => v.message)
      if (violations.length > 0 && body.acknowledge_violations !== true) {
        return NextResponse.json(
          { error: 'Bu vardiya çalışma süresi kurallarını ihlal ediyor.', code: 'WORKING_TIME_VIOLATION', violations },
          { status: 422 }
        )
      }
    }

    const assignment = await updateShiftAssignment(id, shift.employee_id, shift.work_date, payload)

    await logAudit({
      actorId: auth.employee.id,
      action: 'shift.update',
      entityType: 'shift_assignment',
      entityId: id,
      before: shift,
      after: payload,
      note: violations.length > 0 ? `İhlaller onaylandı: ${violations.join(' | ')}` : null,
    })

    return NextResponse.json({ assignment })
  } catch (err) {
    if (err instanceof ShiftConflictError) return conflict(err.message, 'SHIFT_CONFLICT')
    return serverError('PATCH /api/shifts/[id]', err)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz vardiya ID.')

  try {
    const shift = await loadShift(id)
    if (!shift) return notFound('Vardiya bulunamadı.')

    await deleteShiftAssignment(id)

    await logAudit({
      actorId: auth.employee.id,
      action: 'shift.delete',
      entityType: 'shift_assignment',
      entityId: id,
      before: shift,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ShiftConflictError) return conflict(err.message, 'HAS_ATTENDANCE')
    return serverError('DELETE /api/shifts/[id]', err)
  }
}
