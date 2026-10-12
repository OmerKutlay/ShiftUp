/**
 * GET    /api/leave          — Tüm izin taleplerini listele (employee join'li)
 * POST   /api/leave          — Yeni izin talebi oluştur
 * DELETE /api/leave?id=...   — İzin talebini sil (manager+)
 * FAZ 9 + FAZ 10 (bildirim entegrasyonu)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateLeaveRequestPayload, LeaveType } from '@/types/leave'
import { createNotification } from '@/lib/notificationRepository'
import { requireAuth, canAccessEmployee, MANAGER_ROLES, requireMinRole, ROLES } from '@/lib/auth'

const VALID_LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'personal', 'unpaid', 'other', 'weekly_rest']
/** Çalışanın kendi adına açabileceği tipler (weekly_rest sadece manager atayabilir) */
const EMPLOYEE_LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'personal', 'unpaid', 'other']

// ─── GET ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Authentication zorunlu
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const statusFilter = searchParams.get('status')  // 'pending' | 'approved' | 'rejected' | null
    const employeeId = searchParams.get('employee_id')

    const admin = createAdminClient()

    let query = admin
      .from('leave_requests')
      .select(`
        id, employee_id, leave_type, start_date, end_date,
        reason, status, reviewer_note, reviewed_at, created_at, updated_at,
        employees ( id, full_name, role )
      `)
      .order('created_at', { ascending: false })

    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }
    if (employeeId) {
      query = query.eq('employee_id', employeeId)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
    }

    return NextResponse.json({ requests: data ?? [] })
  } catch (err) {
    console.error('[GET /api/leave]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}

// ─── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateLeaveRequestPayload>

    // Validation
    if (!body.employee_id || typeof body.employee_id !== 'string') {
      return NextResponse.json({ error: 'employee_id zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    // Authorization: weekly_rest yalnızca manager+ atayabilir; diğerleri kendi adına veya manager+
    const isWeeklyRest = body.leave_type === 'weekly_rest'
    if (isWeeklyRest) {
      // Sadece manager rolü haftalık tatil atayabilir
      const managerAuth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
      if ('response' in managerAuth) return managerAuth.response
    } else {
      const accessCheck = await canAccessEmployee(req, body.employee_id, MANAGER_ROLES)
      if ('response' in accessCheck) return accessCheck.response
    }

    if (!body.leave_type || !VALID_LEAVE_TYPES.includes(body.leave_type)) {
      return NextResponse.json({ error: 'Geçersiz izin tipi.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    // Çalışanın kendi açabileceği tipler — weekly_rest sadece manager
    if (!isWeeklyRest && body.leave_type && !EMPLOYEE_LEAVE_TYPES.includes(body.leave_type)) {
      return NextResponse.json({ error: 'Bu izin tipini kendiniz oluşturamazsınız.', code: 'FORBIDDEN' }, { status: 403 })
    }
    if (!body.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
      return NextResponse.json({ error: 'start_date YYYY-MM-DD formatında olmalıdır.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!body.end_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
      return NextResponse.json({ error: 'end_date YYYY-MM-DD formatında olmalıdır.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (body.start_date > body.end_date) {
      return NextResponse.json({ error: 'Başlangıç tarihi bitiş tarihinden sonra olamaz.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    // Geçmişe dönük talep — hastalık izni ve haftalık tatil hariç
    const today = new Date().toISOString().slice(0, 10)
    if (body.start_date < today && body.leave_type !== 'sick' && body.leave_type !== 'weekly_rest') {
      return NextResponse.json({ error: 'Geçmiş tarih için izin talebi oluşturulamaz (hastalık izni hariç).', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    // Maks 30 gün (haftalık tatil tek gün olacak, yine de genel kurala dahil)
    const diffDays = (new Date(body.end_date).getTime() - new Date(body.start_date).getTime()) / 86400000
    if (diffDays > 30) {
      return NextResponse.json({ error: 'Tek talep en fazla 30 gün olabilir.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Employee aktiflik kontrolü
    const { data: emp } = await admin
      .from('employees')
      .select('id, active')
      .eq('id', body.employee_id)
      .maybeSingle()

    if (!emp) {
      return NextResponse.json({ error: 'Çalışan bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' }, { status: 404 })
    }
    if (!emp.active) {
      return NextResponse.json({ error: 'Pasif çalışan izin talebi oluşturamaz.', code: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    // Aynı tarih aralığında çakışan pending/approved talep var mı?
    const { data: overlapping } = await admin
      .from('leave_requests')
      .select('id')
      .eq('employee_id', body.employee_id)
      .in('status', ['pending', 'approved'])
      .lte('start_date', body.end_date)
      .gte('end_date', body.start_date)
      .limit(1)

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json({ error: 'Bu tarih aralığında zaten onaylı veya bekleyen bir izin talebi mevcut.', code: 'LEAVE_CONFLICT' }, { status: 409 })
    }

    const { data, error } = await admin
      .from('leave_requests')
      .insert({
        employee_id: body.employee_id,
        leave_type: body.leave_type,
        start_date: body.start_date,
        end_date: body.end_date,
        reason: body.reason?.trim() ?? null,
        // weekly_rest manager tarafından atanır → doğrudan onaylı, onay akışına girmez
        status: isWeeklyRest ? 'approved' : 'pending',
        reviewed_at: isWeeklyRest ? new Date().toISOString() : null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
    }

    // weekly_rest için vardiyaları da sil (aynı gün varsa)
    if (isWeeklyRest) {
      const { error: delErr } = await admin
        .from('shift_assignments')
        .delete()
        .eq('employee_id', body.employee_id)
        .gte('work_date', body.start_date)
        .lte('work_date', body.end_date)
      if (delErr) {
        console.error('[POST /api/leave] weekly_rest vardiya silinemedi:', delErr.message)
      }
    }

    // Bildirim — weekly_rest için tatil bildirimi, diğerleri için talep bildirimi
    try {
      if (isWeeklyRest) {
        await createNotification(admin, {
          employee_id: body.employee_id,
          type: 'leave_approved',
          title: 'Haftalık tatil atandı',
          message: `${body.start_date} – ${body.end_date} tarihli haftalık tatil planınıza eklendi.`,
          related_id: data.id,
        })
      } else {
        await createNotification(admin, {
          employee_id: body.employee_id,
          type: 'leave_submitted',
          title: 'İzin talebiniz alındı',
          message: `${body.start_date} – ${body.end_date} tarihli izin talebiniz incelemeye alındı.`,
          related_id: data.id,
        })
      }
    } catch (notifErr) {
      console.error('[POST /api/leave] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ request: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leave]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}

// ─── DELETE ─────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  // Authorization: en az Müdür Yardımcısı yetkisi gerekir
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id parametresi zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Kaydın varlığını doğrula
    const { data: existing } = await admin
      .from('leave_requests')
      .select('id, employee_id, status, start_date, end_date')
      .eq('id', id)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'İzin talebi bulunamadı.', code: 'NOT_FOUND' }, { status: 404 })
    }

    // Onaylı izin silinirse ilgili shift_assignments'ların is_on_leave bayrağını kaldır
    if (existing.status === 'approved') {
      const { error: resetErr } = await admin
        .from('shift_assignments')
        .update({ is_on_leave: false })
        .eq('employee_id', existing.employee_id)
        .gte('work_date', existing.start_date)
        .lte('work_date', existing.end_date)
      if (resetErr) {
        console.error('[DELETE /api/leave] is_on_leave sıfırlanamadı:', resetErr.message)
      }
    }

    const { error } = await admin
      .from('leave_requests')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/leave]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
