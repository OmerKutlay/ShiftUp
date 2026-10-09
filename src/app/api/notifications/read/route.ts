/**
 * PATCH /api/notifications/read
 * Body: { notification_id }
 * FAZ 10 + FAZ AUTH-2
 *
 * employee_id SESSION'dan alınır — client'tan gelen değer yoksayılır.
 * Employee yalnızca kendi notificationlarını okundu yapabilir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { markAsRead } from '@/lib/notificationRepository'
import { requireAuth } from '@/lib/auth'

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = (await req.json()) as { notification_id?: string }

    if (!body.notification_id || typeof body.notification_id !== 'string') {
      return NextResponse.json(
        { error: 'notification_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()

    // Notificationın bu employee'a ait olduğunu doğrula
    const { data: notif } = await admin
      .from('notifications')
      .select('employee_id')
      .eq('id', body.notification_id)
      .maybeSingle()

    if (!notif) {
      return NextResponse.json({ error: 'Bildirim bulunamadı.', code: 'NOT_FOUND' }, { status: 404 })
    }
    if (notif.employee_id !== currentEmployee.id) {
      return NextResponse.json(
        { error: 'Bu bildirim size ait değil.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    await markAsRead(admin, body.notification_id, currentEmployee.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/notifications/read]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
