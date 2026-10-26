/**
 * GET /api/checklists/today — aktif mağazanın bugünkü kontrol listeleri (oturum gerektirir).
 * Eksik günlük uygulamalar bu istekte tembel oluşturulur (idempotent).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, roleAtLeast, ACCESS } from '@/lib/auth'
import { activeRunDates, canTickChecklist } from '@/lib/checklistRules'
import { fetchTodayRuns, hasTickableShift } from '@/lib/checklistRepository'
import { checklistErrorResponse } from '@/lib/checklistApi'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  try {
    const nowMs = Date.now()
    const isManager = roleAtLeast(employee.access_level, ACCESS.MANAGER)
    const [runs, hasShift] = await Promise.all([
      fetchTodayRuns(employee.store_id, nowMs),
      isManager ? Promise.resolve(false) : hasTickableShift(employee.id, employee.store_id, nowMs),
    ])
    return NextResponse.json({
      date: activeRunDates(nowMs).today,
      runs,
      can_tick: canTickChecklist({ isManager, hasShiftTodayInStore: hasShift }),
      is_manager: isManager,
      current_employee_id: employee.id,
    })
  } catch (err) {
    return checklistErrorResponse('GET /api/checklists/today', err)
  }
}
