'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { EmployeeWithRole, CreateEmployeePayload, UpdateEmployeePayload } from '@/types/employee'
import {
  fetchEmployees,
  fetchRoles,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  deactivateEmployee,
} from '@/lib/api/employees'
import { EmployeeFormDialog } from './EmployeeFormDialog'
import { EmployeeStatusChip } from './EmployeeStatusChip'
import { PageHeader, ListSkeleton, PersonAvatar, SectionCard, SectionRow, SegmentedControl, StatusBadge } from '@/components/common'
import { ROLE_GROUPS, roleGroupOf } from '@/components/schedule/scheduleHelpers'
import { cn } from '@/lib/utils'
import { AlertCircle, Info, Loader2, PencilLine, Plus, Search, Trash2, TriangleAlert, UserX } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

type Filter = 'all' | 'active' | 'inactive'

export function EmployeesPage() {
  const employeesQ = useSWR('employees:all', fetchEmployees)
  const rolesQ = useSWR('roles', fetchRoles)
  const employees = employeesQ.data ?? []
  const roles = rolesQ.data ?? []
  const isFirstLoad = !employeesQ.data && !employeesQ.error
  const loadError = employeesQ.error ?? rolesQ.error
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Yükleme hatası.') : null

  // Edit/Create dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EmployeeWithRole | null>(null)
  const [saving, setSaving] = useState(false)

  // Delete confirmation dialog
  const [deleteTarget, setDeleteTarget] = useState<EmployeeWithRole | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<{ message: string; isFkViolation: boolean } | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const load = () => employeesQ.mutate()

  const openCreate = () => {
    setEditTarget(null)
    setDialogOpen(true)
  }

  const openEdit = (emp: EmployeeWithRole) => {
    setEditTarget(emp)
    setDialogOpen(true)
  }

  const openDelete = (emp: EmployeeWithRole) => {
    setDeleteError(null)
    setDeleteTarget(emp)
  }

  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
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
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteEmployee(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bir hata oluştu.'
      const isFk = (err as { code?: string }).code === 'FK_VIOLATION'
      setDeleteError({ message: msg, isFkViolation: isFk })
    } finally {
      setDeleting(false)
    }
  }

  const handleDeactivateInstead = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deactivateEmployee(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      setDeleteError({
        message: err instanceof Error ? err.message : 'Pasifleştirme başarısız.',
        isFkViolation: false,
      })
    } finally {
      setDeleting(false)
    }
  }

  // Filtered list
  const filtered = employees.filter((e) => {
    const matchSearch =
      search === '' ||
      e.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (e.roles?.name ?? '').toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all' ||
      (filter === 'active' && e.active) ||
      (filter === 'inactive' && !e.active)
    return matchSearch && matchFilter
  })

  const activeCount = employees.filter((e) => e.active).length

  return (
    <div className="p-4 text-ink md:p-6">
      <PageHeader
        title="Çalışanlar"
        subtitle={isFirstLoad ? <Skeleton className="h-4 w-28" /> : `${activeCount} aktif çalışan`}
        actions={
          <Button onClick={openCreate}>
            <Plus /> Yeni Çalışan
          </Button>
        }
      />

      {/* Filtreler */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-[260px]">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            type="search"
            aria-label="Çalışan ara"
            placeholder="İsim veya pozisyon ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <SegmentedControl<Filter>
          aria-label="Durum filtresi"
          value={filter}
          onChange={setFilter}
          fullWidth
          options={[
            { value: 'all', label: `Tümü (${employees.length})` },
            { value: 'active', label: `Aktif (${activeCount})` },
            { value: 'inactive', label: `Pasif (${employees.length - activeCount})` },
          ]}
        />
      </div>

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={6} actions={3} />}

      {error && (
        <Alert tone="danger" className="mb-4">
          <AlertCircle />
          <AlertDescription className="text-ink">{error}</AlertDescription>
        </Alert>
      )}

      {!isFirstLoad && !error && filtered.length === 0 && (
        <Alert tone="info">
          <Info />
          <AlertDescription className="text-ink">
            {search || filter !== 'all'
              ? 'Arama kriterlerine uyan çalışan bulunamadı.'
              : 'Henüz çalışan eklenmemiş.'}
          </AlertDescription>
        </Alert>
      )}

      {!isFirstLoad && !error && filtered.length > 0 && (
        <div className="flex flex-col gap-4">
          {ROLE_GROUPS.map((g) => {
            const list = filtered.filter((e) => roleGroupOf(e.roles) === g.key)
            if (list.length === 0) return null
            return (
              <SectionCard key={g.key} title={g.label} count={list.length}>
                {list.map((emp) => (
                  <EmployeeRow key={emp.id} employee={emp} onEdit={openEdit} onDelete={openDelete} />
                ))}
              </SectionCard>
            )
          })}
        </div>
      )}

      {/* Edit/Create Form Dialog */}
      <EmployeeFormDialog
        key={dialogOpen ? editTarget?.id ?? 'new' : 'closed'}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        employee={editTarget}
        roles={roles}
        loading={saving}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => { if (!next) closeDelete() }}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex-row items-start gap-3">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
              <TriangleAlert className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5 pt-1">
              <AlertDialogTitle>Çalışanı Sil</AlertDialogTitle>
              <AlertDialogDescription>
                <strong className="text-ink">{deleteTarget?.full_name}</strong> adlı çalışan kalıcı olarak silinecek.
                Bu işlem geri alınamaz.
              </AlertDialogDescription>
            </div>
          </AlertDialogHeader>

          {deleteError && (
            <Alert tone={deleteError.isFkViolation ? 'warning' : 'danger'}>
              {deleteError.isFkViolation ? <TriangleAlert /> : <AlertCircle />}
              <AlertDescription className="text-ink">{deleteError.message}</AlertDescription>
            </Alert>
          )}

          {deleteError?.isFkViolation && (
            <p className="text-sm text-ink-secondary">
              Bunun yerine çalışanı <strong className="text-ink">pasifleştirebilirsiniz</strong> — geçmiş kayıtlar korunur, yeni vardiyalara dahil edilmez.
            </p>
          )}

          <AlertDialogFooter>
            <Button type="button" variant="ghost" onClick={closeDelete} disabled={deleting}>
              İptal
            </Button>

            {deleteError?.isFkViolation ? (
              <Button type="button" onClick={handleDeactivateInstead} disabled={deleting}>
                {deleting ? <Loader2 className="animate-spin" /> : <UserX />}
                {deleting ? 'İşleniyor…' : 'Pasifleştir'}
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {deleting ? 'Siliniyor…' : 'Evet, Sil'}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ----------------------------------------------------------------
// Çalışan satırı
// ----------------------------------------------------------------
function EmployeeRow({
  employee,
  onEdit,
  onDelete,
}: {
  employee: EmployeeWithRole
  onEdit: (emp: EmployeeWithRole) => void
  onDelete: (emp: EmployeeWithRole) => void
}) {
  return (
    <SectionRow className={cn('flex-wrap sm:flex-nowrap', !employee.active && 'opacity-60')}>
      <PersonAvatar name={employee.full_name} size={38} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontSize="0.875rem" fontWeight={700} noWrap>{employee.full_name}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography fontSize="0.72rem" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>{employee.roles?.name}</Typography>
          {employee.email && (
            <Typography fontSize="0.72rem" color="text.disabled" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>
              · {employee.email}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {employee.employment_type === 'part_time' && <StatusBadge tone="plum" label="Yarı zamanlı" />}

        <EmployeeStatusChip active={employee.active} />
      </div>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onEdit(employee)}
              aria-label={`${employee.full_name} düzenle`}
              className="text-ink-secondary hover:text-primary"
            >
              <PencilLine />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Düzenle</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(employee)}
              aria-label={`${employee.full_name} sil`}
              className="text-ink-secondary hover:text-danger"
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sil</TooltipContent>
        </Tooltip>
      </div>
    </SectionRow>
  )
}
