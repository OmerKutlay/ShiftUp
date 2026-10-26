/**
 * GET /api/leave/balance?employee_id=...
 * Yıllık izin hakkı ve bakiyesi (İş K. Md. 53). Çalışan kendi bakiyesini, yöneticiler herkesinkini görür.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { canAccessEmployee, requireAuth, MANAGER_ROLES } from '@/lib/auth'
import { badRequest, notFound, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { isEmployeeInStore } from '@/lib/storeScope'
import { getAnnualLeaveBalance } from '@/lib/annualLeaveService'

export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('employee_id')
  let employeeId: string
  if (requested) {
    if (!isUuid(requested)) return badRequest('Geçersiz çalışan ID.')
    const access = await canAccessEmployee(req, requested, MANAGER_ROLES)
    if ('response' in access) return access.response
    employeeId = requested
    // Başkasının bakiyesi yalnızca aktif mağazanın çalışanı için
    if (requested !== access.employee.id && !(await isEmployeeInStore(requested, access.employee.store_id))) {
      return notFound('Çalışan bulunamadı.', 'EMPLOYEE_NOT_FOUND')
    }
  } else {
    const auth = await requireAuth(req)
    if ('response' in auth) return auth.response
    employeeId = auth.employee.id
  }

  try {
    return NextResponse.json({ balance: await getAnnualLeaveBalance(createAdminClient(), employeeId) })
  } catch (err) {
    return serverError('GET /api/leave/balance', err)
  }
}
