/**
 * POST /api/qr/generate
 * QR token üretir. Sadece server-side çalışır.
 *
 * Body: { employee_id, action_type, ttl_seconds? }
 * Response: GenerateQrResponse
 */
import { NextRequest, NextResponse } from 'next/server'
import { generateQrToken, QrTokenError } from '@/lib/qrTokenService'
import type { GenerateQrRequest } from '@/types/qr'

const VALID_ACTIONS = ['clock_in', 'break_start', 'break_end', 'clock_out'] as const

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<GenerateQrRequest>

    // Validation
    if (!body.employee_id || typeof body.employee_id !== 'string') {
      return NextResponse.json(
        { error: 'employee_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    if (!body.action_type || !(VALID_ACTIONS as readonly string[]).includes(body.action_type)) {
      return NextResponse.json(
        { error: 'Geçersiz action_type.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const ttl = body.ttl_seconds && body.ttl_seconds > 0 ? body.ttl_seconds : 60

    const result = await generateQrToken(body.employee_id, body.action_type, ttl)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof QrTokenError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
    }
    console.error('[/api/qr/generate]', err)
    return NextResponse.json(
      { error: 'Sunucu hatası.', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
