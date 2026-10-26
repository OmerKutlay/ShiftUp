/**
 * GET  /api/checklists/templates — aktif mağazanın kontrol listesi şablonları (Müdür Yardımcısı+)
 * POST /api/checklists/templates — yeni şablon (Müdür Yardımcısı+)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, readJson } from '@/lib/apiErrors'
import { logAudit } from '@/lib/auditLog'
import { parseTemplateInput } from '@/lib/checklistRules'
import { createTemplate, fetchTemplates } from '@/lib/checklistRepository'
import { checklistErrorResponse } from '@/lib/checklistApi'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    return NextResponse.json({ templates: await fetchTemplates(auth.employee.store_id) })
  } catch (err) {
    return checklistErrorResponse('GET /api/checklists/templates', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  try {
    const input = parseTemplateInput(body)
    const template = await createTemplate(input, employee.store_id, employee.id)
    await logAudit({
      actorId: employee.id,
      storeId: employee.store_id,
      action: 'checklist.template_create',
      entityType: 'checklist_template',
      entityId: template.id,
      after: template,
    })
    return NextResponse.json({ template }, { status: 201 })
  } catch (err) {
    return checklistErrorResponse('POST /api/checklists/templates', err)
  }
}
