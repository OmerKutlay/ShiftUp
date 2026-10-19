'use client'

/**
 * LoginForm — Development / Production Authentication
 *
 * Tüm auth mantığı server-side API route'larında.
 * Bu bileşen Supabase Auth'u HİÇBİR ZAMAN doğrudan çağırmaz.
 *
 * Development (authMode='development'):
 *   Adım 1: POST /api/auth/dev-login { step: 'check-email', email }
 *   Adım 2: POST /api/auth/dev-login { step: 'verify-otp', email, otp }
 *   → Supabase Auth çağrısı YOK, email gönderimi YOK
 *
 * Production (authMode='production'):
 *   Adım 1: POST /api/auth/send-otp { email }   (server-side Supabase OTP)
 *   Adım 2: POST /api/auth/verify-otp { email, token } (server-side verify)
 *   → Supabase Auth server'da çalışır, client'ta asla
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { AlertCircle, ArrowLeft, Bug, Info, Loader2, LockKeyhole, Mail } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandMark } from '@/components/common/BrandMark'

type Step = 'email' | 'otp'

/** Production'da Supabase email OTP uzunluğu */
const OTP_LENGTH = 6
/** Supabase aynı email'e 60 sn içinde ikinci kod göndermez */
const RESEND_COOLDOWN_SEC = 60

const EMAIL_ERRORS: Record<string, string> = {
  EMPLOYEE_INACTIVE: 'Bu hesap aktif değil. Yöneticinizle iletişime geçin.',
  EMPLOYEE_NOT_FOUND: 'Bu email adresiyle kayıtlı çalışan bulunamadı.',
  INVALID_EMAIL: 'Geçerli bir email adresi giriniz.',
  RATE_LIMITED: 'Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.',
}

const OTP_ERRORS: Record<string, string> = {
  OTP_EXPIRED: 'Kodun süresi dolmuş. Yeni kod isteyin.',
  RATE_LIMITED: 'Çok fazla hatalı deneme. Lütfen 15 dakika sonra tekrar deneyin.',
  EMPLOYEE_NOT_FOUND: 'Bu hesap aktif bir çalışana bağlı değil.',
}

interface FormState {
  email: string
  otp: string
  step: Step
  loading: boolean
  error: string | null
  info: string | null
}

interface Props {
  authMode: string
}

/**
 * Middleware'in eklediği ?next= hedefi — yalnızca aynı origin'deki göreli yollar
 * (açık yönlendirme önlemi); geçersizse ana sayfa. Yetki yoksa middleware yine yönlendirir.
 */
export function safeNextPath(search: string): string {
  const next = new URLSearchParams(search).get('next')
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/'
  if (next === '/login' || next.startsWith('/login/') || next.startsWith('/api/')) return '/'
  return next
}

