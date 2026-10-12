/**
 * GET|POST /api/attendance/alerts/scan
 *
 * Okutulmamış giriş/çıkışları tarar ve yöneticilere bildirim gönderir.
 * Zamanlanmış görev (cron) için tasarlandı — birkaç dakikada bir çağrılmalı.
 *
 * Yetki:
 *   - `Authorization: Bearer <CRON_SECRET>` (env'de CRON_SECRET tanımlıysa), veya
 *   - Müdür Yardımcısı+ oturumu
 *
 * Not: Cron kurulmasa da yönetici bildirim sorgusu (GET /api/notifications)
 * aynı taramayı dakikada en fazla bir kez tetikler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { scanMissedAttendance } from '@/lib/attendanceAlerts'

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const isCron = !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`

  if (!isCron) {
    const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
    if ('response' in auth) return auth.response
  }

  try {
    const result = await scanMissedAttendance(createAdminClient())
    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/attendance/alerts/scan]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
