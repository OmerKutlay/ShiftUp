/**
 * POST /api/client-errors — tarayıcıdaki işlenmemiş hataları app_errors'a yazar.
 * Body: { source?, message, stack?, url? }
 *
 * Oturum zorunlu (kiosk hariç); çalışan ve mağaza SESSION'dan alınır, istemci id'lerine güvenilmez.
 * Kullanıcı başına dakikada 5 istek, gövde en çok 8 KB. Yanıt her zaman 204 (başarılı ya da kısıtlı).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { badRequest, tooManyRequests } from '@/lib/apiErrors'
import { checkRateLimit } from '@/lib/rateLimiter'
import { logError, MAX_MESSAGE, MAX_STACK } from '@/lib/errorLog'

const MAX_BODY_BYTES = 8 * 1024
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 1000

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth


  const limit = await checkRateLimit(`client_err:${employee.id}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!limit.allowed) return tooManyRequests()

  // Boyut sınırı gerçek gövdede uygulanır (content-length başlığına güvenilmez)
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return badRequest('İstek gövdesi çok büyük.')
  let raw: string
  try { raw = await req.text() } catch { return badRequest('Geçersiz istek gövdesi.') }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return badRequest('İstek gövdesi çok büyük.')
  let body: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
  } catch { /* geçersiz JSON */ }
  if (!body) return badRequest('Geçersiz istek gövdesi.')
  const message = str(body.message, MAX_MESSAGE)
  if (!message) return badRequest('message gerekli.')

  logError(
    `client:${(str(body.source, 60) ?? 'unknown').replace(/[^a-zA-Z0-9:_\-./ ]/g, '')}`,
    Object.assign(new Error(message), { stack: str(body.stack, MAX_STACK) ?? undefined }),
    {
      requestId: req.headers.get('cf-ray'),
      employeeId: employee.id,
      storeId: employee.store_id,
      meta: { url: str(body.url, 300), ua: str(req.headers.get('user-agent'), 200) },
    },
  )
  return new NextResponse(null, { status: 204 })
}
