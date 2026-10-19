/**
 * GET  /api/notifications?limit=30  — Oturumdaki çalışanın bildirimleri
 * POST /api/notifications           — Yeni bildirim oluştur (yönetimsel, Müdür Yardımcısı+)
 *
 * Bildirimler kişiseldir: yöneticiler dahil hiç kimse başkasının bildirimlerini okuyamaz.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import {
  createNotification,
  getNotificationsByEmployee,
} from '@/lib/notificationRepository'
import type { CreateNotificationPayload, NotificationType } from '@/types/notification'
import { requireAuth, requireMinRole, ACCESS, MANAGER_ROLES, hasRole } from '@/lib/auth'
import { scanMissedAttendanceThrottled } from '@/lib/attendanceAlerts'
import { badRequest, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'

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
  'shift_swap_submitted',
  'shift_swap_approved',
  'shift_swap_rejected',
  'open_shift_claimed',
  'attendance_late_clock_in',
  'attendance_late_clock_out',
  'attendance_missed_clock_in',
  'attendance_missed_clock_out',
]

// ─── GET ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const limitParam = req.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50
    const admin = createAdminClient()

    // Yönetici bildirimlerini çekerken okutulmamış giriş/çıkış taraması (dakikada en fazla bir kez)
    if (hasRole(currentEmployee.access_level, MANAGER_ROLES)) await scanMissedAttendanceThrottled(admin)

    const notifications = await getNotificationsByEmployee(admin, currentEmployee.id, limit)
    return NextResponse.json({ notifications })
  } catch (err) {
    return serverError('GET /api/notifications', err)
  }
}

// ─── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const body = await readJson<Partial<CreateNotificationPayload>>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    if (!isUuid(body.employee_id)) return badRequest('employee_id zorunludur.')
    if (!body.type || !VALID_TYPES.includes(body.type)) return badRequest('Geçersiz bildirim tipi.')
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120) {
      return badRequest('title zorunludur (en fazla 120 karakter).')
    }
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000) {
      return badRequest('message zorunludur (en fazla 1000 karakter).')
    }
    if (body.related_id != null && !isUuid(body.related_id)) return badRequest('Geçersiz related_id.')

    const admin = createAdminClient()
    const notification = await createNotification(admin, {
      employee_id: body.employee_id,
      type: body.type,
      title: body.title.trim(),
      message: body.message.trim(),
      related_id: body.related_id ?? null,
    })

    // null dönmesi = duplicate (dedupe kısıtı), idempotent
    if (!notification) return NextResponse.json({ notification: null, duplicate: true })
    return NextResponse.json({ notification }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/notifications', err)
  }
}
