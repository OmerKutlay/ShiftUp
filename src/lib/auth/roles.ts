/**
 * roles.ts — Sistem rolü modeli
 *
 * Her sistem rolü (roles tablosu) iki bilgiyi taşır; kod rol ADINA hiç bakmaz:
 *   access_level   → yetki seviyesi (bu dosya)
 *   planning_group → vardiya planlayıcısındaki görev; null = planlanmaz
 *
 * Yetki hiyerarşisi (yüksek → düşük):
 *   Admin > Müdür > Yönetici > Çalışan   (Kiosk hiyerarşi dışı: yalnızca kiosk ekranı)
 *
 * Yeni bir rol (ör. "Şef Kasiyer") yalnızca DB'ye bu iki alanla eklenir; kod değişmez.
 */

export const ACCESS = {
  ADMIN: 'admin',
  STORE_MANAGER: 'store_manager',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
  /** Kiosk cihaz hesabı — hiyerarşi dışında; yalnızca kiosk ekranını açabilir */
  KIOSK: 'kiosk',
} as const

export type AccessLevel = (typeof ACCESS)[keyof typeof ACCESS]

export const ACCESS_LABELS: Record<AccessLevel, string> = {
  admin: 'Admin',
  store_manager: 'Müdür',
  manager: 'Yönetici',
  employee: 'Çalışan',
  kiosk: 'Kiosk',
}

/** Planlayıcıdaki görev — DB CHECK constraint ile senkron */
export const PLANNING_GROUPS = [
  'store_manager', 'assistant_manager', 'floor_lead', 'visual', 'stock', 'cashier', 'sales',
] as const

export type PlanningGroup = (typeof PLANNING_GROUPS)[number]

export const PLANNING_GROUP_LABELS: Record<PlanningGroup, string> = {
  store_manager: 'Mağaza müdürü',
  assistant_manager: 'Müdür yardımcısı',
  floor_lead: 'Reyon sorumlusu',
  visual: 'Görsel (08:00 sabit)',
  stock: 'Depo (08:00 sabit)',
  cashier: 'Kasiyer',
  sales: 'Satış danışmanı',
}

/** Açılış/kapanışta "yönetici bulunmalı" kuralını karşılayan görevler */
export const SHIFT_LEAD_GROUPS: readonly PlanningGroup[] = ['store_manager', 'assistant_manager', 'floor_lead']

export function isPlanningGroup(v: unknown): v is PlanningGroup {
  return typeof v === 'string' && (PLANNING_GROUPS as readonly string[]).includes(v)
}

export function isAccessLevel(v: unknown): v is AccessLevel {
  return typeof v === 'string' && (Object.values(ACCESS) as string[]).includes(v)
}

/** roles tablosundaki sabit Kiosk satırı (20261013100000_kiosk_role_and_signing_keys.sql) */
export const KIOSK_ROLE_ID = '00000000-0000-0000-0000-000000000005'

export function isKioskRole(level: AccessLevel | null | undefined): boolean {
  return level === ACCESS.KIOSK
}

/**
 * Kiosk hesaplarını çalışan listelerinden (plan, puantaj, raporlar) çıkaran PostgREST filtresi.
 * role_id NULL olan çalışanlar korunur (neq tek başına NULL'ları da elerdi).
 */
export const NOT_KIOSK_FILTER = `role_id.is.null,role_id.neq.${KIOSK_ROLE_ID}`

/** Yetki hiyerarşisi — yüksek index = daha fazla yetki */
const ACCESS_HIERARCHY: AccessLevel[] = [
  ACCESS.EMPLOYEE,
  ACCESS.MANAGER,
  ACCESS.STORE_MANAGER,
  ACCESS.ADMIN,
]

/**
 * Verilen yetki seviyesi, hedef seviyeden büyük veya eşit mi?
 * Örn: roleAtLeast('store_manager', 'manager') → true
 */
export function roleAtLeast(level: AccessLevel | null | undefined, minLevel: AccessLevel): boolean {
  const idx = roleRank(level)
  if (idx === -1) return false // Tanımlanmamış / kiosk
  return idx >= ACCESS_HIERARCHY.indexOf(minLevel)
}

/** Yetki seviyesinin hiyerarşideki sırası (bilinmeyen / kiosk / null → -1) */
export function roleRank(level: AccessLevel | null | undefined): number {
  return level ? ACCESS_HIERARCHY.indexOf(level) : -1
}

/**
 * actor, hedef yetki seviyesindeki bir çalışanı yönetebilir mi (düzenleme/silme/rol atama)?
 * Admin herkesi yönetebilir; diğerleri yalnızca kendinden düşük seviyeleri.
 */
export function canManageRole(
  actorLevel: AccessLevel | null | undefined,
  targetLevel: AccessLevel | null | undefined
): boolean {
  if (actorLevel === ACCESS.ADMIN) return true
  const actor = roleRank(actorLevel)
  if (actor < 0) return false
  return roleRank(targetLevel) < actor
}

/** Yönetimsel işlemler (Yönetici ve üstü) */
export const MANAGER_ROLES: AccessLevel[] = [
  ACCESS.ADMIN,
  ACCESS.STORE_MANAGER,
  ACCESS.MANAGER,
]

/** Mağaza ayarları (Müdür ve üstü) */
export const ADMIN_ROLES: AccessLevel[] = [
  ACCESS.ADMIN,
  ACCESS.STORE_MANAGER,
]

/**
 * Verilen yetki seviyesi izin listesinde var mı?
 * Client-side ve server-side'da kullanılabilir — saf fonksiyon.
 * API güvenliği için requireRole() kullan; bu sadece UI kararları için.
 */
export function hasRole(
  level: AccessLevel | null | undefined,
  allowed: AccessLevel[]
): boolean {
  if (!level) return false
  return allowed.includes(level)
}

/** Supabase join'inden ({ access_level } | [{ access_level }] | null) yetki seviyesini çıkarır */
export function accessLevelOf(roles: unknown): AccessLevel | null {
  const r = Array.isArray(roles) ? roles[0] : roles
  const level = (r as { access_level?: unknown } | null | undefined)?.access_level
  return isAccessLevel(level) ? level : null
}
