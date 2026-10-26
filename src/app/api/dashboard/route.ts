/**
 * GET /api/dashboard
 * Genel Bakış ekranı özet istatistikleri (Müdür Yardımcısı+).
 * "Bugün" Türkiye saatine göredir. Tüm sayılar ve listeler aktif mağaza kapsamındadır:
 * çalışanlar mağazaya kayıtlı olanlar, vardiyalar shift_assignments.store_id, izinler mağaza çalışanlarınındır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { serverError } from '@/lib/apiErrors'
import { formatInTimeZone, turkeyToday } from '@/lib/dateUtils'
import { NOT_KIOSK_FILTER } from '@/lib/auth/roles'
import { roleNameOf } from '@/lib/roleJoin'
import { storeEmployeeIds } from '@/lib/storeScope'

interface TodayShift {
  id: string
  employee_id: string
  start_time: string
  end_time: string
  is_on_leave: boolean | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employees: any
}

interface TodayAttendance {
  id: string
  employee_id: string
  shift_assignment_id: string
  status: string
  clock_in_at: string | null
  clock_out_at: string | null
}

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const admin = createAdminClient()
    const today = turkeyToday()
    const storeId = auth.employee.store_id
    const storeEmpIds = await storeEmployeeIds(storeId)

    const [employeesResult, todayShiftsResult, pendingLeavesResult] = await Promise.all([
      admin
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', storeId)
        .eq('active', true)
        .or(NOT_KIOSK_FILTER),
      admin
        .from('shift_assignments')
        .select(`
          id, employee_id, start_time, end_time, is_on_leave,
          employees ( id, full_name, roles ( name ) )
        `)
        .eq('store_id', storeId)
        .eq('work_date', today)
        .order('start_time'),
      // Mağazada çalışan yoksa .in([]) yerine boş sonuç
      storeEmpIds.length === 0
        ? Promise.resolve({ data: [], count: 0, error: null })
        : admin
        .from('leave_requests')
        .select('id, employee_id, leave_type, start_date, end_date, employees!employee_id(full_name, roles(name))', { count: 'exact' })
        .eq('status', 'pending')
        .in('employee_id', storeEmpIds)
        .order('created_at', { ascending: true })
        .limit(5),
    ])
    for (const r of [employeesResult, todayShiftsResult, pendingLeavesResult]) {
      if (r.error) return serverError('GET /api/dashboard', r.error)
    }

    const todayShifts = (todayShiftsResult.data ?? []) as TodayShift[]
    const todayShiftIds = todayShifts.map((s) => s.id)

    let todayAttendance: TodayAttendance[] = []
    if (todayShiftIds.length > 0) {
      const { data: attData, error: attErr } = await admin
        .from('attendance_records')
        .select('id, employee_id, shift_assignment_id, status, clock_in_at, clock_out_at')
        .in('shift_assignment_id', todayShiftIds)
      if (attErr) return serverError('GET /api/dashboard', attErr)
      todayAttendance = (attData ?? []) as TodayAttendance[]
    }

    const attByShift = new Map(todayAttendance.map((a) => [a.shift_assignment_id, a]))

    const todayRoster = todayShifts.map((shift) => {
      const att = attByShift.get(shift.id)
      return {
        employee_id: shift.employee_id,
        full_name: shift.employees?.full_name ?? '—',
        role_name: roleNameOf(shift.employees) ?? '—',
        start_time: shift.start_time,
        end_time: shift.end_time,
        attendance_status: att?.status ?? 'shift_waiting',
        is_on_leave: Boolean(shift.is_on_leave),
        clock_in_at: att?.clock_in_at ?? null,
        clock_out_at: att?.clock_out_at ?? null,
      }
    })

    const working = todayAttendance.filter(
      (a) => a.status === 'working' || a.status === 'working_after_break'
    ).length
    const onBreak = todayAttendance.filter((a) => a.status === 'on_break').length
    const clockedOut = todayAttendance.filter((a) => a.status === 'clocked_out').length
    // Gelmedi: başlamış, izinli olmayan ve giriş kaydı olmayan vardiyalar
    // (izinliler ve henüz başlamamış vardiyalar sayılmaz — Devam raporuyla aynı tanım)
    const nowHm = formatInTimeZone(new Date().toISOString())
    const noShow = todayShifts.filter(
      (s) => !s.is_on_leave && !attByShift.has(s.id) && s.start_time.slice(0, 5) <= nowHm
    ).length

    return NextResponse.json({
      stats: {
        active_employees: employeesResult.count ?? 0,
        today_shifts: todayShifts.length,
        currently_working: working,
        on_break: onBreak,
        clocked_out: clockedOut,
        no_show: noShow,
        pending_leaves: pendingLeavesResult.count ?? 0,
      },
      today_roster: todayRoster,
      pending_leaves: pendingLeavesResult.data ?? [],
    })
  } catch (err) {
    return serverError('GET /api/dashboard', err)
  }
}
