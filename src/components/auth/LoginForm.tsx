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

type Step = 'email' | 'otp'

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
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
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
            data.reason === 'EMPLOYEE_INACTIVE'
              ? 'Bu hesap aktif değil. Yöneticinizle iletişime geçin.'
              : 'Bu email adresiyle kayıtlı çalışan bulunamadı.',
        })
        return
      }

      setPartial({
        loading: false,
        step: 'otp',
        info: isDevMode
          ? 'Development modu aktif. Giriş kodunuzu girin.'
          : `${email} adresine giriş kodu gönderildi.`,
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

    if (token.length < 4) {
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
        setPartial({ loading: false, error: 'Kod hatalı. Tekrar deneyin.' })
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
          bgcolor: 'rgba(15,23,42,0.98)',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
        }}
      >
        <CardContent sx={{ p: 4 }}>
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
              : 'Email adresinize gönderilen kodu girin.'}
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
