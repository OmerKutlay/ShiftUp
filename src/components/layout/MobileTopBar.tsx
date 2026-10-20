'use client'

/**
 * MobileTopBar — telefonda üst çubuk.
 *
 * iOS 26'da ana ekrandan açılan uygulama, durum çubuğunun rengini sayfanın en üstündeki
 * opak, tam genişlikte, `position: fixed` bir öğeden örnekler; uygun öğe yoksa üst kenara kendi
 * bulanıklığını çizer. Bu yüzden çubuk sabit, opak ve tam genişliktir (blur / saydamlık yok);
 * durum çubuğu alanını (safe-area) kendi zemini doldurur. Durum çubuğu opak olduğundan
 * --app-top 0'dır ve çubuk ekranın en üstüne oturur (bkz. layout.tsx'teki kenar şeridi).
 */
import { usePathname } from 'next/navigation'
import { LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/common/BrandMark'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useAuth } from '@/context/AuthContext'
import { pageMetaFor } from './navItems'

/** Çubuğun yüksekliği (safe-area hariç) */
export const MOBILE_TOP_BAR_HEIGHT = 56

export function MobileTopBar() {
  const pathname = usePathname()
  const { employee, status } = useAuth()
  const meta = pageMetaFor(pathname, status === 'loading' ? undefined : employee?.roles?.access_level ?? null)

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 border-b bg-background pt-(--app-top) pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] select-none"
    >
      <div className="flex items-center gap-3 px-4" style={{ height: MOBILE_TOP_BAR_HEIGHT }}>
        <BrandMark size={28} />
        <p className="min-w-0 flex-1 truncate text-base font-semibold">{meta.title}</p>
        {status === 'authenticated' && employee && <NotificationBell employeeId={employee.id} />}
        {status === 'unauthenticated' && (
          <Button asChild variant="ghost" size="icon">
            <a href={`/login?next=${encodeURIComponent(pathname)}`} aria-label="Giriş yap">
              <LogIn />
            </a>
          </Button>
        )}
      </div>
    </header>
  )
}
