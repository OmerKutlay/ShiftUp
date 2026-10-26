/**
 * GET  /api/shifts?week=YYYY-MM-DD           — o haftanın (Pzt–Paz) vardiyaları (oturum gerektirir)
 * GET  /api/shifts?start=YYYY-MM-DD&end=...   — tarih aralığı (en fazla 62 gün)
 * POST /api/shifts                             — vardiya atar (Müdür Yardımcısı+)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireMinRole, ACCESS, hasRole, MANAGER_ROLES } from '@/lib/auth'
import { fetchWeeklyAssignments, fetchAssignmentsInRange, createShiftAssignment, attachWorkedMinutes } from '@/lib/scheduleRepository'
import { ShiftConflictError } from '@/types/schedule'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid, isValidDate, isValidTime } from '@/lib/validation'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { logAudit } from '@/lib/auditLog'
import { checkAssignmentRules } from '@/lib/shiftAssignmentRules'
import { notifyShiftChange } from '@/lib/shiftNotifications'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  const sp = req.nextUrl.searchParams
  const week = sp.get('week')
  const start = sp.get('start')
  const end = sp.get('end')
  // Fiili çalışma süreleri: yönetici herkesinkini, çalışan yalnızca kendisininkini görür
  const onlyEmployeeId = hasRole(auth.employee.access_level, MANAGER_ROLES) ? undefined : auth.employee.id

  try {
    if (week) {
      if (!isValidDate(week)) return badRequest('Geçersiz hafta tarihi.')
      const assignments = await fetchWeeklyAssignments(new Date(`${week}T12:00:00`))
      return NextResponse.json({ assignments: await attachWorkedMinutes(assignments, onlyEmployeeId) })
    }
    if (isValidDate(start) && isValidDate(end)) {
      const days = (Date.parse(end) - Date.parse(start)) / 86_400_000
      if (days < 0 || days > 62) return badRequest('Tarih aralığı 0–62 gün olmalıdır.')
      const assignments = await fetchAssignmentsInRange(start, end)
      return NextResponse.json({ assignments: await attachWorkedMinutes(assignments, onlyEmployeeId) })
    }
    return badRequest('week veya start/end parametresi gerekli.')
  } catch (err) {
    return serverError('GET /api/shifts', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  const { employee_id, shift_template_id, work_date, start_time, end_time } = body
  if (!isUuid(employee_id)) return badRequest('Geçersiz çalışan.')
  if (shift_template_id !== null && shift_template_id !== undefined && !isUuid(shift_template_id)) {
    return badRequest('Geçersiz vardiya şablonu.')
  }
  if (!isValidDate(work_date)) return badRequest('Geçersiz tarih.')
  if (!isValidTime(start_time) || !isValidTime(end_time)) return badRequest('Geçersiz saat formatı (HH:MM).')
  if (start_time.slice(0, 5) === end_time.slice(0, 5)) {
    return badRequest('Başlangıç ve bitiş saati aynı olamaz.')
  }

  try {
    const admin = createAdminClient()
    const { data: emp, error: empErr } = await admin
      .from('employees')
      .select('id, active')
      .eq('id', employee_id)
      .maybeSingle()
    if (empErr) return serverError('POST /api/shifts', empErr)
    if (!emp) return notFound('Çalışan bulunamadı.')

    // İş Kanunu kuralları: kesin engeller (izin, 18 yaş altı) 409; çalışma süresi ihlalleri onay ister
    const rules = await checkAssignmentRules(admin, employee_id, {
      work_date, start_time: start_time.slice(0, 5), end_time: end_time.slice(0, 5),
    })
    const blockers = rules.blockers.filter((b) => !b.includes('çakışıyor'))  // çakışma aşağıda ayrıca kontrol edilir
    if (blockers.length > 0) return conflict(blockers.join(' '), 'ASSIGNMENT_BLOCKED')
    if (rules.violations.length > 0 && body.acknowledge_violations !== true) {
      return NextResponse.json(
        {
          error: 'Bu vardiya çalışma süresi kurallarını ihlal ediyor.',
          code: 'WORKING_TIME_VIOLATION',
          violations: rules.violations.map((v) => v.message),
        },
        { status: 422 }
      )
    }

    const assignment = await createShiftAssignment(
      {
        employee_id,
        shift_template_id: (shift_template_id as string | null | undefined) ?? null,
        work_date,
        start_time: start_time.slice(0, 5),
        end_time: end_time.slice(0, 5),
      },
      emp.active
    )

    await logAudit({
      actorId: auth.employee.id,
      action: 'shift.create',
      entityType: 'shift_assignment',
      entityId: assignment.id,
      after: { employee_id, work_date, start_time, end_time },
      note: rules.violations.length > 0 ? `İhlaller onaylandı: ${rules.violations.map((v) => v.message).join(' | ')}` : null,
    })

    await notifyShiftChange(admin, auth.employee.id, { kind: 'created', shift: assignment })

    return NextResponse.json({ assignment }, { status: 201 })
  } catch (err) {
    if (err instanceof ShiftConflictError) return conflict(err.message, 'SHIFT_CONFLICT')
    if (err instanceof Error && err.message.startsWith('Pasif çalışan')) return badRequest(err.message)
    return serverError('POST /api/shifts', err)
  }
}
