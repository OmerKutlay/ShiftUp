/**
 * GET  /api/time-correction   — Talepleri listele
 * POST /api/time-correction   — Mesai düzeltme talebi oluştur
 *
 * GET:  Çalışan → kendi talepleri; Manager+ → tümü (status filtresi)
 *
 * POST iki mod:
 *   A) Çalışan (normal):  employee_id SESSION'dan, status='pending', yöneticilere bildirim
 *   B) Yönetici (direct): body.direct=true + body.employee_id (BAŞKA bir çalışan),
 *      status='direct', anında uygulanır. Yönetici kendi mesaisini doğrudan giremez —
 *      kendi düzeltmesi için normal talep açar ve başka bir yönetici onaylar.
 *
 * Kurallar: tarih bugünden ileri olamaz ve en fazla MAX_BACKDATE_DAYS geriye gidebilir;
 * çıkış saati girişten küçükse ertesi gün sayılır (gece vardiyası). Çalışma süresi
 * ihlali olan doğrudan giriş, acknowledge_violations=true gönderilmeden uygulanmaz.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth, MANAGER_ROLES, hasRole, forbidden } from '@/lib/auth'
import { createNotification, notifyManagers } from '@/lib/notificationRepository'
import { applyTimeCorrection, checkCorrectionViolations } from '@/lib/timeCorrectionService'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid, isValidDate, isValidTime } from '@/lib/validation'
import { turkeyToday, addDaysToDateString } from '@/lib/dateUtils'
import { logAudit } from '@/lib/auditLog'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

const MAX_BACKDATE_DAYS = 60
const VALID_STATUSES = ['pending', 'approved', 'rejected', 'direct']

interface Body {
  direct?: boolean
  employee_id?: string
  date?: string
  requested_start_time?: string
  requested_end_time?: string
  reason?: string
  break_minutes?: number | null
  acknowledge_violations?: boolean
}

/** Ortak alan doğrulaması — hata mesajı ya da null */
function validateFields(body: Body): string | null {
  if (!isValidDate(body.date)) return 'Geçerli tarih giriniz (YYYY-MM-DD).'
  const today = turkeyToday()
  if (body.date > today) return 'Gelecek bir tarih için mesai düzeltmesi yapılamaz.'
  if (body.date < addDaysToDateString(today, -MAX_BACKDATE_DAYS)) {
    return `En fazla ${MAX_BACKDATE_DAYS} gün öncesine düzeltme yapılabilir.`
  }
  if (!isValidTime(body.requested_start_time)) return 'Giriş saati zorunludur (HH:MM).'
  if (!isValidTime(body.requested_end_time)) return 'Çıkış saati zorunludur (HH:MM).'
  if (body.requested_start_time.slice(0, 5) === body.requested_end_time.slice(0, 5)) {
    return 'Giriş ve çıkış saati aynı olamaz.'
  }
  if (typeof body.reason !== 'string' || !body.reason.trim()) return 'Sebep açıklaması zorunludur.'
  if (body.reason.length > 500) return 'Sebep en fazla 500 karakter olabilir.'
  if (body.break_minutes != null && (!Number.isInteger(body.break_minutes) || body.break_minutes < 0 || body.break_minutes > 240)) {
    return 'Mola süresi 0–240 dakika arasında olmalıdır.'
  }
  return null
}

function dateLabel(date: string) {
  return format(new Date(`${date}T12:00:00`), 'd MMMM yyyy', { locale: tr })
}

// ─── GET ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const statusFilter = req.nextUrl.searchParams.get('status')
    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) return badRequest('Geçersiz durum filtresi.')

    const admin = createAdminClient()
    const isManager = hasRole(currentEmployee.role_name, MANAGER_ROLES)

    let query = admin
      .from('manual_time_correction_requests')
      .select(`
        id, employee_id, date, requested_start_time, requested_end_time, break_minutes,
        reason, status, reviewed_by, reviewed_at, reviewer_note, created_at, updated_at,
        employee:employees!employee_id ( id, full_name, role ),
        reviewer:employees!reviewed_by ( id, full_name )
      `)
      .order('created_at', { ascending: false })

    if (!isManager) query = query.eq('employee_id', currentEmployee.id)
    if (statusFilter) query = query.eq('status', statusFilter)

    const { data, error } = await query
    if (error) return serverError('GET /api/time-correction', error)
    return NextResponse.json({ requests: data ?? [] })
  } catch (err) {
    return serverError('GET /api/time-correction', err)
  }
}

