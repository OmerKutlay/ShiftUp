/**
 * authorization.ts — Server-side RBAC helpers
 *
 * API route'larında kullanılır. Client tarafında useAuth() yeterlidir.
 *
 * Akış:
 *   Request → requireAuth() → SessionEmployee
 *   SessionEmployee → requireRole() → yetkili / 403
 *   SessionEmployee → canAccessEmployee() → kendi verisi / 403
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentEmployee, type SessionEmployee } from './session'
import { roleAtLeast, type RoleName } from './roles'

// ─── Response helpers ────────────────────────────────────────

export function unauthorized(message = 'Giriş yapmanız gerekiyor.') {
  return NextResponse.json(
    { error: message, code: 'UNAUTHORIZED' },
    { status: 401 }
  )
}

export function forbidden(message = 'Bu işlem için yetkiniz yok.') {
  return NextResponse.json(
    { error: message, code: 'FORBIDDEN' },
    { status: 403 }
  )
}

// ─── Auth guard ──────────────────────────────────────────────

/**
 * Request'ten authenticated employee'ı çeker.
 * Unauthenticated ise { response: 401 } döner.
 * Authenticated ise { employee } döner.
 *
 * Kullanım:
 *   const auth = await requireAuth(req)
 *   if ('response' in auth) return auth.response
 *   const { employee } = auth
 */
export async function requireAuth(
  req: NextRequest
): Promise<{ employee: SessionEmployee } | { response: NextResponse }> {
  const employee = await getCurrentEmployee(req)
  if (!employee) {
    return { response: unauthorized() }
  }
  return { employee }
}

// ─── Role guard ──────────────────────────────────────────────

/**
 * Employee'ın belirtilen rollerden birine sahip olup olmadığını kontrol eder.
 * allowedRoles boş ise herhangi bir authenticated user geçer.
 *
 * Kullanım:
 *   const auth = await requireRole(req, MANAGER_ROLES)
 *   if ('response' in auth) return auth.response
 */
export async function requireRole(
  req: NextRequest,
  allowedRoles: RoleName[]
): Promise<{ employee: SessionEmployee } | { response: NextResponse }> {
  const authResult = await requireAuth(req)
  if ('response' in authResult) return authResult

  const { employee } = authResult

  if (allowedRoles.length === 0) return { employee }

  const hasRole = allowedRoles.some((r) => employee.role_name === r)
  if (!hasRole) {
    return { response: forbidden() }
  }

  return { employee }
}

/**
 * Employee'ın minimum rol seviyesini karşılayıp karşılamadığını kontrol eder.
 * Hiyerarşi: Yönetici > Mağaza Müdürü > Müdür Yardımcısı > Çalışan
 *
 * Kullanım:
 *   const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
 *   if ('response' in auth) return auth.response
 */
export async function requireMinRole(
  req: NextRequest,
  minRole: RoleName
): Promise<{ employee: SessionEmployee } | { response: NextResponse }> {
  const authResult = await requireAuth(req)
  if ('response' in authResult) return authResult

  const { employee } = authResult

  if (!employee.role_name || !roleAtLeast(employee.role_name, minRole)) {
    return { response: forbidden() }
  }

  return { employee }
}

// ─── Self-access guard ───────────────────────────────────────

/**
 * Employee'ın yalnızca kendi verisine erişip erişemeyeceğini kontrol eder.
 * Manager+ rolleri tüm employee verilerine erişebilir.
 * Standart Çalışan sadece kendi verilerine erişebilir.
 *
 * @param req - NextRequest
 * @param targetEmployeeId - Erişilmek istenen employee ID'si
 * @param managerRoles - Bu rollere sahip olanlar tüm employee'lara erişebilir
 *
 * Kullanım:
 *   const auth = await canAccessEmployee(req, body.employee_id, MANAGER_ROLES)
 *   if ('response' in auth) return auth.response
 */
export async function canAccessEmployee(
  req: NextRequest,
  targetEmployeeId: string,
  managerRoles: RoleName[]
): Promise<{ employee: SessionEmployee } | { response: NextResponse }> {
  const authResult = await requireAuth(req)
  if ('response' in authResult) return authResult

  const { employee } = authResult

  // Kendi verisine her zaman erişebilir
  if (employee.id === targetEmployeeId) return { employee }

  // Manager+ rolleri tüm employee verilerine erişebilir
  if (employee.role_name && managerRoles.includes(employee.role_name)) {
    return { employee }
  }

  return {
    response: forbidden('Yalnızca kendi verilerinize erişebilirsiniz.'),
  }
}

// ─── Utility ─────────────────────────────────────────────────

// hasRole roles.ts'te tanımlıdır — buradan re-export edilir
export { hasRole } from './roles'
