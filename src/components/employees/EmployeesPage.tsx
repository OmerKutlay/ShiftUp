'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Button,
  Stack,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import PeopleIcon from '@mui/icons-material/People'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import SearchIcon from '@mui/icons-material/Search'
import type { EmployeeWithRole, Role, CreateEmployeePayload, UpdateEmployeePayload } from '@/types/employee'
import {
  fetchEmployees,
  fetchRoles,
  createEmployee,
  updateEmployee,
} from '@/lib/employeeRepository'
import { EmployeeFormDialog } from './EmployeeFormDialog'
import { EmployeeStatusChip } from './EmployeeStatusChip'

type Filter = 'all' | 'active' | 'inactive'

export function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EmployeeWithRole | null>(null)
  const [saving, setSaving] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [emps, rls] = await Promise.all([fetchEmployees(), fetchRoles()])
      setEmployees(emps)
      setRoles(rls)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load() // eslint-disable-line react-hooks/set-state-in-effect
  }, [load])

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
      await load()
    } finally {
      setSaving(false)
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
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100vh', bgcolor: '#0f172a', color: 'text.primary' }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <PeopleIcon sx={{ fontSize: 18, color: 'primary.main' }} />
            <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
              Personel
            </Typography>
          </Box>
          <Typography variant="h5" fontWeight={800}>
            Çalışanlar
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {activeCount} aktif çalışan
          </Typography>
        </Box>

        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={openCreate}
          sx={{ fontWeight: 700 }}
        >
          Yeni Çalışan
        </Button>
      </Box>

      {/* Filters */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
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
          sx={{ minWidth: 240 }}
        />

        <ToggleButtonGroup
          value={filter}
          exclusive
          onChange={(_, v) => { if (v) setFilter(v as Filter) }}
          size="small"
        >
          <ToggleButton value="all">Tümü ({employees.length})</ToggleButton>
          <ToggleButton value="active">Aktif ({activeCount})</ToggleButton>
          <ToggleButton value="inactive">Pasif ({employees.length - activeCount})</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Divider sx={{ mb: 3, borderColor: 'rgba(255,255,255,0.08)' }} />

      {/* Content */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress color="primary" />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Alert severity="info">
          {search || filter !== 'all'
            ? 'Arama kriterlerine uyan çalışan bulunamadı.'
            : 'Henüz çalışan eklenmemiş.'}
        </Alert>
      )}

      {!loading && !error && filtered.length > 0 && (
        <Stack spacing={1}>
          {filtered.map((emp) => (
            <EmployeeCard key={emp.id} employee={emp} onEdit={openEdit} />
          ))}
        </Stack>
      )}

      {/* Form Dialog */}
      <EmployeeFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        employee={editTarget}
        roles={roles}
        loading={saving}
      />
    </Box>
  )
}

// ----------------------------------------------------------------
// Employee Card
// ----------------------------------------------------------------
function EmployeeCard({
  employee,
  onEdit,
}: {
  employee: EmployeeWithRole
  onEdit: (emp: EmployeeWithRole) => void
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
        gridTemplateColumns: { xs: '1fr auto', md: '1fr auto auto' },
        alignItems: 'center',
        gap: 2,
        '&:hover': { borderColor: 'primary.dark' },
        transition: 'border-color 0.2s, opacity 0.2s',
      }}
    >
      {/* Left: name + position + system role */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
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

        <Box>
          <Typography variant="subtitle2" fontWeight={700} color="text.primary">
            {employee.full_name}
          </Typography>
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
          </Box>
        </Box>
      </Box>

      {/* Center: status (desktop only) */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, justifyContent: 'flex-end' }}>
        <EmployeeStatusChip active={employee.active} />
      </Box>

      {/* Right: actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Mobile status */}
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
          <EmployeeStatusChip active={employee.active} />
        </Box>
        <Tooltip title="Düzenle">
          <IconButton
            size="small"
            onClick={() => onEdit(employee)}
            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  )
}
