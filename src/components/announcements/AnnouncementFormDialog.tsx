'use client'

/**
 * AnnouncementFormDialog — yeni duyuru yayınla / mevcut duyuruyu düzenle.
 * Düzenlemede yalnızca başlık, metin, sabitleme ve bitiş değişir; hedef kitle ve onay zorunluluğu
 * yayın anında sabitlenir (okundu/onay kayıtları sıfırlanmaz, yeniden bildirim gitmez).
 */
import { useState } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { DateField, SegmentedControl } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from '@/lib/announcementText'
import { createAnnouncement, updateAnnouncement } from '@/lib/api/announcements'
import { turkeyDateString, turkeyToday } from '@/lib/dateUtils'
import type { Announcement, AnnouncementTarget } from '@/types/announcement'
import { endOfDayIso } from './announcementUi'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Verilirse düzenleme modu */
  editing?: Announcement | null
  /** Tüm mağazalara yayın seçeneği (yalnızca Admin) */
  canCompanyWide: boolean
  storeName?: string | null
  onSaved: () => void
}

export function AnnouncementFormDialog({ open, onOpenChange, editing, canCompanyWide, storeName, onSaved }: Props) {
  // İçerik her açılışta sıfırlanır: bileşen `key` ile yeniden kurulur (bkz. AnnouncementsPage)
  const [title, setTitle] = useState(editing?.title ?? '')
  const [body, setBody] = useState(editing?.body ?? '')
  const [pinned, setPinned] = useState(editing?.pinned ?? false)
  const [requiresAck, setRequiresAck] = useState(editing?.requires_ack ?? false)
  const [target, setTarget] = useState<AnnouncementTarget>(editing?.target_roles ?? 'all')
  const [scope, setScope] = useState<'store' | 'all'>('store')
  const [expiry, setExpiry] = useState(editing?.expires_at ? turkeyDateString(new Date(editing.expires_at)) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) { setError('Başlık ve metin zorunludur.'); return }
    setSaving(true); setError(null)
    try {
      const expires_at = expiry ? endOfDayIso(expiry) : null
      if (editing) {
        await updateAnnouncement(editing.id, { title, body, pinned, expires_at })
        toast.success('Duyuru güncellendi')
      } else {
        const res = await createAnnouncement({
          title, body, pinned, requires_ack: requiresAck, target_roles: target, expires_at,
          all_stores: canCompanyWide && scope === 'all',
        })
        toast.success(`Duyuru yayınlandı (${res.recipients} kişi)`)
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Duyuruyu düzenle' : 'Yeni duyuru'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Düzenleme okundu ve onay kayıtlarını sıfırlamaz, yeniden bildirim göndermez.'
              : 'Yayınlanınca alıcılara bildirim gider; alıcı listesi yayın anında sabitlenir.'}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-5">
          {!editing && canCompanyWide && (
            <Field>
              <FieldLabel>Mağaza</FieldLabel>
              <SegmentedControl
                aria-label="Hedef mağaza"
                value={scope}
                onChange={setScope}
                fullWidth
                options={[
                  { value: 'store', label: storeName ?? 'Bu mağaza' },
                  { value: 'all', label: 'Tüm mağazalar' },
                ]}
              />
            </Field>
          )}

          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="ann-title">Başlık</FieldLabel>
            <Input id="ann-title" value={title} maxLength={ANNOUNCEMENT_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)} placeholder="Örn: Yeni kasa prosedürü" />
          </Field>

          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="ann-body">Metin</FieldLabel>
            <Textarea id="ann-body" rows={6} value={body} maxLength={ANNOUNCEMENT_BODY_MAX}
              onChange={(e) => setBody(e.target.value)} placeholder="Duyuru metni…" />
            <FieldDescription>
              Düz metin; satır sonları korunur, bağlantılar otomatik tıklanabilir olur.
              {' '}{body.length}/{ANNOUNCEMENT_BODY_MAX}
            </FieldDescription>
          </Field>

          {!editing && (
            <Field>
              <FieldLabel>Kimler görsün</FieldLabel>
              <SegmentedControl
                aria-label="Hedef kitle"
                value={target}
                onChange={setTarget}
                fullWidth
                options={[{ value: 'all', label: 'Herkes' }, { value: 'managers', label: 'Yalnızca yöneticiler' }]}
              />
            </Field>
          )}

          <DateField label="Bitiş tarihi (isteğe bağlı)" value={expiry} onChange={setExpiry}
            min={turkeyToday()} clearable fullWidth
            helperText="Bu günün sonunda duyuru listeden kalkar, Arşiv'e geçer." />

          <div className="flex items-center justify-between gap-4">
            <FieldLabel htmlFor="ann-pinned" className="flex-1">Listenin başına sabitle</FieldLabel>
            <Switch id="ann-pinned" checked={pinned} onCheckedChange={setPinned} />
          </div>
          {!editing && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <FieldLabel htmlFor="ann-ack">&quot;Okudum, anladım&quot; onayı zorunlu</FieldLabel>
                <FieldDescription>Okuyanların onay verdiği ayrıca izlenir.</FieldDescription>
              </div>
              <Switch id="ann-ack" checked={requiresAck} onCheckedChange={setRequiresAck} />
            </div>
          )}

          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>İptal</Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? <Spinner /> : <Send />}
            {editing ? 'Kaydet' : 'Yayınla'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
