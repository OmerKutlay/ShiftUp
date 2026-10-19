/**
 * pushDiagnostics — Web Push zincirinin hangi halkasının eksik olduğunu adım adım çıkarır.
 *
 * Zincir: Cloudflare (VAPID_PUBLIC_KEY) → cihaz aboneliği (push_subscriptions) →
 * notifications INSERT → trg_notifications_push_fanout → pg_net → Vault secret'ları →
 * send-push Edge Function → push servisi (FCM/APNs/Mozilla) → telefonun bildirim paneli.
 *
 * Saf fonksiyon (sunucuda GET /api/push/diagnostics içinde çalışır, birim testli).
 * Veritabanı tarafı public.push_diagnostics() RPC'sinden gelir
 * (20261017100000_push_diagnostics.sql); secret değerleri asla dönmez, yalnızca var/yok.
 */

/** pg_net'in send-push çağrısına aldığı yanıt (net._http_response) */
export interface PushHttpResponse {
  status_code: number | null
  error_msg: string | null
  /** Yanıt gövdesinin ilk 200 karakteri (send-push: {"sent":n,"failed":n,"removed":n}) */
  content?: string | null
  created: string
}

/** public.push_diagnostics() çıktısı */
export interface PushDbDiagnostics {
  pg_net: boolean
  vault: boolean
  function_url: boolean
  webhook_secret: boolean
  trigger: boolean
  subscriptions: number
  recent_responses: PushHttpResponse[]
}

export type PushDiagnosticsDb = PushDbDiagnostics | { migrationMissing: true }

export interface PushDiagnosticsInput {
  /** Cloudflare'de VAPID_PUBLIC_KEY tanımlı mı */
  vapidPublicKey: boolean
  /** Oturumdaki çalışanın kayıtlı cihaz sayısı */
  mySubscriptions: number
  /** İstemcinin gönderdiği endpoint kayıtlı mı (gönderilmediyse null) */
  thisDevice: boolean | null
  db: PushDiagnosticsDb
}

export type PushStepKey =
  | 'vapid'
  | 'migration'
  | 'pg_net'
  | 'vault'
  | 'trigger'
  | 'subscription'
  | 'function'

export interface PushDiagnosticStep {
  key: PushStepKey
  /** true: tamam · false: sorun · null: kontrol edilemedi / henüz veri yok */
  ok: boolean | null
  label: string
  /** Sorun varsa ne yapılmalı (kısa, uygulanabilir) */
  hint: string | null
}

const SETUP = 'scripts/setup-push.sh'
const AFTER_MIGRATION = 'Migration uygulanınca kontrol edilir.'

export function isMigrationMissing(db: PushDiagnosticsDb): db is { migrationMissing: true } {
  return 'migrationMissing' in db && db.migrationMissing === true
}

/** send-push'un 2xx gövdesinden gönderim sayıları (çözülemezse null) */
export function parseSendResult(content: string | null | undefined): { sent: number; failed: number } | null {
  if (!content) return null
  try {
    const body = JSON.parse(content) as { sent?: unknown; failed?: unknown }
    if (typeof body.sent !== 'number' || typeof body.failed !== 'number') return null
    return { sent: body.sent, failed: body.failed }
  } catch {
    return null
  }
}

/** Son send-push yanıtını yorumlar */
export function functionStep(last: PushHttpResponse | undefined): PushDiagnosticStep {
  const label = 'send-push Edge Function son yanıtı'
  if (!last) {
    return {
      key: 'function', ok: null, label,
      hint: 'Henüz çağrı yok (pg_net yanıtları ~6 saat tutulur). Bir bildirim oluşunca (ör. izin talebi) Yenile\'ye basın.',
    }
  }
  const code = last.status_code
  if (code === null || code === undefined) {
    const reason = last.error_msg ? `: ${last.error_msg}` : ''
    return {
      key: 'function', ok: false, label: `${label} — istek ulaşmadı`,
      hint: `Fonksiyona ulaşılamadı${reason}. Vault'taki push_function_url adresini kontrol edin (${SETUP}).`,
    }
  }
  const withCode = `${label} — HTTP ${code}`
  if (code === 401) {
    return {
      key: 'function', ok: false, label: withCode,
      hint: `Yetkisiz: Vault'taki push_webhook_secret ile fonksiyondaki PUSH_WEBHOOK_SECRET uyuşmuyor ya da fonksiyon --no-verify-jwt olmadan deploy edildi. ${SETUP} ile yeniden kurun.`,
    }
  }
  if (code === 404) {
    return {
      key: 'function', ok: false, label: withCode,
      hint: `send-push deploy edilmemiş veya push_function_url yanlış. ${SETUP} ile fonksiyonu deploy edin.`,
    }
  }
  if (code >= 500) {
    return {
      key: 'function', ok: false, label: withCode,
      hint: `Fonksiyon hata verdi: secret'ları (VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET) ve Supabase › Edge Functions › send-push loglarını kontrol edin; eksikse ${SETUP}.`,
    }
  }
  if (code >= 200 && code < 300) {
    const result = parseSendResult(last.content)
    if (result && result.failed > 0 && result.sent === 0) {
      return {
        key: 'function', ok: false, label: `${withCode} (gönderilen 0, başarısız ${result.failed})`,
        hint: `Push servisi reddetti: Cloudflare'deki VAPID_PUBLIC_KEY ile fonksiyondaki anahtar çifti aynı olmalı. ${SETUP} sonrası telefonda bildirimleri kapatıp yeniden açın.`,
      }
    }
    const detail = result ? ` (gönderilen ${result.sent}, başarısız ${result.failed})` : ''
    return { key: 'function', ok: true, label: `${withCode}${detail}`, hint: null }
  }
  return {
    key: 'function', ok: false, label: withCode,
    hint: `Beklenmeyen yanıt. Supabase › Edge Functions › send-push loglarına bakın; gerekirse ${SETUP}.`,
  }
}

