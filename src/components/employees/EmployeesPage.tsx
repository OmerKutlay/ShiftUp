'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Button,
  Stack,
  Paper,
  Chip,
  Alert,
  Skeleton,
  Divider,
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
import PeopleIcon from '@mui/icons-material/People'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import SearchIcon from '@mui/icons-material/Search'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { EmployeeWithRole, Role, CreateEmployeePayload, UpdateEmployeePayload } from '@/types/employee'
import {
  fetchEmployees,
  fetchRoles,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  deactivateEmployee,
} from '@/lib/employeeRepository'
import { EmployeeFormDialog } from './EmployeeFormDialog'
import { EmployeeStatusChip } from './EmployeeStatusChip'
import { PageHeader, ListSkeleton } from '@/components/common'
import { useLoadedKey } from '@/hooks/useLoadedKey'

type Filter = 'all' | 'active' | 'inactive'

export function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const { isFirstLoad, markLoaded } = useLoadedKey()
  const [error, setError] = useState<string | null>(null)

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

  const load = useCallback(async () => {
    setError(null)
    try {
      const [emps, rls] = await Promise.all([fetchEmployees(), fetchRoles()])
      setEmployees(emps)
      setRoles(rls)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası.')
    } finally {
      markLoaded()
    }
  }, [markLoaded])

  useEffect(() => {
    void load()
  }, [load])

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
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      <PageHeader
        icon={PeopleIcon}
        overline="Personel"
        title="Çalışanlar"
        subtitle={isFirstLoad ? <Skeleton width={110} /> : `${activeCount} aktif çalışan`}
        actions={
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={openCreate}
            sx={{ fontWeight: 700 }}
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

      <Divider sx={{ mb: 3, borderColor: 'rgba(255,255,255,0.08)' }} />

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
        <Stack spacing={1}>
          {filtered.map((emp) => (
            <EmployeeCard key={emp.id} employee={emp} onEdit={openEdit} onDelete={openDelete} />
          ))}
        </Stack>
      )}

      {/* Edit/Create Form Dialog */}
      <EmployeeFormDialog
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
// Employee Card
// ----------------------------------------------------------------
function EmployeeCard({
  employee,
  onEdit,
  onDelete,
}: {
  employee: EmployeeWithRole
  onEdit: (emp: EmployeeWithRole) => void
  onDelete: (emp: EmployeeWithRole) => void
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, md: 2 },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        opacity: employee.active ? 1 : 0.55,
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr) auto auto' },
        alignItems: 'center',
        gap: { xs: 1, md: 2 },
        '&:hover': { borderColor: 'primary.dark' },
        transition: 'border-color 0.2s, opacity 0.2s',
      }}
    >
      {/* Left: name + position + system role */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            bgcolor: 'rgba(20,184,166,0.12)',
            border: '2px solid rgba(20,184,166,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            color: 'primary.main',
            fontSize: '0.95rem',
            flexShrink: 0,
          }}
        >
          {employee.full_name.charAt(0)}
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700} color="text.primary" noWrap>
            {employee.full_name}
          </Typography>
          {employee.email && (
            <Typography variant="caption" color="text.disabled" fontSize="0.68rem" noWrap display="block">
              {employee.email}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 0.75, mt: 0.3, flexWrap: 'wrap' }}>
            <Chip
              label={employee.role}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.65rem',
                fontWeight: 600,
                bgcolor: 'rgba(99,102,241,0.12)',
                color: '#818cf8',
                border: '1px solid rgba(99,102,241,0.3)',
              }}
            />
            {employee.roles && (
              <Chip
                label={employee.roles.name}
                size="small"
                variant="outlined"
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: 500,
                  color: 'text.secondary',
                  borderColor: 'rgba(255,255,255,0.12)',
                }}
              />
            )}
            {/* Mobile status */}
            <Box sx={{ display: { xs: 'block', md: 'none' } }}>
              <EmployeeStatusChip active={employee.active} />
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Center: status (desktop only) */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, justifyContent: 'flex-end' }}>
        <EmployeeStatusChip active={employee.active} />
      </Box>

      {/* Right: actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title="Düzenle">
          <IconButton
            size="small"
            onClick={() => onEdit(employee)}
            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
            aria-label={`${employee.full_name} düzenle`}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Sil">
          <IconButton
            size="small"
            onClick={() => onDelete(employee)}
            sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
            aria-label={`${employee.full_name} sil`}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  )
}
