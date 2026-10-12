/**
 * GET  /api/shift-templates?active=true — vardiya şablonları (oturum gerektirir)
 * POST /api/shift-templates             — yeni şablon (Müdür Yardımcısı+)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireMinRole, ROLES } from '@/lib/auth'
import {
  fetchShiftTemplates,
  fetchActiveShiftTemplates,
  createShiftTemplate,
  ShiftTemplateValidationError,
} from '@/lib/shiftTemplateRepository'
import { badRequest, readJson, serverError } from '@/lib/apiErrors'
import type { CreateShiftTemplatePayload } from '@/types/shiftTemplate'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  try {
    const templates =
      req.nextUrl.searchParams.get('active') === 'true'
        ? await fetchActiveShiftTemplates()
        : await fetchShiftTemplates()
    return NextResponse.json({ templates })
  } catch (err) {
    return serverError('GET /api/shift-templates', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  const body = await readJson<Partial<CreateShiftTemplatePayload>>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  try {
    const template = await createShiftTemplate({
      name: String(body.name ?? ''),
      start_time: String(body.start_time ?? ''),
      end_time: String(body.end_time ?? ''),
      description: typeof body.description === 'string' ? body.description : null,
      active: typeof body.active === 'boolean' ? body.active : true,
    })
    return NextResponse.json({ template }, { status: 201 })
  } catch (err) {
    if (err instanceof ShiftTemplateValidationError) return badRequest(err.message)
    return serverError('POST /api/shift-templates', err)
  }
}
