/**
 * apiErrors — API route'ları için standart hata yanıtları.
 *
 * DB / iç hata mesajları istemciye sızdırılmaz: sunucuda loglanır,
 * istemciye yalnızca genel mesaj + kod döner.
 */
import { NextResponse } from 'next/server'

export function badRequest(error: string, code = 'VALIDATION_ERROR') {
  return NextResponse.json({ error, code }, { status: 400 })
}

export function notFound(error = 'Kayıt bulunamadı.', code = 'NOT_FOUND') {
  return NextResponse.json({ error, code }, { status: 404 })
}

export function conflict(error: string, code = 'CONFLICT') {
  return NextResponse.json({ error, code }, { status: 409 })
}

export function tooManyRequests(error = 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.') {
  return NextResponse.json({ error, code: 'RATE_LIMITED' }, { status: 429 })
}

/** Beklenmeyen DB/iç hata: detay loglanır, istemciye genel mesaj döner */
export function serverError(context: string, err?: unknown, message = 'Sunucu hatası.') {
  const detail =
    err && typeof err === 'object' && 'message' in err ? (err as { message: unknown }).message : err
  console.error(`[${context}]`, detail)
  return NextResponse.json({ error: message, code: 'SERVER_ERROR' }, { status: 500 })
}

/** JSON gövdesini güvenle okur; geçersizse null döner */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  const ct = req.headers.get('content-type') ?? ''
  if (!ct.toLowerCase().includes('application/json')) return null
  try {
    const body = (await req.json()) as unknown
    return body && typeof body === 'object' ? (body as T) : null
  } catch {
    return null
  }
}
