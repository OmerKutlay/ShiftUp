/**
 * employeeTransfer — çalışanın başka mağazaya taşınması (yalnızca server).
 *
 * Tüm veritabanı yazmaları tek bir Postgres fonksiyonundadır (apply_employee_store_transfer, tek
 * transaction); hata olursa hiçbir şey değişmez.
 *   - eski mağazadaki bugün ve sonrası vardiyalar silinir — haftalık plandan kalkar
 *   - geçmiş vardiyalar ve giriş/çıkış kaydı olan vardiyalar eski mağazada kalır: eski haftaların
 *     planında ve çalışanın "Çalışma özetim" sayfasında görünmeye devam eder
 *   - dün/bugün vardiyasında açık giriş kaydı varsa transfer reddedilir (önce çıkış yapılmalı)
 *   - bekleyen takaslar iptal edilir, karşı taraf bildirilir; üstlenilmiş açık vardiyalar tekrar açılır
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDaysToDateString, turkeyToday } from '@/lib/dateUtils'
import { createNotifications } from '@/lib/notificationRepository'
import type { CancelledSwap } from '@/lib/employeeOffboarding'

export const OPEN_ATTENDANCE_MESSAGE =
  'Çalışanın açık bir giriş kaydı var. Mağazasını değiştirmeden önce çıkış yapılmalı.'

/** Beklenen iş kuralı hatası (HTTP 409 / 404'e çevrilir) */
export class TransferError extends Error {
  constructor(public code: 'OPEN_ATTENDANCE' | 'TERMINATED' | 'NOT_FOUND', message: string) {
    super(message)
  }
}

export interface TransferResult {
  shifts_deleted: number
  open_shifts_reopened: number
  swaps: CancelledSwap[]
}

/** Eski mağazada dün/bugün vardiyasına ait açık (çıkış yapılmamış) devam kaydı var mı? */
export async function hasOpenAttendance(
  admin: SupabaseClient, employeeId: string, storeId: string, today = turkeyToday()
): Promise<boolean> {
  const { data: shifts, error } = await admin
    .from('shift_assignments')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('store_id', storeId)
    .gte('work_date', addDaysToDateString(today, -1))
  if (error) throw error
  const ids = (shifts ?? []).map((s) => s.id as string)
  if (ids.length === 0) return false
  const { data: open, error: recErr } = await admin
    .from('attendance_records')
    .select('id')
    .in('shift_assignment_id', ids)
    .neq('status', 'clocked_out')
    .limit(1)
  if (recErr) throw recErr
  return (open ?? []).length > 0
}

/**
 * Transferi uygular. Çağıran yetki / hedef mağaza kontrollerini yapmış olmalıdır.
 * RPC hata verirse (TransferError dışında) hata olduğu gibi fırlatılır; veritabanında hiçbir şey değişmemiştir.
 */
export async function applyStoreTransfer(
  admin: SupabaseClient,
  params: { employeeId: string; employeeName: string; actorId: string; fromStoreId: string; toStoreId: string }
): Promise<TransferResult> {
  const { employeeId, employeeName, actorId, fromStoreId, toStoreId } = params
  const { data, error } = await admin.rpc('apply_employee_store_transfer', {
    p_employee_id: employeeId,
    p_actor_id: actorId,
    p_from_store: fromStoreId,
    p_to_store: toStoreId,
    p_cancel_note: `${employeeName} başka mağazaya taşındığı için otomatik iptal edildi.`,
  })
  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('OPEN_ATTENDANCE')) throw new TransferError('OPEN_ATTENDANCE', OPEN_ATTENDANCE_MESSAGE)
    if (msg.includes('TERMINATED')) throw new TransferError('TERMINATED', 'İşten çıkışı kayıtlı çalışan başka mağazaya taşınamaz.')
    if (msg.includes('NOT_FOUND')) throw new TransferError('NOT_FOUND', 'Çalışan bulunamadı.')
    throw error
  }

  const r = (data ?? {}) as Record<string, unknown>
  const swaps = (Array.isArray(r.swaps) ? r.swaps : []) as CancelledSwap[]

  // Başarıdan sonra: karşı tarafa bildirim (takas satırı vardiya silinince gidebilir → related_id yok)
  const notices = swaps.flatMap((s) => {
    const other = s.requester_id === employeeId ? s.target_id : s.requester_id
    return other && other !== employeeId
      ? [{
          employee_id: other,
          type: 'shift_swap_rejected' as const,
          title: 'Takas talebi iptal edildi',
          message: `${employeeName} başka mağazaya taşındığı için vardiya takas talebi iptal edildi.`,
          related_id: null,
        }]
      : []
  })
  await createNotifications(admin, notices).catch((e) => console.error('[storeTransfer] swap notify:', e))

  return {
    shifts_deleted: Number(r.shifts_deleted ?? 0),
    open_shifts_reopened: Number(r.open_shifts_reopened ?? 0),
    swaps,
  }
}