/** Teşhis adımlarını zincir sırasıyla üretir */
export function computePushDiagnosticSteps(input: PushDiagnosticsInput): PushDiagnosticStep[] {
  const steps: PushDiagnosticStep[] = []

  steps.push({
    key: 'vapid',
    ok: input.vapidPublicKey,
    label: 'Cloudflare: VAPID_PUBLIC_KEY',
    hint: input.vapidPublicKey
      ? null
      : `Cloudflare Worker'da VAPID_PUBLIC_KEY tanımlı değil. ${SETUP} ile anahtar üretip Cloudflare'e ekleyin ve yeniden deploy edin.`,
  })

  const missing = isMigrationMissing(input.db)
  steps.push({
    key: 'migration',
    ok: !missing,
    label: 'Veritabanı migration\'ları (push_subscriptions, push_diagnostics)',
    hint: missing
      ? `20261016100000 / 20261017100000 migration'ları uygulanmamış. ${SETUP} ile uygulayın (düz supabase db push kullanmayın).`
      : null,
  })

  if (isMigrationMissing(input.db)) {
    steps.push({ key: 'pg_net', ok: null, label: 'pg_net eklentisi', hint: AFTER_MIGRATION })
    steps.push({ key: 'vault', ok: null, label: 'Vault secret\'ları', hint: AFTER_MIGRATION })
    steps.push({ key: 'trigger', ok: null, label: 'Bildirim tetikleyicisi', hint: AFTER_MIGRATION })
    steps.push(subscriptionStep(input))
    steps.push({ key: 'function', ok: null, label: 'send-push Edge Function son yanıtı', hint: AFTER_MIGRATION })
    return steps
  }

  const db = input.db
  steps.push({
    key: 'pg_net',
    ok: db.pg_net,
    label: 'pg_net eklentisi',
    hint: db.pg_net
      ? null
      : `pg_net kurulu değil. Supabase › Database › Extensions'tan pg_net'i açın veya ${SETUP} çalıştırın.`,
  })

  const secretsOk = db.vault && db.function_url && db.webhook_secret
  let vaultHint: string | null = null
  if (!db.vault) {
    vaultHint = `Vault (vault.decrypted_secrets) erişilemiyor. Supabase › Integrations › Vault'u etkinleştirip ${SETUP} çalıştırın.`
  } else if (!secretsOk) {
    const names = [
      !db.function_url && 'push_function_url',
      !db.webhook_secret && 'push_webhook_secret',
    ].filter(Boolean).join(', ')
    vaultHint = `Vault'ta eksik veya boş: ${names}. ${SETUP} ile ekleyin.`
  }
  steps.push({
    key: 'vault',
    ok: secretsOk,
    label: 'Vault secret\'ları (push_function_url, push_webhook_secret)',
    hint: vaultHint,
  })

  steps.push({
    key: 'trigger',
    ok: db.trigger,
    label: 'Bildirim tetikleyicisi (trg_notifications_push_fanout)',
    hint: db.trigger
      ? null
      : 'Tetikleyici yok veya devre dışı. 20261016100000_push_subscriptions.sql migration\'ını yeniden uygulayın.',
  })

  steps.push(subscriptionStep(input))
  steps.push(functionStep(db.recent_responses[0]))
  return steps
}

function subscriptionStep(input: PushDiagnosticsInput): PushDiagnosticStep {
  const n = input.mySubscriptions
  const label = `Bu hesabın kayıtlı cihazları (${n})`
  if (n === 0) {
    return {
      key: 'subscription', ok: false, label,
      hint: 'Bu hesapla kayıtlı cihaz yok. Telefonda Daha fazla › Anlık bildirimler\'i açın (iPhone\'da önce Ana Ekrana Ekle).',
    }
  }
  if (input.thisDevice === false) {
    return {
      key: 'subscription', ok: false, label: `${label} — bu cihaz kayıtlı değil`,
      hint: 'Bu cihazın aboneliği sunucuda yok. Anlık bildirimleri kapatıp yeniden açın.',
    }
  }
  return { key: 'subscription', ok: true, label, hint: null }
}
