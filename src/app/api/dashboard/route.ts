/**
 * GET /api/dashboard
 * Ana sayfa için özet istatistikler — FAZ 9.
 * Tek sorguda tüm dashboard verilerini döner.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { format } from 'date-fns'

export async function GET() {
  try {
    const admin = createAdminClient()
    const today = format(new Date(), 'yyyy-MM-dd')

    // Paralel sorgular — performans için
    const [
      employeesResult,
      todayShiftsResult,
      todayAttendanceResult,
      pendingLeavesResult,
    ] = await Promise.all([
      // 1. Aktif çalışan sayısı
      admin
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('active', true),

      // 2. Bugünkü vardiyalar (çalışan bilgisiyle)
      admin
        .from('shift_assignments')
        .select(`
          id, employee_id, start_time, end_time,
          employees ( id, full_name, role )
        `)
        .eq('work_date', today)
        .order('start_time'),

      // 3. Bugünkü attendance kayıtları
      admin
        .from('attendance_records')
        .select('id, employee_id, shift_assignment_id, status, clock_in_at, clock_out_at')
        .in(
          'shift_assignment_id',
          // sub-select benzeri: sadece bugünkü shift_assignment id'leri
          // Supabase'de doğrudan subquery yok, join üzerinden yapıyoruz
          // Bu yüzden tüm kayıtları çekip client tarafında filtreleriz
          // Önce shift ids çekeceğiz ayrıca
          ['__placeholder__']  // aşağıda override edilecek
        ),

      // 4. Bekleyen izin sayısı
      admin
        .from('leave_requests')
        .select('id, employee_id, leave_type, start_date, end_date, employees(full_name, role)', { count: 'exact' })
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(5),
    ])

    // Bugünkü shift id'leri
    const todayShifts = (todayShiftsResult.data ?? []) as Array<{
      id: string
      employee_id: string
      start_time: string
      end_time: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      employees: any
    }>
    const todayShiftIds = todayShifts.map((s) => s.id)

    // Bugünkü attendance kayıtlarını gerçek shift ids ile sorgula
    let todayAttendance: Array<{
      id: string
      employee_id: string
      shift_assignment_id: string
      status: string
      clock_in_at: string | null
      clock_out_at: string | null
    }> = []

    if (todayShiftIds.length > 0) {
      const { data: attData } = await admin
        .from('attendance_records')
        .select('id, employee_id, shift_assignment_id, status, clock_in_at, clock_out_at')
        .in('shift_assignment_id', todayShiftIds)

      todayAttendance = (attData ?? []) as typeof todayAttendance
    }

    // Attendance lookup map
    const attByShift = new Map(todayAttendance.map((a) => [a.shift_assignment_id, a]))

    // Bugünkü kadro durumu
    const todayRoster = todayShifts.map((shift) => {
      const att = attByShift.get(shift.id)
      return {
        employee_id: shift.employee_id,
        full_name: shift.employees?.full_name ?? '—',
        role: shift.employees?.role ?? '—',
        start_time: shift.start_time,
        end_time: shift.end_time,
        attendance_status: att?.status ?? 'shift_waiting',
        clock_in_at: att?.clock_in_at ?? null,
        clock_out_at: att?.clock_out_at ?? null,
      }
    })

    // İstatistikler
    const working = todayAttendance.filter(
      (a) => a.status === 'working' || a.status === 'working_after_break'
    ).length
    const onBreak = todayAttendance.filter((a) => a.status === 'on_break').length
    const clockedOut = todayAttendance.filter((a) => a.status === 'clocked_out').length
    const noShow = todayShifts.length - todayAttendance.length

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
      pending_leaves: (pendingLeavesResult.data ?? []),
    })
  } catch (err) {
    console.error('[GET /api/dashboard]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
