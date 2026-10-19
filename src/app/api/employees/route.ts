/**
 * GET  /api/employees?active=true|false — çalışan listesi (rol bilgisiyle).
 *      Oturum gerektirir; e-posta ve auth bağlantısı yalnızca yöneticilere döner.
 * POST /api/employees — yeni çalışan (Müdür Yardımcısı+; kendinden düşük rol atanabilir).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireMinRole, ACCESS, MANAGER_ROLES, hasRole } from '@/lib/auth'
import { fetchEmployees, fetchActiveEmployees, createEmployee } from '@/lib/employeeRepository'
import { badRequest, conflict, readJson, serverError } from '@/lib/apiErrors'
import { validateEmployeeInput } from '@/lib/employeeValidation'
import type { CreateEmployeePayload, EmployeeWithRole } from '@/types/employee'



export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  try {
    const activeParam = req.nextUrl.searchParams.get('active')
    let employees: EmployeeWithRole[]
    if (activeParam === 'true') {
      employees = await fetchActiveEmployees()
    } else {
      employees = await fetchEmployees()
      if (activeParam === 'false') employees = employees.filter((e) => !e.active)
    }

    // Standart çalışan diğerlerinin iletişim/kimlik bilgilerini görmez
    if (!hasRole(auth.employee.access_level, MANAGER_ROLES)) {
      employees = employees.map((e) => ({ ...e, email: null, auth_user_id: null }))
    }

    return NextResponse.json({ employees })
  } catch (err) {
    return serverError('GET /api/employees', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')

  try {
    const result = await validateEmployeeInput(body, auth.employee.access_level, false)
    if ('error' in result) return badRequest(result.error)

    const employee = await createEmployee({
      active: true,
      email: null,
      ...result.payload,
    } as CreateEmployeePayload)
    return NextResponse.json({ employee }, { status: 201 })
  } catch (err) {
    if (err instanceof Error && /duplicate|unique|23505/i.test(err.message)) {
      return conflict('Bu e-posta adresi başka bir çalışana ait.', 'DUPLICATE_EMAIL')
    }
    return serverError('POST /api/employees', err)
  }
}
