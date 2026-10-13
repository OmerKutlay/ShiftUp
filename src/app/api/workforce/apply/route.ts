/**
 * POST /api/workforce/apply
 *
 * Onaylanmış taslak planı Weekly Schedule'a (shift_assignments) yazar.
 * Haftanın mevcut planı YENİ PLANLA DEĞİŞTİRİLİR (üst üste yazılmaz):
 *   - Giriş/çıkış kaydı olan vardiyalar korunur; taslaktaki aynı çalışan+gün atlanır.
 *   - İzinli işaretli (is_on_leave) vardiyalar korunur.
 *   - Diğer tüm vardiyalar silinir (devam kaydı olan vardiya DB'de RESTRICT ile zaten silinemez).
 *
 * Sunucu doğrulaması (istemciye güvenilmez):
 *   - Her atama: geçerli çalışan (aktif), tarih (haftanın içinde), saat, şablon
 *   - Onaylı izin gününe atama veya 18 yaş altı gece/8 saat ihlali → 409 (aşılamaz)
 *   - Çalışma süresi / Md. 46 hafta tatili ihlalleri → 422, acknowledge_violations=true ile aşılır
 *
 * Haftalık tatil: planda hiç vardiyası olmayan aktif çalışan başına TEK gün otomatik
 * weekly_rest atanır (haftanın son boş günü). Önceki aktarımdan kalan otomatik tatiller
 * yenileriyle değiştirilir; elle atanan tatiller ve diğer izinler korunur.
 *
 * Body: { assignments: DraftAssignment[], weekStart?: string, acknowledge_violations?: boolean }
 * Response: { created, replaced, skipped, restDays, warnings }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import type { DraftAssignment } from '@/lib/workforcePlanner'
import { AUTO_WEEKLY_REST_REASON, isAutoWeeklyRest } from '@/types/leave'
import { badRequest, conflict, readJson, serverError } from '@/lib/apiErrors'
import { isUuid, isValidDate, isValidTime } from '@/lib/validation'
import { getWeekDays } from '@/lib/scheduleUtils'
import { addDaysToDateString } from '@/lib/dateUtils'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { validateWeekPlan, type PlanShift } from '@/lib/planValidation'
import { logAudit } from '@/lib/auditLog'
import { completedYears, minorWorkViolations } from '@/lib/laborLaw'
import { netWorkMins } from '@/lib/workingTimeService'
import type { EmploymentType } from '@/types/employee'
import { NOT_KIOSK_FILTER } from '@/lib/auth/roles'

const MAX_ASSIGNMENTS = 500

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = await readJson<{
      assignments?: DraftAssignment[]
      weekStart?: string
      acknowledge_violations?: boolean
    }>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')

    const assignments = body.assignments
    if (!Array.isArray(assignments) || assignments.length === 0) return badRequest('assignments dizisi gerekli.')
    if (assignments.length > MAX_ASSIGNMENTS) return badRequest('Çok fazla atama.')

    // ── Alan doğrulaması ────────────────────────────────────────
    for (const a of assignments) {
      if (!a || !isUuid(a.employee_id)) return badRequest('Geçersiz çalışan.')
      if (!isValidDate(a.work_date)) return badRequest('Geçersiz tarih.')
      if (!isValidTime(a.start_time) || !isValidTime(a.end_time) || a.start_time.slice(0, 5) === a.end_time.slice(0, 5)) {
        return badRequest(`Geçersiz vardiya saati (${a.work_date}).`)
      }
      if (a.shift_template_id != null && !isUuid(a.shift_template_id)) return badRequest('Geçersiz vardiya şablonu.')
    }

    // Hafta aralığı: Pzt–Paz (istemciden geleni de kendi hesabımızla doğrularız)
    const firstDate = assignments.map((a) => a.work_date).reduce((a, b) => (a < b ? a : b))
    const weekDays = getWeekDays(new Date(`${isValidDate(body.weekStart) ? body.weekStart : firstDate}T12:00:00`))
    const weekStart = weekDays[0]
    const weekEnd = weekDays[6]
    if (assignments.some((a) => a.work_date < weekStart || a.work_date > weekEnd)) {
      return badRequest('Atamalar seçili haftanın dışında.')
    }

    const admin = createAdminClient()

    // ── Veri ────────────────────────────────────────────────────
    const [existingRes, empsRes, leavesRes, neighborRes] = await Promise.all([
      admin
        .from('shift_assignments')
        .select('*, attendance_records ( id )')
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd),
      admin.from('employees').select('id, full_name, active, employment_type, birth_date').or(NOT_KIOSK_FILTER),
      admin
        .from('leave_requests')
        .select('id, employee_id, leave_type, start_date, end_date, reason, status, reviewed_at, reviewed_by')
        .in('status', ['pending', 'approved'])
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart),
      admin
        .from('shift_assignments')
        .select('id, employee_id, work_date, start_time, end_time, is_on_leave')
        .or(`and(work_date.gte.${addDaysToDateString(weekStart, -6)},work_date.lt.${weekStart}),work_date.eq.${addDaysToDateString(weekEnd, 1)}`),
    ])
    for (const r of [existingRes, empsRes, leavesRes, neighborRes]) {
      if (r.error) return serverError('POST /api/workforce/apply', r.error)
    }

    const employees = (empsRes.data ?? []) as Array<{
      id: string; full_name: string; active: boolean; employment_type: EmploymentType | null; birth_date: string | null
    }>
    const empById = new Map(employees.map((e) => [e.id, e]))
    for (const a of assignments) {
      const emp = empById.get(a.employee_id)
      if (!emp) return badRequest('Planda bilinmeyen bir çalışan var.')
      if (!emp.active) return conflict(`${emp.full_name} aktif değil; plana eklenemez.`)
    }

    // Korunacak / silinecek mevcut vardiyalar
    const keepKeys = new Set<string>()
    const kept: PlanShift[] = []
    const deleteIds: string[] = []
    const deletedRows: Record<string, unknown>[] = []  // hata olursa aynı id'lerle geri yüklemek için
    for (const r of existingRes.data ?? []) {
      const hasAttendance = Array.isArray(r.attendance_records) && r.attendance_records.length > 0
      if (r.is_on_leave || hasAttendance) {
        keepKeys.add(`${r.employee_id}::${r.work_date}`)
        if (!r.is_on_leave) kept.push(r as PlanShift)
      } else {
        deleteIds.push(r.id as string)
        const { attendance_records: _att, ...row } = r
        deletedRows.push(row)
      }
    }

    // Taslak içi tekrarlar ve korunan günler elenir
    const seen = new Set(keepKeys)
    const rows: Array<PlanShift & { shift_template_id: string | null; is_on_leave: boolean }> = []
    let skipped = 0
    for (const a of assignments) {
      const key = `${a.employee_id}::${a.work_date}`
      if (seen.has(key)) { skipped++; continue }
      seen.add(key)
      rows.push({
        employee_id:       a.employee_id,
        shift_template_id: a.shift_template_id ?? null,
        work_date:         a.work_date,
        start_time:        a.start_time.slice(0, 5),
        end_time:          a.end_time.slice(0, 5),
        is_on_leave:       false,
      })
    }

    // ── İzin çakışması (aşılamaz) ──────────────────────────────
    const leaves = leavesRes.data ?? []
    const oldAutoRests = leaves.filter((l) =>
      isAutoWeeklyRest(l) && (l.start_date as string) >= weekStart && (l.end_date as string) <= weekEnd
    )
    const oldAutoRestIds = new Set(oldAutoRests.map((l) => l.id as string))
    const blockingLeaves = leaves.filter((l) => !oldAutoRestIds.has(l.id as string))
    const approvedBlocking = blockingLeaves.filter((l) => l.status === 'approved')

    const leaveClashes = rows
      .filter((r) => approvedBlocking.some((l) =>
        l.employee_id === r.employee_id && (l.start_date as string) <= r.work_date && (l.end_date as string) >= r.work_date))
      .map((r) => `${empById.get(r.employee_id)?.full_name}: ${r.work_date} onaylı izin günü.`)
    // 18 yaş altı korumaları (gece yasağı, günlük 8 saat) — yasal yasak, onayla aşılamaz
    for (const r of rows) {
      const emp = empById.get(r.employee_id)!
      const age = emp.birth_date ? completedYears(emp.birth_date, r.work_date) : null
      for (const msg of minorWorkViolations(age, r.start_time, r.end_time, netWorkMins(r.start_time, r.end_time))) {
        leaveClashes.push(`${emp.full_name} (${r.work_date}): ${msg}`)
      }
    }
    if (leaveClashes.length > 0) {
      return NextResponse.json({ error: leaveClashes.join(' '), code: 'LEAVE_CONFLICT', violations: leaveClashes }, { status: 409 })
    }

    // ── Yasal kontroller (onayla aşılabilir) ────────────────────
    const violations = validateWeekPlan(
      [...rows, ...kept],
      ((neighborRes.data ?? []) as Array<PlanShift & { is_on_leave: boolean }>).filter((s) => !s.is_on_leave),
      employees.map((e) => ({ id: e.id, full_name: e.full_name, employment_type: e.employment_type ?? 'full_time' })),
      weekDays,
      getWorkingTimeConfig()
    )
    if (violations.length > 0 && body.acknowledge_violations !== true) {
      return NextResponse.json(
        {
          error: 'Plan çalışma süresi kurallarını ihlal ediyor. Onaylıyorsanız tekrar gönderin.',
          code: 'WORKING_TIME_VIOLATION',
          violations,
        },
        { status: 422 }
      )
    }

    // ── Haftalık tatil: çalışan başına tek gün ─────────────────
    const reviewedAt = new Date().toISOString()
    const restRows = []
    for (const e of employees.filter((x) => x.active)) {
      const empLeaves = blockingLeaves.filter((l) => l.employee_id === e.id)
      const hasManualRest = empLeaves.some((l) => l.leave_type === 'weekly_rest')
      if (hasManualRest) continue
      const freeDays = weekDays.filter((day) =>
        !seen.has(`${e.id}::${day}`) &&
        !empLeaves.some((l) => (l.start_date as string) <= day && (l.end_date as string) >= day)
      )
      if (freeDays.length === 0) continue
      const restDay = freeDays[freeDays.length - 1]
      restRows.push({
        employee_id: e.id,
        leave_type:  'weekly_rest',
        start_date:  restDay,
        end_date:    restDay,
        reason:      AUTO_WEEKLY_REST_REASON,
        status:      'approved',
        reviewed_at: reviewedAt,
        reviewed_by: auth.employee.id,
      })
    }

    // Sıra önemli: uq_shift_employee_day (çalışan+gün tekil) ve leave_requests_no_overlap
    // nedeniyle eskiler yenilerden ÖNCE silinmelidir. Her adım başarısız olursa önceki
    // adımlar geri alınır (eski vardiyalar aynı id'lerle geri yüklenir).

    // 1) Eski otomatik tatiller silinir (yeni tatiller aynı güne düşebilir)
    if (oldAutoRests.length > 0) {
      const { error: delRestErr } = await admin.from('leave_requests').delete().in('id', [...oldAutoRestIds])
      if (delRestErr) return serverError('POST /api/workforce/apply rest delete', delRestErr, 'Eski haftalık tatiller silinemedi, mevcut plan değiştirilmedi.')
    }

    const restoreOldRests = async () => {
      if (oldAutoRests.length > 0) {
        await admin.from('leave_requests').insert(oldAutoRests.map(({ id: _id, ...rest }) => rest))
      }
    }

    // 2) Yeni haftalık tatiller
    const { data: insertedRests, error: restErr } = restRows.length > 0
      ? await admin.from('leave_requests').insert(restRows).select('id')
      : { data: [], error: null }
    if (restErr) {
      await restoreOldRests()
      return serverError('POST /api/workforce/apply rest insert', restErr, 'Haftalık tatiller atanamadı, mevcut plan değiştirilmedi.')
    }
    const newRestIds = (insertedRests ?? []).map((r) => r.id as string)

    const rollbackRests = async () => {
      if (newRestIds.length > 0) await admin.from('leave_requests').delete().in('id', newRestIds)
      await restoreOldRests()
    }

    // 3) Eski plan silinir (tek ifade → ya hepsi ya hiçbiri)
    if (deleteIds.length > 0) {
      const { error: delErr } = await admin.from('shift_assignments').delete().in('id', deleteIds)
      if (delErr) {
        await rollbackRests()
        return serverError('POST /api/workforce/apply delete', delErr, 'Eski plan silinemedi, mevcut plan değiştirilmedi.')
      }
    }

    // 4) Yeni plan tek istekte; başarısızsa eski plan ve tatiller geri yüklenir
    const { data: inserted, error: insErr } = rows.length > 0
      ? await admin.from('shift_assignments').insert(rows).select('id')
      : { data: [], error: null }
    if (insErr) {
      if (deletedRows.length > 0) await admin.from('shift_assignments').insert(deletedRows)
      await rollbackRests()
      return serverError('POST /api/workforce/apply insert', insErr, 'Plan aktarılamadı, mevcut plan geri yüklendi.')
    }
    const newShiftIds = (inserted ?? []).map((r) => r.id as string)

    await logAudit({
      actorId: auth.employee.id,
      action: 'workforce.apply',
      entityType: 'week_plan',
      entityId: null,
      after: { weekStart, weekEnd, created: newShiftIds.length, replaced: deleteIds.length, restDays: newRestIds.length },
      note: violations.length > 0 ? `İhlaller onaylandı: ${violations.join(' | ')}` : null,
    })

    return NextResponse.json({
      created:  newShiftIds.length,
      replaced: deleteIds.length,
      skipped,
      restDays: newRestIds.length,
      warnings: violations,
      errors:   [] as string[],
    })
  } catch (err) {
    return serverError('POST /api/workforce/apply', err)
  }
}
