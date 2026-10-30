import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'
import { AUTH_MODE } from '@/lib/authConfig'

export const metadata: Metadata = {
  title: 'Admin girişi',
  // Admin giriş adresi arama motorlarına düşmesin
  robots: { index: false, follow: false },
}

/** Admin hesaplarının tek giriş sayfası: admin şifresi → e-posta kodu (bkz. @/lib/auth/adminLogin) */
export default function AdminLoginPage() {
  return <LoginForm authMode={AUTH_MODE} variant="admin" />
}
