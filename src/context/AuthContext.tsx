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
import { usePathname, useRouter } from 'next/navigation'
import { useSWRConfig } from 'swr'
import type { Employee, Role } from '@/types/employee'
import { runBeforeSignOut } from '@/lib/pwa/sessionEvents'
import { UNAUTHORIZED_EVENT } from '@/lib/api/http'

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

/**
 * Son /api/auth/me sorgusunun sonucu. 'unauthenticated' durumunu ikiye ayırır:
 *   - 'signed-out': sunucu oturumun olmadığını / hesabın pasif olduğunu söyledi (kesin)
 *   - 'unreachable': ağ hatası veya 5xx — oturumun durumu bilinmiyor (çevrimdışı olabilir)
 * Her sorguda yeni nesne üretilir; aynı sonuç tekrar gelse de efektler yeniden çalışır.
 */
export interface SessionCheck {
  result: 'authenticated' | 'signed-out' | 'unreachable'
  at: number
}

interface AuthContextValue {
  status: AuthStatus
  employee: AuthEmployee | null
  sessionCheck: SessionCheck | null
  signOut: () => Promise<void>
  /** Employee bilgisini yeniden yükle */
  refreshEmployee: () => Promise<void>
}

/** Oturumsuz açılabilen sayfalar — oturum düştüğünde buralardan /login'e yönlendirilmez */
const PUBLIC_PAGES = ['/login', '/offline']

/** /api/auth/me ağ hatası / 5xx'te (ör. Cloudflare soğuk başlangıç 503) ek deneme bekleme süreleri (ms) */
const ME_RETRY_DELAYS = [500, 1500]

// ─── Context ─────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  status: 'loading',
  employee: null,
  sessionCheck: null,
  signOut: async () => {},
  refreshEmployee: async () => {},
})

// ─── Provider ────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [employee, setEmployee] = useState<AuthEmployee | null>(null)
  const [sessionCheck, setSessionCheck] = useState<SessionCheck | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  const { mutate } = useSWRConfig()

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchEmployee = useCallback(async (): Promise<AuthEmployee | null> => {
    const record = (result: SessionCheck['result']) => {
      if (mountedRef.current) setSessionCheck({ result, at: Date.now() })
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
        if (res.status === 401 || res.status === 403) {
          record('signed-out')
          return null
        }
        if (res.ok) {
          const data = (await res.json()) as { employee: AuthEmployee | null }
          const emp = data.employee ?? null
          record(emp && emp.active ? 'authenticated' : 'signed-out')
          return emp
        }
      } catch { /* ağ hatası — aşağıda yeniden denenir */ }
      // Geçici sunucu hatası tek seferde "giriş yapılmadı" durumuna düşürmesin;
      // çevrimdışıyken beklemek anlamsız (çevrimdışı anlık görüntüler hemen gösterilmeli)
      const delay = ME_RETRY_DELAYS[attempt]
      if (delay === undefined || !navigator.onLine) {
        record('unreachable')
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
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
    // PWA temizliği (push aboneliği, çevrimdışı önbellek) — oturum hâlâ geçerliyken
    await runBeforeSignOut()
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

  // Herhangi bir API isteği 401 alırsa oturumu yeniden doğrula (süresi dolmuş / iptal edilmiş oturum)
  useEffect(() => {
    let pending = false
    const onUnauthorized = () => {
      if (pending) return
      pending = true
      void refreshEmployee().finally(() => { pending = false })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [refreshEmployee])

  // Sunucu oturumun olmadığını kesin söylediyse korumalı sayfada bırakma: giriş ekranına yönlendir.
  // Tam sayfa geçişi: middleware geçersiz çerezleri temizler, istemci durumu sıfırlanır.
  // 'unreachable' (çevrimdışı / geçici hata) yönlendirmez — çevrimdışı görüntüleme bozulmasın.
  useEffect(() => {
    if (sessionCheck?.result !== 'signed-out' || PUBLIC_PAGES.includes(pathname)) return
    void mutate(() => true, undefined, { revalidate: false })
    window.location.replace(`/login?next=${encodeURIComponent(pathname)}`)
  }, [sessionCheck, pathname, mutate])

  return (
    <AuthContext.Provider value={{ status, employee, sessionCheck, signOut, refreshEmployee }}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────

export function useAuth() {
  return useContext(AuthContext)
}
