/**
 * POST /api/workforce/generate
 *
 * Kural tabanlı haftalık vardiya taslağı (draft) üretir.
 * Veriyi DB'ye YAZMAZ — sadece hesaplar ve döner.
 * Yalnızca MANAGER_ROLES erişebilir.
 *
 * Body: { week: 'YYYY-MM-DD', seed?: number }
 * Response: PlannerResult (assignments, stats, warnings, hasHardViolation)
 *
 * Ek uyarılar (planlayıcının dışında, sunucuda hesaplanır):
 *   - Bekleyen izin talebi olan güne atama (onaylanırsa vardiya kaldırılır)
 *   - Geçen haftanın sonuyla birlikte 6 günü aşan ardışık çalışma (İş Kanunu Md. 46)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { turkeyToday, addDaysToDateString, dayOfWeekFromDateString } from '@/lib/dateUtils'
import { getWeekDays } from '@/lib/scheduleUtils'
import { isValidDate } from '@/lib/validation'
import { readJson, serverError } from '@/lib/apiErrors'
import { maxConsecutiveDays } from '@/lib/planValidation'
import { runPlanner, kindFromTimes } from '@/lib/workforcePlanner'
import type { PlannerEmployee, PlannerShiftTemplate, ShiftKind } from '@/lib/workforcePlanner'
import type { DayOfWeek } from '@/types/workforce'
import { isAutoWeeklyRest } from '@/types/leave'

const DOW_MAP: Record<number, DayOfWeek> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = (await readJson<{ week?: string; seed?: number }>(req)) ?? {}
    const weekParam = body.week ?? turkeyToday()
    if (!isValidDate(weekParam)) {
      return NextResponse.json({ error: 'Geçersiz week parametresi.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const weekDays  = getWeekDays(new Date(`${weekParam}T12:00:00`))
    const weekStart = weekDays[0]
    const weekEnd   = weekDays[6]
    const prevWeekStart = addDaysToDateString(weekStart, -7)
    const prevWeekEnd   = addDaysToDateString(weekStart, -1)

    const admin = createAdminClient()

    // ── Veri toplama (paralel) ────────────────────────────────
    const [empsRes, tmplsRes, availsRes, leavesRes, prevRes, weekRes] = await Promise.all([
      admin
        .from('employees')
        .select('id, full_name, role, employment_type, active, roles ( name )')
        .eq('active', true)
        .order('full_name'),
      admin
        .from('shift_templates')
        .select('id, name, start_time, end_time')
        .eq('active', true)
        .order('start_time'),
      admin
        .from('employee_availability')
        .select('employee_id, day_of_week, start_time, end_time, is_available'),
      // Onaylı + bekleyen izinler (bu haftayla kesişen)
      admin
        .from('leave_requests')
        .select('employee_id, leave_type, reason, start_date, end_date, status')
        .in('status', ['approved', 'pending'])
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart),
      // Geçen haftanın vardiyaları (rotasyon + ardışık gün kontrolü)
      admin
        .from('shift_assignments')
        .select('employee_id, work_date, start_time, end_time, is_on_leave')
        .gte('work_date', prevWeekStart)
        .lte('work_date', prevWeekEnd),
      // Bu hafta zaten çalışılmış vardiyalar (giriş/çıkış kaydı olan) — aktarımda korunur
      admin
        .from('shift_assignments')
        .select('employee_id, work_date, start_time, end_time, shift_template_id, attendance_records ( id )')
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd),
    ])
    for (const r of [empsRes, tmplsRes, availsRes, leavesRes, prevRes, weekRes]) {
      if (r.error) return serverError('POST /api/workforce/generate', r.error)
    }

    const fixedAssignments = (weekRes.data ?? [])
      .filter((s) => Array.isArray(s.attendance_records) && s.attendance_records.length > 0)
      .map((s) => ({
        employee_id:       s.employee_id as string,
        work_date:         s.work_date as string,
        start_time:        s.start_time as string,
        end_time:          s.end_time as string,
        shift_template_id: s.shift_template_id as string | null,
      }))

    // ── Veri dönüşümü ─────────────────────────────────────────
    const prevShifts = (prevRes.data ?? []).filter((s) => !s.is_on_leave)

    // Geçen hafta → employee_id → dow → tür. Mağazada hiç kayıt yoksa geçen hafta bilinmiyor sayılır.
    const hasPrevWeek = prevShifts.length > 0
    const lastWeekMap = new Map<string, Partial<Record<string, ShiftKind>>>()
    for (const s of prevShifts) {
      const empId = s.employee_id as string
      if (!lastWeekMap.has(empId)) lastWeekMap.set(empId, {})
      lastWeekMap.get(empId)![DOW_MAP[dayOfWeekFromDateString(s.work_date as string)]] =
        kindFromTimes(s.start_time as string, s.end_time as string)
    }

    // Availability → employee_id → dow → records[]
    const availMap = new Map<string, Record<string, Array<{ start_time: string; end_time: string; is_available: boolean }>>>()
    for (const a of availsRes.data ?? []) {
      const empId = a.employee_id as string
      const dow   = a.day_of_week as string
      if (!availMap.has(empId)) availMap.set(empId, {})
      const empAvail = availMap.get(empId)!
      if (!empAvail[dow]) empAvail[dow] = []
      empAvail[dow].push({
        start_time:   a.start_time as string,
        end_time:     a.end_time as string,
        is_available: a.is_available as boolean,
      })
    }

    // İzin → employee_id → Set<'YYYY-MM-DD'> (onaylı: bloklar; bekleyen: yalnızca uyarı)
    // Otomatik plandan gelen haftalık tatiller yok sayılır — yeniden aktarımda yenilenir
    const leaveMap = new Map<string, Set<string>>()
    const pendingMap = new Map<string, Set<string>>()
    for (const lv of leavesRes.data ?? []) {
      if (isAutoWeeklyRest(lv as { leave_type: string; reason: string | null })) continue
      const target = lv.status === 'approved' ? leaveMap : pendingMap
      const empId = lv.employee_id as string
      if (!target.has(empId)) target.set(empId, new Set())
      const set = target.get(empId)!
      for (let d = lv.start_date as string; d <= (lv.end_date as string); d = addDaysToDateString(d, 1)) {
        if (d >= weekStart && d <= weekEnd) set.add(d)
      }
    }

    const emps = empsRes.data ?? []
    const plannerEmployees: PlannerEmployee[] = emps.map((e) => {
      const rolesObj = Array.isArray(e.roles) ? e.roles[0] : e.roles
      return {
        id:              e.id as string,
        full_name:       e.full_name as string,
        position:        e.role as string,
        role_name:       (rolesObj as { name?: string } | null)?.name ?? 'Çalışan',
        employment_type: (e.employment_type as 'full_time' | 'part_time') ?? 'full_time',
        availability:    availMap.get(e.id as string) ?? {},
        leaveDays:       leaveMap.get(e.id as string) ?? new Set(),
        lastWeek:        hasPrevWeek ? lastWeekMap.get(e.id as string) ?? {} : undefined,
      }
    })

    const plannerTemplates: PlannerShiftTemplate[] = (tmplsRes.data ?? []).map((t) => ({
      id:         t.id as string,
      name:       t.name as string,
      start_time: (t.start_time as string).slice(0, 5),
      end_time:   (t.end_time as string).slice(0, 5),
    }))

    // ── Plan üret ─────────────────────────────────────────────
    const result = runPlanner({
      weekStart,
      weekEnd,
      weekDays,
      employees: plannerEmployees,
      templates: plannerTemplates,
      fixedAssignments,
      // Her "Oluştur" farklı bir varyasyon üretir; aynı planı tekrar üretmek için seed gönderilebilir
      seed: typeof body.seed === 'number' ? body.seed : Math.floor(Math.random() * 2 ** 31),
    })

    // ── Ek uyarılar ───────────────────────────────────────────
    const nameOf = new Map(emps.map((e) => [e.id as string, e.full_name as string]))
    for (const a of result.assignments) {
      if (pendingMap.get(a.employee_id)?.has(a.work_date)) {
        result.warnings.push({
          level: 'warning',
          message: `${a.employee_name}: ${a.work_date} için bekleyen izin talebi var; onaylanırsa vardiya kaldırılır.`,
        })
      }
    }
    const datesByEmp = new Map<string, string[]>()
    const tail = prevShifts.filter((s) => (s.work_date as string) >= addDaysToDateString(weekStart, -6))
    for (const s of [...tail, ...result.assignments]) {
      const list = datesByEmp.get(s.employee_id as string) ?? []
      list.push(s.work_date as string)
      datesByEmp.set(s.employee_id as string, list)
    }
    for (const [empId, dates] of datesByEmp) {
      const run = maxConsecutiveDays(dates)
      if (run.length > 6 && run.end! >= weekStart) {
        result.warnings.push({
          level: 'warning',
          message: `${nameOf.get(empId) ?? empId}: ${run.start} – ${run.end} arası ${run.length} gün ardışık çalışma (geçen haftayla birlikte). İş Kanunu Md. 46 gereği 7 günde bir hafta tatili verilmeli.`,
        })
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    return serverError('POST /api/workforce/generate', err)
  }
}