export function LoginForm({ authMode }: Props) {
  const router = useRouter()
  const { refreshEmployee, status } = useAuth()
  const isDevMode = authMode === 'development'

  // OTP başarıyla doğrulandıktan sonra refreshEmployee çağrılır.
  // AuthContext status 'authenticated' olduğunda buradan navigate edilir —
  // bu sayede AppShell mount'u sırasında context zaten güncel olur.
  const [readyToNavigate, setReadyToNavigate] = useState(false)
  useEffect(() => {
    if (readyToNavigate && status === 'authenticated') {
      // Oturum düşmüşken açılan sayfaya (ör. bildirime tıklama) geri dön
      router.replace(safeNextPath(window.location.search))
    }
  }, [readyToNavigate, status, router])

  // Tekrar gönder geri sayımı
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const [state, setState] = useState<FormState>({
    email: '',
    otp: '',
    step: 'email',
    loading: false,
    error: null,
    info: null,
  })

  function setPartial(patch: Partial<FormState>) {
    setState((prev) => ({ ...prev, ...patch }))
  }

  // ─── Adım 1: Email kontrolü ──────────────────────────────
  async function handleEmailSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const email = state.email.trim().toLowerCase()

    if (!email || !email.includes('@')) {
      setPartial({ error: 'Geçerli bir email adresi giriniz.' })
      return
    }

    setPartial({ loading: true, error: null, info: null })

    try {
      // Development ve production akışı aynı endpoint üzerinden gider.
      // /api/auth/dev-login AUTH_MODE=development'ta aktif,
      // /api/auth/send-otp AUTH_MODE=production'da aktif.
      // Bu bileşen Supabase Auth'u HİÇBİR ZAMAN çağırmaz.
      const endpoint = isDevMode ? '/api/auth/dev-login' : '/api/auth/send-otp'
      const body = isDevMode
        ? { step: 'check-email', email }
        : { email }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { ok: boolean; reason?: string }

      if (!data.ok) {
        setPartial({
          loading: false,
          error:
            EMAIL_ERRORS[data.reason ?? ''] ??
            'Giriş kodu gönderilemedi. Lütfen daha sonra tekrar deneyin.',
        })
        return
      }

      if (!isDevMode) setCooldown(RESEND_COOLDOWN_SEC)
      setPartial({
        loading: false,
        step: 'otp',
        otp: '',
        info: isDevMode
          ? 'Development modu aktif. Giriş kodunuzu girin.'
          : `${email} kayıtlı bir çalışana aitse giriş kodu gönderildi.`,
        email,
      })
    } catch {
      setPartial({ loading: false, error: 'Bağlantı hatası. Lütfen tekrar deneyin.' })
    }
  }

  // ─── Adım 2: OTP doğrulama ───────────────────────────────
  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault()
    const token = state.otp.replace(/\D/g, '').slice(0, 6)

    if (isDevMode ? token.length < 4 : token.length !== OTP_LENGTH) {
      setPartial({ error: 'Kodu eksiksiz giriniz.' })
      return
    }

    setPartial({ loading: true, error: null })

    try {
      const endpoint = isDevMode ? '/api/auth/dev-login' : '/api/auth/verify-otp'
      const body = isDevMode
        ? { step: 'verify-otp', email: state.email, otp: token }
        : { email: state.email, token }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { ok: boolean; reason?: string }

      if (!data.ok) {
        setPartial({
          loading: false,
          error: OTP_ERRORS[data.reason ?? ''] ?? 'Kod hatalı. Tekrar deneyin.',
        })
        return
      }

      // Session cookie set edildi — AuthContext'i güncelle, state propagate olunca navigate et
      await refreshEmployee()
      setReadyToNavigate(true)
    } catch {
      setPartial({ loading: false, error: 'Doğrulama sırasında hata oluştu.' })
    }
  }

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm py-0">
        <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
          {/* Logo + dev rozeti */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <BrandMark size={36} />
              <h1 className="text-2xl font-bold text-ink">ShiftUp</h1>
              {isDevMode && (
                <Badge tone="warning" className="ml-auto">
                  <Bug aria-hidden />
                  DEV
                </Badge>
              )}
            </div>
            <p className="text-sm text-ink-secondary">
              {state.step === 'email'
                ? 'Email adresinizi girerek devam edin.'
                : isDevMode
                ? 'Development kodu girin (varsayılan: 12345).'
                : 'Email adresinize gönderilen 6 haneli kodu girin.'}
            </p>
          </div>

          {(state.error || state.info) && (
            <div className="flex flex-col gap-2">
              {state.error && (
                <Alert tone="danger">
                  <AlertCircle />
                  <AlertDescription className="text-ink">{state.error}</AlertDescription>
                </Alert>
              )}
              {state.info && (
                <Alert tone="info" role="status">
                  <Info />
                  <AlertDescription className="text-ink">{state.info}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Adım 1: Email */}
          {state.step === 'email' && (
            <form onSubmit={handleEmailSubmit} noValidate className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="login-email">Email</Label>
                <div className="relative">
                  <Mail
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
                  />
                  <Input
                    id="login-email"
                    type="email"
                    value={state.email}
                    onChange={(e) => setPartial({ email: e.target.value, error: null })}
                    autoFocus
                    autoComplete="email"
                    placeholder="ad.soyad@ornek.com"
                    disabled={state.loading}
                    aria-invalid={state.error ? true : undefined}
                    className="h-11 pl-9"
                  />
                </div>
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={state.loading}>
                {state.loading ? <Loader2 className="size-5 animate-spin" aria-label="Yükleniyor" /> : 'Devam Et'}
              </Button>
            </form>
          )}

          {/* Adım 2: OTP */}
          {state.step === 'otp' && (
            <form onSubmit={handleOtpSubmit} noValidate className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="login-otp">{isDevMode ? 'Development Kodu' : 'Giriş Kodu'}</Label>
                <div className="relative">
                  <LockKeyhole
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
                  />
                  <Input
                    id="login-otp"
                    type="text"
                    inputMode="numeric"
                    value={state.otp}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                      setPartial({ otp: v, error: null })
                    }}
                    autoFocus
                    autoComplete="one-time-code"
                    maxLength={6}
                    disabled={state.loading}
                    aria-invalid={state.error ? true : undefined}
                    className="h-14 pl-10 text-center font-mono text-2xl tracking-[0.5em] md:text-2xl"
                  />
                </div>
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={state.loading}>
                {state.loading ? <Loader2 className="size-5 animate-spin" aria-label="Yükleniyor" /> : 'Giriş Yap'}
              </Button>
              <div className="flex flex-col gap-1">
                {!isDevMode && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-primary"
                    disabled={state.loading || cooldown > 0}
                    onClick={() => handleEmailSubmit()}
                  >
                    {cooldown > 0 ? `Kodu tekrar gönder (${cooldown} sn)` : 'Kodu tekrar gönder'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-ink-secondary"
                  disabled={state.loading}
                  onClick={() => setPartial({ step: 'email', otp: '', error: null, info: null })}
                >
                  <ArrowLeft />
                  Email adresini değiştir
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
