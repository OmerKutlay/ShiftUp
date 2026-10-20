/**
 * scheduleRepository — shift_assignments veri katmanı (yalnızca server).
 * Client bileşenleri '@/lib/api/schedule' üzerinden API'yi çağırır.
 */
import { db } from '@/lib/db'
import type { ShiftAssignmentWithDetails, CreateShiftAssignmentPayload, UpdateShiftAssignmentPayload } from '@/types/schedule'
import { ShiftConflictError } from '@/types/schedule'
import { format, addDays, parseISO } from 'date-fns'
import { getWeekRange, getWeekDays, timesOverlap, shiftAbsoluteRange } from '@/lib/scheduleUtils'
import { workedMinutes, type AttendanceTimes } from '@/lib/attendanceDurations'
import { plannedBreakMins } from '@/lib/workingTimeService'

// Saf yardımcılar geriye dönük uyumluluk için buradan da export edilir
export { getWeekRange, getWeekDays, timesOverlap, shiftAbsoluteRange }

const ASSIGNMENT_DETAIL_SELECT = `
  id, employee_id, shift_template_id, work_date, start_time, end_time, is_on_leave, created_at, updated_at,
  shift_templates ( id, name, start_time, end_time, description, active, created_at, updated_at ),
  employees ( id, full_name, role_id, active, employment_type, created_at, updated_at, roles ( id, name, description, access_level, planning_group, sort_order, created_at ) )
`

// ============================================================
// Queries
// ============================================================

/**
 * Bir haftalık tüm shift_assignments'ı getirir.
 * employee ve shift_template bilgileriyle join edilir.
 */
export async function fetchWeeklyAssignments(
  weekDate: Date
): Promise<ShiftAssignmentWithDetails[]> {
  const { start, end } = getWeekRange(weekDate)
  return fetchAssignmentsInRange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'))
}

/** [startDate, endDate] aralığındaki tüm vardiyalar (dahil) */
export async function fetchAssignmentsInRange(
  startDate: string,
  endDate: string
): Promise<ShiftAssignmentWithDetails[]> {
  const { data, error } = await db
    .from('shift_assignments')
    .select(ASSIGNMENT_DETAIL_SELECT)
    .gte('work_date', startDate)
    .lte('work_date', endDate)
    .order('work_date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) throw new Error(`Haftalık plan yüklenemedi: ${error.message}`)
  return (data ?? []) as unknown as ShiftAssignmentWithDetails[]
}

/**
 * Çıkış yapılmış vardiyalara fiili net çalışmayı (worked_minutes) ekler.
 * onlyEmployeeId verilirse yalnızca o çalışanın vardiyalarına eklenir (çalışan başkasının devamını görmez).
 */
export async function attachWorkedMinutes(
  assignments: ShiftAssignmentWithDetails[],
  onlyEmployeeId?: string
): Promise<ShiftAssignmentWithDetails[]> {
  const ids = assignments
    .filter((a) => !onlyEmployeeId || a.employee_id === onlyEmployeeId)
    .map((a) => a.id)
  if (ids.length === 0) return assignments

  const recs: Array<AttendanceTimes & { shift_assignment_id: string }> = []
  // Uzun id listesi URL sınırına takılmasın diye parçalı sorgu
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('attendance_records')
      .select('shift_assignment_id, clock_in_at, clock_out_at, break_start_at, break_end_at, completed_break_minutes')
      .in('shift_assignment_id', ids.slice(i, i + 200))
      .not('clock_out_at', 'is', null)
    if (error) throw new Error(`Devam kayıtları yüklenemedi: ${error.message}`)
    recs.push(...((data ?? []) as Array<AttendanceTimes & { shift_assignment_id: string }>))
  }
  const byShift = new Map(recs.map((r) => [r.shift_assignment_id, r]))

  return assignments.map((a) => {
    const rec = byShift.get(a.id)
    if (!rec) return a
    return { ...a, worked_minutes: workedMinutes(rec, plannedBreakMins(a.start_time, a.end_time)) }
  })
}

/**
 * Belirli bir çalışanın belirli bir gündeki vardiyalarını getirir.
 */
export async function fetchAssignmentsForEmployeeOnDate(
  employeeId: string,
  workDate: string
): Promise<ShiftAssignmentWithDetails[]> {
  return fetchAssignmentsForEmployeeAround(employeeId, workDate, 0)
}

/**
 * Çalışanın workDate ± spanDays aralığındaki vardiyaları.
 * Gece yarısını geçen vardiyaların komşu günlerle çakışmasını yakalamak için kullanılır.
 */
