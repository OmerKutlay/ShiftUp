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
import { UNAUTHORIZED_EVENT, apiFetch, setRequestStoreId } from '@/lib/api/http'
import { STORE_BROADCAST_CHANNEL, STORE_CHANGED_EVENT } from '@/lib/storeHeader'
import type { StoreContextInfo } from '@/types/store'
import { ACCESS } from '@/lib/auth/roles'

// ─── Types ───────────────────────────────────────────────────

export interface AuthEmployee extends Employee {
  /** Sistem rolü; yetki kararları için roles.access_level kullanılır (ad yalnızca gösterim) */
  roles: Role | null
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

/** /api/auth/me yanıtından çözümlenen oturum */
interface MeSession {
  employee: AuthEmployee | null
  store: StoreContextInfo | null
}

interface AuthContextValue {
  status: AuthStatus
  employee: AuthEmployee | null
  /** Aktif mağaza bağlamı (admin: seçilen mağaza; diğerleri: ana mağaza); oturum yoksa null */
  store: StoreContextInfo | null
  sessionCheck: SessionCheck | null
  signOut: () => Promise<void>
  /** Employee bilgisini yeniden yükle */
  refreshEmployee: () => Promise<void>
  /**
   * Admin: aktif mağazayı değiştirir. Sunucu çerezi güncellenir, SWR önbelleğinin tamamı sıfırlanıp
   * yeniden doğrulanır (veriler yeni mağazaya göre gelir) ve sunucu bileşenleri tazelenir.
   * Hata olursa ApiError fırlatır.
   */
  switchStore: (storeId: string) => Promise<void>
}

/** Oturumsuz açılabilen sayfalar — oturum düştüğünde buralardan /login'e yönlendirilmez */
const PUBLIC_PAGES = ['/login', '/login/admin', '/offline', '/gizlilik']

/** /api/auth/me ağ hatası / 5xx'te (ör. Cloudflare soğuk başlangıç 503) ek deneme bekleme süreleri (ms) */
const ME_RETRY_DELAYS = [500, 1500]

// ─── Context ─────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  status: 'loading',
  employee: null,
  store: null,
  sessionCheck: null,
  signOut: async () => {},
  refreshEmployee: async () => {},
  switchStore: async () => {},
})

// ─── Provider ────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [employee, setEmployee] = useState<AuthEmployee | null>(null)
  const [store, setStore] = useState<StoreContextInfo | null>(null)
  const [sessionCheck, setSessionCheck] = useState<SessionCheck | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  const { mutate } = useSWRConfig()

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchSession = useCallback(async (): Promise<MeSession | null> => {
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
          const data = (await res.json()) as { employee: AuthEmployee | null; store?: StoreContextInfo | null }
          const emp = data.employee ?? null
          record(emp && emp.active ? 'authenticated' : 'signed-out')
          return { employee: emp, store: data.store ?? null }
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

  const applySession = useCallback((session: MeSession | null) => {
    const emp = session?.employee ?? null
    if (emp && emp.active) {
      setEmployee(emp)
      setStore(session?.store ?? null)
      setStatus('authenticated')
    } else {
      setEmployee(null)
      setStore(null)
      setStatus('unauthenticated')
    }
  }, [])

  // İlk yükleme — cookie session'dan employee'ı yükle
  useEffect(() => {
    fetchSession().then((session) => {
      if (!mountedRef.current) return
      applySession(session)
    })
  }, [fetchSession, applySession])

  const signOut = useCallback(async () => {
    // Admin kendi giriş sayfasına döner (admin normal girişi kullanamaz)
    const loginPage = employee?.roles?.access_level === ACCESS.ADMIN ? '/login/admin' : '/login'
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
      setStore(null)
      setStatus('unauthenticated')
    }
    router.replace(loginPage)
    router.refresh()
  }, [employee, mutate, router])

  const refreshEmployee = useCallback(async () => {
    const session = await fetchSession()
    if (!mountedRef.current) return
    applySession(session)
  }, [fetchSession, applySession])

  /** Yeni mağaza bağlamını al, eski mağazanın verisini önbellekten at, mounted hook'ları yeniden doğrula */
  const reloadStoreContext = useCallback(async () => {
    await refreshEmployee()
    await mutate(() => true, undefined, { revalidate: false })
    await mutate(() => true)
    router.refresh()
  }, [mutate, refreshEmployee, router])

  const switchStore = useCallback(async (storeId: string) => {
    await apiFetch('/api/stores/active', { method: 'POST', body: { store_id: storeId } })
    await reloadStoreContext()
    // Aynı tarayıcıdaki diğer sekmeler de yeni mağazaya geçsin (çerez ortaktır)
    try {
      const channel = new BroadcastChannel(STORE_BROADCAST_CHANNEL)
      channel.postMessage({ storeId })
      channel.close()
    } catch { /* BroadcastChannel yok — diğer sekme ilk yazmada 409 STORE_CHANGED ile yenilenir */ }
  }, [reloadStoreContext])

  // Yazma istekleri sekmenin gösterdiği mağazayı taşır (sunucu farklıysa 409 STORE_CHANGED)
  useEffect(() => {
    setRequestStoreId(store?.active.id ?? null)
  }, [store])

  // Başka sekmede mağaza değişti (yayın) ya da bir yazma 409 STORE_CHANGED aldı → bağlamı yenile
  useEffect(() => {
    let pending = false
    const onStoreChanged = () => {
      if (pending) return
      pending = true
      void reloadStoreContext().finally(() => { pending = false })
    }
    window.addEventListener(STORE_CHANGED_EVENT, onStoreChanged)
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(STORE_BROADCAST_CHANNEL)
      channel.onmessage = onStoreChanged
    } catch { /* desteklenmiyor */ }
    return () => {
      window.removeEventListener(STORE_CHANGED_EVENT, onStoreChanged)
      channel?.close()
    }
  }, [reloadStoreContext])

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
    <AuthContext.Provider value={{ status, employee, store, sessionCheck, signOut, refreshEmployee, switchStore }}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────

export function useAuth() {
  return useContext(AuthContext)
}
