/**
 * GET  /api/notifications?employee_id=xxx          — Bildirimleri listele
 * POST /api/notifications                           — Yeni bildirim oluştur (internal use)
 * FAZ 10 + FAZ AUTH-2
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import {
  createNotification,
  getNotificationsByEmployee,
} from '@/lib/notificationRepository'
import type { CreateNotificationPayload, NotificationType } from '@/types/notification'
import { requireAuth, requireMinRole, ROLES, MANAGER_ROLES } from '@/lib/auth'

const VALID_TYPES: NotificationType[] = [
  'shift_reminder',
  'leave_submitted',
  'leave_approved',
  'leave_rejected',
  'attendance_override',
  'open_shift_available',
  'time_correction_submitted',
  'time_correction_approved',
  'time_correction_rejected',
]

// ─── GET ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const { searchParams } = new URL(req.url)
    const limitParam = searchParams.get('limit')

    // employee_id: manager+ parametreden, diğerleri session'dan
    const isManager = currentEmployee.role_name
      ? MANAGER_ROLES.includes(currentEmployee.role_name)
      : false
    const requestedId = searchParams.get('employee_id')
    const employeeId = isManager && requestedId ? requestedId : currentEmployee.id

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
  // Notification oluşturma yönetimsel işlem — manager+ yetkisi gerekir
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

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
