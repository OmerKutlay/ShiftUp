/**
 * GET /api/push/diagnostics — Web Push kurulum teşhisi (Mağaza Müdürü+).
 * Sorgu: ?endpoint=<bu cihazın PushSubscription.endpoint'i> (opsiyonel; "bu cihaz kayıtlı mı")
 *
 * Yanıt:
 *   {
 *     app:   { vapidPublicKey: boolean },
 *     me:    { subscriptions: number, thisDevice: boolean | null },
 *     db:    push_diagnostics() çıktısı | { migrationMissing: true },
 *     steps: PushDiagnosticStep[]   // zincir sırasıyla { key, ok, label, hint }
 *   }
 * Secret değerleri asla dönmez; yalnızca var/yok bilgisi.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { serverError } from '@/lib/apiErrors'
import {
  computePushDiagnosticSteps,
  type PushDbDiagnostics,
  type PushDiagnosticsDb,
} from '@/lib/pushDiagnostics'

/** Tablo / fonksiyon yok (migration uygulanmamış) — Postgres ve PostgREST hata kodları */
const MISSING_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])

function isMissing(err: { code?: string } | null | undefined): boolean {
  return Boolean(err?.code && MISSING_CODES.has(err.code))
}

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MAGAZA_MUDURU)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const vapidPublicKey = Boolean(process.env.VAPID_PUBLIC_KEY?.trim())
  const endpoint = req.nextUrl.searchParams.get('endpoint')

  try {
    const admin = createAdminClient()
    let migrationMissing = false

    // Bu çalışanın abonelikleri
    let subscriptions = 0
    let thisDevice: boolean | null = null
    const subs = await admin.from('push_subscriptions').select('endpoint').eq('employee_id', employee.id)
    if (subs.error) {
      if (!isMissing(subs.error)) throw subs.error
      migrationMissing = true
    } else {
      const rows = (subs.data ?? []) as { endpoint: string }[]
      subscriptions = rows.length
      if (endpoint) thisDevice = rows.some((r) => r.endpoint === endpoint)
    }

    // Veritabanı tarafı (pg_net, Vault, tetikleyici, son yanıtlar)
    let db: PushDiagnosticsDb = { migrationMissing: true }
    if (!migrationMissing) {
      const rpc = await admin.rpc('push_diagnostics')
      if (rpc.error) {
        if (!isMissing(rpc.error)) throw rpc.error
      } else {
        const data = rpc.data as Partial<PushDbDiagnostics> | null
        db = {
          pg_net: Boolean(data?.pg_net),
          vault: Boolean(data?.vault),
          function_url: Boolean(data?.function_url),
          webhook_secret: Boolean(data?.webhook_secret),
          trigger: Boolean(data?.trigger),
          subscriptions: Number(data?.subscriptions ?? 0),
          recent_responses: Array.isArray(data?.recent_responses) ? data.recent_responses : [],
        }
      }
    }

    const steps = computePushDiagnosticSteps({ vapidPublicKey, mySubscriptions: subscriptions, thisDevice, db })
    return NextResponse.json({ app: { vapidPublicKey }, me: { subscriptions, thisDevice }, db, steps })
  } catch (err) {
    return serverError('GET /api/push/diagnostics', err)
  }
}