async function fetchAssignmentsForEmployeeAround(
  employeeId: string,
  workDate: string,
  spanDays: number
): Promise<ShiftAssignmentWithDetails[]> {
  const base = parseISO(workDate)
  const { data, error } = await db
    .from('shift_assignments')
    .select('id, employee_id, shift_template_id, work_date, start_time, end_time, is_on_leave, created_at, updated_at')
    .eq('employee_id', employeeId)
    .gte('work_date', format(addDays(base, -spanDays), 'yyyy-MM-dd'))
    .lte('work_date', format(addDays(base, spanDays), 'yyyy-MM-dd'))

  if (error) throw new Error(`Vardiyalar kontrol edilemedi: ${error.message}`)
  return (data ?? []) as ShiftAssignmentWithDetails[]
}

// ============================================================
// Conflict detection
// ============================================================


/**
 * Çakışma guard — yeni vardiya atamadan önce çağrılır.
 * Önceki/sonraki günün gece vardiyalarıyla çakışmalar da yakalanır.
 * excludeId: güncelleme durumunda kendi kaydını hariç tut.
 */
async function checkConflict(
  employeeId: string,
  workDate: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<void> {
  const existing = await fetchAssignmentsForEmployeeAround(employeeId, workDate, 1)
  const [aS, aE] = shiftAbsoluteRange(workDate, startTime, endTime)
  const conflicts = existing.filter((a) => {
    if (excludeId && a.id === excludeId) return false
    const [bS, bE] = shiftAbsoluteRange(a.work_date ?? workDate, a.start_time, a.end_time)
    return aS < bE && bS < aE
  })

  if (conflicts.length > 0) {
    const c = conflicts[0]
    throw new ShiftConflictError(
      `Bu çalışanın ${c.work_date ?? workDate} tarihinde ${c.start_time.slice(0, 5)}–${c.end_time.slice(0, 5)} arası çakışan vardiyası var.`
    )
  }
}

/** Çalışanın o gün onaylı izni varsa (haftalık tatil dahil) hata fırlatır */
async function checkNotOnLeave(employeeId: string, workDate: string): Promise<void> {
  const { data, error } = await db
    .from('leave_requests')
    .select('id, leave_type')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('start_date', workDate)
    .gte('end_date', workDate)
    .limit(1)

  if (error) throw new Error(`İzin durumu kontrol edilemedi: ${error.message}`)
  if (data && data.length > 0) {
    throw new ShiftConflictError(`Bu çalışan ${workDate} tarihinde onaylı izinde.`)
  }
}

// ============================================================
// Mutations
// ============================================================

/** Yeni vardiya atar. Pasif çalışan guard + çakışma + izin kontrolü içerir. */
export async function createShiftAssignment(
  payload: CreateShiftAssignmentPayload,
  employeeActive: boolean
): Promise<ShiftAssignmentWithDetails> {
  if (!employeeActive) {
    throw new Error('Pasif çalışana yeni vardiya atanamaz.')
  }

  await checkConflict(payload.employee_id, payload.work_date, payload.start_time, payload.end_time)
  await checkNotOnLeave(payload.employee_id, payload.work_date)

  const { data, error } = await db
    .from('shift_assignments')
    .insert({
      employee_id: payload.employee_id,
      shift_template_id: payload.shift_template_id,
      work_date: payload.work_date,
      start_time: payload.start_time,
      end_time: payload.end_time,
    })
    .select(ASSIGNMENT_DETAIL_SELECT)
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ShiftConflictError('Bu çalışanın bu tarihte zaten bir vardiyası var.')
    }
    throw new Error(`Vardiya atanamadı: ${error.message}`)
  }
  return data as unknown as ShiftAssignmentWithDetails
}

/** Mevcut vardiyayı günceller (template değiştirme). Çakışma kontrolü içerir. */
export async function updateShiftAssignment(
  id: string,
  employeeId: string,
  workDate: string,
  payload: UpdateShiftAssignmentPayload
): Promise<ShiftAssignmentWithDetails> {
  if (payload.start_time && payload.end_time) {
    await checkConflict(employeeId, workDate, payload.start_time, payload.end_time, id)
  }

  const { data, error } = await db
    .from('shift_assignments')
    .update(payload)
    .eq('id', id)
    .select(ASSIGNMENT_DETAIL_SELECT)
    .single()

  if (error) throw new Error(`Vardiya güncellenemedi: ${error.message}`)
  return data as unknown as ShiftAssignmentWithDetails
}

/**
 * Vardiyayı siler. Devam kaydı olan vardiya silinemez (FK RESTRICT → 23503);
 * böylece fiilen çalışılmış saatler kaybolmaz.
 */
export async function deleteShiftAssignment(id: string): Promise<void> {
  const { error } = await db
    .from('shift_assignments')
    .delete()
    .eq('id', id)

  if (error) {
    if (error.code === '23503') {
      throw new ShiftConflictError('Bu vardiyada devam kaydı var; silinemez.')
    }
    throw new Error(`Vardiya silinemedi: ${error.message}`)
  }
}
