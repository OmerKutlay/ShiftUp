/**
 * PATCH /api/stores/[id] — mağaza adını değiştirir / (de)aktive eder (yalnızca Admin)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { StoreValidationError, updateStore } from '@/lib/storeRepository'
import { logAudit } from '@/lib/auditLog'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz mağaza ID.')

  const body = await readJson<{ name?: unknown; active?: unknown }>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  try {
    const result = await updateStore(id, { name: body.name, active: body.active })
    if (!result) return notFound('Mağaza bulunamadı.')
    await logAudit({
      actorId: auth.employee.id,
      storeId: id,
      action: 'store.update',
      entityType: 'store',
      entityId: id,
      before: { name: result.before.name, active: result.before.active },
      after: { name: result.after.name, active: result.after.active },
    })
    return NextResponse.json({ store: result.after })
  } catch (err) {
    if (err instanceof StoreValidationError) {
      return err.code === 'VALIDATION_ERROR' ? badRequest(err.message) : conflict(err.message, err.code)
    }
    return serverError('PATCH /api/stores/[id]', err)
  }
}
