'use client'

/**
 * AuthContext — FAZ AUTH (Development Mode)
 *
 * Supabase Auth kullanmaz. /api/auth/me endpoint'i üzerinden
 * session durumunu okur; /api/auth/logout ile session'ı sonlandırır.
 *
 * AUTH_MODE=development → cookie tabanlı dev session
 * AUTH_MODE=production  → aynı /api/auth/me endpoint'i, Supabase Auth cookie
 *
 * Context değişmez — mod geçişi yalnızca API katmanında gerçekleşir.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useSWRConfig } from 'swr'
import type { Employee, Role } from '@/types/employee'

// ─── Types ───────────────────────────────────────────────────

export interface AuthEmployee extends Employee {
  roles: Role | null
  /** roles tablosundan gelen yapılandırılmış rol adı — authorization için kullan */
  role_name?: string | null
}

export type AuthStatus =
  | 'loading'         // İlk yükleme
  | 'authenticated'   // Session + aktif employee mevcut
  | 'unauthenticated' // Session yok

interface AuthContextValue {
  status: AuthStatus
  employee: AuthEmployee | null
  signOut: () => Promise<void>
  /** Employee bilgisini yeniden yükle */
  refreshEmployee: () => Promise<void>
}

// ─── Context ─────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  status: 'loading',
  employee: null,
  signOut: async () => {},
  refreshEmployee: async () => {},
})

// ─── Provider ────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [employee, setEmployee] = useState<AuthEmployee | null>(null)
  const router = useRouter()
  const { mutate } = useSWRConfig()

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchEmployee = useCallback(async (): Promise<AuthEmployee | null> => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
      if (!res.ok) return null
      const data = (await res.json()) as { employee: AuthEmployee | null }
      return data.employee ?? null
    } catch {
      return null
    }
  }, [])

  // İlk yükleme — cookie session'dan employee'ı yükle
  useEffect(() => {
    fetchEmployee().then((emp) => {
      if (!mountedRef.current) return
      if (emp && emp.active) {
        setEmployee(emp)
        setStatus('authenticated')
      } else {
        setEmployee(null)
        setStatus('unauthenticated')
      }
    })
  }, [fetchEmployee])

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch { /* sessiz hata */ }
    // Önbellekteki tüm veriyi temizle — aynı cihazda giriş yapan sonraki kullanıcı
    // önceki kullanıcının verisini görmesin
    await mutate(() => true, undefined, { revalidate: false })
    if (mountedRef.current) {
      setEmployee(null)
      setStatus('unauthenticated')
    }
    router.replace('/login')
    router.refresh()
  }, [mutate, router])

  const refreshEmployee = useCallback(async () => {
    const emp = await fetchEmployee()
    if (!mountedRef.current) return
    if (emp && emp.active) {
      setEmployee(emp)
      setStatus('authenticated')
    } else {
      setEmployee(null)
      setStatus('unauthenticated')
    }
  }, [fetchEmployee])

  return (
    <AuthContext.Provider value={{ status, employee, signOut, refreshEmployee }}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────

export function useAuth() {
  return useContext(AuthContext)
}
