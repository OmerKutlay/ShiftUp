/**
 * GET    /api/availability?employee_id=xxx | ?all=true
 * POST   /api/availability
 * DELETE /api/availability?id=xxx
 *
 * Erişim kuralları:
 *   GET:    requireAuth → employee kendi, manager+ herkes (all=true yalnızca manager)
 *   POST:   requireAuth → kendi adına; başkası adına ancak manager+
 *   DELETE: requireAuth → kaydın sahibi veya manager+
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateAvailabilityPayload, DayOfWeek } from '@/types/workforce'
import { requireAuth, canAccessEmployee, MANAGER_ROLES, hasRole, forbidden } from '@/lib/auth'
import { badRequest, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid, isValidTime } from '@/lib/validation'

const VALID_DAYS: DayOfWeek[] = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

// ─── GET ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const requestedId = req.nextUrl.searchParams.get('employee_id')
    const all = req.nextUrl.searchParams.get('all') === 'true'
    if (requestedId && !isUuid(requestedId)) return badRequest('Geçersiz çalışan ID.')

    const isManager = hasRole(currentEmployee.access_level, MANAGER_ROLES)
    const admin = createAdminClient()

    let query = admin
      .from('employee_availability')
      .select('*')
      .order('day_of_week')
      .order('start_time')

    if (!(all && isManager)) {
      query = query.eq('employee_id', isManager ? (requestedId ?? currentEmployee.id) : currentEmployee.id)
    }

    const { data, error } = await query
    if (error) return serverError('GET /api/availability', error)
    return NextResponse.json({ availability: data ?? [] })
  } catch (err) {
    return serverError('GET /api/availability', err)
  }
}

// ─── POST ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await readJson<Partial<CreateAvailabilityPayload>>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    if (!isUuid(body.employee_id)) return badRequest('employee_id zorunludur.')
    if (!body.day_of_week || !VALID_DAYS.includes(body.day_of_week)) return badRequest('Geçersiz gün.')
    if (!isValidTime(body.start_time) || !isValidTime(body.end_time)) {
      return badRequest('start_time ve end_time HH:MM formatında zorunludur.')
    }
    if (body.start_time.slice(0, 5) >= body.end_time.slice(0, 5)) {
      return badRequest('Başlangıç saati bitiş saatinden önce olmalıdır.')
    }
    if (body.is_available !== undefined && typeof body.is_available !== 'boolean') {
      return badRequest('is_available boolean olmalıdır.')
    }
    if (body.note != null && (typeof body.note !== 'string' || body.note.length > 300)) {
      return badRequest('Not en fazla 300 karakter olabilir.')
    }

    // Employee sadece kendisi adına, manager+ herhangi biri adına
    const accessCheck = await canAccessEmployee(req, body.employee_id, MANAGER_ROLES)
    if ('response' in accessCheck) return accessCheck.response

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('employee_availability')
      .insert({
        employee_id: body.employee_id,
        day_of_week: body.day_of_week,
        start_time: body.start_time.slice(0, 5),
        end_time: body.end_time.slice(0, 5),
        is_available: body.is_available ?? true,
        note: body.note?.trim() || null,
      })
      .select()
      .single()

    if (error) return serverError('POST /api/availability', error)
    return NextResponse.json({ availability: data }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/availability', err)
  }
}

// ─── DELETE ──────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!isUuid(id)) return badRequest('id zorunludur.')

    const admin = createAdminClient()

    const { data: existing, error: exErr } = await admin
      .from('employee_availability')
      .select('employee_id')
      .eq('id', id)
      .maybeSingle()
    if (exErr) return serverError('DELETE /api/availability', exErr)
    if (!existing) return notFound('Kayıt bulunamadı.')

    if (existing.employee_id !== currentEmployee.id && !hasRole(currentEmployee.access_level, MANAGER_ROLES)) {
      return forbidden('Yalnızca kendi müsaitlik kaydınızı silebilirsiniz.')
    }

    const { error } = await admin.from('employee_availability').delete().eq('id', id)
    if (error) return serverError('DELETE /api/availability', error)
    return NextResponse.json({ success: true })
  } catch (err) {
    return serverError('DELETE /api/availability', err)
  }
}
