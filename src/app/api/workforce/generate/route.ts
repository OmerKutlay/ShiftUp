/**
 * POST /api/workforce/generate
 *
 * Kural tabanlı haftalık vardiya taslağı (draft) üretir.
 * Veriyi DB'ye YAZMAZ — sadece hesaplar ve döner.
 * Yalnızca MANAGER_ROLES erişebilir.
 *
 * Body: { week: 'YYYY-MM-DD' }
 * Response: PlannerResult (assignments, stats, warnings, hasHardViolation)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns'
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
    const body = (await req.json()) as { week?: string; seed?: number }
    const weekParam = body.week ?? format(new Date(), 'yyyy-MM-dd')
    const refDate = new Date(weekParam)
    if (isNaN(refDate.getTime())) {
      return NextResponse.json({ error: 'Geçersiz week parametresi.' }, { status: 400 })
    }

    const weekStart = format(startOfWeek(refDate, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd   = format(endOfWeek(refDate, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekDays  = Array.from({ length: 7 }, (_, i) =>
      format(addDays(new Date(weekStart), i), 'yyyy-MM-dd')
    )

    const admin = createAdminClient()

    // ── Veri toplama ──────────────────────────────────────────

    // Aktif çalışanlar + rolleri
    const { data: emps, error: empErr } = await admin
      .from('employees')
      .select('id, full_name, role, employment_type, active, roles ( name )')
      .eq('active', true)
      .order('full_name')
    if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 })

    // Aktif vardiya şablonları
    const { data: tmpls, error: tmplErr } = await admin
      .from('shift_templates')
      .select('id, name, start_time, end_time')
      .eq('active', true)
      .order('start_time')
    if (tmplErr) return NextResponse.json({ error: tmplErr.message }, { status: 500 })

    // Availability
    const { data: avails } = await admin
      .from('employee_availability')
      .select('employee_id, day_of_week, start_time, end_time, is_available')

    // Onaylı izinler (bu haftayla kesişen). Otomatik plandan gelen haftalık tatiller yok sayılır:
    // yeniden aktarımda yenileriyle değiştirilir, tatil günü rotasyonla kayabilir
    const { data: leaves } = await admin
      .from('leave_requests')
      .select('employee_id, leave_type, reason, start_date, end_date')
      .eq('status', 'approved')
      .lte('start_date', weekEnd)
      .gte('end_date', weekStart)

    // Geçen haftanın vardiyaları (rotasyon için: izin günü ve açılış/kapanış kaydırılır)
    const prevWeekStart = format(addDays(new Date(weekStart), -7), 'yyyy-MM-dd')
    const prevWeekEnd   = format(addDays(new Date(weekStart), -1), 'yyyy-MM-dd')
    const { data: prevShifts } = await admin
      .from('shift_assignments')
      .select('employee_id, work_date, start_time, end_time, is_on_leave')
      .gte('work_date', prevWeekStart)
      .lte('work_date', prevWeekEnd)

    // Bu hafta zaten çalışılmış vardiyalar (giriş/çıkış kaydı olan) — aktarımda korunur,
    // bu yüzden planlayıcı da bunları sabit kabul edip limitleri ona göre doldurur
    const { data: weekShifts } = await admin
      .from('shift_assignments')
      .select('employee_id, work_date, start_time, end_time, shift_template_id, attendance_records ( id )')
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd)
    const fixedAssignments = (weekShifts ?? [])
      .filter((s) => Array.isArray(s.attendance_records) && s.attendance_records.length > 0)
      .map((s) => ({
        employee_id:       s.employee_id as string,
        work_date:         s.work_date as string,
        start_time:        s.start_time as string,
        end_time:          s.end_time as string,
        shift_template_id: s.shift_template_id as string | null,
      }))

    // ── Veri dönüşümü ─────────────────────────────────────────

    // Geçen hafta → employee_id → dow → tür. Mağazada hiç kayıt yoksa geçen hafta bilinmiyor sayılır.
    const hasPrevWeek = (prevShifts ?? []).length > 0
    const lastWeekMap = new Map<string, Partial<Record<string, ShiftKind>>>()
    for (const s of prevShifts ?? []) {
      if (s.is_on_leave) continue
      const empId = s.employee_id as string
      if (!lastWeekMap.has(empId)) lastWeekMap.set(empId, {})
      lastWeekMap.get(empId)![DOW_MAP[new Date(s.work_date as string).getDay()]] =
        kindFromTimes(s.start_time as string, s.end_time as string)
    }

    // Availability → employee_id → dow → records[]
    const availMap = new Map<string, Record<string, Array<{ start_time: string; end_time: string; is_available: boolean }>>>()
    for (const a of avails ?? []) {
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

    // Leave → employee_id → Set<'YYYY-MM-DD'>
    const leaveMap = new Map<string, Set<string>>()
    for (const lv of leaves ?? []) {
      if (isAutoWeeklyRest(lv as { leave_type: string; reason: string | null })) continue
      const empId = lv.employee_id as string
      if (!leaveMap.has(empId)) leaveMap.set(empId, new Set())
      const leaveSet = leaveMap.get(empId)!
      // İzin aralığını gün gün ekle
      const start = new Date(lv.start_date as string)
      const end   = new Date(lv.end_date as string)
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = format(d, 'yyyy-MM-dd')
        if (ds >= weekStart && ds <= weekEnd) leaveSet.add(ds)
      }
    }

    const plannerEmployees: PlannerEmployee[] = (emps ?? []).map((e) => {
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

    const plannerTemplates: PlannerShiftTemplate[] = (tmpls ?? []).map((t) => ({
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

    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/workforce/generate]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
