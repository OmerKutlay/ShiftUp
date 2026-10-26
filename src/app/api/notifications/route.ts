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
import { requireAuth, MANAGER_ROLES, hasRole } from '@/lib/auth'
import { scanMissedAttendanceThrottled } from '@/lib/attendanceAlerts'
import { serverError } from '@/lib/apiErrors'

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
