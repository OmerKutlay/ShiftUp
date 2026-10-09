/**
 * POST /api/attendance/override
 * Manuel attendance kaydı düzeltmesi — FAZ 7 + FAZ 10 (bildirim).
 *
 * Tüm alan değişiklikleri server-side doğrulanır.
 * exception_note zorunludur — override sebebi kaydedilir.
 *
 * Body: ManualAttendanceOverride
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { ManualAttendanceOverride } from '@/types/report'
import type { AttendanceStatus } from '@/types/attendance'
import { createNotification } from '@/lib/notificationRepository'
import { requireMinRole, ROLES } from '@/lib/auth'

const VALID_STATUSES: AttendanceStatus[] = [
  'shift_waiting',
  'working',
  'on_break',
  'working_after_break',
  'clocked_out',
]

function isValidIso(val: unknown): boolean {
  if (val === null || val === undefined) return true // null silme için geçerli
  if (typeof val !== 'string') return false
  const d = new Date(val)
  return !isNaN(d.getTime())
}

export async function POST(req: NextRequest) {
  // Authorization: en az Müdür Yardımcısı yetkisi gerekir
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as Partial<ManualAttendanceOverride>

    // Zorunlu alanlar
    if (!body.record_id || typeof body.record_id !== 'string') {
      return NextResponse.json(
        { error: 'record_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    if (!body.exception_note || typeof body.exception_note !== 'string' || !body.exception_note.trim()) {
      return NextResponse.json(
        { error: 'exception_note zorunludur — override sebebini belirtin.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    // Status validation
    if (body.status !== undefined && !(VALID_STATUSES as string[]).includes(body.status)) {
      return NextResponse.json(
        { error: `Geçersiz status: ${body.status}`, code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    // Timestamp validations
    const timeFields = ['clock_in_at', 'break_start_at', 'break_end_at', 'clock_out_at'] as const
    for (const field of timeFields) {
      if (field in body && !isValidIso(body[field])) {
        return NextResponse.json(
          { error: `${field} geçersiz format (ISO 8601 bekleniyor).`, code: 'VALIDATION_ERROR' },
          { status: 400 }
        )
      }
    }

    const admin = createAdminClient()

    // Kaydın var olduğunu doğrula
    const { data: existing, error: fetchError } = await admin
      .from('attendance_records')
      .select('id, status, employee_id')
      .eq('id', body.record_id)
      .maybeSingle()

    if (fetchError) {
      return NextResponse.json(
        { error: 'Kayıt sorgulanamadı.', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'Attendance kaydı bulunamadı.', code: 'RECORD_NOT_FOUND' },
        { status: 404 }
      )
    }

    // Patch nesnesi — sadece gönderilen alanları güncelle
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {
      exception_note: body.exception_note.trim(),
      updated_at: new Date().toISOString(),
    }

    if (body.status !== undefined) patch.status = body.status
    for (const field of timeFields) {
      if (field in body) patch[field] = body[field] ?? null
    }

    const { data: updated, error: updateError } = await admin
      .from('attendance_records')
      .update(patch)
      .eq('id', body.record_id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json(
        { error: 'Kayıt güncellenemedi.', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    // FAZ 10: Çalışana attendance düzeltme bildirimi gönder
    try {
      await createNotification(admin, {
        employee_id: existing.employee_id,
        type: 'attendance_override',
        title: 'Devam kaydınız güncellendi',
        message: `Devam kaydınızda bir düzeltme yapıldı. Sebep: ${body.exception_note!.trim()}`,
        related_id: body.record_id,
      })
    } catch (notifErr) {
      console.error('[POST /api/attendance/override] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json(
      { success: true, record: updated },
      { status: 200 }
    )
  } catch (err) {
    console.error('[/api/attendance/override]', err)
    return NextResponse.json(
      { error: 'Sunucu hatası.', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
