/**
 * GET /api/push/config — Web Push yapılandırması (istemci aboneliği için VAPID açık anahtarı).
 * Yanıt: { enabled: boolean, publicKey: string | null }
 * VAPID_PUBLIC_KEY tanımlı değilse push kapalıdır; arayüz "Aç" düğmesini göstermez.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null
  return NextResponse.json({ enabled: Boolean(publicKey), publicKey })
}
