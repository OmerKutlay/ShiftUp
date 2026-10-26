/**
 * storeNormService — mağaza aylık norm saati: veri okuma ve kullanım hesabı (yalnızca server).
 * Tüm sorgular verilen storeId ile sınırlıdır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ACCESS, accessLevelOf, isKioskRole } from '@/lib/auth/roles'
import { unwrapJoin } from '@/lib/roleJoin'
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

const groupBy = <T extends { store_id: string }>(rows: T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>()
  for (const r of rows) m.set(r.store_id, [...(m.get(r.store_id) ?? []), r])
  return m
}

/**
 * Norma esas çalışanlar, mağaza başına gruplu: ana mağazası verilen mağazalardan biri olanlar.
 * Tüm mağazalar için tek sorgu (sayfalı) — mağaza sayısıyla istek sayısı artmaz.
 */
export async function fetchNormEmployees(admin: SupabaseClient, storeIds: string[]): Promise<Map<string, NormEmployee[]>> {
  const out = new Map<string, NormEmployee[]>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('employees')
      .select('id, store_id, active, hire_date, roles(access_level, planning_group)')
      .in('store_id', storeIds)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as Array<{
      store_id: string; active: boolean; hire_date: string | null; roles: unknown
    }>
    for (const r of rows) {
      const role = unwrapJoin(r.roles as { planning_group?: string | null } | null)
      const level = accessLevelOf(r.roles)
      out.set(r.store_id, [...(out.get(r.store_id) ?? []), {
        active: r.active,
        hire_date: r.hire_date,
        isKiosk: isKioskRole(level),
        isAdmin: level === ACCESS.ADMIN,
        planned: !!role?.planning_group,
      }])
    }
    if (rows.length < PAGE) return out
  }
}

export interface NormRow {
  store_id: string
  norm_hours: number | string
  note: string | null
  set_by: string | null
  updated_at: string
}

/** Verilen mağazaların o aya ait girilmiş normları (tek sorgu) */
export async function fetchNormRows(admin: SupabaseClient, storeIds: string[], month: string): Promise<Map<string, NormRow>> {
  const { data, error } = await admin
    .from('store_monthly_norms')
    .select('store_id, norm_hours, note, set_by, updated_at')
    .in('store_id', storeIds)
    .eq('month', month)
  if (error) throw error
  return new Map(((data ?? []) as NormRow[]).map((r) => [r.store_id, r]))
}

export async function fetchNormRow(admin: SupabaseClient, storeId: string, month: string): Promise<NormRow | null> {
  return (await fetchNormRows(admin, [storeId], month)).get(storeId) ?? null
}

type MonthShift = ShiftForNorm & { id: string; store_id: string }

/** Mağazaların ay içi vardiyaları (sayfalı, tek akış) */
export async function fetchMonthShifts(admin: SupabaseClient, storeIds: string[], month: string): Promise<MonthShift[]> {
  const out: MonthShift[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('shift_assignments')
      .select('id, store_id, work_date, start_time, end_time, is_on_leave')
      .in('store_id', storeIds)
      .gte('work_date', month)
      .lte('work_date', monthEnd(month))
      .order('work_date')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as MonthShift[]
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
      if (shift) mins += workedMinutes(rec, shift) ?? 0
    }
  }
  return Math.round((mins / 60) * 10) / 10
}

export interface StoreNormStatus extends ResolvedNorm, NormUsage {
  /** Fiili çalışılan saat; liste görünümünde (çok mağaza) hesaplanmaz → null */
  workedHours: number | null
  updatedAt: string | null
}

/**
 * Birden çok mağazanın norm durumu; istek sayısı mağaza sayısından bağımsızdır
 * (çalışan, norm ve vardiya için birer sorgu) — Workers ücretsiz plan subrequest sınırı için.
 */
export async function getStoreNormStatuses(
  admin: SupabaseClient, storeIds: string[], month: string, { withWorked = false } = {},
): Promise<Map<string, StoreNormStatus>> {
  const out = new Map<string, StoreNormStatus>()
  if (storeIds.length === 0) return out
  const [employees, rows, shifts] = await Promise.all([
    fetchNormEmployees(admin, storeIds),
    fetchNormRows(admin, storeIds, month),
    fetchMonthShifts(admin, storeIds, month),
  ])
  const shiftsByStore = groupBy(shifts)
  for (const id of storeIds) {
    const row = rows.get(id)
    const norm = resolveStoreNorm(month, employees.get(id) ?? [], row)
    const own = shiftsByStore.get(id) ?? []
    out.set(id, {
      ...norm,
      ...computeNormUsage(plannedNetHours(own), norm.normHours),
      workedHours: withWorked ? await actualWorkedHours(admin, own) : null,
      updatedAt: row?.updated_at ?? null,
    })
  }
  return out
}

export async function getStoreNormStatus(admin: SupabaseClient, storeId: string, month: string): Promise<StoreNormStatus> {
  return (await getStoreNormStatuses(admin, [storeId], month, { withWorked: true })).get(storeId)!
}
