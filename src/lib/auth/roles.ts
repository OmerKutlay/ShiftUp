/**
 * roles.ts — Mevcut ShiftUp rol hiyerarşisi
 *
 * Veritabanındaki `roles` tablosundaki name değerleriyle birebir eşleşir.
 * Yeni rol eklenmeden önce DB'ye de eklenmeli.
 *
 * Hiyerarşi (yüksek → düşük yetki):
 *   Yönetici > Mağaza Müdürü > Müdür Yardımcısı > Çalışan
 */

export const ROLES = {
  YONETICI: 'Yönetici',
  MAGAZA_MUDURU: 'Mağaza Müdürü',
  MUDUR_YARDIMCISI: 'Müdür Yardımcısı',
  CALISAN: 'Çalışan',
  /** Kiosk cihaz hesabı — hiyerarşi dışında; yalnızca kiosk ekranını açabilir */
  KIOSK: 'Kiosk',
} as const

export type RoleName = (typeof ROLES)[keyof typeof ROLES]

/** roles tablosundaki sabit Kiosk satırı (20261013100000_kiosk_role_and_signing_keys.sql) */
export const KIOSK_ROLE_ID = '00000000-0000-0000-0000-000000000005'

export function isKioskRole(roleName: string | null | undefined): boolean {
  return roleName === ROLES.KIOSK
}

/**
 * Kiosk hesaplarını çalışan listelerinden (plan, puantaj, raporlar) çıkaran PostgREST filtresi.
 * role_id NULL olan çalışanlar korunur (neq tek başına NULL'ları da elerdi).
 */
export const NOT_KIOSK_FILTER = `role_id.is.null,role_id.neq.${KIOSK_ROLE_ID}`

/**
 * Rol hiyerarşisi — yüksek index = daha fazla yetki
 * Bir rolün kendi seviyesini veya altını yapabileceği işlemler için kullanılır.
 */
const ROLE_HIERARCHY: RoleName[] = [
  ROLES.CALISAN,
  ROLES.MUDUR_YARDIMCISI,
  ROLES.MAGAZA_MUDURU,
  ROLES.YONETICI,
]

/**
 * Verilen rol, hedef rolden büyük veya eşit yetkiye sahip mi?
 * Örn: roleAtLeast('Mağaza Müdürü', 'Müdür Yardımcısı') → true
 */
export function roleAtLeast(roleName: string, minRole: RoleName): boolean {
  const roleIdx = ROLE_HIERARCHY.indexOf(roleName as RoleName)
  const minIdx = ROLE_HIERARCHY.indexOf(minRole)
  if (roleIdx === -1) return false // Tanımlanmamış rol
  return roleIdx >= minIdx
}

/** Rolün hiyerarşideki sırası (bilinmeyen rol / null → -1) */
export function roleRank(roleName: string | null | undefined): number {
  return roleName ? ROLE_HIERARCHY.indexOf(roleName as RoleName) : -1
}

/**
 * actor, hedef rolündeki bir çalışanı yönetebilir mi (düzenleme/silme/rol atama)?
 * Yönetici herkesi yönetebilir; diğerleri yalnızca kendinden düşük rolleri.
 */
export function canManageRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
): boolean {
  if (actorRole === ROLES.YONETICI) return true
  const actor = roleRank(actorRole)
  if (actor < 0) return false
  return roleRank(targetRole) < actor
}

/**
 * Yönetimsel işlemler için minimum gerekli rol grupları.
 * API route'larında requireRole() parametresi olarak kullanılır.
 */
export const MANAGER_ROLES: RoleName[] = [
  ROLES.YONETICI,
  ROLES.MAGAZA_MUDURU,
  ROLES.MUDUR_YARDIMCISI,
]

export const ADMIN_ROLES: RoleName[] = [
  ROLES.YONETICI,
  ROLES.MAGAZA_MUDURU,
]

/**
 * Verilen rol adı izin listesinde var mı?
 * Client-side ve server-side'da kullanılabilir — saf fonksiyon.
 * API güvenliği için requireRole() kullan; bu sadece UI kararları için.
 */
export function hasRole(
  employeeRoleName: string | null | undefined,
  allowedRoles: RoleName[]
): boolean {
  if (!employeeRoleName) return false
  return allowedRoles.some((r) => r === employeeRoleName)
}
