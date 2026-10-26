/**
 * POST /api/open-shifts/claim
 *
 * Oturumdaki çalışan açık vardiyayı kendi adına üstlenir (employee_id session'dan).
 * Açık vardiya çalışanın kendi mağazasına ait olmalı (başka mağaza → 404); oluşan vardiya
 * açık vardiyanın mağazasına yazılır, mağaza yöneticilerine bildirilir.
 *
 * Kurallar (sunucuda): vardiya açık ve geçmişte değil; pozisyon belirtilmişse çalışanın
 * pozisyonu eşleşmeli; onaylı izin günü değil; komşu günlerle çakışma yok; tüm haftanın
 * çalışma süresi kuralları (part-time dahil) sağlanıyor.
 *
 * Yarış önlemi: önce açık vardiya koşullu olarak (status='open') sahiplenilir, sonra
 * plana eklenir; ekleme başarısızsa sahiplenme geri alınır. İki çalışan aynı anda
 * deneyemez — yalnızca biri kazanır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth, forbidden } from '@/lib/auth'
import { notifyManagers } from '@/lib/notificationRepository'
import { checkAvailability } from '@/lib/workingTimeService'
import { checkAssignmentRules } from '@/lib/shiftAssignmentRules'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { turkeyToday } from '@/lib/dateUtils'
import type { DayOfWeek } from '@/types/workforce'
import { matchesRoleNeeded } from '@/lib/openShiftEligibility'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = await readJson<{ open_shift_id?: string }>(req)
    if (!body || !isUuid(body.open_shift_id)) return badRequest('open_shift_id zorunludur.')

    const employeeId = currentEmployee.id
    const admin = createAdminClient()

    const { data: openShift, error: osErr } = await admin
      .from('open_shifts')
      .select('id, store_id, status, work_date, start_time, end_time, role_needed')
      .eq('id', body.open_shift_id)
      .eq('store_id', currentEmployee.home_store_id)
      .maybeSingle()
    if (osErr) return serverError('POST /api/open-shifts/claim', osErr)
    if (!openShift) return notFound('Açık vardiya bulunamadı.')
    if (openShift.status !== 'open') return conflict('Bu vardiya artık açık değil.')
    if (openShift.work_date < turkeyToday()) return badRequest('Geçmiş tarihli vardiya üstlenilemez.')

    if (!matchesRoleNeeded(openShift.role_needed, currentEmployee.role_name)) {
      return forbidden(`Bu vardiya "${openShift.role_needed}" rolü için açılmış.`)
    }

    const rules = await checkAssignmentRules(admin, employeeId, openShift)
    if (rules.blockers.length > 0) {
      return conflict(rules.blockers.join(' '), 'CLAIM_BLOCKED')
    }
    if (rules.violations.length > 0) {
      return NextResponse.json(
        { error: rules.violations.map((v) => v.message).join(' '), code: 'WORKING_TIME_VIOLATION' },
        { status: 422 }
      )
    }

    // Müsaitlik — yalnızca uyarı
    const { data: availRaw } = await admin
      .from('employee_availability')
      .select('day_of_week, start_time, end_time, is_available')
      .eq('employee_id', employeeId)
    const availabilityWarning = checkAvailability(
      openShift.work_date,
      openShift.start_time,
      openShift.end_time,
      (availRaw ?? []) as Array<{ day_of_week: DayOfWeek; start_time: string; end_time: string; is_available: boolean }>
    )

    // 1) Koşullu sahiplenme — yalnızca hâlâ 'open' ise
    const now = new Date().toISOString()
    const { data: claimed, error: claimErr } = await admin
      .from('open_shifts')
      .update({ status: 'filled', filled_by: employeeId, updated_at: now })
      .eq('id', openShift.id)
      .eq('status', 'open')
      .select()
      .maybeSingle()
    if (claimErr) return serverError('POST /api/open-shifts/claim', claimErr)
    if (!claimed) return conflict('Bu vardiya az önce başka biri tarafından alındı.')

    // 2) Plana ekle
    const { data: newAssignment, error: assignErr } = await admin
      .from('shift_assignments')
      .insert({
        store_id:          openShift.store_id,
        employee_id:       employeeId,
        shift_template_id: null,
        work_date:         openShift.work_date,
        start_time:        openShift.start_time,
        end_time:          openShift.end_time,
      })
      .select('id')
      .single()

    if (assignErr) {
      await admin
        .from('open_shifts')
        .update({ status: 'open', filled_by: null, updated_at: new Date().toISOString() })
        .eq('id', openShift.id)
      if (assignErr.code === '23505') return conflict('Bu tarihte zaten bir vardiyanız var.')
      return serverError('POST /api/open-shifts/claim', assignErr)
    }

    await admin
      .from('open_shifts')
      .update({ filled_assignment_id: newAssignment.id })
      .eq('id', openShift.id)

    try {
      await notifyManagers(
        admin,
        openShift.store_id,
        {
          type: 'open_shift_claimed',
          title: 'Açık vardiya alındı',
          message: `${currentEmployee.full_name}, ${openShift.work_date} ${openShift.start_time.slice(0, 5)}–${openShift.end_time.slice(0, 5)} açık vardiyasını üstlendi.`,
          related_id: newAssignment.id,
        },
        { excludeEmployeeId: employeeId },
      )
    } catch (notifErr) {
      console.error('[POST /api/open-shifts/claim] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({
      open_shift: { ...claimed, filled_assignment_id: newAssignment.id },
      shift_assignment_id: newAssignment.id,
      warnings: [...rules.warnings.map((w) => w.message), ...(availabilityWarning ? [availabilityWarning.message] : [])],
    })
  } catch (err) {
    return serverError('POST /api/open-shifts/claim', err)
  }
}
