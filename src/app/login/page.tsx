import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'
import { AUTH_MODE } from '@/lib/authConfig'

export const metadata: Metadata = {
  title: 'Giriş',
}

export default function LoginPage() {
  // Server Component — AUTH_MODE burada okunur, client'a prop olarak geçer
  return <LoginForm authMode={AUTH_MODE} />
}
