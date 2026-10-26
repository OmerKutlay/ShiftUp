'use client'

/**
 * StoreSwitcher — aktif mağazayı gösterir; yalnızca Admin (store.can_switch) değiştirebilir.
 *
 *   variant="sidebar"  masaüstü yan menü başlığı: logo + "ShiftUp" + mağaza adı ("team switcher" kalıbı)
 *   variant="mobile"   mobil üst çubukta sayfa başlığının altındaki küçük mağaza adı
 *
 * Diğer roller yalnızca mağaza adını görür. Seçim sunucu çerezine yazılır; AuthContext.switchStore
 * SWR önbelleğini sıfırlar, böylece tüm sayfa yeni mağazanın verisiyle yenilenir.
 */
import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronsUpDown, Settings2, Store as StoreIcon } from 'lucide-react'

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import { BrandMark } from '@/components/common/BrandMark'
import { useAuth } from '@/context/AuthContext'
import { STORES_KEY, fetchStores } from '@/lib/api/stores'

/** Ayarlar › Mağazalar sekmesi */
export const MANAGE_STORES_HREF = '/settings?tab=stores'

/** Mağaza listesi + seçim — iki görünüm de aynı menüyü kullanır */
function StoreMenu({ side, align, className }: {
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  const { store, switchStore } = useAuth()
  const { data } = useSWR(STORES_KEY, fetchStores, { revalidateOnFocus: false })
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  const stores = (data?.stores ?? []).filter((s) => s.active)
  const activeId = store?.active.id

  const select = async (id: string, name: string) => {
    if (id === activeId || switchingId) return
    setSwitchingId(id)
    try {
      await switchStore(id)
      toast.success(`Aktif mağaza: ${name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mağaza değiştirilemedi.')
    } finally {
      setSwitchingId(null)
    }
  }

  return (
    <DropdownMenuContent className={className} side={side} align={align} sideOffset={4}>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Mağazalar</DropdownMenuLabel>
      <DropdownMenuGroup>
        {stores.length === 0 && (
          <DropdownMenuItem disabled>{data ? 'Aktif mağaza yok' : 'Yükleniyor…'}</DropdownMenuItem>
        )}
        {stores.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() => void select(s.id, s.name)}
            aria-current={s.id === activeId ? 'true' : undefined}
            className="gap-2"
          >
            <StoreIcon />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {switchingId === s.id
              ? <Spinner className="size-4" />
              : s.id === activeId && <Check className="size-4" aria-label="Aktif mağaza" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href={MANAGE_STORES_HREF} prefetch={false}>
          <Settings2 />
          Mağazaları yönet
        </Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

function MobileStoreSwitcher() {
  const { store } = useAuth()
  const name = store?.active.name
  if (!name) return null
  if (!store.can_switch) {
    return <p className="truncate text-xs leading-4 text-muted-foreground">{name}</p>
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Mağaza değiştir, aktif: ${name}`}
          className="-my-2 flex max-w-full items-center gap-1 py-2 text-xs leading-4 text-muted-foreground outline-none focus-visible:text-foreground data-[state=open]:text-foreground"
        >
          <span className="truncate">{name}</span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <StoreMenu side="bottom" align="start" className="min-w-56 max-w-[calc(100vw-2rem)]" />
    </DropdownMenu>
  )
}

function SidebarStoreSwitcher() {
  const { store, status } = useAuth()
  const { isMobile } = useSidebar()
  const name = store?.active.name
  const subtitle = name ?? (status === 'loading' ? '' : 'Vardiya yönetimi')
  const head = (
    <>
      <BrandMark size={32} />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">ShiftUp</span>
        <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {store?.can_switch ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                tooltip={`Mağaza: ${name}`}
                aria-label={`Mağaza değiştir, aktif: ${name}`}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                {head}
                <ChevronsUpDown className="ml-auto size-4" aria-hidden />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <StoreMenu
              side={isMobile ? 'bottom' : 'right'}
              align="start"
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            />
          </DropdownMenu>
        ) : (
          <SidebarMenuButton size="lg" asChild tooltip={name ?? 'ShiftUp'}>
            <Link href="/" prefetch={false}>{head}</Link>
          </SidebarMenuButton>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function StoreSwitcher({ variant }: { variant: 'sidebar' | 'mobile' }) {
  return variant === 'mobile' ? <MobileStoreSwitcher /> : <SidebarStoreSwitcher />
}
