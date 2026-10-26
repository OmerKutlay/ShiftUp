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
import { accessLevelOf, canReviewRole, isKioskRole, roleAtLeast, type AccessLevel } from './roles'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { isEmployeeInStore } from '@/lib/storeScope'
import { STORE_CHANGED_CODE, STORE_HEADER } from '@/lib/storeHeader'

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
 * Kiosk hesapları varsayılan olarak reddedilir (403): kiosk cihazı yalnızca kiosk
 * route'larını ({ allowKiosk: true }) kullanabilir; çalışan/yönetici API'lerine erişemez.
 *
 * Kullanım:
 *   const auth = await requireAuth(req)
 *   if ('response' in auth) return auth.response
 *   const { employee } = auth
 */
export async function requireAuth(
  req: NextRequest,
  { allowKiosk = false }: { allowKiosk?: boolean } = {}
): Promise<{ employee: SessionEmployee } | { response: NextResponse }> {
  const employee = await getCurrentEmployee(req)
  if (!employee) {
    return { response: unauthorized() }
  }
  if (!allowKiosk && isKioskRole(employee.access_level)) {
    return { response: forbidden('Kiosk hesabı bu işlemi yapamaz.') }
  }
  // İstemci isteği hangi mağazayı görürken gönderdi? Admin başka sekmede mağaza değiştirdiyse
  // aktif mağaza artık farklıdır — işlem yanlış mağazaya uygulanmasın (bkz. @/lib/storeHeader)
  const claimedStore = req.headers?.get?.(STORE_HEADER)
  if (claimedStore && claimedStore !== employee.store_id) {
    return {
      response: NextResponse.json(
        {
          error: 'Aktif mağaza başka bir sekmede değiştirildi. Sayfa yeni mağazaya göre yenilendi; işlemi tekrar deneyin.',
          code: STORE_CHANGED_CODE,
        },
        { status: 409 }
      ),
    }
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
  allowedRoles: AccessLevel[]
): Promise<{ employee: SessionEmployee } | { response: NextResponse }> {
  const authResult = await requireAuth(req)
  if ('response' in authResult) return authResult

  const { employee } = authResult

  if (allowedRoles.length === 0) return { employee }

  const hasRole = allowedRoles.some((r) => employee.access_level === r)
  if (!hasRole) {
    return { response: forbidden() }
  }

  return { employee }
}

/**
 * Employee'ın minimum rol seviyesini karşılayıp karşılamadığını kontrol eder.
 * Hiyerarşi: Admin > Müdür > Yönetici > Çalışan (roles.access_level)
 *
 * Kullanım:
 *   const auth = await requireMinRole(req, ACCESS.MANAGER)
 *   if ('response' in auth) return auth.response
 */
export async function requireMinRole(
  req: NextRequest,
  minRole: AccessLevel
): Promise<{ employee: SessionEmployee } | { response: NextResponse }> {
  const authResult = await requireAuth(req)
  if ('response' in authResult) return authResult

  const { employee } = authResult

  if (!roleAtLeast(employee.access_level, minRole)) {
    return { response: forbidden() }
  }

  return { employee }
}

// ─── Self-access guard ───────────────────────────────────────

/**
 * Employee'ın yalnızca kendi verisine erişip erişemeyeceğini kontrol eder.
 * Manager+ rolleri aktif mağazadaki tüm employee verilerine erişebilir.
 * Standart Çalışan sadece kendi verilerine erişebilir.
 * Başka mağazanın çalışanı için 404 döner (varlığı sızdırılmaz).
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
  managerRoles: AccessLevel[]
): Promise<{ employee: SessionEmployee } | { response: NextResponse }> {
  const authResult = await requireAuth(req)
  if ('response' in authResult) return authResult

  const { employee } = authResult

  // Kendi verisine her zaman erişebilir
  if (employee.id === targetEmployeeId) return { employee }

  // Manager+ rolleri aktif mağazanın çalışanlarına erişebilir
  if (employee.access_level && managerRoles.includes(employee.access_level)) {
    if (!(await isEmployeeInStore(targetEmployeeId, employee.store_id))) {
      return {
        response: NextResponse.json(
          { error: 'Çalışan bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' },
          { status: 404 }
        ),
      }
    }
    return { employee }
  }

  return {
    response: forbidden('Yalnızca kendi verilerinize erişebilirsiniz.'),
  }
}

// ─── Hierarchy guard ─────────────────────────────────────────

/**
 * Yönetici, hedef çalışanın talebine/kaydına karar verebilir mi (bkz. canReviewRole)?
 * Kendinden yüksek yetkili birinin kaydıysa (ör. Yönetici → Müdür'ün izni) 403 yanıtı, değilse null.
 * Hedefin mağaza kontrolü çağıranın sorumluluğundadır.
 *
 * Kullanım:
 *   const denied = await forbidIfOutranked(employee, request.employee_id)
 *   if (denied) return denied
 */
export async function forbidIfOutranked(
  actor: SessionEmployee,
  targetEmployeeId: string
): Promise<NextResponse | null> {
  const { data, error } = await createAdminClient()
    .from('employees')
    .select('roles ( access_level )')
    .eq('id', targetEmployeeId)
    .maybeSingle()
  if (error) throw error
  const targetLevel = accessLevelOf((data as { roles?: unknown } | null)?.roles)
  if (canReviewRole(actor.access_level, targetLevel)) return null
  return forbidden('Sizden yüksek yetkili bir çalışanın kaydı hakkında işlem yapamazsınız.')
}

// ─── Utility ─────────────────────────────────────────────────

// hasRole roles.ts'te tanımlıdır — buradan re-export edilir
export { hasRole } from './roles'
