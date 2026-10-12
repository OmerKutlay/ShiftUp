/**
 * PATCH /api/notifications/read-all
 * FAZ 10 + FAZ AUTH-2
 *
 * employee_id SESSION'dan alınır — client'tan gelen değer yoksayılır.
 * Employee yalnızca kendi tüm notificationlarını okundu yapabilir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { markAllAsRead } from '@/lib/notificationRepository'
import { requireAuth } from '@/lib/auth'

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const admin = createAdminClient()
    await markAllAsRead(admin, currentEmployee.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/notifications/read-all]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
