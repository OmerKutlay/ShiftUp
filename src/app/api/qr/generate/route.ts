/**
 * POST /api/qr/generate
 *
 * Klasik çalışan bazlı QR (yalnızca Müdür Yardımcısı+).
 * Kiosk QR'ları sunucuda üretilmez — bkz. /api/kiosk/key ve kioskKeyService.
 *
 * Çalışanlar QR üretemez; aksi halde evden kendi ürettikleri kodu okutarak
 * mağazada bulunma şartını atlayabilirlerdi.
 * Hedef çalışan yöneticinin aktif mağazasında olmalıdır (başka mağaza → 404).
 * Token ömrü en fazla 60 sn — ekran fotoğrafıyla uzaktan okutma penceresini daraltır.
 */
import { isEffectivelyActive } from '@/lib/employment'
import { NextRequest, NextResponse } from 'next/server'
import { generateQrToken, QrTokenError } from '@/lib/qrTokenService'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { checkRateLimit } from '@/lib/rateLimiter'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import type { GenerateQrRequest } from '@/types/qr'

const VALID_ACTIONS = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const MAX_TTL_SECONDS = 60

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const body = (await readJson<Partial<GenerateQrRequest>>(req)) ?? {}
    const ttl =
      typeof body.ttl_seconds === 'number' && body.ttl_seconds > 0
        ? Math.min(body.ttl_seconds, MAX_TTL_SECONDS)
        : MAX_TTL_SECONDS

    if (!isUuid(body.employee_id)) {
      return NextResponse.json(
        { error: 'employee_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    if (!body.action_type || !(VALID_ACTIONS as readonly string[]).includes(body.action_type)) {
      return NextResponse.json({ error: 'Geçersiz action_type.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const rateCheck = await checkRateLimit(`qr_gen:${auth.employee.id}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Çok fazla QR talebi. Lütfen bir dakika bekleyin.',
          code: 'RATE_LIMITED',
          reset_at: new Date(rateCheck.resetAt).toISOString(),
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)) } }
      )
    }

    const admin = createAdminClient()
    const { data: employee, error: empError } = await admin
      .from('employees')
      .select('id, active, store_id, termination_date')
      .eq('id', body.employee_id)
      .eq('store_id', auth.employee.store_id)
      .maybeSingle()

    if (empError) return serverError('POST /api/qr/generate', empError)
    if (!employee) {
      return NextResponse.json({ error: 'Çalışan bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' }, { status: 404 })
    }
    if (!isEffectivelyActive(employee)) {
      return NextResponse.json({ error: 'Pasif çalışan için QR üretilemez.', code: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    const result = await generateQrToken(body.employee_id, body.action_type, ttl, employee.store_id)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof QrTokenError) {
      return serverError('POST /api/qr/generate', err, err.message)
    }
    return serverError('POST /api/qr/generate', err)
  }
}
