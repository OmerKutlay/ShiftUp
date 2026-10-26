/**
 * GET /api/checklists/today — aktif mağazanın bugünkü kontrol listeleri (oturum gerektirir).
 * Eksik günlük uygulamalar bu istekte tembel oluşturulur (idempotent).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, roleAtLeast, ACCESS } from '@/lib/auth'
import { turkeyToday } from '@/lib/dateUtils'
import { canTickChecklist } from '@/lib/checklistRules'
import { fetchTodayRuns, hasShiftTodayInStore } from '@/lib/checklistRepository'
import { checklistErrorResponse } from '@/lib/checklistApi'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  try {
    const today = turkeyToday()
    const isManager = roleAtLeast(employee.access_level, ACCESS.MANAGER)
    const [runs, hasShift] = await Promise.all([
      fetchTodayRuns(employee.store_id, today),
      isManager ? Promise.resolve(false) : hasShiftTodayInStore(employee.id, employee.store_id, today),
    ])
    return NextResponse.json({
      date: today,
      runs,
      can_tick: canTickChecklist({ isManager, hasShiftTodayInStore: hasShift }),
      is_manager: isManager,
      current_employee_id: employee.id,
    })
  } catch (err) {
    return checklistErrorResponse('GET /api/checklists/today', err)
  }
}
