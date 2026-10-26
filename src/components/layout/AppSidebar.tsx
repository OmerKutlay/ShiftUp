'use client'

/**
 * AppSidebar — masaüstü yan menü (shadcn Sidebar, inset + ikona daralan).
 * Gezinme öğeleri navItems'tan gelir ve rol filtresinden geçer; gruplar NAV_GROUP_ORDER sırasıyla.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from '@/components/ui/sidebar'
import { StoreSwitcher } from '@/components/stores/StoreSwitcher'
import { useAuth } from '@/context/AuthContext'
import { useAnnouncementUnread } from '@/hooks/useAnnouncementUnread'
import { NAV_ITEMS, filterNavItems, groupNavItems, isNavActive } from './navItems'
import { NavUser } from './NavUser'

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { employee, status } = useAuth()
  const announcementsUnread = useAnnouncementUnread()
  const groups = status === 'loading' ? [] : groupNavItems(filterNavItems(NAV_ITEMS, employee?.roles?.access_level ?? null))

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        {/* Aktif mağaza: Admin için değiştirici, diğerleri için yalnızca ad */}
        <StoreSwitcher variant="sidebar" />
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
                    {item.href === '/announcements' && announcementsUnread > 0 && (
                      <SidebarMenuBadge aria-label={`${announcementsUnread} okunmamış duyuru`}>{announcementsUnread}</SidebarMenuBadge>
                    )}
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
