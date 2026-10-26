/**
 * PATCH /api/checklists/templates/[id] — şablonu günceller / (de)aktive eder (Müdür Yardımcısı+).
 * Kısmi gövde kabul edilir; `items` verilirse madde listesi tümüyle (sıralı) değiştirilir.
 * Geçmiş uygulamalar etkilenmez (maddeler uygulamaya kopyalanmıştır).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, readJson } from '@/lib/apiErrors'
import { logAudit } from '@/lib/auditLog'
import { isUuid, pick } from '@/lib/validation'
import { updateTemplate } from '@/lib/checklistRepository'
import { checklistErrorResponse } from '@/lib/checklistApi'

const FIELDS = ['name', 'kind', 'weekdays', 'due_time', 'active', 'items'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz liste ID.')

  const body = await readJson<Record<string, unknown>>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')
  const patch = pick(body, FIELDS) as Record<string, unknown>
  if (Object.keys(patch).length === 0) return badRequest('Güncellenecek alan yok.')

  try {
    const { before, after } = await updateTemplate(id, patch, employee.store_id, employee.id)
    await logAudit({
      actorId: employee.id,
      storeId: employee.store_id,
      action: 'checklist.template_update',
      entityType: 'checklist_template',
      entityId: id,
      before,
      after,
    })
    return NextResponse.json({ template: after })
  } catch (err) {
    return checklistErrorResponse('PATCH /api/checklists/templates/[id]', err)
  }
}
