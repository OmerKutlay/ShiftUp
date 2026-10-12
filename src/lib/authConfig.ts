/**
 * authConfig — Authentication mode yönetimi
 *
 * AUTH_MODE=development → dev OTP, no email, cookie session
 * AUTH_MODE=production  → Supabase Auth email OTP
 *
 * Bu dosya yalnızca server-side (API routes, middleware) kullanımı içindir.
 * Client'a AUTH_MODE veya DEV_OTP asla gönderilmez.
 */

/**
 * Fail-closed: AUTH_MODE tanımsızsa production kabul edilir ve
 * NODE_ENV=production build'lerinde dev auth asla etkinleşmez.
 */
export const AUTH_MODE: 'development' | 'production' =
  process.env.AUTH_MODE === 'development' && process.env.NODE_ENV !== 'production'
    ? 'development'
    : 'production'
export const IS_DEV_AUTH = AUTH_MODE === 'development'

/**
 * Dev modunda geçerli OTP kodu.
 * Yalnızca IS_DEV_AUTH=true olduğunda kullanılır.
 * Production'da bu değer hiçbir zaman kontrol edilmez.
 */
export function getDevOtp(): string {
  if (!IS_DEV_AUTH) {
    throw new Error('getDevOtp() called in non-development auth mode')
  }
  const otp = process.env.DEV_OTP
  if (!otp) {
    throw new Error('DEV_OTP must be set when AUTH_MODE=development')
  }
  return otp
}

/** Dev session cookie adı */
export const DEV_SESSION_COOKIE = 'dev_auth_session'

/** Cookie max-age: 8 saat (development session) */
export const DEV_SESSION_MAX_AGE = 8 * 60 * 60
