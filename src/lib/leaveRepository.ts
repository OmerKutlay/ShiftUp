/**
 * Leave Repository — FAZ 9
 * İzin talepleri için veri katmanı.
 */
import { supabase } from '@/lib/supabase'
import type {
  LeaveRequest,
  LeaveRequestWithEmployee,
  CreateLeaveRequestPayload,
} from '@/types/leave'

// ============================================================
// Queries
// ============================================================

/** Tüm izin taleplerini employee bilgisiyle getirir. Yeniden eskiye sıralı. */
export async function fetchLeaveRequests(): Promise<LeaveRequestWithEmployee[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(`
      id,
      employee_id,
      leave_type,
      start_date,
      end_date,
      reason,
      status,
      reviewer_note,
      reviewed_at,
      created_at,
      updated_at,
      employees (
        id,
        full_name,
        role
      )
    `)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`İzin talepleri yüklenemedi: ${error.message}`)
  return (data ?? []) as unknown as LeaveRequestWithEmployee[]
}

/** Bekleyen (pending) izin taleplerini getirir */
export async function fetchPendingLeaveRequests(): Promise<LeaveRequestWithEmployee[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(`
      id,
      employee_id,
      leave_type,
      start_date,
      end_date,
      reason,
      status,
      reviewer_note,
      reviewed_at,
      created_at,
      updated_at,
      employees (
        id,
        full_name,
        role
      )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Bekleyen talepler yüklenemedi: ${error.message}`)
  return (data ?? []) as unknown as LeaveRequestWithEmployee[]
}

/** Belirli bir çalışanın izin taleplerini getirir */
export async function fetchLeaveRequestsByEmployee(employeeId: string): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Çalışan izin talepleri yüklenemedi: ${error.message}`)
  return (data ?? []) as LeaveRequest[]
}

// ============================================================
// Mutations
// ============================================================

/** Yeni izin talebi oluşturur. Validation burada yapılır. */
export async function createLeaveRequest(
  payload: CreateLeaveRequestPayload
): Promise<LeaveRequest> {
  // Tarih validasyonu
  if (!payload.start_date || !payload.end_date) {
    throw new Error('Başlangıç ve bitiş tarihi zorunludur.')
  }
  if (payload.start_date > payload.end_date) {
    throw new Error('Başlangıç tarihi bitiş tarihinden sonra olamaz.')
  }
  // Geçmişe dönük talep kontrolü (bugünden öncesi sadece hastalık için geçerli)
  const today = new Date().toISOString().slice(0, 10)
  if (payload.start_date < today && payload.leave_type !== 'sick') {
    throw new Error('Geçmiş tarih için izin talebi oluşturulamaz (hastalık izni hariç).')
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: payload.employee_id,
      leave_type: payload.leave_type,
      start_date: payload.start_date,
      end_date: payload.end_date,
      reason: payload.reason?.trim() ?? null,
      status: 'pending',
    })
    .select()
    .single()

  if (error) throw new Error(`İzin talebi oluşturulamadı: ${error.message}`)
  return data as LeaveRequest
}
