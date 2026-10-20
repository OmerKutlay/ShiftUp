'use client'

/**
 * AppSidebar — masaüstü yan menü (shadcn Sidebar, inset + ikona daralan).
 * Gezinme öğeleri navItems'tan gelir ve rol filtresinden geçer; gruplar NAV_GROUP_ORDER sırasıyla.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'

import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from '@/components/ui/sidebar'
import { BrandMark } from '@/components/common/BrandMark'
import { useAuth } from '@/context/AuthContext'
import { apiFetch } from '@/lib/api/http'
import { NAV_ITEMS, filterNavItems, groupNavItems, isNavActive } from './navItems'
import { NavUser } from './NavUser'

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { employee, status } = useAuth()
  const groups = status === 'loading' ? [] : groupNavItems(filterNavItems(NAV_ITEMS, employee?.roles?.access_level ?? null))

  // Alt başlık: aktif mağazanın adı (yoksa genel etiket)
  const { data: store } = useSWR(
    status === 'authenticated' ? '/api/store-location/name' : null,
    (url: string) => apiFetch<{ name: string | null }>(url),
    { revalidateOnFocus: false },
  )

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="ShiftUp">
              <Link href="/" prefetch={false}>
                <BrandMark size={32} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">ShiftUp</span>
                  <span className="truncate text-xs text-muted-foreground">{store?.name ?? 'Vardiya yönetimi'}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.group}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarMenu>
              {g.items.map((item) => {
                const active = isNavActive(pathname, item.href)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href} prefetch={false} aria-current={active ? 'page' : undefined}>
                        {item.icon}
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
