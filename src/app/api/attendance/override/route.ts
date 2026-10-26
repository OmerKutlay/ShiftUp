/**
 * POST /api/attendance/override
 * Yöneticinin devam kaydını manuel düzeltmesi (Müdür Yardımcısı+).
 *
 * - Kaydın düzeltme sonrası son hali tutarlı olmalı (durum ↔ saatler, kronolojik sıra).
 * - Yönetici kendi devam kaydını düzeltemez; yalnızca aktif mağazanın vardiyasına ait kaydı düzeltebilir.
 * - exception_note zorunludur ve mevcut nota EKLENİR (yuvarlama notu kaybolmaz).
 * - Mola alanları elle girilemez (400); mola otomatik hesaplanır. Molada unutulan kayıt kapatılırsa
 *   bitmemiş mola okutulmamış sayılır.
 * - Eski/yeni değerler audit_logs'a yazılır.
 * - Kayıt okunduktan sonra başkası güncellediyse 409 döner (updated_at koşulu).
 *
 * Body: ManualAttendanceOverride
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { ManualAttendanceOverride } from '@/types/report'
import type { AttendanceStatus } from '@/types/attendance'
import { createNotification } from '@/lib/notificationRepository'
import { requireMinRole, ACCESS, forbidden, forbidIfOutranked } from '@/lib/auth'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { validateOverrideState, type OverrideState } from '@/lib/attendanceOverride'
import { logAudit } from '@/lib/auditLog'

const VALID_STATUSES: AttendanceStatus[] = [
  'shift_waiting',
  'working',
  'on_break',
  'working_after_break',
  'clocked_out',
]
const TIME_FIELDS = ['clock_in_at', 'clock_out_at'] as const
/** Mola elle girilmez — okutulan molalar korunur, düşülecek mola otomatik hesaplanır (bkz. attendanceDurations) */
const BREAK_FIELDS = ['break_start_at', 'break_end_at', 'completed_break_minutes'] as const

function isValidIso(val: unknown): boolean {
  if (val === null || val === undefined) return true // null silme için geçerli
  if (typeof val !== 'string') return false
  return !Number.isNaN(new Date(val).getTime())
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const body = await readJson<Partial<ManualAttendanceOverride>>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')
    if (!isUuid(body.record_id)) return badRequest('record_id zorunludur.')

    const note = typeof body.exception_note === 'string' ? body.exception_note.trim() : ''
    if (!note) return badRequest('exception_note zorunludur — override sebebini belirtin.')
    if (note.length > 500) return badRequest('Sebep en fazla 500 karakter olabilir.')

    if (body.status !== undefined && !(VALID_STATUSES as string[]).includes(body.status)) {
      return badRequest(`Geçersiz status: ${body.status}`)
    }
    if (BREAK_FIELDS.some((f) => f in body)) {
      return badRequest('Mola elle girilemez; mola süresi otomatik hesaplanır.', 'BREAK_NOT_EDITABLE')
    }
    for (const field of TIME_FIELDS) {
      if (field in body && !isValidIso(body[field])) {
        return badRequest(`${field} geçersiz format (ISO 8601 bekleniyor).`)
      }
    }

    const admin = createAdminClient()
    const storeId = auth.employee.store_id

    const { data: existing, error: fetchError } = await admin
      .from('attendance_records')
      .select('*')
      .eq('id', body.record_id)
      .maybeSingle()
    if (fetchError) return serverError('POST /api/attendance/override', fetchError)
    if (!existing) return notFound('Attendance kaydı bulunamadı.', 'RECORD_NOT_FOUND')

    // Kaydın vardiyası aktif mağazada olmalı (başka mağazanın kaydı → 404, varlığı sızdırılmaz)
    const { data: shiftRow, error: shiftError } = await admin
      .from('shift_assignments')
      .select('id')
      .eq('id', existing.shift_assignment_id)
      .eq('store_id', storeId)
      .maybeSingle()
    if (shiftError) return serverError('POST /api/attendance/override', shiftError)
    if (!shiftRow) return notFound('Attendance kaydı bulunamadı.', 'RECORD_NOT_FOUND')

    if (existing.employee_id === auth.employee.id) {
      return forbidden('Kendi devam kaydınızı düzeltemezsiniz.')
    }
    const outranked = await forbidIfOutranked(auth.employee, existing.employee_id)
    if (outranked) return outranked

    // Son hali oluştur ve doğrula
    const next: OverrideState = {
      status: (body.status ?? existing.status) as AttendanceStatus,
      clock_in_at: 'clock_in_at' in body ? (body.clock_in_at ?? null) : existing.clock_in_at,
      break_start_at: existing.break_start_at,
      break_end_at: existing.break_end_at,
      clock_out_at: 'clock_out_at' in body ? (body.clock_out_at ?? null) : existing.clock_out_at,
      completed_break_minutes: existing.completed_break_minutes ?? 0,
    }
    // Molada unutulan kayıt kapatılıyorsa bitmemiş mola okutulmamış sayılır (mola elle tamamlanmaz)
    if (next.status !== 'on_break' && next.break_start_at && !next.break_end_at) {
      next.break_start_at = null
    }
    // ISO'ları normalize et
    for (const field of ['clock_in_at', 'break_start_at', 'break_end_at', 'clock_out_at'] as const) {
      const v = next[field]
      if (v) next[field] = new Date(v).toISOString()
    }

    const stateError = validateOverrideState(next)
    if (stateError) return badRequest(stateError, 'INCONSISTENT_RECORD')

    const prevNote = typeof existing.exception_note === 'string' ? existing.exception_note.trim() : ''
    const patch = {
      ...next,
      exception_note: prevNote ? `${prevNote} | Düzeltme: ${note}` : `Düzeltme: ${note}`,
      verification_method: 'manual_override',
      updated_at: new Date().toISOString(),
    }

    const { data: updated, error: updateError } = await admin
      .from('attendance_records')
      .update(patch)
      .eq('id', body.record_id)
      .eq('updated_at', existing.updated_at)
      .select()
      .maybeSingle()
    if (updateError) return serverError('POST /api/attendance/override', updateError)
    if (!updated) return conflict('Kayıt bu sırada başka bir işlemle güncellendi. Sayfayı yenileyip tekrar deneyin.')

    await logAudit({
      actorId: auth.employee.id,
      storeId,
      action: 'attendance.override',
      entityType: 'attendance_record',
      entityId: existing.id,
      before: {
        status: existing.status,
        clock_in_at: existing.clock_in_at,
        break_start_at: existing.break_start_at,
        break_end_at: existing.break_end_at,
        clock_out_at: existing.clock_out_at,
        completed_break_minutes: existing.completed_break_minutes,
      },
      after: next,
      note,
    })

    try {
      await createNotification(admin, {
        employee_id: existing.employee_id,
        type: 'attendance_override',
        title: 'Devam kaydınız güncellendi',
        message: `Devam kaydınızda bir düzeltme yapıldı. Sebep: ${note}`,
        related_id: existing.id,
      })
    } catch (notifErr) {
      console.error('[POST /api/attendance/override] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ success: true, record: updated }, { status: 200 })
  } catch (err) {
    return serverError('POST /api/attendance/override', err)
  }
}
