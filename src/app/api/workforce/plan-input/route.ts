/**
 * GET /api/workforce/plan-input?week=YYYY-MM-DD
 *
 * Kural tabanlı haftalık vardiya taslağının VERİ PAKETİ: planlayıcı girdisi + haftanın tatilleri.
 * Plan TARAYICIDA üretilir (buildPlan, src/lib/workforcePlanPayload.ts) — planlayıcı Worker'ın
 * CPU sınırını aşıyordu (1102). Veriyi DB'ye YAZMAZ.
 * Yalnızca MANAGER_ROLES erişebilir.
 * Yalnızca aktif mağazanın verisiyle çalışır: çalışanlar, şablonlar, vardiyalar, izinler,
 * müsaitlik ve tatiller (ulusal + mağaza) o mağazaya göre filtrelenir.
 *
 * Response: PlanPayload
 * (Md. 46: H.İ. takvim haftası içinde; geçen haftadan gelen seri (prevStreak) planlayıcıda tercih olarak kullanılır.)
 */
import { isEmployedOn } from '@/lib/employment'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { turkeyToday, addDaysToDateString, dayOfWeekFromDateString } from '@/lib/dateUtils'
import { getWeekDays } from '@/lib/scheduleUtils'
import { isValidDate } from '@/lib/validation'
import { serverError } from '@/lib/apiErrors'
import { kindFromTimes } from '@/lib/workforcePlanner'
import type { PlannerEmployee, PlannerShiftTemplate, ShiftKind } from '@/lib/workforcePlanner'
import { toPayloadEmployee, type PlanPayload } from '@/lib/workforcePlanPayload'
import type { DayOfWeek } from '@/types/workforce'
import { isAutoWeeklyRest } from '@/types/leave'
import { grossMins } from '@/lib/laborLaw'
import { NOT_KIOSK_FILTER, isPlanningGroup, type PlanningGroup } from '@/lib/auth/roles'
import { storeEmployeeIds } from '@/lib/storeScope'
import { fetchHolidaysInRange } from '@/lib/holidayRepository'