// ─── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = await readJson<Body>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    const fieldError = validateFields(body)
    if (fieldError) return badRequest(fieldError)
    const date = body.date!
    const start = body.requested_start_time!.slice(0, 5)
    const end = body.requested_end_time!.slice(0, 5)
    const reason = body.reason!.trim()

    const admin = createAdminClient()

    // ── B) Yönetici doğrudan giriş ──────────────────────────────
    if (body.direct === true) {
      if (!hasRole(currentEmployee.role_name, MANAGER_ROLES)) {
        return forbidden('Doğrudan mesai girişi yalnızca yöneticiler içindir.')
      }
      if (!isUuid(body.employee_id)) return badRequest('Çalışan seçiniz.')
      const employeeId = body.employee_id
      if (employeeId === currentEmployee.id) {
        return forbidden('Kendi mesainizi doğrudan giremezsiniz; talep oluşturun, başka bir yönetici onaylasın.')
      }

      const { data: emp, error: empErr } = await admin
        .from('employees')
        .select('id, active')
        .eq('id', employeeId)
        .maybeSingle()
      if (empErr) return serverError('POST /api/time-correction', empErr)
      if (!emp) return notFound('Çalışan bulunamadı.')
      if (!emp.active) return badRequest('Pasif çalışan için mesai girilemez.')

      const violations = await checkCorrectionViolations({ admin, employeeId, date, startTime: start, endTime: end })
      if (violations.errors.length > 0 && body.acknowledge_violations !== true) {
        return NextResponse.json(
          {
            error: 'Bu düzeltme çalışma süresi kurallarını ihlal ediyor. Onaylıyorsanız tekrar gönderin.',
            code: 'WORKING_TIME_VIOLATION',
            violations: violations.errors.map((v) => v.message),
          },
          { status: 422 }
        )
      }

      const { data, error } = await admin
        .from('manual_time_correction_requests')
        .insert({
          employee_id: employeeId,
          date,
          requested_start_time: start,
          requested_end_time: end,
          break_minutes: body.break_minutes ?? null,
          reason,
          status: 'direct',
          reviewed_by: currentEmployee.id,
          reviewed_at: new Date().toISOString(),
        })
        .select()
        .single()
      if (error) return serverError('POST /api/time-correction', error)

      let applied
      try {
        applied = await applyTimeCorrection({
          admin, employeeId, date, startTime: start, endTime: end, breakMinutes: body.break_minutes,
        })
      } catch (applyErr) {
        // Uygulanamayan doğrudan kaydı geri al
        await admin.from('manual_time_correction_requests').delete().eq('id', data.id)
        return serverError('POST /api/time-correction direct apply', applyErr)
      }

      await logAudit({
        actorId: currentEmployee.id,
        action: 'time_correction.direct',
        entityType: 'attendance_record',
        entityId: applied.attendanceRecordId,
        after: { employee_id: employeeId, date, start, end, break_minutes: applied.breakMinutes },
        note: violations.errors.length > 0
          ? `İhlaller onaylandı: ${violations.errors.map((v) => v.message).join(' | ')}`
          : null,
      })

      try {
        await createNotification(admin, {
          employee_id: employeeId,
          type: 'time_correction_approved',
          title: 'Mesai düzeltmeniz uygulandı',
          message: `${dateLabel(date)} ${start}–${end} mesai saatiniz yönetici tarafından güncellendi.`,
          related_id: data.id,
        })
      } catch (notifErr) {
        console.error('[POST /api/time-correction direct] bildirim gönderilemedi:', notifErr)
      }

      return NextResponse.json(
        { request: data, warnings: [...violations.errors, ...violations.warnings].map((v) => v.message) },
        { status: 201 }
      )
    }

    // ── A) Çalışan normal talebi ────────────────────────────────
    const { data: existing, error: dupErr } = await admin
      .from('manual_time_correction_requests')
      .select('id')
      .eq('employee_id', currentEmployee.id)
      .eq('date', date)
      .in('status', ['pending', 'approved', 'direct'])
      .limit(1)
    if (dupErr) return serverError('POST /api/time-correction', dupErr)
    if (existing && existing.length > 0) {
      return conflict('Bu tarih için zaten bekleyen veya onaylanmış bir mesai düzeltme talebi var.', 'DUPLICATE_REQUEST')
    }

    const { data, error } = await admin
      .from('manual_time_correction_requests')
      .insert({
        employee_id: currentEmployee.id,
        date,
        requested_start_time: start,
        requested_end_time: end,
        break_minutes: body.break_minutes ?? null,
        reason,
        status: 'pending',
      })
      .select()
      .single()
    if (error) {
      if (error.code === '23505') {
        return conflict('Bu tarih için zaten bekleyen bir mesai düzeltme talebi var.', 'DUPLICATE_REQUEST')
      }
      return serverError('POST /api/time-correction', error)
    }

    try {
      await notifyManagers(
        admin,
        {
          type: 'time_correction_submitted',
          title: 'Yeni Mesai Düzeltme Talebi',
          message: `${currentEmployee.full_name} — ${dateLabel(date)} için ${start}–${end} mesai düzeltme talebi oluşturdu.`,
          related_id: data.id,
        },
        { excludeEmployeeId: currentEmployee.id },
      )
    } catch (notifErr) {
      console.error('[POST /api/time-correction] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ request: data }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/time-correction', err)
  }
}
