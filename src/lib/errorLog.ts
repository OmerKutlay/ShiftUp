/**
 * errorLog — ücretsiz hata günlüğü: console.error + app_errors tablosuna yazım.
 *
 * - Asla fırlatmaz, yanıtı bloklamaz: yazım Workers'ta ctx.waitUntil ile (yoksa fire-and-forget).
 * - Isolate başına basit kısıtlama: aynı hata 60 sn'de bir, toplamda dakikada en fazla 30 satır
 *   yazılır; hata fırtınası veritabanını şişirmez (console.error her zaman çalışır).
 * - Test ortamında DB'ye yazılmaz.
 * - Saklama: 30 gün (purge_expired_data, 20261028100000).
 */
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabaseAdmin'

export interface ErrorContext {
  requestId?: string | null
  employeeId?: string | null
  storeId?: string | null
  meta?: Record<string, unknown>
}

export const MAX_MESSAGE = 500
export const MAX_STACK = 4000
const MAX_META_JSON = 2000
const DEDUPE_MS = 60_000
const GLOBAL_LIMIT = 30
const GLOBAL_WINDOW_MS = 60_000
const MAX_TRACKED = 200

const recent = new Map<string, number>()
let windowStart = 0
let windowCount = 0

/** Yalnızca testler için */
export function _resetErrorLogThrottle() {
  recent.clear()
  windowStart = 0
  windowCount = 0
}

function describe(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack ?? null }
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    return { message: typeof m === 'string' ? m : safeJson(m), stack: null }
  }
  return { message: typeof err === 'string' ? err : safeJson(err), stack: null }
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

/** true → bu hata şimdi yazılmalı */
function shouldWrite(key: string, now: number): boolean {
  const last = recent.get(key)
  if (last !== undefined && now - last < DEDUPE_MS) return false
  if (now - windowStart > GLOBAL_WINDOW_MS) { windowStart = now; windowCount = 0 }
  if (windowCount >= GLOBAL_LIMIT) return false
  windowCount++
  if (recent.size >= MAX_TRACKED) recent.clear()
  recent.set(key, now)
  return true
}

async function currentRequestId(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers')
    return (await headers()).get('cf-ray')
  } catch {
    return null
  }
}

async function write(row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await createAdminClient().from('app_errors').insert(row)
    if (error) console.error('[errorLog] yazılamadı:', error.message)
  } catch (e) {
    console.error('[errorLog] yazılamadı:', e instanceof Error ? e.message : e)
  }
}

function runInBackground(p: Promise<void>) {
  try {
    getCloudflareContext().ctx.waitUntil(p)
  } catch {
    // Workers dışı (yerel geliştirme): söz kendi başına tamamlanır, hatası zaten yutuluyor
    void p.catch(() => {})
  }
}

export function logError(source: string, err: unknown, ctx: ErrorContext = {}): void {
  try {
    const { message, stack } = describe(err)
    console.error(`[${source}]`, message)
    if (process.env.NODE_ENV === 'test') return

    if (!shouldWrite(`${source}|${message}`, Date.now())) return

    runInBackground((async () => {
      const requestId = ctx.requestId ?? (await currentRequestId())
      let meta: unknown = null
      if (ctx.meta) {
        const json = safeJson(ctx.meta)
        meta = json.length <= MAX_META_JSON ? ctx.meta : { truncated: json.slice(0, MAX_META_JSON) }
      }
      await write({
        source: source.slice(0, 200),
        message: message.slice(0, MAX_MESSAGE),
        stack: stack ? stack.slice(0, MAX_STACK) : null,
        request_id: requestId ?? null,
        employee_id: ctx.employeeId ?? null,
        store_id: ctx.storeId ?? null,
        meta,
      })
    })())
  } catch {
    // günlükleme hiçbir zaman isteği bozmamalı
  }
}
