/**
 * PATCH /api/checklists/runs/[id] — bugünün uygulamasına serbest not yazar. Gövde: { note: string | null }
 * Yetki: madde işaretleme ile aynı (yönetici ya da bugün bu mağazada vardiyası olan).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, roleAtLeast, ACCESS } from '@/lib/auth'
import { badRequest, readJson } from '@/lib/apiErrors'
import { turkeyToday } from '@/lib/dateUtils'
import { isUuid } from '@/lib/validation'
import { setRunNote } from '@/lib/checklistRepository'
import { checklistErrorResponse, tickRateLimited } from '@/lib/checklistApi'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz ID.')

  const body = await readJson<{ note?: unknown }>(req)
  if (!body || (body.note !== null && typeof body.note !== 'string')) return badRequest('note alanı metin olmalıdır.')

  const limited = await tickRateLimited(employee.id)
  if (limited) return limited

  try {
    const note = await setRunNote({
      runId: id,
      note: body.note as string | null,
      actor: { id: employee.id, isManager: roleAtLeast(employee.access_level, ACCESS.MANAGER) },
      storeId: employee.store_id,
      today: turkeyToday(),
    })
    return NextResponse.json({ note })
  } catch (err) {
    return checklistErrorResponse('PATCH /api/checklists/runs/[id]', err)
  }
}
