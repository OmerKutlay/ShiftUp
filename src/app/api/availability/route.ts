/**
 * GET    /api/availability?employee_id=xxx
 * POST   /api/availability
 * DELETE /api/availability?id=xxx
 * FAZ 11 + FAZ AUTH-2 (authorization)
 *
 * Erişim kuralları:
 *   GET:    requireAuth → employee kendi, manager+ herkes
 *   POST:   requireAuth → employee_id session'dan → başkası adına ancak manager+
 *   DELETE: requireAuth → kaydın sahibi veya manager+
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateAvailabilityPayload, DayOfWeek } from '@/types/workforce'
import { requireAuth, canAccessEmployee, MANAGER_ROLES } from '@/lib/auth'

const VALID_DAYS: DayOfWeek[] = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

// ─── GET ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const { searchParams } = new URL(req.url)
    const requestedId = searchParams.get('employee_id')
    const all = searchParams.get('all') === 'true'

    const isManager = currentEmployee.role_name
      ? MANAGER_ROLES.includes(currentEmployee.role_name)
      : false

    const admin = createAdminClient()

    // Manager + all=true → tüm aktif çalışanların availability'si
    if (all && isManager) {
      const { data, error } = await admin
        .from('employee_availability')
        .select('*')
        .order('employee_id')
        .order('day_of_week')
        .order('start_time')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ availability: data ?? [] })
    }

    const effectiveId = isManager
      ? (requestedId ?? currentEmployee.id)
      : currentEmployee.id

    const { data, error } = await admin
      .from('employee_availability')
      .select('*')
      .eq('employee_id', effectiveId)
      .order('day_of_week')
      .order('start_time')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ availability: data ?? [] })
  } catch (err) {
    console.error('[GET /api/availability]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

// ─── POST ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as Partial<CreateAvailabilityPayload>

    if (!body.employee_id) return NextResponse.json({ error: 'employee_id zorunludur.' }, { status: 400 })
    if (!body.day_of_week || !VALID_DAYS.includes(body.day_of_week))
      return NextResponse.json({ error: 'Geçersiz gün.' }, { status: 400 })
    if (!body.start_time || !body.end_time)
      return NextResponse.json({ error: 'start_time ve end_time zorunludur.' }, { status: 400 })
    if (body.start_time >= body.end_time)
      return NextResponse.json({ error: 'Başlangıç saati bitiş saatinden önce olmalıdır.' }, { status: 400 })

    // Employee sadece kendisi adına, manager+ herhangi biri adına
    const accessCheck = await canAccessEmployee(req, body.employee_id, MANAGER_ROLES)
    if ('response' in accessCheck) return accessCheck.response

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('employee_availability')
      .insert({
        employee_id: body.employee_id,
        day_of_week: body.day_of_week,
        start_time: body.start_time,
        end_time: body.end_time,
        is_available: body.is_available ?? true,
        note: body.note ?? null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ availability: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/availability]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

// ─── DELETE ──────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id zorunludur.' }, { status: 400 })

    const admin = createAdminClient()

    // Kaydın sahibini doğrula
    const { data: existing } = await admin
      .from('employee_availability')
      .select('employee_id')
      .eq('id', id)
      .maybeSingle()

    if (!existing) return NextResponse.json({ error: 'Kayıt bulunamadı.' }, { status: 404 })

    const isManager = currentEmployee.role_name
      ? MANAGER_ROLES.includes(currentEmployee.role_name)
      : false

    if (existing.employee_id !== currentEmployee.id && !isManager) {
      return NextResponse.json(
        { error: 'Yalnızca kendi availability kaydınızı silebilirsiniz.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const { error } = await admin.from('employee_availability').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/availability]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
