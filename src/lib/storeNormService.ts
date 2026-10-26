/**
 * storeNormService — mağaza aylık norm saati: veri okuma ve kullanım hesabı (yalnızca server).
 * Tüm sorgular verilen storeId ile sınırlıdır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { accessLevelOf, isKioskRole } from '@/lib/auth/roles'
import { netWorkMins } from '@/lib/workingTimeService'
import { workedMinutes, type AttendanceTimes } from '@/lib/attendanceDurations'
import {
  computeNormUsage, monthEnd, resolveStoreNorm, type NormEmployee, type NormUsage, type ResolvedNorm,
} from '@/lib/storeNorm'

const PAGE = 1000

export interface ShiftForNorm {
  work_date: string
  start_time: string
  end_time: string
  is_on_leave?: boolean | null
}

/** Planlanan net saat (mola düşülmüş), izin günleri hariç — saf */
export function plannedNetHours(shifts: ShiftForNorm[]): number {
  let mins = 0
  for (const s of shifts) {
    if (s.is_on_leave) continue
    mins += netWorkMins(s.start_time, s.end_time)
  }
  return Math.round((mins / 60) * 10) / 10
}

/** Norma esas çalışan listesi: ana mağazası bu mağaza olanlar (rol join'iyle kiosk ayrımı) */
export async function fetchNormEmployees(admin: SupabaseClient, storeId: string): Promise<NormEmployee[]> {
  const out: NormEmployee[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('employees')
      .select('id, active, hire_date, role_id, roles(access_level)')
      .eq('store_id', storeId)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as Array<{
      active: boolean; hire_date: string | null; roles: unknown
    }>
    for (const r of rows) {
      out.push({ active: r.active, hire_date: r.hire_date, isKiosk: isKioskRole(accessLevelOf(r.roles)) })
    }
    if (rows.length < PAGE) return out
  }
}

export interface NormRow {
  norm_hours: number | string
  note: string | null
  set_by: string | null
  updated_at: string
}

export async function fetchNormRow(admin: SupabaseClient, storeId: string, month: string): Promise<NormRow | null> {
  const { data, error } = await admin
    .from('store_monthly_norms')
    .select('norm_hours, note, set_by, updated_at')
    .eq('store_id', storeId)
    .eq('month', month)
    .maybeSingle()
  if (error) throw error
  return (data as NormRow | null) ?? null
}

export async function fetchMonthShifts(
  admin: SupabaseClient, storeId: string, month: string,
): Promise<Array<ShiftForNorm & { id: string }>> {
  const out: Array<ShiftForNorm & { id: string }> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('shift_assignments')
      .select('id, work_date, start_time, end_time, is_on_leave')
      .eq('store_id', storeId)
      .gte('work_date', month)
      .lte('work_date', monthEnd(month))
      .order('work_date')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as Array<ShiftForNorm & { id: string }>
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/** Çıkışı yapılmış vardiyalardaki fiili net çalışma (saat); yalnızca verilen vardiyalar için */
export async function actualWorkedHours(
  admin: SupabaseClient, shifts: Array<ShiftForNorm & { id: string }>,
): Promise<number> {
  const byId = new Map(shifts.filter((s) => !s.is_on_leave).map((s) => [s.id, s]))
  const ids = [...byId.keys()]
  let mins = 0
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from('attendance_records')
      .select('shift_assignment_id, clock_in_at, clock_out_at, break_start_at, break_end_at, completed_break_minutes')
      .in('shift_assignment_id', ids.slice(i, i + 200))
      .not('clock_out_at', 'is', null)
    if (error) throw error
    for (const rec of (data ?? []) as Array<AttendanceTimes & { shift_assignment_id: string }>) {
      const shift = byId.get(rec.shift_assignment_id)
      if (shift) mins += workedMinutes(rec, shift)
    }
  }
  return Math.round((mins / 60) * 10) / 10
}

export interface StoreNormStatus extends ResolvedNorm, NormUsage {
  workedHours: number
}

export async function getStoreNormStatus(
  admin: SupabaseClient, storeId: string, month: string,
): Promise<StoreNormStatus> {
  const [employees, row, shifts] = await Promise.all([
    fetchNormEmployees(admin, storeId),
    fetchNormRow(admin, storeId, month),
    fetchMonthShifts(admin, storeId, month),
  ])
  const norm = resolveStoreNorm(month, employees, row)
  const usage = computeNormUsage(plannedNetHours(shifts), norm.normHours)
  return { ...norm, ...usage, workedHours: await actualWorkedHours(admin, shifts) }
}
