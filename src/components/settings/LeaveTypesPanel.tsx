'use client'

/**
 * LeaveTypesPanel — Ayarlar › İzin türleri (yalnızca Admin): şirket genelindeki izin türleri.
 *
 * Her tür bir puantaj koduna bağlıdır (Yİ, Rİ, Üİ, Mİ, RT); puantaj, bordro ve yıllık izin bakiyesi
 * bu koda göre işler. Kod tür eklendikten sonra değişmez; tür silinmez, pasife alınır (geçmiş kayıtlar
 * adıyla görünmeye devam eder). "Çalışan talep edebilir" kapalı türleri yalnızca yönetici planda atar.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { CircleAlert, MoreHorizontal, Plane, Plus, Power, PowerOff, SquarePen } from 'lucide-react'

import { LEAVE_BASE_TYPE_INFO, type LeaveBaseType, type LeaveTypeDefinition } from '@/types/leave'
import { createLeaveType, updateLeaveType, useLeaveTypes } from '@/lib/api/leaveTypes'
import { DataTable, StatusBadge, TableSkeleton, useConfirm, type ColumnDef } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** Yeni türde seçilebilen kodlar ("Ücretli izin (diğer)" eski kayıtlar içindir) */
const NEW_BASE_TYPES: LeaveBaseType[] = ['annual', 'sick', 'unpaid', 'personal', 'public_holiday']

function CodeBadge({ base }: { base: LeaveBaseType }) {
  const info = LEAVE_BASE_TYPE_INFO[base]
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant="outline" className="font-mono tabular-nums">{info.code}</Badge>
      <span className="text-sm text-muted-foreground">{info.label}</span>
    </span>
  )
}

