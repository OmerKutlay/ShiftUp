/**
 * POST /api/push/test — oturumdaki çalışana bir test bildirimi ekler.
 *
 * Bildirim normal yoldan (notifications INSERT → tetikleyici → send-push) gider; telefonun
 * bildirim panelinde görünmüyorsa zincirin kopuk halkası GET /api/push/diagnostics ile bulunur.
 * Kiosk hesabı kullanamaz (requireAuth varsayılanı). Çalışan başına 10 dakikada 5 istek.
 * Yanıt: { success: true }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { conflict, serverError } from '@/lib/apiErrors'
import { checkRateLimit } from '@/lib/rateLimiter'
import { createNotification } from '@/lib/notificationRepository'

const RATE_LIMIT = 5
const RATE_WINDOW_MS = 10 * 60 * 1000

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const limit = await checkRateLimit(`push_test:${employee.id}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Çok fazla test bildirimi. Lütfen birkaç dakika sonra tekrar deneyin.', code: 'RATE_LIMITED' },
      { status: 429 },
    )
  }

  try {
    const admin = createAdminClient()
    await createNotification(admin, {
      employee_id: employee.id,
      type: 'push_test',
      title: 'Test bildirimi',
      message: 'Bu bir deneme bildirimidir. Telefonunuzun bildirim panelinde görüyorsanız kurulum tamam.',
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    // notification_type enum'unda 'push_test' yok → migration uygulanmamış
    if (err && typeof err === 'object' && (err as { code?: string }).code === '22P02') {
      return conflict(
        'Test bildirimi tipi veritabanında yok: 20261017100000_push_diagnostics migration\'ı uygulanmamış.',
        'MIGRATION_MISSING',
      )
    }
    return serverError('POST /api/push/test', err)
  }
}
