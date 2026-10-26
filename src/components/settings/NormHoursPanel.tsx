'use client'

/**
 * NormHoursPanel — Ayarlar › Norm saatleri (yalnızca Admin).
 *
 * Üst yönetim her ay mağaza başına bir norm saati bildirir; Admin burada girer. Girilmeyen ay için
 * çalışan sayısından hesaplanan tahmin kullanılır (kayıt edilmez). Kayıt, mağazanın müdür ve
 * yöneticilerine bildirim gönderir.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { CircleAlert, Gauge, RotateCcw, SquarePen } from 'lucide-react'

import { apiFetch } from '@/lib/api/http'
import {
  allStoreNormsKey, clearStoreNorm, setStoreNorm, type StoreNormListItem,
} from '@/lib/api/storeNorm'
import { formatHours, monthLabelTr } from '@/lib/storeNorm'
import { turkeyToday } from '@/lib/dateUtils'
import { PeriodStepper, StatusBadge, useConfirm } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

/** 'YYYY-MM-01' ± n ay */
function shiftMonth(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1))
  return d.toISOString().slice(0, 7) + '-01'
}

/** "1.240" / "1240,5" / "1240.5" → sayı (geçersizse NaN) */
function parseHours(v: string): number {
  const s = v.trim().replace(/\s/g, '')
  // Binlik noktası ("1.240") ile ondalık noktasını ("1240.5") ayır
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.')
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN
}

function EditDialog({ item, month, onClose, onSaved }: {
  item: StoreNormListItem
  month: string
  onClose: () => void
  onSaved: () => void
}) {
  const [hours, setHours] = useState(() => String(item.normHours).replace('.', ','))
  const [note, setNote] = useState(item.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const value = parseHours(hours)
    if (!Number.isFinite(value) || value <= 0) { setError('Geçerli bir saat girin (0’dan büyük).'); return }
    setSaving(true)
    try {
      await setStoreNorm({ month, normHours: value, note: note.trim() || undefined, storeId: item.storeId })
      toast.success('Norm saati kaydedildi', { description: `${item.storeName} · ${monthLabelTr(month)}` })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.storeName} · {monthLabelTr(month)}</DialogTitle>
          <DialogDescription>
            Üst yönetimin bu ay için bildirdiği norm saati. Kaydedince mağaza müdür ve yöneticilerine bildirim gider.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="norm-hours">Norm saati</FieldLabel>
            <Input
              id="norm-hours"
              inputMode="decimal"
              value={hours}
              onChange={(e) => { setHours(e.target.value); setError(null) }}
              aria-invalid={!!error}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Hesaplanan tahmin: {formatHours(item.defaultHours)} sa ({item.employeeCount} çalışan)
            </p>
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="norm-note">Not (isteğe bağlı)</FieldLabel>
            <Input id="norm-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Vazgeç</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Spinner />}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NormHoursPanel() {
  const confirm = useConfirm()
  const [month, setMonth] = useState(() => `${turkeyToday().slice(0, 7)}-01`)
  const [editing, setEditing] = useState<StoreNormListItem | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
    allStoreNormsKey(month),
    (url: string) => apiFetch<{ stores: StoreNormListItem[] }>(url),
  )

  const reset = async (item: StoreNormListItem) => {
    const ok = await confirm({
      title: 'Varsayılana dönülsün mü?',
      message: `${item.storeName} · ${monthLabelTr(month)} için girilen norm silinecek; hesaplanan tahmin (${formatHours(item.defaultHours)} sa) kullanılacak.`,
      confirmText: 'Varsayılana dön',
    })
    if (!ok) return
    try {
      await clearStoreNorm(month, item.storeId)
      toast.success('Varsayılan norma dönüldü')
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'İşlem başarısız.')
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Gauge className="size-5" /> Norm saatleri</CardTitle>
        <CardDescription>
          Her ay mağaza başına işgücü saat hakkı. Girilmezse çalışan sayısı × 45 saat üzerinden hesaplanır.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PeriodStepper
          label={monthLabelTr(month)}
          onPrev={() => setMonth(shiftMonth(month, -1))}
          onNext={() => setMonth(shiftMonth(month, 1))}
          prevLabel="Önceki ay"
          nextLabel="Sonraki ay"
          minLabelWidth={128}
        />

        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Norm saatleri yüklenemedi</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : 'Yükleme hatası.'}</AlertDescription>
          </Alert>
        )}
        {isLoading && <Skeleton className="h-24 w-full rounded-lg" />}

        <div className="flex flex-col gap-2">
          {(data?.stores ?? []).map((s) => (
            <Item key={s.storeId} variant="outline" size="sm" className="flex-wrap">
              <ItemContent className="min-w-0">
                <ItemTitle className="flex flex-wrap items-center gap-2">
                  <span className="truncate">{s.storeName}</span>
                  {s.source === 'set'
                    ? <StatusBadge tone="success" label="Girildi" />
                    : <StatusBadge tone="neutral" label="Tahmin" />}
                </ItemTitle>
                <ItemDescription className="tabular-nums">
                  Norm {formatHours(s.normHours)} sa · Planlanan {formatHours(s.plannedHours)} sa (%{s.percent})
                  {s.source === 'default' && ` · ${s.employeeCount} çalışan`}
                </ItemDescription>
                {s.note && <ItemDescription className="line-clamp-2">Not: {s.note}</ItemDescription>}
              </ItemContent>
              <ItemActions>
                <Button variant="outline" size="sm" onClick={() => setEditing(s)}>
                  <SquarePen />
                  {s.source === 'set' ? 'Düzenle' : 'Norm gir'}
                </Button>
                {s.source === 'set' && (
                  <Button variant="ghost" size="icon-sm" aria-label={`${s.storeName} normunu sil`} onClick={() => void reset(s)}>
                    <RotateCcw />
                  </Button>
                )}
              </ItemActions>
            </Item>
          ))}
        </div>
      </CardContent>

      {editing && (
        <EditDialog key={editing.storeId} item={editing} month={month} onClose={() => setEditing(null)} onSaved={() => void mutate()} />
      )}
    </Card>
  )
}
