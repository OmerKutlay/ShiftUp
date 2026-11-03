/**
 * leaveTypeRepository — şirket genelindeki adlandırılmış izin türleri (server).
 * Bkz. migration 20261103110000_leave_type_definitions: her tanım bir temel türe (puantaj kodu) bağlıdır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeaveTypeDefinition } from '@/types/leave'

export const LEAVE_TYPE_DEF_COLUMNS = 'id, name, base_type, employee_requestable, active, sort_order, system_key'

export const MAX_LEAVE_TYPE_NAME = 60

/** Ad doğrulama: kırpılmış, iç boşluklar teke indirilmiş, 1–60 karakter; geçersizse null */
export function parseLeaveTypeName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const name = v.trim().replace(/\s+/g, ' ')
  return name.length >= 1 && name.length <= MAX_LEAVE_TYPE_NAME ? name : null
}

export async function listLeaveTypes(admin: SupabaseClient): Promise<LeaveTypeDefinition[]> {
  const { data, error } = await admin
    .from('leave_type_definitions')
    .select(LEAVE_TYPE_DEF_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as LeaveTypeDefinition[]
}

export async function getLeaveType(admin: SupabaseClient, id: string): Promise<LeaveTypeDefinition | null> {
  const { data, error } = await admin
    .from('leave_type_definitions')
    .select(LEAVE_TYPE_DEF_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as LeaveTypeDefinition | null) ?? null
}

/** Temel türün sistem tanımı (tanımsız gönderilen eski istekler bu ada bağlanır); yoksa null */
export async function systemLeaveType(admin: SupabaseClient, baseType: string): Promise<LeaveTypeDefinition | null> {
  const { data, error } = await admin
    .from('leave_type_definitions')
    .select(LEAVE_TYPE_DEF_COLUMNS)
    .eq('system_key', baseType)
    .maybeSingle()
  if (error) throw error
  return (data as LeaveTypeDefinition | null) ?? null
}
