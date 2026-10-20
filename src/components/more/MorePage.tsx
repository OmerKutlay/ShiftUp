'use client'

/**
 * MorePage — mobil "Daha fazla" sekmesi: profil özeti, alt barda olmayan erişilebilir
 * sayfalar (gruplu) ve çıkış. Liste navItems'tan gelir; rol filtresi yan menüyle aynıdır.
 */
import Link from 'next/link'
import { ChevronRight, LogIn, LogOut } from 'lucide-react'

import { useAuth } from '@/context/AuthContext'
import { getMoreItems, groupNavItems } from '@/components/layout/navItems'
import { PageHeader, PersonAvatar } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function MorePage() {
  const { employee, status, signOut } = useAuth()
  const roleName = employee?.roles?.access_level ?? null
  const groups = status === 'loading' ? [] : groupNavItems(getMoreItems(roleName))

  return (
    <div className="mx-auto w-full max-w-[640px] p-4 text-ink md:p-6">
      <PageHeader title="Daha fazla" />

      {/* Profil özeti */}
      <div className="mb-6 flex items-center gap-3 rounded-2xl border bg-card p-4">
        {status === 'loading' ? (
          <>
            <Skeleton className="size-12 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
          </>
        ) : (
          <>
            <PersonAvatar name={employee?.full_name ?? '?'} size={48} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{employee?.full_name ?? 'Giriş yapılmadı'}</p>
              {employee && (
                <Typography variant="body2" color="text.secondary" noWrap>
                  {employee.roles?.name}
                </Typography>
              )}
            </div>
          </>
        )}
      </div>

      {groups.map((g) => (
        <section key={g.group} aria-labelledby={`more-${g.group}`} className="mb-5">
          <h2 id={`more-${g.group}`} className="mb-1.5 px-1 text-xs font-semibold text-ink-secondary">
            {g.label}
          </h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {g.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors outline-none select-none hover:bg-muted/70 focus-visible:bg-muted"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand [&_svg]:size-[18px]">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.95rem] font-medium">{item.label}</span>
                  <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {status === 'authenticated' && (
        <Button
          variant="outline"
          className="mt-1 w-full text-danger hover:bg-danger-soft hover:text-danger"
          onClick={() => void signOut()}
        >
          <LogOut />
          Çıkış Yap
        </Button>
      )}
      {status === 'unauthenticated' && (
        <Button asChild className="mt-1 w-full">
          <a href="/login?next=%2Fmore">
            <LogIn />
            Giriş Yap
          </a>
        </Button>
      )}
    </div>
  )
}
