/**
 * GET  /api/stores — erişilebilen mağazalar (Admin: hepsi; diğerleri: kendi mağazası)
 * POST /api/stores — yeni mağaza (yalnızca Admin)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, conflict, readJson, serverError } from '@/lib/apiErrors'
import { canSwitchStore } from '@/lib/storeScope'
import { createStore, fetchStores, StoreValidationError } from '@/lib/storeRepository'
import { logAudit } from '@/lib/auditLog'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, { allowKiosk: true })
  if ('response' in auth) return auth.response
  const { employee } = auth

  try {
    const stores = canSwitchStore(employee.access_level)
      ? await fetchStores()
      : await fetchStores({ ids: [employee.home_store_id] })
    return NextResponse.json({ stores, active_store_id: employee.store_id })
  } catch (err) {
    return serverError('GET /api/stores', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  const body = await readJson<{ name?: unknown }>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  try {
    const store = await createStore({ name: body.name })
    await logAudit({
      actorId: auth.employee.id,
      storeId: store.id,
      action: 'store.create',
      entityType: 'store',
      entityId: store.id,
      after: { name: store.name },
    })
    return NextResponse.json({ store }, { status: 201 })
  } catch (err) {
    if (err instanceof StoreValidationError) {
      return err.code === 'DUPLICATE_STORE_NAME' ? conflict(err.message, err.code) : badRequest(err.message, err.code)
    }
    return serverError('POST /api/stores', err)
  }
}
