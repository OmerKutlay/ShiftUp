'use client'

/**
 * AnnouncementsPage — Operasyon › Duyurular
 *
 * Çalışan: kendisine gelen duyurular (sabitler önce, sonra yeniden eskiye; okunmamış rozeti).
 * Yönetici: aynı liste + yayınladıkları için "Okundu 12/18 · Onay 9/18"; yeni duyuru, düzenle, sil, hatırlat.
 * Süresi dolanlar varsayılan listeden kalkar, "Arşiv" görünümünde durur.
 * ?id=<duyuru> adresi ilgili duyurunun detayını açar.
 */
import { Suspense, useEffect, useState } from 'react'
import useSWR from 'swr'
import { useRouter, useSearchParams } from 'next/navigation'
import { Megaphone, Pin, Plus, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ACCESS, hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { apiFetch } from '@/lib/api/http'
import { announcementsKey, archiveMoreKey, type AnnouncementsResponse } from '@/lib/api/announcements'
import { ListSkeleton, Page, PageHeader, SegmentedControl } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { previewText } from '@/lib/announcementText'
import type { Announcement } from '@/types/announcement'
import { AnnouncementDetailDialog } from './AnnouncementDetailDialog'
import { AnnouncementFormDialog } from './AnnouncementFormDialog'
import { fmtWhen, needsAttention, statsLabel } from './announcementUi'

/** ?id= değerini okuyup detayı açar (useSearchParams Suspense gerektirir) */
function IdFromUrl({ onId }: { onId: (id: string) => void }) {
  const id = useSearchParams().get('id')
  useEffect(() => { if (id) onId(id) }, [id, onId])
  return null
}

export function AnnouncementsPage() {
  const router = useRouter()
  const { employee, store } = useAuth()
  const level = employee?.roles?.access_level ?? null
  const isManager = hasRole(level, MANAGER_ROLES)
  const isAdmin = level === ACCESS.ADMIN

  const [view, setView] = useState<'active' | 'archive'>('active')
  const [openId, setOpenId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [formKey, setFormKey] = useState(0)

  const { data, error, isLoading, mutate } = useSWR<AnnouncementsResponse>(announcementsKey(view === 'archive'))
  // Arşivde sonraki sayfalar (before imleciyle) yerel olarak eklenir; görünüm/veri değişince sıfırlanır
  const [more, setMore] = useState<{ items: Announcement[]; cursor: string | null; for: unknown } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const extra = more && more.for === data ? more : null
  const items = [...(data?.announcements ?? []), ...(extra?.items ?? [])]
  const cursor = extra ? extra.cursor : (data?.next_before ?? null)
  const loadMore = async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await apiFetch<AnnouncementsResponse>(archiveMoreKey(cursor))
      setMore({ items: [...(extra?.items ?? []), ...page.announcements], cursor: page.next_before ?? null, for: data })
    } catch { /* sessiz: düğme yeniden denenebilir */ }
    finally { setLoadingMore(false) }
  }

  const openForm = (a: Announcement | null) => {
    setEditing(a); setFormKey((k) => k + 1); setFormOpen(true)
  }
  const closeDetail = () => {
    setOpenId(null)
    // ?id= kalırsa aynı duyuru yeniden açılır
    router.replace('/announcements')
  }

  return (
    <Page size="narrow">
      <Suspense fallback={null}><IdFromUrl onId={setOpenId} /></Suspense>

      <PageHeader
        title="Duyurular"
        description="Mağaza duyuruları ve okundu takibi"
        titleAdornment={data && (data.unread_count ?? 0) > 0 ? <Badge tone="brand">{data.unread_count} yeni</Badge> : undefined}
        actions={isManager ? (
          <Button onClick={() => openForm(null)}><Plus /> Yeni duyuru</Button>
        ) : undefined}
      />

      <SegmentedControl
        aria-label="Duyuru görünümü"
        value={view}
        onChange={setView}
        options={[{ value: 'active', label: 'Güncel' }, { value: 'archive', label: 'Arşiv' }]}
      />

      {isLoading && !data ? <ListSkeleton count={4} avatar={false} lines={3} /> : error && !data ? (
        <p className="text-sm text-destructive" role="alert">Duyurular yüklenemedi.</p>
      ) : items.length === 0 ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Megaphone /></EmptyMedia>
            <EmptyTitle>{view === 'archive' ? 'Arşivde duyuru yok' : 'Duyuru yok'}</EmptyTitle>
            <EmptyDescription>
              {view === 'archive' ? 'Süresi dolan duyurular burada görünür.' : 'Yeni duyurular burada ve bildirimlerinizde görünür.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {items.map((a) => (
            <AnnouncementRow key={a.id} a={a} onOpen={() => setOpenId(a.id)} />
          ))}
        </ItemGroup>
      )}

      {cursor && view === 'archive' && (
        <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore} className="self-center">
          Daha fazla göster
        </Button>
      )}

      <AnnouncementDetailDialog id={openId} onClose={closeDetail} onEdit={(a) => openForm(a)} />
      <AnnouncementFormDialog
        key={formKey}
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        canCompanyWide={isAdmin}
        storeName={store?.active.name ?? null}
        onSaved={() => { void mutate() }}
      />
    </Page>
  )
}

function AnnouncementRow({ a, onOpen }: { a: Announcement; onOpen: () => void }) {
  const unread = needsAttention(a)
  const stats = statsLabel(a)
  return (
    <Item variant="outline" asChild className="bg-card shadow-xs">
      <button type="button" onClick={onOpen} className="w-full text-left">
        <ItemContent className="min-w-0 gap-1">
          <ItemTitle className="w-full gap-2">
            {a.pinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="Sabit" />}
            <span className={`min-w-0 truncate ${unread ? 'font-semibold' : ''}`}>{a.title}</span>
            {a.is_recipient && !a.read_at && <Badge tone="brand" className="ml-auto shrink-0">Yeni</Badge>}
          </ItemTitle>
          <ItemDescription className="line-clamp-2">{previewText(a.body, 160)}</ItemDescription>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{a.author_name ?? 'Yönetim'} · {fmtWhen(a.created_at)}</span>
            {a.store_id === null && <Badge variant="outline">Tüm mağazalar</Badge>}
            {a.requires_ack && a.is_recipient && !a.ack_at && (
              <Badge tone="warning">Onay bekliyor</Badge>
            )}
            {a.requires_ack && a.ack_at && (
              <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" /> Onaylandı</span>
            )}
            {stats && <span className="tabular-nums">{stats}</span>}
          </div>
        </ItemContent>
      </button>
    </Item>
  )
}
