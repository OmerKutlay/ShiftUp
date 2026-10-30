/**
 * verifiedSession — Supabase oturumunu Auth sunucusuna gitmeden doğrular.
 *
 * getClaims(): çerezdeki access token'ın ES256 imzası ve süresi WebCrypto ile yerelde doğrulanır;
 * imza anahtarı (JWKS) isolate başına önbellektedir (auth-js, 10 dk). Süresi dolan token yine
 * getSession içinde yenilenir ve yeni çerezler yazılır.
 *
 * Neden getUser() değil: her istekte Auth sunucusuna ek bir alt istek demekti. Ücretsiz planda
 * her alt istek CPU harcar ve istek başına 10 ms sınırı (Error 1102) aşılıyordu.
 * Hesabı kapatılan / pasifleştirilen çalışan yine her istekte çalışan kaydından düşürülür;
 * çıkışta refresh token iptal edilir ve çerezler silinir.
 *
 * Edge uyumlu (middleware'den import edilir).
 */
import { SESSION_MAX_AGE, signInTimeFromClaims } from './sessionAge'

/** @supabase/ssr istemcisinin kullandığımız auth yüzeyi */
interface ClaimsAuth {
  getClaims(): Promise<{ data: { claims: object } | null; error: unknown }>
  getUser(): Promise<{ data: { user: { id: string; last_sign_in_at?: string | null } | null } }>
}

export interface VerifiedSession {
  /** Supabase auth kullanıcısı (`sub`) */
  userId: string
  /** Oturum kimliği (`session_id`; token yenilemede korunur) — admin girişi çerezi buna bağlıdır */
  sessionId: string | null
  /** Girişten bu yana SESSION_MAX_AGE geçti mi (bkz. sessionAge) */
  expired: boolean
}

/** Geçerli oturum yoksa (çerez yok, imza / süre geçersiz) null */
export async function verifySupabaseSession(auth: ClaimsAuth, now = Date.now()): Promise<VerifiedSession | null> {
  const { data, error } = await auth.getClaims()
  const claims = data?.claims as Record<string, unknown> | undefined
  const userId = claims?.sub
  if (error || !claims || typeof userId !== 'string' || !userId) return null

  let startedAt = signInTimeFromClaims(claims)
  if (startedAt === null) {
    // `amr` yoksa (eski biçim token) giriş anı kullanıcı kaydından okunur — nadir, tek alt istek
    const { data: { user } } = await auth.getUser()
    if (!user || user.id !== userId) return null
    const parsed = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN
    startedAt = Number.isFinite(parsed) ? parsed : null
  }

  const sid = claims.session_id
  return {
    userId,
    sessionId: typeof sid === 'string' && sid ? sid : null,
    expired: startedAt !== null && now - startedAt > SESSION_MAX_AGE * 1000,
  }
}
