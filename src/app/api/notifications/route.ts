/**
 * GET  /api/notifications?employee_id=xxx          — Bildirimleri listele
 * POST /api/notifications                           — Yeni bildirim oluştur (internal use)
 * FAZ 10
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import {
  createNotification,
  getNotificationsByEmployee,
} from '@/lib/notificationRepository'
import type { CreateNotificationPayload, NotificationType } from '@/types/notification'

const VALID_TYPES: NotificationType[] = [
  'shift_reminder',
  'leave_submitted',
  'leave_approved',
  'leave_rejected',
  'attendance_override',
]

// ─── GET ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employee_id')
    const limitParam = searchParams.get('limit')

    if (!employeeId || typeof employeeId !== 'string') {
      return NextResponse.json(
        { error: 'employee_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50
    const admin = createAdminClient()
    const notifications = await getNotificationsByEmployee(admin, employeeId, limit)

    return NextResponse.json({ notifications })
  } catch (err) {
    console.error('[GET /api/notifications]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}

// ─── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateNotificationPayload>

    if (!body.employee_id || typeof body.employee_id !== 'string') {
      return NextResponse.json(
        { error: 'employee_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    if (!body.type || !VALID_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: 'Geçersiz bildirim tipi.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    if (!body.title?.trim()) {
      return NextResponse.json(
        { error: 'title zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    if (!body.message?.trim()) {
      return NextResponse.json(
        { error: 'message zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    const notification = await createNotification(admin, {
      employee_id: body.employee_id,
      type: body.type,
      title: body.title.trim(),
      message: body.message.trim(),
      related_id: body.related_id ?? null,
    })

    // null dönmesi = duplicate shift_reminder, idempotent
    if (!notification) {
      return NextResponse.json({ notification: null, duplicate: true })
    }

    return NextResponse.json({ notification }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/notifications]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
