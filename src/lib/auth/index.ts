/**
 * @/lib/auth barrel export
 *
 * ── Client-safe (browser'da import edilebilir) ──────────────
 *   hasRole, ROLES, MANAGER_ROLES, ADMIN_ROLES, roleAtLeast
 *
 * ── Server-only (API routes, middleware) ────────────────────
 *   requireAuth, requireRole, requireMinRole, canAccessEmployee,
 *   unauthorized, forbidden
 *   → Bu fonksiyonlar session.ts'e bağlıdır; session.ts next/headers
 *     taşıdığından bu dosyayı 'use client' context'inde import ETME.
 *
 *   getCurrentEmployee, SessionEmployee
 *   → Doğrudan '@/lib/auth/session' veya '@/lib/auth/authorization'
 *     üzerinden import et; barrel üzerinden kullanımı chain'i bozabilir.
 */

// ── Client-safe ───────────────────────────────────────────────
export {
  ROLES,
  MANAGER_ROLES,
  ADMIN_ROLES,
  roleAtLeast,
  roleRank,
  canManageRole,
  isKioskRole,
  KIOSK_ROLE_ID,
  NOT_KIOSK_FILTER,
} from './roles'
export type { RoleName } from './roles'

export { hasRole } from './authorization'

// ── Server-only: bu export'ları yalnızca API route'larında kullan ──
// Aşağıdaki satırları 'use client' olan veya client'tan import edilen
// bir dosyada kullanma.
export {
  requireAuth,
  requireRole,
  requireMinRole,
  canAccessEmployee,
  unauthorized,
  forbidden,
} from './authorization'

// getCurrentEmployee ve SessionEmployee tipi kasıtlı olarak burada
// export edilmiyor — doğrudan '@/lib/auth/session' üzerinden import et.
// Bu, webpack'in next/headers'ı client bundle'a sokmasını önler.
