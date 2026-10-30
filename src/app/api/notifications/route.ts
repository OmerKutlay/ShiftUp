/**
 * GET /api/notifications?limit=30 — Oturumdaki çalışanın bildirimleri
 *
 * Bildirimler kişiseldir: yöneticiler dahil hiç kimse başkasının bildirimlerini okuyamaz.
 * Bildirimler yalnızca sunucuda, ilgili işlemin route'unda veya pg_cron taramalarında oluşturulur;
 * istemcinin keyfi bildirim oluşturabileceği bir uç yoktur.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { getNotificationsByEmployee } from '@/lib/notificationRepository'
import { requireAuth } from '@/lib/auth'
import { serverError } from '@/lib/apiErrors'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const limitParam = req.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50
    const admin = createAdminClient()
    // Okutulmamış giriş/çıkış taraması burada yapılmaz: pg_cron 2 dakikada bir çalıştırır
    // (bkz. @/lib/attendanceAlerts). Bu uç dakikada bir yoklanır, ucuz kalmalı.
    const notifications = await getNotificationsByEmployee(admin, currentEmployee.id, limit)
    return NextResponse.json({ notifications })
  } catch (err) {
    return serverError('GET /api/notifications', err)
  }
}
