/**
 * Notification Repository — FAZ 10
 * Server-side (API routes) kullanımı için admin client gerektirir.
 * createAdminClient() çağıranın sorumluluğundadır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreateNotificationPayload, Notification, NotificationType } from '@/types/notification'
import { MANAGER_ROLES } from '@/lib/auth/roles'

/**
 * Yeni bildirim oluştur.
 * shift_reminder için unique constraint ihlali (23505) sessizce göz ardı edilir —
 * bu şekilde duplicate hatırlatma oluşmaz.
 */
export async function createNotification(
  admin: SupabaseClient,
  payload: CreateNotificationPayload,
): Promise<Notification | null> {
  const { data, error } = await admin
    .from('notifications')
    .insert({
      employee_id: payload.employee_id,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      related_id: payload.related_id ?? null,
      is_read: false,
    })
    .select()
    .single()

  if (error) {
    // Duplicate shift_reminder — unique_violation, beklenen davranış
    if (error.code === '23505') return null
    throw error
  }

  return data as Notification
}

/**
 * Aktif tüm yöneticilere (MANAGER_ROLES) aynı bildirimi gönder.
 * excludeEmployeeId: işlemi yapan yönetici kendi talebi için bildirim almasın.
 * Tek tek insert hataları diğerlerini engellemez. Gönderilen bildirim sayısını döner.
 */
export async function notifyManagers(
  admin: SupabaseClient,
  payload: Omit<CreateNotificationPayload, 'employee_id'>,
  options: { excludeEmployeeId?: string } = {},
): Promise<number> {
  const { data: employees, error } = await admin
    .from('employees')
    .select('id, roles(name)')
    .eq('active', true)

  if (error) throw error

  const targets = (employees ?? []).filter((e) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roleName = (e as any).roles?.name ?? null
    return MANAGER_ROLES.includes(roleName) && e.id !== options.excludeEmployeeId
  })

  const results = await Promise.allSettled(
    targets.map((m) => createNotification(admin, { ...payload, employee_id: m.id })),
  )
  return results.filter((r) => r.status === 'fulfilled' && r.value).length
}

/**
 * Verilen tip + related_id çiftleri için zaten bildirim oluşturulmuş olanları döner.
 * Dönen Set anahtarı: `${type}:${related_id}` — periyodik taramalarda tekrar bildirimi önler.
 */
export async function getExistingNotificationKeys(
  admin: SupabaseClient,
  types: NotificationType[],
  relatedIds: string[],
): Promise<Set<string>> {
  if (types.length === 0 || relatedIds.length === 0) return new Set()

  const { data, error } = await admin
    .from('notifications')
    .select('type, related_id')
    .in('type', types)
    .in('related_id', relatedIds)

  if (error) throw error
  return new Set((data ?? []).map((n) => `${n.type}:${n.related_id}`))
}

/**
 * Çalışanın bildirimlerini getir. Okunmamışlar önce gelir.
 */
export async function getNotificationsByEmployee(
  admin: SupabaseClient,
  employeeId: string,
  limit = 50,
): Promise<Notification[]> {
  const { data, error } = await admin
    .from('notifications')
    .select('*')
    .eq('employee_id', employeeId)
    .order('is_read', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as Notification[]
}

/**
 * Okunmamış bildirim sayısı.
 */
export async function getUnreadCount(
  admin: SupabaseClient,
  employeeId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .eq('is_read', false)

  if (error) throw error
  return count ?? 0
}

/**
 * Tek bildirimi okundu olarak işaretle.
 */
export async function markAsRead(
  admin: SupabaseClient,
  notificationId: string,
  employeeId: string,
): Promise<void> {
  const { error } = await admin
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('employee_id', employeeId) // başka çalışanın bildirimini işaretleyemez

  if (error) throw error
}

/**
 * Tüm bildirimleri okundu olarak işaretle.
 */
export async function markAllAsRead(
  admin: SupabaseClient,
  employeeId: string,
): Promise<void> {
  const { error } = await admin
    .from('notifications')
    .update({ is_read: true })
    .eq('employee_id', employeeId)
    .eq('is_read', false)

  if (error) throw error
}
