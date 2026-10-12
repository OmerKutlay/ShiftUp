/**
 * POST /api/qr/generate
 *
 * İki mod:
 *   kiosk: true → Evrensel kiosk QR (employee/action içermez, yönetici veya sistem çağırır)
 *   kiosk: false/undefined → Klasik employee bazlı QR (geriye dönük uyumluluk)
 *
 * FAZ 8: Rate limiting, employee aktiflik kontrolü.
 */
import { NextRequest, NextResponse } from 'next/server'
import { generateQrToken, generateKioskQrToken, QrTokenError } from '@/lib/qrTokenService'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { checkRateLimit } from '@/lib/rateLimiter'
import { requireAuth } from '@/lib/auth'
import type { GenerateQrRequest } from '@/types/qr'

const VALID_ACTIONS = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 1000

export async function POST(req: NextRequest) {
  // Authentication zorunlu
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as Partial<GenerateQrRequest>
    const ttl = body.ttl_seconds && body.ttl_seconds > 0 ? Math.min(body.ttl_seconds, 300) : 60

    // ── Kiosk modu ────────────────────────────────────────────
    if (body.kiosk === true) {
      const rateLimitKey = `qr_gen:kiosk`
      const rateCheck = checkRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: 'Çok fazla QR talebi.', code: 'RATE_LIMITED' },
          { status: 429 }
        )
      }
      const result = await generateKioskQrToken(ttl)
      return NextResponse.json(result, { status: 201 })
    }

    // ── Klasik mod ────────────────────────────────────────────
    if (!body.employee_id || typeof body.employee_id !== 'string') {
      return NextResponse.json(
        { error: 'employee_id veya kiosk:true zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    if (!body.action_type || !(VALID_ACTIONS as readonly string[]).includes(body.action_type)) {
      return NextResponse.json(
        { error: 'Geçersiz action_type.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const rateLimitKey = `qr_gen:${body.employee_id}`
    const rateCheck = checkRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
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
      .select('id, active')
      .eq('id', body.employee_id)
      .maybeSingle()

    if (empError || !employee) {
      return NextResponse.json({ error: 'Çalışan bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' }, { status: 404 })
    }
    if (!employee.active) {
      return NextResponse.json({ error: 'Pasif çalışan için QR üretilemez.', code: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    const result = await generateQrToken(body.employee_id, body.action_type, ttl)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof QrTokenError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
    }
    console.error('[/api/qr/generate]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
