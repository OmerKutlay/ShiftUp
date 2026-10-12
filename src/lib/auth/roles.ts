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
} as const

export type RoleName = (typeof ROLES)[keyof typeof ROLES]

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
