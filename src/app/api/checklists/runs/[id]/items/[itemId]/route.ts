/**
 * PATCH /api/checklists/runs/[id]/items/[itemId] — maddeyi işaretler / geri alır. Gövde: { done: boolean }
 *
 * İşaretleme: yönetici ya da bugün bu mağazada vardiyası olan çalışan. Geri alma: işareti koyan
 * kişi ya da yönetici (aynı gün). Başka mağazanın uygulaması 404. Denetim kaydı yazılmaz (tik).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, roleAtLeast, ACCESS } from '@/lib/auth'
import { badRequest, readJson } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { setItemDone } from '@/lib/checklistRepository'
import { checklistErrorResponse, tickRateLimited } from '@/lib/checklistApi'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const { id, itemId } = await params
  if (!isUuid(id) || !isUuid(itemId)) return badRequest('Geçersiz ID.')

  const body = await readJson<{ done?: unknown }>(req)
  if (!body || typeof body.done !== 'boolean') return badRequest('done alanı boolean olmalıdır.')

  const limited = await tickRateLimited(employee.id)
  if (limited) return limited

  try {
    const result = await setItemDone({
      runId: id,
      itemId,
      done: body.done,
      actor: { id: employee.id, isManager: roleAtLeast(employee.access_level, ACCESS.MANAGER) },
      storeId: employee.store_id,
    })
    return NextResponse.json(result)
  } catch (err) {
    return checklistErrorResponse('PATCH /api/checklists/runs/[id]/items/[itemId]', err)
  }
}
