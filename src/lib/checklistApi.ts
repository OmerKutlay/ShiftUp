/**
 * checklistApi — /api/checklists/* route'larının ortak hata eşlemesi ve limitleri (yalnızca server).
 */
import { NextResponse } from 'next/server'
import { badRequest, notFound, serverError, tooManyRequests } from '@/lib/apiErrors'
import { forbidden } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimiter'
import { ChecklistValidationError } from '@/lib/checklistRules'
import { ChecklistForbiddenError, ChecklistNotFoundError } from '@/lib/checklistRepository'

/** Madde işaretleme / not: kullanıcı başına saatte 300 (genel kullanımda aşılmaz, otomasyonu keser) */
export const TICK_LIMIT = 300
export const TICK_WINDOW_MS = 60 * 60 * 1000

/** Limit aşıldıysa 429 yanıtı, değilse null */
export async function tickRateLimited(employeeId: string): Promise<NextResponse | null> {
  const rl = await checkRateLimit(`checklist_tick:${employeeId}`, TICK_LIMIT, TICK_WINDOW_MS)
  return rl.allowed ? null : tooManyRequests()
}

export function checklistErrorResponse(context: string, err: unknown): NextResponse {
  if (err instanceof ChecklistValidationError) return badRequest(err.message)
  if (err instanceof ChecklistNotFoundError) return notFound(err.message)
  if (err instanceof ChecklistForbiddenError) return forbidden(err.message)
  return serverError(context, err)
}