const DOW_MAP: Record<number, DayOfWeek> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
}

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const weekParam = req.nextUrl.searchParams.get('week') ?? turkeyToday()
    if (!isValidDate(weekParam)) {
      return NextResponse.json({ error: 'Geçersiz week parametresi.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const weekDays  = getWeekDays(new Date(`${weekParam}T12:00:00`))
    const weekStart = weekDays[0]
    const weekEnd   = weekDays[6]
    const prevWeekStart = addDaysToDateString(weekStart, -7)
    const prevWeekEnd   = addDaysToDateString(weekStart, -1)

    const admin = createAdminClient()
    const storeId = auth.employee.store_id
    // Müsaitlik ve izin tabloları çalışana bağlıdır: yalnızca bu mağazanın çalışanları
    const storeEmpIds = await storeEmployeeIds(storeId)

    // ── Veri toplama (paralel) ────────────────────────────────
    const [empsRes, tmplsRes, availsRes, leavesRes, prevRes, weekRes, holidays] = await Promise.all([
      admin
        .from('employees')
        .select('id, full_name, employment_type, active, birth_date, termination_date, roles ( planning_group )')
        .eq('store_id', storeId)
        .eq('active', true)
        .or(NOT_KIOSK_FILTER)
        .order('full_name'),
      admin
        .from('shift_templates')
        .select('id, name, start_time, end_time')
        .eq('store_id', storeId)
        .eq('active', true)
        .order('start_time'),
      admin
        .from('employee_availability')
        .select('employee_id, day_of_week, start_time, end_time, is_available')
        .in('employee_id', storeEmpIds),
      // Onaylı + bekleyen izinler (bu haftayla kesişen)
      admin
        .from('leave_requests')
        .select('employee_id, leave_type, reason, start_date, end_date, status')
        .in('employee_id', storeEmpIds)
        .in('status', ['approved', 'pending'])
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart),
      // Geçen haftanın vardiyaları (rotasyon + ardışık gün kontrolü)
      admin
        .from('shift_assignments')
        .select('employee_id, work_date, start_time, end_time, is_on_leave')
        .eq('store_id', storeId)
        .gte('work_date', prevWeekStart)
        .lte('work_date', prevWeekEnd),
      // Bu haftanın vardiyaları: giriş/çıkış kaydı olanlar ve geçmiş günlerinkiler aktarımda korunur
      admin
        .from('shift_assignments')
        .select('employee_id, work_date, start_time, end_time, shift_template_id, is_on_leave, attendance_records ( id )')
        .eq('store_id', storeId)
        .gte('work_date', weekStart)
        .lte('work_date', weekEnd),
      fetchHolidaysInRange(storeId, weekStart, weekEnd),
    ])
    for (const r of [empsRes, tmplsRes, availsRes, leavesRes, prevRes, weekRes]) {
      if (r.error) return serverError('GET /api/workforce/plan-input', r.error)
    }

    const emps = empsRes.data ?? []
    const planningGroupOf = (e: (typeof emps)[number]): PlanningGroup | null => {
      const role = Array.isArray(e.roles) ? e.roles[0] : e.roles
      const g = (role as { planning_group?: unknown } | null)?.planning_group
      return isPlanningGroup(g) ? g : null
    }
    // Rolü planlamaya girmeyen çalışanlar (ör. Admin): elle yazılmış vardiyaları aktarımda silinmesin
    const unplannedIds = new Set(emps.filter((e) => planningGroupOf(e) === null).map((e) => e.id as string))

    // Değiştirilemeyen vardiyalar: giriş/çıkış kaydı olanlar ve bugünden önceki günlerinkiler
    // (gelinmemiş geçmiş vardiya da devamsızlık kaydıdır; yeniden planlanmaz)
    const today = turkeyToday()
    const fixedAssignments = (weekRes.data ?? [])
      .filter((s) => !s.is_on_leave)
      .flatMap((s) => {
        const worked = Array.isArray(s.attendance_records) && s.attendance_records.length > 0
        const past = (s.work_date as string) < today
        const unplanned = unplannedIds.has(s.employee_id as string)
        if (!worked && !past && !unplanned) return []
        return [{
          employee_id:       s.employee_id as string,
          work_date:         s.work_date as string,
          start_time:        s.start_time as string,
          end_time:          s.end_time as string,
          shift_template_id: s.shift_template_id as string | null,
          reason:            worked ? 'Giriş/çıkış kaydı var — mevcut vardiya korunuyor'
            : past ? 'Geçmiş gün — mevcut vardiya korunuyor'
            : 'Rolü otomatik plana girmiyor — elle yazılan vardiya korunuyor',
        }]
      })

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
    // Ücretli izin (onaylı, haftalık tatil dışı) FT 45s hedefinden düşülür
    const leaveMap = new Map<string, Set<string>>()
    const paidLeaveMap = new Map<string, Set<string>>()
    const pendingMap = new Map<string, Set<string>>()
    for (const lv of leavesRes.data ?? []) {
      if (isAutoWeeklyRest(lv as { leave_type: string; reason: string | null })) continue
      const empId = lv.employee_id as string
      const targets = lv.status !== 'approved' ? [pendingMap]
        : lv.leave_type === 'weekly_rest' ? [leaveMap] : [leaveMap, paidLeaveMap]
      for (const target of targets) {
        if (!target.has(empId)) target.set(empId, new Set())
        const set = target.get(empId)!
        for (let d = lv.start_date as string; d <= (lv.end_date as string); d = addDaysToDateString(d, 1)) {
          if (d >= weekStart && d <= weekEnd) set.add(d)
        }
      }
    }

    // İşten ayrılanlar son çalışma gününden sonra planlanmaz (izinli gibi bloklanır; ücretli izin sayılmaz)
    for (const e of emps) {
      const term = (e as { termination_date?: string | null }).termination_date
      if (!term || term >= weekEnd) continue
      const set = leaveMap.get(e.id as string) ?? new Set<string>()
      for (let d = weekStart; d <= weekEnd; d = addDaysToDateString(d, 1)) if (!isEmployedOn({ termination_date: term }, d)) set.add(d)
      leaveMap.set(e.id as string, set)
    }

    // Geçen haftanın sonundan geriye kesintisiz çalışılan gün sayısı (uzun seriden kaçınmak için)
    const prevWorkDays = new Map<string, Set<string>>()
    for (const s of prevShifts) {
      const set = prevWorkDays.get(s.employee_id as string) ?? new Set<string>()
      set.add(s.work_date as string)
      prevWorkDays.set(s.employee_id as string, set)
    }
    const prevStreakOf = (empId: string) => {
      const days = prevWorkDays.get(empId)
      let n = 0
      while (days?.has(addDaysToDateString(prevWeekEnd, -n))) n++
      return n
    }

    // Geçen Pazar'ın vardiya bitişi (Pazartesi 00:00'a göre dk) — hafta başı dinlenme kontrolü
    const prevDayEnd = new Map<string, number>()
    for (const s of prevShifts) {
      if (s.work_date !== prevWeekEnd) continue
      const start = s.start_time as string
      const [h, m] = start.slice(0, 5).split(':').map(Number)
      const end = h * 60 + m + grossMins(start, s.end_time as string) - 24 * 60
      prevDayEnd.set(s.employee_id as string, Math.max(end, prevDayEnd.get(s.employee_id as string) ?? -Infinity))
    }

    const plannerEmployees: PlannerEmployee[] = emps.map((e) => {
      return {
        id:              e.id as string,
        full_name:       e.full_name as string,
        planning_group:  planningGroupOf(e),
        employment_type: (e.employment_type as 'full_time' | 'part_time') ?? 'full_time',
        availability:    availMap.get(e.id as string) ?? {},
        leaveDays:       leaveMap.get(e.id as string) ?? new Set(),
        paidLeaveDays:   paidLeaveMap.get(e.id as string) ?? new Set(),
        lastWeek:        hasPrevWeek ? lastWeekMap.get(e.id as string) ?? {} : undefined,
        birthDate:       (e.birth_date as string | null) ?? null,
        prevDayEndMins:  prevDayEnd.get(e.id as string),
        prevStreak:      prevStreakOf(e.id as string),
        pendingLeaveDays: pendingMap.get(e.id as string) ?? new Set(),
      }
    })

    const plannerTemplates: PlannerShiftTemplate[] = (tmplsRes.data ?? []).map((t) => ({
      id:         t.id as string,
      name:       t.name as string,
      start_time: (t.start_time as string).slice(0, 5),
      end_time:   (t.end_time as string).slice(0, 5),
    }))

    // Plan ve ek uyarılar (bekleyen izin, resmi tatil) tarayıcıda: buildPlan
    const payload: PlanPayload = {
      weekStart,
      weekEnd,
      weekDays,
      today,
      employees: plannerEmployees.map(toPayloadEmployee),
      templates: plannerTemplates,
      fixedAssignments,
      holidays: holidays.map(({ date, name, half_day }) => ({ date, name, half_day })),
    }
    return NextResponse.json(payload)
  } catch (err) {
    return serverError('GET /api/workforce/plan-input', err)
  }
}
