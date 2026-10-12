/**
 * PATCH /api/shift-templates/[id] — şablonu günceller / (de)aktive eder (Müdür Yardımcısı+)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ROLES } from '@/lib/auth'
import { updateShiftTemplate, ShiftTemplateValidationError } from '@/lib/shiftTemplateRepository'
import { badRequest, readJson, serverError } from '@/lib/apiErrors'
import { isUuid, pick } from '@/lib/validation'
import type { UpdateShiftTemplatePayload } from '@/types/shiftTemplate'

const FIELDS = ['name', 'start_time', 'end_time', 'description', 'active'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  const { id } = await params
  if (!isUuid(id)) return badRequest('Geçersiz şablon ID.')

  const body = await readJson<UpdateShiftTemplatePayload>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  const payload = pick(body, FIELDS)
  if (payload.active !== undefined && typeof payload.active !== 'boolean') {
    return badRequest('active alanı boolean olmalıdır.')
  }
  if (Object.keys(payload).length === 0) return badRequest('Güncellenecek alan yok.')

  try {
    const template = await updateShiftTemplate(id, payload)
    return NextResponse.json({ template })
  } catch (err) {
    if (err instanceof ShiftTemplateValidationError) return badRequest(err.message)
    return serverError('PATCH /api/shift-templates/[id]', err)
  }
}
