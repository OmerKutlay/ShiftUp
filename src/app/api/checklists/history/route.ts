/**
 * GET /api/checklists/history — son 30 günün uygulamaları (Müdür Yardımcısı+, salt okunur).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { turkeyToday } from '@/lib/dateUtils'
import { historyFrom } from '@/lib/checklistRules'
import { fetchHistory } from '@/lib/checklistRepository'
import { checklistErrorResponse } from '@/lib/checklistApi'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const to = turkeyToday()
    const from = historyFrom(to, 30)
    const runs = await fetchHistory(auth.employee.store_id, from, to)
    return NextResponse.json({ from, to, runs })
  } catch (err) {
    return checklistErrorResponse('GET /api/checklists/history', err)
  }
}
