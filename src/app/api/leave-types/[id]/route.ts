/**
 * PATCH /api/leave-types/[id] — izin türünü günceller (yalnızca Admin).
 * Body: { name?, employee_requestable?, active? }. Puantaj kodu (base_type) değiştirilemez; tür silinmez,
 * active=false ile pasifleştirilir (geçmiş kayıtlar adıyla görünmeye devam eder, yeni kayıtta seçilemez).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { logAudit } from '@/lib/auditLog'
import {
  LEAVE_TYPE_DEF_COLUMNS, MAX_LEAVE_TYPE_NAME, getLeaveType, parseLeaveTypeName,
} from '@/lib/leaveTypeRepository'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz izin türü.')

  const body = await readJson<{ name?: unknown; employee_requestable?: unknown; active?: unknown; base_type?: unknown }>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')
  if (body.base_type !== undefined) return badRequest('İzin türünün puantaj kodu değiştirilemez.')

  const patch: { name?: string; employee_requestable?: boolean; active?: boolean } = {}
  if (body.name !== undefined) {
    const name = parseLeaveTypeName(body.name)
    if (!name) return badRequest(`İzin türü adı zorunludur (en fazla ${MAX_LEAVE_TYPE_NAME} karakter).`)
    patch.name = name
  }
  for (const key of ['employee_requestable', 'active'] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') return badRequest('Geçersiz değer.')
    patch[key] = body[key] as boolean
  }
  if (Object.keys(patch).length === 0) return badRequest('Güncellenecek alan yok.')

  try {
    const admin = createAdminClient()
    const before = await getLeaveType(admin, id)
    if (!before) return notFound('İzin türü bulunamadı.')

    const { data, error } = await admin
      .from('leave_type_definitions')
      .update(patch)
      .eq('id', id)
      .select(LEAVE_TYPE_DEF_COLUMNS)
      .single()
    if (error) {
      if (error.code === '23505') return conflict('Bu adda bir izin türü zaten var.', 'LEAVE_TYPE_EXISTS')
      return serverError('PATCH /api/leave-types/[id]', error)
    }
    await logAudit({
      actorId: auth.employee.id,
      storeId: auth.employee.store_id,
      action: 'leave_type.update',
      entityType: 'leave_type',
      entityId: id,
      before: { name: before.name, employee_requestable: before.employee_requestable, active: before.active },
      after: patch,
    })
    return NextResponse.json({ type: data })
  } catch (err) {
    return serverError('PATCH /api/leave-types/[id]', err)
  }
}
