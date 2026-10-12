/**
 * leaveService — izin onayı / haftalık tatil atamasının vardiyalara etkisi (server).
 *
 * İzin onaylandığında o aralıktaki *planlanmış* (devam kaydı olmayan) vardiyalar
 * kaldırılır. Fiilen çalışılmış vardiyalar ve devam kayıtları ASLA silinmez —
 * geriye dönük bir hastalık izni puantajı yok etmemeli. Korunan vardiya sayısı
 * çağırana döner ki yönetici bilgilendirilsin.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ShiftCleanupResult {
  removed: number
  keptWorked: number
}

export async function removePlannedShiftsInRange(
  admin: SupabaseClient,
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<ShiftCleanupResult> {
  const { data: shifts, error } = await admin
    .from('shift_assignments')
    .select('id')
    .eq('employee_id', employeeId)
    .gte('work_date', startDate)
    .lte('work_date', endDate)
  if (error) throw error
  if (!shifts || shifts.length === 0) return { removed: 0, keptWorked: 0 }

  const ids = shifts.map((s) => s.id as string)
  const { data: worked, error: wErr } = await admin
    .from('attendance_records')
    .select('shift_assignment_id')
    .in('shift_assignment_id', ids)
  if (wErr) throw wErr

  const workedIds = new Set((worked ?? []).map((r) => r.shift_assignment_id as string))
  const removable = ids.filter((id) => !workedIds.has(id))

  if (removable.length > 0) {
    const { error: delErr } = await admin.from('shift_assignments').delete().in('id', removable)
    if (delErr) throw delErr
  }
  return { removed: removable.length, keptWorked: workedIds.size }
}
