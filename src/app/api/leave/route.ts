/**
 * GET  /api/leave          — Tüm izin taleplerini listele (employee join'li)
 * POST /api/leave          — Yeni izin talebi oluştur
 * FAZ 9 + FAZ 10 (bildirim entegrasyonu)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateLeaveRequestPayload, LeaveType } from '@/types/leave'
import { createNotification } from '@/lib/notificationRepository'

const VALID_LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'personal', 'unpaid', 'other']

// ─── GET ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
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
    if (!body.leave_type || !VALID_LEAVE_TYPES.includes(body.leave_type)) {
      return NextResponse.json({ error: 'Geçersiz izin tipi.', code: 'VALIDATION_ERROR' }, { status: 400 })
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
    // Geçmişe dönük talep — hastalık izni hariç
    const today = new Date().toISOString().slice(0, 10)
    if (body.start_date < today && body.leave_type !== 'sick') {
      return NextResponse.json({ error: 'Geçmiş tarih için izin talebi oluşturulamaz (hastalık izni hariç).', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    // Maks 30 gün
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
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
    }

    // FAZ 10: İzin talebi oluşturulduğunda çalışana bildirim gönder
    try {
      await createNotification(admin, {
        employee_id: body.employee_id,
        type: 'leave_submitted',
        title: 'İzin talebiniz alındı',
        message: `${body.start_date} – ${body.end_date} tarihli izin talebiniz incelemeye alındı.`,
        related_id: data.id,
      })
    } catch (notifErr) {
      // Bildirim hatası ana işlemi engellememeli
      console.error('[POST /api/leave] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ request: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leave]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
