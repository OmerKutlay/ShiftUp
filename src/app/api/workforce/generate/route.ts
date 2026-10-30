/**
 * POST /api/workforce/generate — KALDIRILDI.
 *
 * Planı sunucuda üreten eski uç: planlayıcı Worker'ın CPU sınırını aşıyordu (1102).
 * Plan artık tarayıcıda üretilir: veri GET /api/workforce/plan-input'tan gelir,
 * buildPlan (src/lib/workforcePlanPayload.ts) hesaplar. Güncellenmemiş istemci 409 CLIENT_OUTDATED
 * alır ve mesajı gösterir; sayfa yenilenince yeni akış kullanılır.
 */
import { NextRequest } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { clientOutdated } from '@/lib/apiErrors'

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response
  return clientOutdated()
}
