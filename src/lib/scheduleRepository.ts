import { supabase } from '@/lib/supabase'
import type { ShiftAssignmentWithDetails, CreateShiftAssignmentPayload, UpdateShiftAssignmentPayload } from '@/types/schedule'
import { ShiftConflictError } from '@/types/schedule'
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns'

// ============================================================
// Date helpers
// ============================================================

/** Haftanın Pazartesi–Pazar tarih aralığını döner */
export function getWeekRange(date: Date): { start: Date; end: Date } {
  const start = startOfWeek(date, { weekStartsOn: 1 }) // Pazartesi
  const end = endOfWeek(date, { weekStartsOn: 1 })     // Pazar
  return { start, end }
}

/** ISO date string listesi (Pazartesi–Pazar) */
export function getWeekDays(date: Date): string[] {
  const { start } = getWeekRange(date)
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
}

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
  const startStr = format(start, 'yyyy-MM-dd')
  const endStr = format(end, 'yyyy-MM-dd')

  const { data, error } = await supabase
    .from('shift_assignments')
    .select(`
      id,
      employee_id,
      shift_template_id,
      work_date,
      start_time,
      end_time,
      is_on_leave,
      created_at,
      updated_at,
      shift_templates (
        id, name, start_time, end_time, description, active, created_at, updated_at
      ),
      employees (
        id, full_name, role, role_id, active, created_at, updated_at,
        roles ( id, name, description, created_at )
      )
    `)
    .gte('work_date', startStr)
    .lte('work_date', endStr)
    .order('work_date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) throw new Error(`Haftalık plan yüklenemedi: ${error.message}`)
  return (data ?? []) as unknown as ShiftAssignmentWithDetails[]
}

/**
 * Belirli bir çalışanın belirli bir gündeki vardiyalarını getirir.
 * Çakışma kontrolü için kullanılır.
 */
export async function fetchAssignmentsForEmployeeOnDate(
  employeeId: string,
  workDate: string
): Promise<ShiftAssignmentWithDetails[]> {
  const { data, error } = await supabase
    .from('shift_assignments')
    .select('id, employee_id, shift_template_id, work_date, start_time, end_time, created_at, updated_at')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)

  if (error) throw new Error(`Vardiyalar kontrol edilemedi: ${error.message}`)
  return (data ?? []) as ShiftAssignmentWithDetails[]
}

// ============================================================
// Conflict detection
// ============================================================

/**
 * Zaman aralığı çakışma kontrolü.
 * İki vardiya start/end zamanları overlap ediyor mu?
 * 'HH:MM' veya 'HH:MM:SS' formatını kabul eder.
 */
export function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  // Dakikaya çevir
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const aS = toMins(aStart)
  let aE = toMins(aEnd)
  const bS = toMins(bStart)
  let bE = toMins(bEnd)

  // Gece yarısını geçen vardiyalar (end < start)
  if (aE <= aS) aE += 24 * 60
  if (bE <= bS) bE += 24 * 60

  // Overlap: A başlamadan B bitiyor veya B başlamadan A bitiyor değilse
  return aS < bE && bS < aE
}

/**
 * Çakışma guard — yeni vardiya atamadan önce çağrılır.
 * excludeId: güncelleme durumunda kendi kaydını hariç tut.
 */
async function checkConflict(
  employeeId: string,
  workDate: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<void> {
  const existing = await fetchAssignmentsForEmployeeOnDate(employeeId, workDate)
  const conflicts = existing.filter((a) => {
    if (excludeId && a.id === excludeId) return false
    return timesOverlap(startTime, endTime, a.start_time, a.end_time)
  })

  if (conflicts.length > 0) {
    const c = conflicts[0]
    throw new ShiftConflictError(
      `Bu çalışanın ${workDate} tarihinde ${c.start_time.slice(0, 5)}–${c.end_time.slice(0, 5)} arası çakışan vardiyası var.`
    )
  }
}

// ============================================================
// Mutations
// ============================================================

/** Yeni vardiya atar. Pasif çalışan guard + çakışma kontrolü içerir. */
export async function createShiftAssignment(
  payload: CreateShiftAssignmentPayload,
  employeeActive: boolean
): Promise<ShiftAssignmentWithDetails> {
  if (!employeeActive) {
    throw new Error('Pasif çalışana yeni vardiya atanamaz.')
  }

  await checkConflict(payload.employee_id, payload.work_date, payload.start_time, payload.end_time)

  const { data, error } = await supabase
    .from('shift_assignments')
    .insert({
      employee_id: payload.employee_id,
      shift_template_id: payload.shift_template_id,
      work_date: payload.work_date,
      start_time: payload.start_time,
      end_time: payload.end_time,
    })
    .select(`
      id, employee_id, shift_template_id, work_date, start_time, end_time, created_at, updated_at,
      shift_templates ( id, name, start_time, end_time, description, active, created_at, updated_at ),
      employees ( id, full_name, role, role_id, active, created_at, updated_at, roles ( id, name, description, created_at ) )
    `)
    .single()

  if (error) throw new Error(`Vardiya atanamadı: ${error.message}`)
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

  const { data, error } = await supabase
    .from('shift_assignments')
    .update(payload)
    .eq('id', id)
    .select(`
      id, employee_id, shift_template_id, work_date, start_time, end_time, created_at, updated_at,
      shift_templates ( id, name, start_time, end_time, description, active, created_at, updated_at ),
      employees ( id, full_name, role, role_id, active, created_at, updated_at, roles ( id, name, description, created_at ) )
    `)
    .single()

  if (error) throw new Error(`Vardiya güncellenemedi: ${error.message}`)
  return data as unknown as ShiftAssignmentWithDetails
}

/** Vardiyayı siler. Attendance kaydı varsa DB CASCADE ile silinir. */
export async function deleteShiftAssignment(id: string): Promise<void> {
  const { error } = await supabase
    .from('shift_assignments')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Vardiya silinemedi: ${error.message}`)
}
