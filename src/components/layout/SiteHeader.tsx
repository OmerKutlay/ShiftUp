'use client'

/**
 * SiteHeader — masaüstü içerik panelinin üst çubuğu: menü düğmesi · konum (breadcrumb) · tema · bildirimler.
 */
import { usePathname } from 'next/navigation'

import {
  Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { ThemeSwitch } from '@/components/common/ThemeSwitch'
import { useAuth } from '@/context/AuthContext'
import { pageMetaFor } from './navItems'

export function SiteHeader() {
  const pathname = usePathname()
  const { employee, status } = useAuth()
  const meta = pageMetaFor(pathname, status === 'loading' ? undefined : employee?.roles?.access_level ?? null)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" aria-label="Menüyü aç/kapat" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            {meta.group && (
              <>
                <BreadcrumbItem className="hidden lg:block">{meta.group}</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden lg:block" />
              </>
            )}
            <BreadcrumbItem>
              <BreadcrumbPage>{meta.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-1">
          <ThemeSwitch />
          {status === 'authenticated' && employee && <NotificationBell employeeId={employee.id} />}
        </div>
      </div>
    </header>
  )
}
