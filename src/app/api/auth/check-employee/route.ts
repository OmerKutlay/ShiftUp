/**
 * POST /api/auth/check-employee
 *
 * OTP gönderilmeden önce email'in aktif bir employee'a ait olup olmadığını doğrular.
 * shouldCreateUser: false kullandığımız için Supabase zaten kayıtsız kullanıcıya OTP göndermez,
 * ancak bu route ShiftUp iş kuralını (aktiflik) da erken kontrol eder.
 *
 * Body: { email: string }
 * Response:
 *   200 { allowed: true }
 *   403 { allowed: false, reason: 'EMPLOYEE_NOT_FOUND' | 'EMPLOYEE_INACTIVE' }
 *   400 { error: 'VALIDATION_ERROR' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string }
    const email = body.email?.trim().toLowerCase()

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Geçerli bir email adresi giriniz.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()

    // Email'e göre employee ara
    const { data: employee } = await admin
      .from('employees')
      .select('id, active, email')
      .eq('email', email)
      .maybeSingle()

    if (!employee) {
      return NextResponse.json(
        { allowed: false, reason: 'EMPLOYEE_NOT_FOUND' },
        { status: 403 }
      )
    }

    if (!employee.active) {
      return NextResponse.json(
        { allowed: false, reason: 'EMPLOYEE_INACTIVE' },
        { status: 403 }
      )
    }

    return NextResponse.json({ allowed: true })
  } catch (err) {
    console.error('[POST /api/auth/check-employee]', err)
    return NextResponse.json(
      { error: 'Sunucu hatası.', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
