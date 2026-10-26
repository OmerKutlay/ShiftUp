'use client'

/**
 * AnnouncementDetailDialog — duyuru detayı (mobilde alttan açılan sayfa).
 * Alıcı: açılınca okundu işaretlenir; onay zorunluysa "Okudum, anladım" düğmesi.
 * Yönetici: okundu/onay istatistiği, okumayan / okuyanların adları, düzenle · hatırlat · sil.
 */
import { useEffect, useRef, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { BellRing, CheckCheck, Pencil, Pin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ANNOUNCEMENTS_KEY, ANNOUNCEMENTS_UNREAD_KEY, ackAnnouncement, announcementKey, deleteAnnouncement,
  markAnnouncementRead, remindAnnouncement, type AnnouncementDetailResponse,
} from '@/lib/api/announcements'
import type { Announcement } from '@/types/announcement'
import { AnnouncementBody } from './AnnouncementBody'
import { fmtDay, fmtWhen, statsLabel } from './announcementUi'

interface Props {
  id: string | null
  onClose: () => void
  onEdit: (a: Announcement) => void
}

export function AnnouncementDetailDialog({ id, onClose, onEdit }: Props) {
  const { mutate: globalMutate } = useSWRConfig()
  const confirm = useConfirm()
  const { data, error, isLoading, mutate } = useSWR<AnnouncementDetailResponse>(id ? announcementKey(id) : null)
  const [busy, setBusy] = useState<'ack' | 'remind' | 'delete' | null>(null)
  const readFor = useRef<string | null>(null)

  const a = data?.announcement
  const refreshLists = () => {
    void globalMutate((key) => typeof key === 'string' && key.startsWith(ANNOUNCEMENTS_KEY))
    void globalMutate(ANNOUNCEMENTS_UNREAD_KEY)
  }

  // Açılınca okundu işaretle (bir kez; sunucu da idempotent)
  useEffect(() => {
    if (!a || !a.is_recipient || a.read_at || readFor.current === a.id) return
    readFor.current = a.id
    markAnnouncementRead(a.id)
      .then(() => { void mutate(); refreshLists() })
      .catch(() => { readFor.current = null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.is_recipient, a?.read_at])

  const handleAck = async () => {
    if (!a) return
    setBusy('ack')
    try {
      await ackAnnouncement(a.id)
      toast.success('Teşekkürler, onayınız kaydedildi')
      await mutate(); refreshLists()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Onay kaydedilemedi')
    } finally { setBusy(null) }
  }

  const handleRemind = async () => {
    if (!a) return
    setBusy('remind')
    try {
      const res = await remindAnnouncement(a.id)
      toast.success(`${res.reminded} kişiye hatırlatma gönderildi`)
      await mutate(); refreshLists()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hatırlatma gönderilemedi')
    } finally { setBusy(null) }
  }

  const handleDelete = async () => {
    if (!a) return
    const ok = await confirm({
      title: 'Duyuru silinsin mi?',
      message: 'Duyuru herkesin listesinden kalkar. İşlem denetim kaydına yazılır.',
      confirmText: 'Sil', tone: 'error',
    })
    if (!ok) return
    setBusy('delete')
    try {
      await deleteAnnouncement(a.id)
      toast.success('Duyuru silindi')
      refreshLists(); onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Silinemedi')
    } finally { setBusy(null) }
  }

  const recipients = data?.recipients ?? []
  const pendingList = recipients.filter((r) => (a?.requires_ack ? !r.ack_at : !r.read_at))
  const doneList = recipients.filter((r) => (a?.requires_ack ? r.ack_at : r.read_at))
  const unreadCount = recipients.filter((r) => !r.read_at).length

  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6 text-left">
            {a?.pinned && <Pin className="mt-1 size-4 shrink-0 text-muted-foreground" aria-label="Sabit" />}
            <span className="min-w-0 break-words">{a?.title ?? 'Duyuru'}</span>
          </DialogTitle>
          <DialogDescription>
            {a ? (
              <>
                {a.author_name ?? 'Yönetim'} · {fmtWhen(a.created_at)}
                {a.store_id === null && ' · Tüm mağazalar'}
                {a.expires_at && ` · ${fmtDay(a.expires_at)} tarihine kadar`}
                {a.edited_at && ` · Düzenlendi · ${fmtWhen(a.edited_at)}`}
              </>
            ) : 'Yükleniyor'}
          </DialogDescription>
        </DialogHeader>

        {isLoading && <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>}
        {error && !a && <p className="text-sm text-destructive">Duyuru yüklenemedi.</p>}

        {a && (
          <>
            <AnnouncementBody text={a.body} className="text-sm leading-relaxed" />

            {a.is_recipient && a.requires_ack && (
              a.ack_at ? (
                <Badge tone="success" className="self-start">Onayladınız · {fmtWhen(a.ack_at)}</Badge>
              ) : (
                <Button onClick={() => void handleAck()} disabled={busy === 'ack'} className="w-full sm:w-auto">
                  {busy === 'ack' ? <Spinner /> : <CheckCheck />}
                  Okudum, anladım
                </Button>
              )
            )}

            {a.can_manage && a.stats && (
              <section className="flex flex-col gap-3 rounded-lg border p-3" aria-label="Okunma durumu">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium tabular-nums">{statsLabel(a)}</p>
                  {a.last_reminded_at && (
                    <span className="text-xs text-muted-foreground">Son hatırlatma {fmtWhen(a.last_reminded_at)}</span>
                  )}
                </div>
                <Tabs defaultValue="pending">
                  <TabsList className="w-full">
                    <TabsTrigger value="pending" className="flex-1">
                      {a.requires_ack ? 'Onaylamayanlar' : 'Okumayanlar'} ({pendingList.length})
                    </TabsTrigger>
                    <TabsTrigger value="done" className="flex-1">
                      {a.requires_ack ? 'Onaylayanlar' : 'Okuyanlar'} ({doneList.length})
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="pending">
                    <NameList items={pendingList} empty={a.requires_ack ? 'Herkes onayladı.' : 'Herkes okudu.'}
                      note={a.requires_ack ? (r) => (r.read_at ? 'okudu, onaylamadı' : 'okumadı') : undefined} />
                  </TabsContent>
                  <TabsContent value="done">
                    <NameList items={doneList} empty="Henüz kimse yok."
                      when={(r) => fmtWhen((a.requires_ack ? r.ack_at : r.read_at) as string)} />
                  </TabsContent>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  Alıcı listesi yayın anında sabitlenmiştir (sabit ya da onay zorunlu duyurulara sonradan katılanlar eklenir).
                  Düzenleme okundu kayıtlarını sıfırlamaz; onay zorunluysa başlık/metin değişince onaylar sıfırlanır.
                </p>
              </section>
            )}
          </>
        )}

        {a?.can_manage && (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" className="text-destructive hover:text-destructive"
              onClick={() => void handleDelete()} disabled={busy !== null}>
              {busy === 'delete' ? <Spinner /> : <Trash2 />}
              Sil
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => onEdit(a)} disabled={busy !== null}>
                <Pencil /> Düzenle
              </Button>
              <Button variant="outline" onClick={() => void handleRemind()}
                disabled={busy !== null || pendingList.length === 0}
                title={unreadCount === 0 && !a.requires_ack ? 'Herkes okudu' : 'Okumayanlara bildirim gönder (6 saatte bir)'}>
                {busy === 'remind' ? <Spinner /> : <BellRing />}
                Hatırlat
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function NameList({ items, empty, note, when }: {
  items: { employee_id: string; full_name: string; read_at: string | null; ack_at: string | null }[]
  empty: string
  note?: (r: { read_at: string | null; ack_at: string | null }) => string
  when?: (r: { read_at: string | null; ack_at: string | null }) => string
}) {
  if (items.length === 0) return <p className="py-3 text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="max-h-56 divide-y overflow-y-auto text-sm">
      {items.map((r) => (
        <li key={r.employee_id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 truncate">{r.full_name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{note?.(r) ?? when?.(r)}</span>
        </li>
      ))}
    </ul>
  )
}
