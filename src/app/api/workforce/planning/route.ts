/**
 * GET /api/workforce/planning?week=YYYY-MM-DD
 *
 * Haftalık workforce planning verisi — yalnızca MANAGER_ROLES erişebilir.
 *
 * Döner:
 *   - Her employee için haftalık vardiya özeti
 *   - Toplam haftalık çalışma süresi
 *   - Çalışma süresi kural ihlalleri
 *   - Open shift sayısı
 *   - Hafta günleri
 *
 * week parametresi: haftadaki herhangi bir gün (Pazartesi'ye hizalanır).
 * Yoksa mevcut hafta kullanılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { buildWeekSummary } from '@/lib/workingTimeService'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { getWeekDays } from '@/lib/scheduleUtils'
import { turkeyToday } from '@/lib/dateUtils'
import { isValidDate } from '@/lib/validation'
import { serverError } from '@/lib/apiErrors'
import { NOT_KIOSK_FILTER } from '@/lib/auth/roles'

export async function GET(req: NextRequest) {
  // Yalnızca Müdür Yardımcısı ve üzeri erişebilir
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const weekParam = searchParams.get('week')

    // Haftayı hesapla (saat diliminden bağımsız; varsayılan: Türkiye'de bugün)
    const ref = weekParam ?? turkeyToday()
    if (!isValidDate(ref)) {
      return NextResponse.json({ error: 'Geçersiz week parametresi.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const weekDays = getWeekDays(new Date(`${ref}T12:00:00`))
    const weekStart = weekDays[0]
    const weekEnd = weekDays[6]

    const admin = createAdminClient()

    // Haftalık shift assignments (tüm çalışanlar)
    const { data: assignments, error: assignErr } = await admin
      .from('shift_assignments')
      .select(`
        id,
        employee_id,
        work_date,
        start_time,
        end_time,
        is_on_leave,
        employees ( id, full_name, employment_type )
      `)
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd)
      .order('work_date')
      .order('start_time')

    if (assignErr) {
      return serverError('GET /api/workforce/planning', assignErr)
    }

    // Aktif çalışanlar (vardiyası olmayan çalışanlar da listelenmeli)
    const { data: employees, error: empErr } = await admin
      .from('employees')
      .select('id, full_name, role_id, active, employment_type')
      .eq('active', true)
      .or(NOT_KIOSK_FILTER)
      .order('full_name')

    if (empErr) {
      return serverError('GET /api/workforce/planning', empErr)
    }

    // Open shifts bu hafta
    const { data: openShifts } = await admin
      .from('open_shifts')
      .select('id, work_date, start_time, end_time, role_needed, status')
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd)
      .eq('status', 'open')

    const config = getWorkingTimeConfig()

    // buildWeekSummary için assignment shape'ini hazırla
    const assignmentsMapped = (assignments ?? []).map((a) => {
      const empObj = (Array.isArray(a.employees) ? a.employees[0] : a.employees) as
        | { id: string; full_name: string; employment_type?: string } | null
      return {
        id: a.id as string,
        employee_id: a.employee_id as string,
        work_date: a.work_date as string,
        start_time: a.start_time as string,
        end_time: a.end_time as string,
        is_on_leave: Boolean(a.is_on_leave),
        employment_type: (empObj?.employment_type ?? 'full_time') as import('@/types/employee').EmploymentType,
        employees: empObj ? { id: empObj.id, full_name: empObj.full_name } : null,
      }
    })

    const summaries = buildWeekSummary(assignmentsMapped, weekDays, config)

    // Vardiyası olmayan aktif çalışanları da özet listesine ekle (boş hafta)
    const summaryIds = new Set(summaries.map((s) => s.employeeId))
    for (const emp of employees ?? []) {
      if (!summaryIds.has(emp.id as string)) {
        const emptyDays: Record<string, unknown> = {}
        for (const day of weekDays) {
          emptyDays[day] = { date: day, shifts: [], totalMins: 0, isLeave: false }
        }
        summaries.push({
          employeeId: emp.id as string,
          employeeName: emp.full_name as string,
          employment_type: ((emp as { employment_type?: string }).employment_type ?? 'full_time') as import('@/types/employee').EmploymentType,
          days: emptyDays as never,
          totalWeeklyMins: 0,
          weeklyWorkDays: 0,
          violations: [],
        })
      }
    }

    // Alfabetik sırala (yalnızca vardiyasız çalışan eklendiyse; buildWeekSummary zaten sıralı döner)
    if (summaries.length > summaryIds.size) {
      summaries.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'tr'))
    }

    return NextResponse.json({
      weekStart,
      weekEnd,
      weekDays,
      config: {
        minRestHours: config.minRestHours,
        maxDailyWorkHours: config.maxDailyWorkHours,
        maxWeeklyWorkHours: config.maxWeeklyWorkHours,
      },
      summaries,
      openShiftsThisWeek: openShifts ?? [],
    })
  } catch (err) {
    return serverError('GET /api/workforce/planning', err)
  }
}
