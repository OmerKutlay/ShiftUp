/**
 * GET|POST /api/attendance/alerts/scan
 *
 * Okutulmamış giriş/çıkışları tarar ve yöneticilere bildirim gönderir.
 * Zamanlanmış görev (cron) için tasarlandı — birkaç dakikada bir çağrılmalı.
 *
 * Yetki:
 *   - GET  : yalnızca `Authorization: Bearer <CRON_SECRET>` (Vercel Cron GET ile çağırır)
 *   - POST : CRON_SECRET veya Müdür Yardımcısı+ oturumu
 *     (oturumlu tetikleme yalnızca POST — tarayıcıdan GET ile CSRF tetiklenemez)
 *
 * Not: Cron kurulmasa da yönetici bildirim sorgusu (GET /api/notifications)
 * aynı taramayı dakikada en fazla bir kez tetikler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS, unauthorized } from '@/lib/auth'
import { scanMissedAttendance } from '@/lib/attendanceAlerts'
import { serverError } from '@/lib/apiErrors'

function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const header = req.headers.get('authorization')
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

async function runScan() {
  try {
    const result = await scanMissedAttendance(createAdminClient())
    return NextResponse.json(result)
  } catch (err) {
    return serverError('/api/attendance/alerts/scan', err)
  }
}

export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return unauthorized('Geçersiz cron anahtarı.')
  return runScan()
}

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) {
    const auth = await requireMinRole(req, ACCESS.MANAGER)
    if ('response' in auth) return auth.response
  }
  return runScan()
}
