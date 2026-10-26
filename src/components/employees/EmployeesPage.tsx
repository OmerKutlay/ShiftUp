'use client'

/**
 * EmployeesPage — Yönetim › Çalışanlar.
 *
 * DESIGN_GUIDE iskeleti: PageHeader (+ "Yeni çalışan") → KPI kartları → durum sekmesi + araç çubuğu
 * (arama, rol grubu, çalışma tipi) → DataTable (mobilde Item kartları) → satır menüsü (Düzenle / Sil)
 * → form Dialog + silme AlertDialog → sonuç toast.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  CalendarClock, FileSignature, MoreHorizontal, Plus, Search, SquarePen, Trash2, TriangleAlert, UserPlus,
  Users, UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'

import type { CreateEmployeePayload, EmployeeWithRole, EmploymentType, UpdateEmployeePayload } from '@/types/employee'
import { createEmployee, fetchEmployees, fetchRoles, updateEmployee } from '@/lib/api/employees'
import { STORES_KEY, fetchStores } from '@/lib/api/stores'
import { useAuth } from '@/context/AuthContext'
import { ACCESS_LABELS, isKioskRole } from '@/lib/auth/roles'
import { cn } from '@/lib/utils'
import { ROLE_GROUPS, compareRoles, roleGroupOf, type RoleGroupKey } from '@/components/schedule/scheduleHelpers'
import {
  DataTable, Page, PageHeader, PersonAvatar, SegmentedControl, StatCard, StatCards, StatusBadge, TableSkeleton,
  type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmployeeDeleteDialog } from './EmployeeDeleteDialog'
import { EmployeeFormDialog } from './EmployeeFormDialog'
import { EmployeeStatusChip } from './EmployeeStatusChip'
import { EMPLOYMENT_HINTS, EMPLOYMENT_LABELS, fmtDate, tenureLabel } from './format'

// ─── Filtreler ───────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'inactive'
type GroupFilter = 'all' | RoleGroupKey
type TypeFilter = 'all' | EmploymentType

const STATUS_LABELS: Record<StatusFilter, string> = { all: 'Tümü', active: 'Aktif', inactive: 'Pasif' }

const normalize = (s: string) => s.toLocaleLowerCase('tr-TR')

const matchesStatus = (e: EmployeeWithRole, f: StatusFilter) =>
  f === 'all' || (f === 'active' ? e.active : !e.active)

// ─── Küçük parçalar ──────────────────────────────────────────

function EmploymentBadge({ type }: { type: EmploymentType }) {
  // Olağan durum (tam zamanlı) sade metin, istisna (yarı zamanlı) renkli rozet
  return type === 'part_time'
    ? <StatusBadge tone="plum" label={EMPLOYMENT_LABELS.part_time} />
    : <span className="text-muted-foreground">{EMPLOYMENT_LABELS.full_time}</span>
}

function RowActions({ employee, onEdit, onDelete }: {
  employee: EmployeeWithRole
  onEdit: (e: EmployeeWithRole) => void
  onDelete: (e: EmployeeWithRole) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground data-[state=open]:bg-muted"
          aria-label={`${employee.full_name} işlemleri`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => onEdit(employee)}>
          <SquarePen />
          Düzenle
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(employee)}>
          <Trash2 />
          Sil
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Sayfa ───────────────────────────────────────────────────

export function EmployeesPage() {
  const employeesQ = useSWR('employees:all', fetchEmployees)
  const rolesQ = useSWR('roles', fetchRoles)
  // Yalnızca Admin: çalışanın mağazasını seçer / başka mağazaya taşır
  const { store: storeCtx } = useAuth()
  const canPickStore = !!storeCtx?.can_switch
  const storesQ = useSWR(canPickStore ? STORES_KEY : null, fetchStores)
  const employees = useMemo(() => employeesQ.data ?? [], [employeesQ.data])
  const roles = rolesQ.data ?? []
  const isFirstLoad = !employeesQ.data && !employeesQ.error
  const loadError = employeesQ.error ?? rolesQ.error
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Yükleme hatası.') : null

  // Oluştur / düzenle
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EmployeeWithRole | null>(null)
  const [saving, setSaving] = useState(false)
  // Silme onayı
  const [deleteTarget, setDeleteTarget] = useState<EmployeeWithRole | null>(null)

  // Filtreler
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [group, setGroup] = useState<GroupFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')

  const load = () => employeesQ.mutate()

  const openCreate = () => {
    setEditTarget(null)
    setDialogOpen(true)
  }

  const openEdit = (emp: EmployeeWithRole) => {
    setEditTarget(emp)
    setDialogOpen(true)
  }

  const handleSave = async (payload: CreateEmployeePayload | UpdateEmployeePayload) => {
    setSaving(true)
    try {
      if (editTarget) {
        await updateEmployee(editTarget.id, payload as UpdateEmployeePayload)
      } else {
        await createEmployee(payload as CreateEmployeePayload)
      }
      setDialogOpen(false)
      // Transfer sonrası çalışan bu mağazanın listesinden çıkar (load() ile yenilenir)
      const transferred = !!editTarget && !!payload.store_id && payload.store_id !== editTarget.store_id
      toast.success(
        transferred
          ? `${editTarget.full_name} taşındı`
          : editTarget ? 'Değişiklikler kaydedildi' : `${payload.full_name ?? 'Çalışan'} eklendi`
      )
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDone = async (result: 'deleted' | 'deactivated', emp: EmployeeWithRole) => {
    setDeleteTarget(null)
    toast.success(result === 'deleted' ? `${emp.full_name} silindi` : `${emp.full_name} pasifleştirildi`)
    await load()
  }

  // Arama + grup + tip filtresi (durum sekmesinden bağımsız; sekme sayaçları buna göre)
  const baseFiltered = useMemo(() => {
    const q = normalize(search.trim())
    return employees.filter((e) => {
      const matchSearch = !q
        || normalize(e.full_name).includes(q)
        || normalize(e.roles?.name ?? '').includes(q)
        || normalize(e.email ?? '').includes(q)
      const matchGroup = group === 'all' || roleGroupOf(e.roles) === group
      const matchType = type === 'all' || e.employment_type === type
      return matchSearch && matchGroup && matchType
    })
  }, [employees, search, group, type])
  const filtered = useMemo(() => baseFiltered.filter((e) => matchesStatus(e, status)), [baseFiltered, status])
  const statusCount = (f: StatusFilter) => baseFiltered.filter((e) => matchesStatus(e, f)).length

  const clearFilters = () => {
    setSearch('')
    setGroup('all')
    setType('all')
    setStatus('all')
  }

  // ── KPI ──
  const active = employees.filter((e) => e.active)
  const staff = active.filter((e) => !isKioskRole(e.roles?.access_level))
  const inactiveCount = employees.length - active.length
  const partTime = staff.filter((e) => e.employment_type === 'part_time').length
  const leadership = staff.filter((e) => roleGroupOf(e.roles) === 'yonetim').length
  const missingConsent = staff.filter((e) => !e.overtime_consent_at).length

  // ── Tablo sütunları ──
  const columns: ColumnDef<EmployeeWithRole, unknown>[] = [
    {
      id: 'employee',
      accessorKey: 'full_name',
      header: 'Çalışan',
      sortingFn: (a, b) => a.original.full_name.localeCompare(b.original.full_name, 'tr'),
      cell: ({ row }) => {
        const e = row.original
        return (
          <span className="flex min-w-0 items-center gap-3">
            <PersonAvatar name={e.full_name} size={32} className={cn(!e.active && 'opacity-60')} />
            <span className="flex min-w-0 flex-col">
              <span className={cn('truncate font-medium', !e.active && 'text-muted-foreground')}>{e.full_name}</span>
              <span className="truncate text-xs text-muted-foreground">{e.email ?? 'E-posta yok'}</span>
            </span>
          </span>
        )
      },
    },
    {
      id: 'role',
      accessorFn: (e) => e.roles?.name ?? '',
      header: 'Sistem rolü',
      sortingFn: (a, b) =>
        compareRoles(a.original.roles, b.original.roles) || a.original.full_name.localeCompare(b.original.full_name, 'tr'),
      cell: ({ row }) => {
        const r = row.original.roles
        if (!r) return <span className="text-muted-foreground">—</span>
        return (
          <span className="flex flex-col">
            <span>{r.name}</span>
            <span className="text-xs text-muted-foreground">{ACCESS_LABELS[r.access_level]} yetkisi</span>
          </span>
        )
      },
    },
    {
      id: 'type',
      accessorKey: 'employment_type',
      header: 'Çalışma tipi',
      cell: ({ row }) => <EmploymentBadge type={row.original.employment_type} />,
    },
    {
      id: 'hire',
      accessorFn: (e) => e.hire_date ?? '',
      header: 'İşe giriş',
      cell: ({ row }) => {
        const e = row.original
        const tenure = tenureLabel(e.hire_date)
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span className="tabular-nums">{fmtDate(e.hire_date)}</span>
            {tenure && <span className="text-xs text-muted-foreground">{tenure}</span>}
          </span>
        )
      },
    },
    {
      id: 'consent',
      accessorFn: (e) => e.overtime_consent_at ?? '',
      header: 'Fazla çalışma onayı',
      meta: { className: 'hidden @5xl/main:table-cell', headerClassName: 'hidden @5xl/main:table-cell' },
      cell: ({ row }) => {
        const e = row.original
        if (isKioskRole(e.roles?.access_level)) return <span className="text-muted-foreground">—</span>
        // Olağan durum sade tarih, istisna (onay yok) uyarı rozeti
        return e.overtime_consent_at
          ? <span className="whitespace-nowrap tabular-nums">{fmtDate(e.overtime_consent_at)}</span>
          : <StatusBadge tone="warning" label="Onay yok" />
      },
    },
    {
      id: 'status',
      accessorKey: 'active',
      header: 'Durum',
      cell: ({ row }) => <EmployeeStatusChip active={row.original.active} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => <RowActions employee={row.original} onEdit={openEdit} onDelete={setDeleteTarget} />,
    },
  ]

  // ── Mobil kart ──
  const mobileItem = (e: EmployeeWithRole) => (
    <Item variant="outline" size="sm">
      <ItemMedia><PersonAvatar name={e.full_name} size={36} className={cn(!e.active && 'opacity-60')} /></ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className={cn(!e.active && 'text-muted-foreground')}>{e.full_name}</ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{e.roles?.name ?? 'Rol yok'}</span>
          <span aria-hidden>·</span>
          <span>{EMPLOYMENT_LABELS[e.employment_type]}</span>
        </ItemDescription>
      </ItemContent>
      <ItemActions className="gap-1">
        {!e.active && <EmployeeStatusChip active={false} />}
        <RowActions employee={e} onEdit={openEdit} onDelete={setDeleteTarget} />
      </ItemActions>
    </Item>
  )

  const noEmployees = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Users /></EmptyMedia>
        <EmptyTitle>Henüz çalışan eklenmemiş</EmptyTitle>
        <EmptyDescription>Kadroyu oluşturmak için ilk çalışanı ekleyin; sistem rolü yetkiyi ve planlamadaki görevi belirler.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={openCreate}><UserPlus /> Çalışan ekle</Button>
      </EmptyContent>
    </Empty>
  )
  const noMatches = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Search /></EmptyMedia>
        <EmptyTitle>Eşleşen çalışan yok</EmptyTitle>
        <EmptyDescription>Arama metnini veya filtreleri değiştirin.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={clearFilters}>Filtreleri temizle</Button>
      </EmptyContent>
    </Empty>
  )

  const toolbar = (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <SegmentedControl<StatusFilter>
        aria-label="Durum filtresi"
        value={status}
        onChange={setStatus}
        options={(['all', 'active', 'inactive'] as StatusFilter[]).map((f) => ({
          value: f,
          label: (
            <>
              {STATUS_LABELS[f]}
              <Badge variant="secondary" className="tabular-nums">{statusCount(f)}</Badge>
            </>
          ),
        }))}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <InputGroup className="sm:w-64">
          <InputGroupInput
            placeholder="Ad, e-posta veya rol ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Çalışan ara"
          />
          <InputGroupAddon><Search /></InputGroupAddon>
        </InputGroup>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={group} onValueChange={(v) => setGroup(v as GroupFilter)}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Rol grubu"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm gruplar</SelectItem>
              {ROLE_GROUPS.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Çalışma tipi filtresi"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm tipler</SelectItem>
              <SelectItem value="full_time">{EMPLOYMENT_LABELS.full_time}</SelectItem>
              <SelectItem value="part_time">{EMPLOYMENT_LABELS.part_time}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )

  return (
    <Page>
      <PageHeader
        title="Çalışanlar"
        description="Mağaza kadrosu, sistem rolleri ve çalışma tipleri"
        actions={
          <Button onClick={openCreate} className="max-sm:w-full">
            <Plus />
            Yeni çalışan
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Çalışanlar yüklenemedi</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isFirstLoad ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
          <TableSkeleton rows={8} columns={6} />
        </>
      ) : employeesQ.data && (
        <>
          <StatCards>
            <StatCard
              icon={<Users />}
              label="Aktif çalışan"
              value={active.length}
              hint={inactiveCount > 0 ? `${employees.length} kayıt · ${inactiveCount} pasif` : `${employees.length} kayıt`}
            />
            <StatCard
              icon={<CalendarClock />}
              label="Yarı zamanlı"
              value={partTime}
              hint={EMPLOYMENT_HINTS.part_time}
            />
            <StatCard
              icon={<UsersRound />}
              label="Yönetim kadrosu"
              value={leadership}
              hint="Açılış ve kapanışı yönetebilenler"
            />
            <StatCard
              icon={<FileSignature />}
              label="Fazla çalışma onayı"
              value={`${staff.length - missingConsent}/${staff.length}`}
              footer={missingConsent > 0 && (
                <>
                  <TriangleAlert className="text-warning" />
                  {missingConsent} kişide onay yok
                </>
              )}
              hint={missingConsent > 0 ? undefined : 'Tüm aktif çalışanlarda var'}
            />
          </StatCards>

          <DataTable
            columns={columns}
            data={filtered}
            toolbar={employees.length > 0 ? toolbar : undefined}
            initialSorting={[{ id: 'role', desc: false }]}
            getRowId={(e) => e.id}
            renderMobileItem={mobileItem}
            empty={employees.length === 0 ? noEmployees : noMatches}
          />
        </>
      )}

      <EmployeeFormDialog
        key={dialogOpen ? editTarget?.id ?? 'new' : 'closed'}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        employee={editTarget}
        roles={roles}
        loading={saving}
        stores={canPickStore ? storesQ.data?.stores : undefined}
        defaultStoreId={storeCtx?.active.id}
      />

      <EmployeeDeleteDialog
        key={deleteTarget?.id ?? 'none'}
        employee={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDone={handleDeleteDone}
      />
    </Page>
  )
}
