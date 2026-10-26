'use client'

/**
 * StoresPanel — Ayarlar › Mağazalar (yalnızca Admin): mağaza listesi, ekleme, yeniden adlandırma,
 * pasife alma / yeniden etkinleştirme. Mağaza silinmez (geçmiş vardiya ve puantaj kayıtları ona bağlıdır).
 * Sunucu hataları (ör. aynı ad, aktif çalışanı olan mağazayı pasife alma) olduğu gibi gösterilir.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  CircleAlert, MoreHorizontal, Plus, Power, PowerOff, SquarePen, Store as StoreIcon, Users,
} from 'lucide-react'

import type { StoreWithStats } from '@/types/store'
import { STORES_KEY, createStore, fetchStores, updateStore } from '@/lib/api/stores'
import { useAuth } from '@/context/AuthContext'
import { DataTable, StatusBadge, TableSkeleton, useConfirm, type ColumnDef } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

// ─── Küçük parçalar ──────────────────────────────────────────

function ActiveBadge({ active }: { active: boolean }) {
  return active ? <StatusBadge tone="success" label="Aktif" /> : <StatusBadge tone="neutral" label="Pasif" />
}

function employeeCountLabel(n: number) {
  return `${n} aktif çalışan`
}

function RowActions({ store, isCurrent, onRename, onToggle }: {
  store: StoreWithStats
  /** Şu an çalışılan mağaza pasife alınamaz (oturum bağlamı bozulmasın) */
  isCurrent: boolean
  onRename: () => void
  onToggle: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground data-[state=open]:bg-muted"
          aria-label={`${store.name} işlemleri`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onRename}>
          <SquarePen />
          Yeniden adlandır
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {store.active ? (
          <DropdownMenuItem variant="destructive" disabled={isCurrent} onClick={onToggle}>
            <PowerOff />
            {isCurrent ? 'Pasife al (aktif mağaza)' : 'Pasife al'}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onToggle}>
            <Power />
            Yeniden etkinleştir
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Ekle / yeniden adlandır ─────────────────────────────────

function StoreNameDialog({ initialName, editing, onClose, onSave }: {
  initialName: string
  editing: boolean
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setError('Mağaza adı zorunludur.'); return }
    setSaving(true); setError(null)
    try {
      await onSave(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Mağazayı yeniden adlandır' : 'Mağaza ekle'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Yeni ad tüm ekranlarda ve raporlarda görünür.'
              : 'Yeni mağaza boş açılır; çalışanları Çalışanlar sayfasından ekleyebilir veya taşıyabilirsiniz.'}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => { e.preventDefault(); void submit() }} className="flex flex-col gap-6">
          <FieldGroup className="gap-5">
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field data-invalid={(!!error && !name.trim()) || undefined}>
              <FieldLabel htmlFor="store-name">Mağaza adı</FieldLabel>
              <Input
                id="store-name"
                placeholder="Örn: Kadıköy"
                value={name}
                maxLength={120}
                autoComplete="off"
                autoFocus
                onChange={(e) => setName(e.target.value)}
                aria-invalid={(!!error && !name.trim()) || undefined}
              />
              {!!error && !name.trim() && <FieldError>Mağazanın adını yazın.</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              {editing ? 'Kaydet' : 'Ekle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Panel ───────────────────────────────────────────────────

export function StoresPanel() {
  const confirm = useConfirm()
  const { store: current, refreshEmployee } = useAuth()
  const { data, error, mutate, isLoading } = useSWR(STORES_KEY, fetchStores)
  const [dialog, setDialog] = useState<{ target: StoreWithStats | null } | null>(null)

  const stores = data?.stores ?? []
  const activeCount = stores.filter((s) => s.active).length
  const currentId = current?.active.id ?? data?.active_store_id

  const save = async (name: string) => {
    const target = dialog?.target
    if (target) {
      await updateStore(target.id, { name })
      toast.success('Mağaza adı güncellendi')
      // Yan menüdeki aktif mağaza adı da değişmiş olabilir
      void refreshEmployee()
    } else {
      await createStore(name)
      toast.success(`${name} eklendi`)
    }
    setDialog(null)
    await mutate()
  }

  const toggle = async (s: StoreWithStats) => {
    if (s.active) {
      if (!(await confirm({
        title: `${s.name} pasife alınsın mı?`,
        message: 'Pasif mağaza listelerde görünmez ve seçilemez; geçmiş vardiya ve puantaj kayıtları korunur. Mağazada aktif çalışan varsa önce onları taşıyın veya pasifleştirin.',
        confirmText: 'Pasife al',
        tone: 'warning',
      }))) return
    } else if (!(await confirm({
      title: `${s.name} yeniden etkinleştirilsin mi?`,
      message: 'Mağaza tekrar seçilebilir hale gelir.',
      confirmText: 'Etkinleştir',
    }))) return
    try {
      await updateStore(s.id, { active: !s.active })
      toast.success(s.active ? `${s.name} pasife alındı` : `${s.name} etkinleştirildi`)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'İşlem yapılamadı.')
    }
  }

  const openNew = () => setDialog({ target: null })
  const openRename = (s: StoreWithStats) => setDialog({ target: s })

  const columns: ColumnDef<StoreWithStats, unknown>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Mağaza',
      sortingFn: (a, b) => a.original.name.localeCompare(b.original.name, 'tr'),
      cell: ({ row }) => {
        const s = row.original
        return (
          <span className={cn('inline-flex items-center gap-2 font-medium', !s.active && 'text-muted-foreground')}>
            {s.name}
            {s.id === currentId && <Badge variant="secondary">Şu an çalışılan</Badge>}
          </span>
        )
      },
    },
    {
      id: 'employees',
      accessorKey: 'employee_count',
      header: 'Çalışan',
      cell: ({ row }) => <span className="tabular-nums">{employeeCountLabel(row.original.employee_count)}</span>,
    },
    {
      id: 'status',
      accessorKey: 'active',
      header: 'Durum',
      cell: ({ row }) => <ActiveBadge active={row.original.active} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => (
        <RowActions
          store={row.original}
          isCurrent={row.original.id === currentId}
          onRename={() => openRename(row.original)}
          onToggle={() => void toggle(row.original)}
        />
      ),
    },
  ]

  const mobileItem = (s: StoreWithStats) => (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon"><StoreIcon /></ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className={cn(!s.active && 'text-muted-foreground')}>
          {s.name}
          {s.id === currentId && <Badge variant="secondary">Şu an çalışılan</Badge>}
        </ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Users className="size-3.5" aria-hidden />
          {employeeCountLabel(s.employee_count)}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="gap-1">
        <ActiveBadge active={s.active} />
        <RowActions
          store={s}
          isCurrent={s.id === currentId}
          onRename={() => openRename(s)}
          onToggle={() => void toggle(s)}
        />
      </ItemActions>
    </Item>
  )

  const empty = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><StoreIcon /></EmptyMedia>
        <EmptyTitle>Henüz mağaza yok</EmptyTitle>
        <EmptyDescription>İlk mağazayı ekleyin.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={openNew}>
          <Plus />
          Mağaza ekle
        </Button>
      </EmptyContent>
    </Empty>
  )

  return (
    <Card className="gap-5 shadow-xs">
      <CardHeader className="px-4 max-sm:grid-cols-1! md:px-6">
        <CardTitle className="flex items-center gap-2">
          Mağazalar
          {data && <Badge variant="secondary" className="tabular-nums">{activeCount}</Badge>}
        </CardTitle>
        <CardDescription className="max-w-2xl">
          Her mağazanın çalışanları, planı ve raporları ayrıdır. Mağazalar arasında yan menüden geçiş yapılır.
          Şu an çalışılan mağaza pasife alınamaz.
        </CardDescription>
        <CardAction className="max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:mt-2 max-sm:w-full max-sm:justify-self-stretch">
          <Button onClick={openNew} className="max-sm:w-full">
            <Plus />
            Mağaza ekle
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-4 md:px-6">
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Mağazalar yüklenemedi</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : 'Bilinmeyen hata'}</AlertDescription>
          </Alert>
        )}
        {isLoading && !data && <TableSkeleton rows={3} columns={4} />}
        {data && (
          <DataTable
            columns={columns}
            data={stores}
            pageSize={0}
            initialSorting={[{ id: 'name', desc: false }]}
            getRowId={(s) => s.id}
            renderMobileItem={mobileItem}
            empty={empty}
          />
        )}
      </CardContent>

      {dialog && (
        <StoreNameDialog
          key={dialog.target?.id ?? 'new'}
          initialName={dialog.target?.name ?? ''}
          editing={!!dialog.target}
          onClose={() => setDialog(null)}
          onSave={save}
        />
      )}
    </Card>
  )
}
