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
import { Bug, CircleAlert, Mail, MailCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { BrandMark } from '@/components/common/BrandMark'
import { ThemeSwitch } from '@/components/common/ThemeSwitch'
import { cn } from '@/lib/utils'

type Step = 'email' | 'otp'

/** Production'da Supabase email OTP uzunluğu */
const OTP_LENGTH = 6
/** Supabase aynı email'e 60 sn içinde ikinci kod göndermez */
const RESEND_COOLDOWN_SEC = 60

const EMAIL_ERRORS: Record<string, string> = {
  EMPLOYEE_INACTIVE: 'Bu hesap aktif değil. Yöneticinizle iletişime geçin.',
  EMPLOYEE_NOT_FOUND: 'Bu e-posta adresiyle kayıtlı çalışan bulunamadı.',
  INVALID_EMAIL: 'Geçerli bir e-posta adresi girin.',
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
  /** Kod kutularında etkin kutu vurgusu için */
  const [otpFocused, setOtpFocused] = useState(false)
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
      setPartial({ error: 'Geçerli bir e-posta adresi girin.' })
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
          ? 'Geliştirme modu etkin. Giriş kodunuzu girin.'
          : 'Bu adres kayıtlı bir çalışana aitse giriş kodu gönderildi.',
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
      setPartial({ error: 'Kodu eksiksiz girin.' })
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
  const isEmail = state.step === 'email'
  const otpInvalid = !isEmail && !!state.error
  const activeSlot = Math.min(state.otp.length, OTP_LENGTH - 1)

  return (
    <div
      className={cn(
        'relative flex min-h-dvh flex-col items-center justify-center bg-muted/40 p-6 md:p-10',
        // Kabuksuz sayfa: iOS çentik / ana ekran çubuğu için güvenli alan kendi dolgumuzda
        'pt-[max(1.5rem,var(--app-top))] pb-[max(1.5rem,var(--safe-bottom))]'
      )}
    >
      <ThemeSwitch className="absolute top-[max(1rem,var(--app-top))] right-4" />
      <div className="flex w-full max-w-sm flex-col gap-6">
        {/* Marka */}
        <div className="flex items-center justify-center gap-2.5">
          <BrandMark size={32} />
          <span className="text-lg font-semibold tracking-tight">ShiftUp</span>
          {isDevMode && (
            <Badge tone="warning">
              <Bug aria-hidden />
              Geliştirme
            </Badge>
          )}
        </div>

        <Card className="gap-6 shadow-xs">
          <CardHeader className="px-6 text-center">
            <CardTitle className="text-xl">
              <h1>{isEmail ? 'Hoş geldiniz' : 'Giriş kodunu girin'}</h1>
            </CardTitle>
            <CardDescription>
              {isEmail
                ? 'Devam etmek için iş e-posta adresinizi girin.'
                : isDevMode
                ? 'Geliştirme kodunu girin (varsayılan: 12345).'
                : 'E-posta adresinize gönderilen 6 haneli kodu girin.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6">
            {/* Adım 1: E-posta */}
            {isEmail && (
              <form onSubmit={handleEmailSubmit} noValidate>
                <FieldGroup className="gap-5">
                  {state.error && (
                    <Alert variant="destructive">
                      <CircleAlert />
                      <AlertTitle>Giriş yapılamadı</AlertTitle>
                      <AlertDescription>{state.error}</AlertDescription>
                    </Alert>
                  )}
                  <Field data-invalid={state.error ? true : undefined}>
                    <FieldLabel htmlFor="login-email">E-posta</FieldLabel>
                    <InputGroup className="h-11">
                      <InputGroupInput
                        id="login-email"
                        type="email"
                        value={state.email}
                        onChange={(e) => setPartial({ email: e.target.value, error: null })}
                        autoFocus
                        autoComplete="email"
                        placeholder="ad.soyad@ornek.com"
                        disabled={state.loading}
                        aria-invalid={state.error ? true : undefined}
                        className="text-base"
                      />
                      <InputGroupAddon><Mail /></InputGroupAddon>
                    </InputGroup>
                  </Field>
                  <Button type="submit" size="lg" className="h-11 w-full" disabled={state.loading}>
                    {state.loading && <Spinner />}
                    {state.loading ? 'Gönderiliyor…' : 'Devam et'}
                  </Button>
                </FieldGroup>
              </form>
            )}

            {/* Adım 2: Kod */}
            {!isEmail && (
              <form onSubmit={handleOtpSubmit} noValidate>
                <FieldGroup className="gap-5">
                  {state.error && (
                    <Alert variant="destructive">
                      <CircleAlert />
                      <AlertTitle>Kod doğrulanamadı</AlertTitle>
                      <AlertDescription>{state.error}</AlertDescription>
                    </Alert>
                  )}
                  {state.info && !state.error && (
                    <Alert role="status">
                      <MailCheck />
                      <AlertDescription className="text-foreground">{state.info}</AlertDescription>
                    </Alert>
                  )}

                  {/* E-posta + değiştir */}
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-3 text-sm">
                    <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{state.email}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={state.loading}
                      onClick={() => setPartial({ step: 'email', otp: '', error: null, info: null })}
                    >
                      Değiştir
                    </Button>
                  </div>

                  <Field data-invalid={otpInvalid || undefined}>
                    <FieldLabel htmlFor="login-otp">{isDevMode ? 'Geliştirme kodu' : 'Giriş kodu'}</FieldLabel>
                    {/*
                     * InputOTP benzeri görünüm: tek gerçek <input> (otomatik doldurma, yapıştırma, ekran
                     * okuyucu) kutuların üstünde saydam durur; kutular yalnızca girilen rakamları gösterir.
                     */}
                    <div className="relative">
                      <input
                        id="login-otp"
                        type="text"
                        inputMode="numeric"
                        value={state.otp}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                          setPartial({ otp: v, error: null })
                        }}
                        onFocus={() => setOtpFocused(true)}
                        onBlur={() => setOtpFocused(false)}
                        autoFocus
                        autoComplete="one-time-code"
                        maxLength={6}
                        disabled={state.loading}
                        aria-invalid={otpInvalid || undefined}
                        className="absolute inset-0 z-10 size-full cursor-text text-base opacity-0 disabled:cursor-not-allowed"
                      />
                      <div aria-hidden className="grid grid-cols-6 gap-2">
                        {Array.from({ length: OTP_LENGTH }, (_, i) => {
                          const char = state.otp[i]
                          const active = otpFocused && i === activeSlot
                          return (
                            <div
                              key={i}
                              className={cn(
                                'relative flex h-12 items-center justify-center rounded-md border border-input bg-background font-mono text-xl font-semibold text-foreground tabular-nums shadow-xs transition-[color,box-shadow]',
                                active && 'z-[1] border-ring ring-[3px] ring-ring/50',
                                otpInvalid && 'border-destructive',
                                state.loading && 'opacity-50'
                              )}
                            >
                              {char}
                              {active && !char && (
                                <span className="h-5 w-px animate-pulse bg-foreground" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    {!otpInvalid && (
                      <FieldDescription>
                        {isDevMode ? 'En az 4 haneli geliştirme kodu.' : 'Kod birkaç dakika geçerlidir. Gelen kutunuzu ve spam klasörünü kontrol edin.'}
                      </FieldDescription>
                    )}
                  </Field>

                  <Button type="submit" size="lg" className="h-11 w-full" disabled={state.loading}>
                    {state.loading && <Spinner />}
                    {state.loading ? 'Doğrulanıyor…' : 'Giriş yap'}
                  </Button>

                  {!isDevMode && (
                    <p className="text-center text-sm text-muted-foreground">
                      Kod gelmedi mi?{' '}
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0"
                        disabled={state.loading || cooldown > 0}
                        onClick={() => handleEmailSubmit()}
                      >
                        {cooldown > 0 ? `Tekrar gönder (${cooldown} sn)` : 'Tekrar gönder'}
                      </Button>
                    </p>
                  )}
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="px-6 text-center text-xs text-muted-foreground">
          Giriş sorunu yaşıyorsanız mağaza yöneticinize başvurun.
        </p>
      </div>
    </div>
  )
}
