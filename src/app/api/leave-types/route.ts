/**
 * GET  /api/leave-types — şirket genelindeki izin türleri (oturum gerektirir; pasifler dahil, active alanıyla)
 * POST /api/leave-types — yeni izin türü (yalnızca Admin). Body: { name, base_type, employee_requestable? }
 *
 * Temel tür (puantaj kodu) oluşturulduktan sonra değişmez; tür silinmez, pasifleştirilir (bkz. [id]).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, conflict, readJson, serverError } from '@/lib/apiErrors'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { logAudit } from '@/lib/auditLog'
import {
  LEAVE_TYPE_DEF_COLUMNS, MAX_LEAVE_TYPE_NAME, listLeaveTypes, parseLeaveTypeName,
} from '@/lib/leaveTypeRepository'
import { LEAVE_BASE_TYPES, type LeaveBaseType } from '@/types/leave'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  try {
    return NextResponse.json({ types: await listLeaveTypes(createAdminClient()) })
  } catch (err) {
    return serverError('GET /api/leave-types', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  const body = await readJson<{ name?: unknown; base_type?: unknown; employee_requestable?: unknown }>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')
  const name = parseLeaveTypeName(body.name)
  if (!name) return badRequest(`İzin türü adı zorunludur (en fazla ${MAX_LEAVE_TYPE_NAME} karakter).`)
  if (!LEAVE_BASE_TYPES.includes(body.base_type as LeaveBaseType)) return badRequest('Geçersiz puantaj kodu.')
  const baseType = body.base_type as LeaveBaseType
  // Resmi tatil yönetici ataması içindir; çalışan talebine varsayılan olarak kapalı
  const requestable = typeof body.employee_requestable === 'boolean'
    ? body.employee_requestable
    : baseType !== 'public_holiday'

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('leave_type_definitions')
      .insert({ name, base_type: baseType, employee_requestable: requestable, created_by: auth.employee.id })
      .select(LEAVE_TYPE_DEF_COLUMNS)
      .single()
    if (error) {
      if (error.code === '23505') return conflict('Bu adda bir izin türü zaten var.', 'LEAVE_TYPE_EXISTS')
      return serverError('POST /api/leave-types', error)
    }
    await logAudit({
      actorId: auth.employee.id,
      storeId: auth.employee.store_id,
      action: 'leave_type.create',
      entityType: 'leave_type',
      entityId: data.id,
      after: { name, base_type: baseType, employee_requestable: requestable },
    })
    return NextResponse.json({ type: data }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/leave-types', err)
  }
}
