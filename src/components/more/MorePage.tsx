'use client'

/**
 * MorePage — mobil "Daha fazla" sekmesi: profil kartı (Item), alt barda olmayan erişilebilir
 * sayfalar (gruplu ItemGroup), tema seçimi ve çıkış. Liste navItems'tan gelir; rol filtresi yan menüyle aynıdır.
 */
import Link from 'next/link'
import { ChevronRight, LogIn, LogOut } from 'lucide-react'

import { useAuth } from '@/context/AuthContext'
import { getMoreItems, groupNavItems } from '@/components/layout/navItems'
import { Page, PageHeader, PersonAvatar } from '@/components/common'
import { ThemeSelect } from '@/components/common/ThemeSwitch'
import { Button } from '@/components/ui/button'
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle,
} from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewportDiagnostics } from '@/components/pwa/ViewportDiagnostics'

export function MorePage() {
  const { employee, status, signOut } = useAuth()
  const roleName = employee?.roles?.access_level ?? null
  const groups = status === 'loading' ? [] : groupNavItems(getMoreItems(roleName))

  return (
    <Page size="narrow">
      <PageHeader title="Daha fazla" description="Diğer sayfalar ve hesabınız" className="max-md:hidden" />

      {/* Profil */}
      <Item variant="outline" className="bg-card shadow-xs">
        {status === 'loading' ? (
          <>
            <ItemMedia><Skeleton className="size-11 rounded-full" /></ItemMedia>
            <ItemContent className="gap-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3.5 w-1/3" />
            </ItemContent>
          </>
        ) : (
          <>
            <ItemMedia><PersonAvatar name={employee?.full_name ?? '?'} size={44} /></ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="w-full truncate text-base">{employee?.full_name ?? 'Giriş yapılmadı'}</ItemTitle>
              {employee?.roles?.name && <ItemDescription className="truncate">{employee.roles.name}</ItemDescription>}
            </ItemContent>
          </>
        )}
      </Item>

      {groups.map((g) => (
        <section key={g.group} aria-labelledby={`more-${g.group}`} className="flex flex-col gap-2">
          <h2 id={`more-${g.group}`} className="px-1 text-sm font-medium text-muted-foreground">
            {g.label}
          </h2>
          <ItemGroup className="overflow-hidden rounded-xl border bg-card shadow-xs">
            {g.items.map((item, i) => (
              <div key={item.href} role="listitem">
                {i > 0 && <ItemSeparator />}
                <Item asChild size="sm" className="min-h-14 rounded-none">
                  <Link href={item.href} prefetch={false} className="select-none">
                    <ItemMedia variant="icon" className="size-9 rounded-md bg-background text-muted-foreground">
                      {item.icon}
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{item.label}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </ItemActions>
                  </Link>
                </Item>
              </div>
            ))}
          </ItemGroup>
        </section>
      ))}

      <section aria-labelledby="more-theme" className="flex flex-col gap-2">
        <h2 id="more-theme" className="px-1 text-sm font-medium text-muted-foreground">
          Tema
        </h2>
        <ThemeSelect fullWidth />
      </section>

      {status === 'authenticated' && (
        <Button
          variant="outline"
          size="lg"
          className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void signOut()}
        >
          <LogOut />
          Çıkış yap
        </Button>
      )}
      {status === 'unauthenticated' && (
        <Button asChild size="lg" className="w-full">
          <a href="/login?next=%2Fmore">
            <LogIn />
            Giriş yap
          </a>
        </Button>
      )}

      {/* Yalnızca ana ekran uygulamasında: cihazdaki görünüm alanı ölçümleri (destek için) */}
      <ViewportDiagnostics />
    </Page>
  )
}
