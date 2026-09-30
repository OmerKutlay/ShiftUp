/**
 * PATCH /api/notifications/read
 * Body: { notification_id, employee_id }
 * Tek bildirimi okundu olarak işaretle.
 * FAZ 10
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { markAsRead } from '@/lib/notificationRepository'

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      notification_id?: string
      employee_id?: string
    }

    if (!body.notification_id || typeof body.notification_id !== 'string') {
      return NextResponse.json(
        { error: 'notification_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    if (!body.employee_id || typeof body.employee_id !== 'string') {
      return NextResponse.json(
        { error: 'employee_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    await markAsRead(admin, body.notification_id, body.employee_id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/notifications/read]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
