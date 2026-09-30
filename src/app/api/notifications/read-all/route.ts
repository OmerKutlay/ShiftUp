/**
 * PATCH /api/notifications/read-all
 * Body: { employee_id }
 * Tüm bildirimleri okundu olarak işaretle.
 * FAZ 10
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { markAllAsRead } from '@/lib/notificationRepository'

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { employee_id?: string }

    if (!body.employee_id || typeof body.employee_id !== 'string') {
      return NextResponse.json(
        { error: 'employee_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    await markAllAsRead(admin, body.employee_id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/notifications/read-all]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
