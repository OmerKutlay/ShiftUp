'use client'

/**
 * NavUser — yan menünün altındaki kullanıcı düğmesi; açılır menüde bildirimler, tema ve çıkış.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, ChevronsUpDown, LogIn, LogOut } from 'lucide-react'

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { PersonAvatar } from '@/components/common/PersonAvatar'
import { THEME_OPTIONS } from '@/components/common/ThemeSwitch'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/hooks/useTheme'
import type { ThemePreference } from '@/lib/theme'

export function NavUser() {
  const { isMobile } = useSidebar()
  const pathname = usePathname()
  const { employee, status, signOut } = useAuth()
  const { preference, setPreference } = useTheme()

  if (status === 'unauthenticated' || !employee) {
    if (status === 'loading') return null
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="Giriş yap">
            {/* Tam sayfa geçişi: middleware oturumu yeniden değerlendirir */}
            <a href={`/login?next=${encodeURIComponent(pathname)}`}>
              <LogIn />
              <span>Giriş yap</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  const role = employee.roles?.name ?? ''
  const who = (
    <>
      <PersonAvatar name={employee.full_name} size={32} className="rounded-lg" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{employee.full_name}</span>
        <span className="truncate text-xs text-muted-foreground">{role}</span>
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {who}
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5">{who}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href="/notifications" prefetch={false}>
                  <Bell />
                  Bildirimler
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Tema</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
              {THEME_OPTIONS.map((o) => (
                <DropdownMenuRadioItem key={o.value} value={o.value} onSelect={(e) => e.preventDefault()}>
                  {o.icon}
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut />
              Çıkış yap
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