function RowActions({ type, onRename, onToggle }: { type: LeaveTypeDefinition; onRename: () => void; onToggle: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground data-[state=open]:bg-muted"
          aria-label={`${type.name} işlemleri`}
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
        {type.active ? (
          <DropdownMenuItem variant="destructive" onClick={onToggle}>
            <PowerOff />
            Pasife al
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

function LeaveTypeDialog({ target, onClose, onSaved }: {
  target: LeaveTypeDefinition | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const editing = !!target
  const [name, setName] = useState(target?.name ?? '')
  const [base, setBase] = useState<LeaveBaseType>(target?.base_type ?? 'personal')
  const [requestable, setRequestable] = useState(target?.employee_requestable ?? true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setError('İzin türünün adını yazın.'); return }
    setSaving(true); setError(null)
    try {
      if (target) {
        await updateLeaveType(target.id, { name: trimmed })
        toast.success('İzin türü güncellendi')
      } else {
        await createLeaveType({ name: trimmed, base_type: base, employee_requestable: requestable })
        toast.success(`${trimmed} eklendi`)
      }
      await onSaved()
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
          <DialogTitle>{editing ? 'İzin türünü yeniden adlandır' : 'İzin türü ekle'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Yeni ad planda, izinlerde ve geçmiş kayıtlarda görünür. Puantaj kodu değişmez.'
              : 'Puantaj kodu, türün puantaj ve bordroda nasıl sayılacağını belirler; sonradan değiştirilemez.'}
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
              <FieldLabel htmlFor="leave-type-name">Ad</FieldLabel>
              <Input
                id="leave-type-name"
                placeholder="Örn: Doğum izni"
                value={name}
                maxLength={60}
                autoComplete="off"
                autoFocus
                onChange={(e) => setName(e.target.value)}
                aria-invalid={(!!error && !name.trim()) || undefined}
              />
              {!!error && !name.trim() && <FieldError>İzin türünün adını yazın.</FieldError>}
            </Field>
            {!editing && (
              <>
                <Field>
                  <FieldLabel htmlFor="leave-type-code">Puantaj kodu</FieldLabel>
                  <Select
                    value={base}
                    onValueChange={(v) => {
                      setBase(v as LeaveBaseType)
                      if (v === 'public_holiday') setRequestable(false)
                    }}
                  >
                    <SelectTrigger id="leave-type-code" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NEW_BASE_TYPES.map((b) => (
                        <SelectItem key={b} value={b}>
                          {LEAVE_BASE_TYPE_INFO[b].code} · {LEAVE_BASE_TYPE_INFO[b].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{LEAVE_BASE_TYPE_INFO[base].hint}</FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="leave-type-requestable"
                    checked={requestable}
                    onCheckedChange={(v) => setRequestable(v === true)}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="leave-type-requestable">Çalışan talep edebilir</FieldLabel>
                    <FieldDescription>Kapalıysa bu türü yalnızca yönetici planda atar.</FieldDescription>
                  </FieldContent>
                </Field>
              </>
            )}
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

export function LeaveTypesPanel() {
  const confirm = useConfirm()
  const { types, isLoading, error, mutate } = useLeaveTypes()
  const [dialog, setDialog] = useState<{ target: LeaveTypeDefinition | null } | null>(null)
  const activeCount = types.filter((t) => t.active).length

  const patch = async (t: LeaveTypeDefinition, p: Parameters<typeof updateLeaveType>[1], done: string) => {
    try {
      await updateLeaveType(t.id, p)
      toast.success(done)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'İşlem yapılamadı.')
    }
  }

  const toggle = async (t: LeaveTypeDefinition) => {
    if (t.active && !(await confirm({
      title: `${t.name} pasife alınsın mı?`,
      message: 'Pasif tür yeni izinlerde seçilemez; geçmiş kayıtlar bu adla görünmeye devam eder.',
      confirmText: 'Pasife al',
      tone: 'warning',
    }))) return
    await patch(t, { active: !t.active }, t.active ? `${t.name} pasife alındı` : `${t.name} etkinleştirildi`)
  }

  const requestableSwitch = (t: LeaveTypeDefinition) => (
    <Switch
      checked={t.employee_requestable}
      disabled={!t.active}
      aria-label={`${t.name}: çalışan talep edebilir`}
      onCheckedChange={(v) => void patch(t, { employee_requestable: v },
        v ? `${t.name} çalışan talebine açıldı` : `${t.name} yalnızca yönetici ataması`)}
    />
  )

  const columns: ColumnDef<LeaveTypeDefinition, unknown>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'İzin türü',
      enableSorting: false,
      cell: ({ row }) => (
        <span className={cn('font-medium', !row.original.active && 'text-muted-foreground')}>{row.original.name}</span>
      ),
    },
    {
      id: 'code',
      accessorKey: 'base_type',
      header: 'Puantaj kodu',
      enableSorting: false,
      cell: ({ row }) => <CodeBadge base={row.original.base_type} />,
    },
    {
      id: 'requestable',
      accessorKey: 'employee_requestable',
      header: 'Çalışan talep edebilir',
      enableSorting: false,
      cell: ({ row }) => requestableSwitch(row.original),
    },
    {
      id: 'status',
      accessorKey: 'active',
      header: 'Durum',
      enableSorting: false,
      cell: ({ row }) => row.original.active
        ? <StatusBadge tone="success" label="Aktif" />
        : <StatusBadge tone="neutral" label="Pasif" />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => (
        <RowActions
          type={row.original}
          onRename={() => setDialog({ target: row.original })}
          onToggle={() => void toggle(row.original)}
        />
      ),
    },
  ]

  const mobileItem = (t: LeaveTypeDefinition) => (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon"><Plane /></ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className={cn(!t.active && 'text-muted-foreground')}>
          {t.name}
          {!t.active && <Badge variant="secondary">Pasif</Badge>}
        </ItemTitle>
        <ItemDescription><CodeBadge base={t.base_type} /></ItemDescription>
      </ItemContent>
      <ItemActions className="gap-1">
        {requestableSwitch(t)}
        <RowActions type={t} onRename={() => setDialog({ target: t })} onToggle={() => void toggle(t)} />
      </ItemActions>
    </Item>
  )

  return (
    <Card className="gap-5 shadow-xs">
      <CardHeader className="px-4 max-sm:grid-cols-1! md:px-6">
        <CardTitle className="flex items-center gap-2">
          İzin türleri
          {!isLoading && <Badge variant="secondary" className="tabular-nums">{activeCount}</Badge>}
        </CardTitle>
        <CardDescription className="max-w-2xl">
          Planda ve izin taleplerinde seçilen türler. Puantaj kodu türün puantaj ve bordroda nasıl sayılacağını
          belirler. Tür silinmez, pasife alınır.
        </CardDescription>
        <CardAction className="max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:mt-2 max-sm:w-full max-sm:justify-self-stretch">
          <Button onClick={() => setDialog({ target: null })} className="max-sm:w-full">
            <Plus />
            Tür ekle
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-4 md:px-6">
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>İzin türleri yüklenemedi</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {isLoading && <TableSkeleton rows={5} columns={5} />}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            data={types}
            pageSize={0}
            getRowId={(t) => t.id}
            renderMobileItem={mobileItem}
          />
        )}
      </CardContent>

      {dialog && (
        <LeaveTypeDialog
          key={dialog.target?.id ?? 'new'}
          target={dialog.target}
          onClose={() => setDialog(null)}
          onSaved={async () => { setDialog(null); await mutate() }}
        />
      )}
    </Card>
  )
}
