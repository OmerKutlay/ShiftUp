/**
 * GET  /api/time-correction   — Talepleri listele
 * POST /api/time-correction   — Mesai düzeltme talebi oluştur
 *
 * GET:  Çalışan → kendi talepleri; Manager+ → tümü (status filtresi)
 *
 * POST iki mod:
 *   A) Çalışan (normal):  employee_id SESSION'dan, status='pending', yöneticilere bildirim
 *   B) Yönetici (direct): body.direct=true + body.employee_id (kendi veya başkası),
 *      status='direct', anında applyTimeCorrection() çağrılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth, requireMinRole, ROLES, MANAGER_ROLES } from '@/lib/auth'
import { hasRole } from '@/lib/auth'
import { createNotification } from '@/lib/notificationRepository'
import { applyTimeCorrection } from '@/lib/timeCorrectionService'
import type { CreateTimeCorrectionPayload, DirectTimeCorrectionPayload } from '@/types/timeCorrection'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

// ─── GET ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const { searchParams } = new URL(req.url)
    const statusFilter = searchParams.get('status')

    const admin = createAdminClient()
    const isManager = hasRole(currentEmployee.role_name, MANAGER_ROLES)

    let query = admin
      .from('manual_time_correction_requests')
      .select(`
        id, employee_id, date, requested_start_time, requested_end_time,
        reason, status, reviewed_by, reviewed_at, reviewer_note, created_at, updated_at,
        employee:employees!employee_id ( id, full_name, role ),
        reviewer:employees!reviewed_by ( id, full_name )
      `)
      .order('created_at', { ascending: false })

    if (!isManager) query = query.eq('employee_id', currentEmployee.id)
    if (statusFilter) query = query.eq('status', statusFilter)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
    return NextResponse.json({ requests: data ?? [] })
  } catch (err) {
    console.error('[GET /api/time-correction]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}

// ─── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = (await req.json()) as Partial<CreateTimeCorrectionPayload & DirectTimeCorrectionPayload & { direct?: boolean }>

    const isDirect = body.direct === true && hasRole(currentEmployee.role_name, MANAGER_ROLES)

    // Yönetici doğrudan giriş — başka çalışan adına da olabilir
    if (isDirect) {
      // Yetki ikinci kez kontrol (güvenlik)
      const authMin = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
      if ('response' in authMin) return authMin.response

      const employeeId = body.employee_id ?? currentEmployee.id  // belirtilmezse kendisi

      // Validation
      if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))
        return NextResponse.json({ error: 'Geçerli tarih giriniz.', code: 'VALIDATION_ERROR' }, { status: 400 })
      if (!body.requested_start_time || !body.requested_end_time)
        return NextResponse.json({ error: 'Giriş ve çıkış saati zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })
      if (body.requested_start_time >= body.requested_end_time)
        return NextResponse.json({ error: 'Çıkış saati girişten sonra olmalıdır.', code: 'VALIDATION_ERROR' }, { status: 400 })
      if (!body.reason?.trim())
        return NextResponse.json({ error: 'Sebep zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })

      const admin = createAdminClient()

      // Aynı gün önceki direct/approved kaydını kaldır (duplicate önlemi)
      await admin
        .from('manual_time_correction_requests')
        .delete()
        .eq('employee_id', employeeId)
        .eq('date', body.date)
        .in('status', ['direct', 'approved'])

      // Kaydı oluştur
      const { data, error } = await admin
        .from('manual_time_correction_requests')
        .insert({
          employee_id:            employeeId,
          date:                   body.date,
          requested_start_time:   body.requested_start_time,
          requested_end_time:     body.requested_end_time,
          reason:                 body.reason.trim(),
          status:                 'direct',
          reviewed_by:            currentEmployee.id,
          reviewed_at:            new Date().toISOString(),
        })
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })

      // Anında uygula
      const { warnings } = await applyTimeCorrection({
        admin,
        employeeId,
        date:       body.date,
        startTime:  body.requested_start_time.slice(0, 5),
        endTime:    body.requested_end_time.slice(0, 5),
      })

      // Çalışana bildirim (kendisi için değilse)
      if (employeeId !== currentEmployee.id) {
        try {
          const dateLabel = format(new Date(body.date + 'T00:00:00'), 'd MMMM yyyy', { locale: tr })
          await createNotification(admin, {
            employee_id: employeeId,
            type: 'time_correction_approved',
            title: 'Mesai düzeltmeniz uygulandı',
            message: `${dateLabel} ${body.requested_start_time}–${body.requested_end_time} mesai saatiniz yönetici tarafından güncellendi.`,
            related_id: data.id,
          })
        } catch (notifErr) {
          console.error('[POST /api/time-correction direct] bildirim gönderilemedi:', notifErr)
        }
      }

      return NextResponse.json({ request: data, warnings }, { status: 201 })
    }

    // ── Çalışan normal talebi ────────────────────────────────────
    // Validation
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))
      return NextResponse.json({ error: 'Geçerli tarih giriniz (YYYY-MM-DD).', code: 'VALIDATION_ERROR' }, { status: 400 })
    if (!body.requested_start_time || !/^\d{2}:\d{2}$/.test(body.requested_start_time))
      return NextResponse.json({ error: 'Giriş saati zorunludur (HH:MM).', code: 'VALIDATION_ERROR' }, { status: 400 })
    if (!body.requested_end_time || !/^\d{2}:\d{2}$/.test(body.requested_end_time))
      return NextResponse.json({ error: 'Çıkış saati zorunludur (HH:MM).', code: 'VALIDATION_ERROR' }, { status: 400 })
    if (body.requested_start_time >= body.requested_end_time)
      return NextResponse.json({ error: 'Çıkış saati giriş saatinden sonra olmalıdır.', code: 'VALIDATION_ERROR' }, { status: 400 })
    if (!body.reason?.trim())
      return NextResponse.json({ error: 'Sebep açıklaması zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })

    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('manual_time_correction_requests')
      .select('id')
      .eq('employee_id', currentEmployee.id)
      .eq('date', body.date)
      .in('status', ['pending', 'approved', 'direct'])
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({
        error: 'Bu tarih için zaten bekleyen veya onaylanmış bir mesai düzeltme talebi var.',
        code: 'DUPLICATE_REQUEST',
      }, { status: 409 })
    }

    const { data, error } = await admin
      .from('manual_time_correction_requests')
      .insert({
        employee_id:          currentEmployee.id,
        date:                 body.date,
        requested_start_time: body.requested_start_time,
        requested_end_time:   body.requested_end_time,
        reason:               body.reason.trim(),
        status:               'pending',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })

    // Yöneticilere bildirim
    try {
      const dateLabel = format(new Date(body.date + 'T00:00:00'), 'd MMMM yyyy', { locale: tr })
      const { data: managers } = await admin
        .from('employees')
        .select('id, roles(name)')
        .eq('active', true)

      if (managers) {
        const targets = managers.filter((m) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rn = (m as any).roles?.name ?? null
          return MANAGER_ROLES.includes(rn)
        })
        await Promise.allSettled(
          targets.map((m) =>
            createNotification(admin, {
              employee_id: m.id,
              type: 'time_correction_submitted',
              title: 'Yeni Mesai Düzeltme Talebi',
              message: `${currentEmployee.full_name} — ${dateLabel} için ${body.requested_start_time}–${body.requested_end_time} mesai düzeltme talebi oluşturdu.`,
              related_id: data.id,
            })
          )
        )
      }
    } catch (notifErr) {
      console.error('[POST /api/time-correction] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ request: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/time-correction]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
