'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  Box,
  Typography,
  Button,
  Stack,
  Alert,
  Skeleton,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DeleteIcon from '@mui/icons-material/Delete'
import SearchIcon from '@mui/icons-material/Search'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
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
import { PageHeader, ListSkeleton, PersonAvatar, SectionCard, SectionRow, StatusBadge } from '@/components/common'
import { ROLE_GROUPS, roleGroupOf } from '@/components/schedule/scheduleHelpers'

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
      e.role.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all' ||
      (filter === 'active' && e.active) ||
      (filter === 'inactive' && !e.active)
    return matchSearch && matchFilter
  })

  const activeCount = employees.filter((e) => e.active).length

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: 'text.primary' }}>
      <PageHeader
        title="Çalışanlar"
        subtitle={isFirstLoad ? <Skeleton width={110} /> : `${activeCount} aktif çalışan`}
        actions={
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={openCreate}
          >
            Yeni Çalışan
          </Button>
        }
      />

      {/* Filters */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', flexDirection: { xs: 'column', sm: 'row' } }}>
        <TextField
          size="small"
          placeholder="İsim veya pozisyon ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              </InputAdornment>
            ),
          }}
          sx={{ minWidth: { xs: 'auto', sm: 240 }, width: { xs: '100%', sm: 'auto' } }}
        />

        <ToggleButtonGroup
          value={filter}
          exclusive
          onChange={(_, v) => { if (v) setFilter(v as Filter) }}
          size="small"
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          <ToggleButton value="all" sx={{ flex: { xs: 1, sm: 'none' } }}>Tümü ({employees.length})</ToggleButton>
          <ToggleButton value="active" sx={{ flex: { xs: 1, sm: 'none' } }}>Aktif ({activeCount})</ToggleButton>
          <ToggleButton value="inactive" sx={{ flex: { xs: 1, sm: 'none' } }}>Pasif ({employees.length - activeCount})</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={6} actions={3} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!isFirstLoad && !error && filtered.length === 0 && (
        <Alert severity="info">
          {search || filter !== 'all'
            ? 'Arama kriterlerine uyan çalışan bulunamadı.'
            : 'Henüz çalışan eklenmemiş.'}
        </Alert>
      )}

      {!isFirstLoad && !error && filtered.length > 0 && (
        <Stack spacing={2}>
          {ROLE_GROUPS.map((g) => {
            const list = filtered.filter((e) => roleGroupOf(e.role ?? '') === g.key)
            if (list.length === 0) return null
            return (
              <SectionCard key={g.key} title={g.label} count={list.length}>
                {list.map((emp) => (
                  <EmployeeRow key={emp.id} employee={emp} onEdit={openEdit} onDelete={openDelete} />
                ))}
              </SectionCard>
            )
          })}
        </Stack>
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
      <Dialog
        open={!!deleteTarget}
        onClose={closeDelete}
        maxWidth="xs"
        fullWidth
        aria-labelledby="delete-dialog-title"
      >
        <DialogTitle id="delete-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
          <WarningAmberIcon sx={{ color: 'error.main' }} />
          Çalışanı Sil
        </DialogTitle>
        <DialogContent>
          {deleteError ? (
            <Alert
              severity={deleteError.isFkViolation ? 'warning' : 'error'}
              sx={{ mb: deleteError.isFkViolation ? 2 : 0 }}
            >
              {deleteError.message}
            </Alert>
          ) : (
            <DialogContentText>
              <strong>{deleteTarget?.full_name}</strong> adlı çalışan kalıcı olarak silinecek.
              Bu işlem geri alınamaz.
            </DialogContentText>
          )}

          {deleteError?.isFkViolation && (
            <DialogContentText sx={{ mt: 1 }}>
              Bunun yerine çalışanı <strong>pasifleştirebilirsiniz</strong> — geçmiş kayıtlar korunur, yeni vardiyalara dahil edilmez.
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={closeDelete} disabled={deleting} color="inherit">
            İptal
          </Button>

          {deleteError?.isFkViolation ? (
            <Button
              variant="contained"
              color="warning"
              onClick={handleDeactivateInstead}
              disabled={deleting}
            >
              {deleting ? 'İşleniyor…' : 'Pasifleştir'}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? 'Siliniyor…' : 'Evet, Sil'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
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
    <SectionRow sx={{ opacity: employee.active ? 1 : 0.6, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
      <PersonAvatar name={employee.full_name} size={38} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontSize="0.875rem" fontWeight={700} noWrap>{employee.full_name}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography fontSize="0.72rem" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>{employee.role}</Typography>
          {employee.email && (
            <Typography fontSize="0.72rem" color="text.disabled" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>
              · {employee.email}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {employee.employment_type === 'part_time' && <StatusBadge tone="plum" label="Yarı zamanlı" />}
        {employee.roles && <StatusBadge tone="neutral" label={employee.roles.name} sx={{ display: { xs: 'none', md: 'inline-flex' } }} />}
        <EmployeeStatusChip active={employee.active} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Tooltip title="Düzenle">
          <IconButton
            size="small"
            onClick={() => onEdit(employee)}
            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
            aria-label={`${employee.full_name} düzenle`}
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Sil">
          <IconButton
            size="small"
            onClick={() => onDelete(employee)}
            sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
            aria-label={`${employee.full_name} sil`}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </SectionRow>
  )
}
