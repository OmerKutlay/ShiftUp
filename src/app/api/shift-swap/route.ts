/**
 * GET  /api/shift-swap?status=pending
 * POST /api/shift-swap
 *
 * Vardiya takası iki aşamalı bir TALEPTİR:
 *   1. Çalışan talep açar → hedef çalışan kabul eder (target_accepted_at)
 *   2. Müdür Yardımcısı+ onaylar (/api/shift-swap/review) → takas uygulanır
 *
 * GET:  çalışan yalnızca tarafı olduğu talepleri; yönetici tümünü görür
 * POST: requester_id SESSION'dan alınır
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateSwapRequestPayload } from '@/types/workforce'
import { createNotification } from '@/lib/notificationRepository'
import { requireAuth, MANAGER_ROLES, hasRole, forbidden } from '@/lib/auth'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { turkeyToday } from '@/lib/dateUtils'

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'cancelled']

// ─── GET ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const status = req.nextUrl.searchParams.get('status')
    if (status && !VALID_STATUSES.includes(status)) return badRequest('Geçersiz durum filtresi.')

    const isManager = hasRole(currentEmployee.access_level, MANAGER_ROLES)

    const admin = createAdminClient()
    let query = admin
      .from('shift_swap_requests')
      .select(`
        *,
        requester:employees!requester_id(id, full_name),
        target:employees!target_id(id, full_name),
        requester_shift:shift_assignments!requester_shift_id(work_date, start_time, end_time),
        target_shift:shift_assignments!target_shift_id(work_date, start_time, end_time)
      `)
      .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)

    // Manager+ tümünü görür; çalışan yalnızca tarafı olduğu talepleri (id session'dan, UUID)
    if (!isManager) {
      query = query.or(`requester_id.eq.${currentEmployee.id},target_id.eq.${currentEmployee.id}`)
    }

    const { data, error } = await query
    if (error) return serverError('GET /api/shift-swap', error)
    return NextResponse.json({ swap_requests: data ?? [] })
  } catch (err) {
    return serverError('GET /api/shift-swap', err)
  }
}

// ─── POST ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = await readJson<Partial<CreateSwapRequestPayload>>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    const requesterId = currentEmployee.id

    if (!isUuid(body.requester_shift_id)) return badRequest('requester_shift_id zorunludur.')
    if (!isUuid(body.target_id)) return badRequest('Takas yapılacak çalışan (target_id) zorunludur.')
    if (body.target_id === requesterId) return badRequest('Kendinizle takas yapamazsınız.')
    if (body.target_shift_id != null && !isUuid(body.target_shift_id)) return badRequest('Geçersiz hedef vardiya.')
    if (body.requester_note && (typeof body.requester_note !== 'string' || body.requester_note.length > 500)) {
      return badRequest('Not en fazla 500 karakter olabilir.')
    }

    const admin = createAdminClient()
    const today = turkeyToday()

    const { data: shift, error: shErr } = await admin
      .from('shift_assignments')
      .select('id, employee_id, work_date')
      .eq('id', body.requester_shift_id)
      .maybeSingle()
    if (shErr) return serverError('POST /api/shift-swap', shErr)
    if (!shift) return notFound('Vardiya bulunamadı.')
    if (shift.employee_id !== requesterId) return forbidden('Bu vardiya size ait değil.')
    if (shift.work_date < today) return badRequest('Geçmiş vardiya için takas talebi oluşturulamaz.')

    const { data: target, error: tErr } = await admin
      .from('employees')
      .select('id, full_name, active')
      .eq('id', body.target_id)
      .maybeSingle()
    if (tErr) return serverError('POST /api/shift-swap', tErr)
    if (!target) return notFound('Hedef çalışan bulunamadı.')
    if (!target.active) return badRequest('Hedef çalışan aktif değil.')

    if (body.target_shift_id) {
      const { data: targetShift, error: tsErr } = await admin
        .from('shift_assignments')
        .select('id, employee_id, work_date')
        .eq('id', body.target_shift_id)
        .maybeSingle()
      if (tsErr) return serverError('POST /api/shift-swap', tsErr)
      if (!targetShift) return notFound('Hedef vardiya bulunamadı.')
      if (targetShift.employee_id !== body.target_id) return badRequest('Hedef vardiya seçilen çalışana ait değil.')
      if (targetShift.work_date < today) return badRequest('Geçmiş bir vardiya ile takas yapılamaz.')
    }

    // Bekleyen talep kontrolü — iki vardiyadan biri zaten bekleyen bir takasta mı? (id'ler UUID doğrulandı)
    const shiftIds = [body.requester_shift_id, body.target_shift_id].filter(Boolean).join(',')
    const { data: existing, error: exErr } = await admin
      .from('shift_swap_requests')
      .select('id')
      .eq('status', 'pending')
      .or(`requester_shift_id.in.(${shiftIds}),target_shift_id.in.(${shiftIds})`)
      .limit(1)
    if (exErr) return serverError('POST /api/shift-swap', exErr)
    if (existing && existing.length > 0) return conflict('Bu vardiya için zaten bekleyen bir takas talebi var.')

    const { data, error } = await admin
      .from('shift_swap_requests')
      .insert({
        requester_id:       requesterId,
        requester_shift_id: body.requester_shift_id,
        target_id:          body.target_id,
        target_shift_id:    body.target_shift_id ?? null,
        requester_note:     body.requester_note?.trim() || null,
        status: 'pending',
      })
      .select()
      .single()
    if (error) return serverError('POST /api/shift-swap', error)

    try {
      // Önce karşı tarafın kabulü gerekir; yöneticiler kabulden sonra bilgilendirilir
      await createNotification(admin, {
        employee_id: body.target_id,
        type: 'shift_swap_submitted',
        title: 'Size bir vardiya takas teklifi var',
        message: `${currentEmployee.full_name}, ${shift.work_date} tarihli vardiyası için sizinle takas yapmak istiyor. Kabul ederseniz yönetici onayına gönderilir.`,
        related_id: data.id,
      })
    } catch (notifErr) {
      console.error('[POST /api/shift-swap] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ swap_request: data }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/shift-swap', err)
  }
}
