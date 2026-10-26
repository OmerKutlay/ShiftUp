/**
 * storeScope — çoklu mağaza kapsamı (yalnızca server).
 *
 * Her oturumun bir "aktif mağaza"sı vardır (SessionEmployee.store_id):
 *   - Admin şirket genelidir: ACTIVE_STORE_COOKIE ile seçtiği aktif mağazada çalışır
 *     (çerez yoksa / geçersizse kendi ana mağazası).
 *   - Diğer herkes (müdür, yönetici, çalışan, kiosk) yalnızca kendi ana mağazasını görür;
 *     çerez yok sayılır.
 *
 * Tüm veri okuma/yazma bu kapsamla sınırlandırılır:
 *   - store_id kolonu olan tablolar (shift_assignments, shift_templates, open_shifts,
 *     store_locations, qr_tokens, public_holidays, audit_logs) → .eq('store_id', storeId)
 *   - çalışana bağlı tablolar (izin, mesai düzeltme, takas, uygunluk, bildirim) →
 *     storeEmployeeIds() ile .in('employee_id', ids) ya da isEmployeeInStore() kontrolü
 * İstemciden gelen her id (employee_id, kayıt id'si) mağazaya ait olduğu doğrulanmadan
 * işlenmez — service role RLS'yi bypass ettiğinden tek koruma budur.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/validation'
import { ACCESS, type AccessLevel } from '@/lib/auth/roles'

/** Admin'in seçtiği aktif mağaza (httpOnly çerez; /api/stores/active yazar) */
export const ACTIVE_STORE_COOKIE = 'shiftup_store'

/** 1 yıl — seçim cihazda kalır */
export const ACTIVE_STORE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

/** Migration'da tüm mevcut verinin taşındığı ana mağaza */
export const PRIMARY_STORE_ID = '00000000-0000-0000-0003-000000000001'

/** Şirket geneli yetki: tüm mağazaları görür, mağaza açar, aktif mağazayı değiştirir */
export function canSwitchStore(level: AccessLevel | null | undefined): boolean {
  return level === ACCESS.ADMIN
}

/**
 * Oturumun aktif mağazasını belirler.
 * Admin değilse her zaman ana mağaza; admin ise çerezdeki mağaza (var ve aktifse).
 */
export async function resolveActiveStoreId(
  admin: SupabaseClient,
  {
    homeStoreId,
    accessLevel,
    requestedStoreId,
  }: {
    homeStoreId: string
    accessLevel: AccessLevel | null
    requestedStoreId: string | null | undefined
  }
): Promise<string> {
  if (!canSwitchStore(accessLevel)) return homeStoreId
  if (!requestedStoreId || requestedStoreId === homeStoreId || !isUuid(requestedStoreId)) {
    return homeStoreId
  }
  const { data } = await admin
    .from('stores')
    .select('id')
    .eq('id', requestedStoreId)
    .eq('active', true)
    .maybeSingle()
  return data ? requestedStoreId : homeStoreId
}

/** PostgREST tek yanıtta en fazla bu kadar satır döner (max_rows) — sayfalanarak okunur */
const PAGE_SIZE = 1000

/** Mağazanın çalışan id'leri (varsayılan: pasifler dahil — geçmiş kayıtlar için) */
export async function storeEmployeeIds(
  storeId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {}
): Promise<string[]> {
  const admin = createAdminClient()
  const ids: string[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = admin.from('employees').select('id').eq('store_id', storeId)
    if (activeOnly) query = query.eq('active', true)
    const { data, error } = await query.order('id').range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as { id: string }[]
    ids.push(...page.map((r) => r.id))
    if (page.length < PAGE_SIZE) return ids
  }
}

/** Çalışanın mağazası (yoksa null) */
export async function employeeStoreId(employeeId: string): Promise<string | null> {
  if (!isUuid(employeeId)) return null
  const { data, error } = await createAdminClient()
    .from('employees')
    .select('store_id')
    .eq('id', employeeId)
    .maybeSingle()
  if (error) throw error
  return (data as { store_id: string } | null)?.store_id ?? null
}

/** Çalışan bu mağazaya mı ait? (istemciden gelen employee_id doğrulaması) */
export async function isEmployeeInStore(employeeId: string, storeId: string): Promise<boolean> {
  return (await employeeStoreId(employeeId)) === storeId
}

/** Verilen tüm çalışanlar bu mağazaya mı ait? (toplu atama / takas doğrulaması) */
export async function areEmployeesInStore(employeeIds: string[], storeId: string): Promise<boolean> {
  const unique = [...new Set(employeeIds)]
  if (unique.length === 0) return true
  if (!unique.every(isUuid)) return false
  const { data, error } = await createAdminClient()
    .from('employees')
    .select('id')
    .in('id', unique)
    .eq('store_id', storeId)
  if (error) throw error
  return (data ?? []).length === unique.length
}
