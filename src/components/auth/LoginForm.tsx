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
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  InputAdornment,
  Chip,
} from '@mui/material'
import EmailIcon from '@mui/icons-material/Email'
import LockIcon from '@mui/icons-material/Lock'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import BugReportIcon from '@mui/icons-material/BugReport'
import { C, tint } from '@/lib/palette'

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
      router.replace('/')
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
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: 400,
          bgcolor: tint(C.canvas, 0.98),
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
        }}
      >
        <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
          {/* Logo + dev badge */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="h5" fontWeight={800} color="primary.main" letterSpacing={1}>
              ShiftUp
            </Typography>
            {isDevMode && (
              <Chip
                icon={<BugReportIcon sx={{ fontSize: '14px !important' }} />}
                label="DEV"
                size="small"
                color="warning"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.65rem' }}
              />
            )}
          </Box>

          <Typography variant="body2" color="text.secondary" mb={3}>
            {state.step === 'email'
              ? 'Email adresinizi girerek devam edin.'
              : isDevMode
              ? 'Development kodu girin (varsayılan: 12345).'
              : 'Email adresinize gönderilen 6 haneli kodu girin.'}
          </Typography>

          {state.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {state.error}
            </Alert>
          )}
          {state.info && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {state.info}
            </Alert>
          )}

          {/* Adım 1: Email */}
          {state.step === 'email' && (
            <Box component="form" onSubmit={handleEmailSubmit} noValidate>
              <TextField
                label="Email"
                type="email"
                value={state.email}
                onChange={(e) => setPartial({ email: e.target.value, error: null })}
                fullWidth
                autoFocus
                autoComplete="email"
                disabled={state.loading}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <EmailIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{ mb: 2 }}
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={state.loading}
                sx={{ py: 1.25, fontWeight: 700 }}
              >
                {state.loading ? <CircularProgress size={20} color="inherit" /> : 'Devam Et'}
              </Button>
            </Box>
          )}

          {/* Adım 2: OTP */}
          {state.step === 'otp' && (
            <Box component="form" onSubmit={handleOtpSubmit} noValidate>
              <TextField
                label={isDevMode ? 'Development Kodu' : 'Giriş Kodu'}
                type="text"
                inputMode="numeric"
                value={state.otp}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setPartial({ otp: v, error: null })
                }}
                fullWidth
                autoFocus
                autoComplete="one-time-code"
                disabled={state.loading}
                inputProps={{
                  maxLength: 6,
                  style: { letterSpacing: 8, fontSize: '1.4rem' },
                }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{ mb: 2 }}
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={state.loading}
                sx={{ py: 1.25, fontWeight: 700, mb: 1.5 }}
              >
                {state.loading ? <CircularProgress size={20} color="inherit" /> : 'Giriş Yap'}
              </Button>
              {!isDevMode && (
                <Button
                  variant="text"
                  size="small"
                  fullWidth
                  disabled={state.loading || cooldown > 0}
                  onClick={() => handleEmailSubmit()}
                  sx={{ mb: 0.5 }}
                >
                  {cooldown > 0 ? `Kodu tekrar gönder (${cooldown} sn)` : 'Kodu tekrar gönder'}
                </Button>
              )}
              <Button
                startIcon={<ArrowBackIcon />}
                variant="text"
                size="small"
                fullWidth
                disabled={state.loading}
                onClick={() => setPartial({ step: 'email', otp: '', error: null, info: null })}
                sx={{ color: 'text.secondary' }}
              >
                Email adresini değiştir
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
