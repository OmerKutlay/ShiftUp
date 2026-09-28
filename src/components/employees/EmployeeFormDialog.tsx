'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Stack,
  CircularProgress,
  Alert,
  SelectChangeEvent,
} from '@mui/material'
import type { EmployeeWithRole, Role, CreateEmployeePayload, UpdateEmployeePayload } from '@/types/employee'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (payload: CreateEmployeePayload | UpdateEmployeePayload) => Promise<void>
  employee?: EmployeeWithRole | null   // null = yeni oluşturma modu
  roles: Role[]
  loading: boolean
}

interface FormState {
  full_name: string
  role: string       // pozisyon / unvan
  role_id: string
  active: boolean
}

const EMPTY_FORM: FormState = {
  full_name: '',
  role: '',
  role_id: '',
  active: true,
}

function toFormState(emp: EmployeeWithRole): FormState {
  return {
    full_name: emp.full_name,
    role: emp.role,
    role_id: emp.role_id ?? '',
    active: emp.active,
  }
}

export function EmployeeFormDialog({ open, onClose, onSave, employee, roles, loading }: Props) {
  const isEdit = !!employee
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(employee ? toFormState(employee) : EMPTY_FORM)
      setErrors({})
      setSubmitError(null)
    }
  }, [open, employee])

  function validate(): boolean {
    const next: typeof errors = {}
    if (!form.full_name.trim()) next.full_name = 'Ad Soyad zorunludur.'
    if (!form.role.trim()) next.role = 'Pozisyon zorunludur.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleTextChange = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    setErrors((err) => ({ ...err, [field]: undefined }))
  }

  const handleSelectChange = (e: SelectChangeEvent<string>) => {
    setForm((f) => ({ ...f, role_id: e.target.value }))
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitError(null)
    try {
      const payload = {
        full_name: form.full_name.trim(),
        role: form.role.trim(),
        role_id: form.role_id || null,
        active: form.active,
      }
      await onSave(payload)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {isEdit ? 'Çalışanı Düzenle' : 'Yeni Çalışan Ekle'}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {submitError && (
            <Alert severity="error" onClose={() => setSubmitError(null)}>
              {submitError}
            </Alert>
          )}

          <TextField
            label="Ad Soyad"
            value={form.full_name}
            onChange={handleTextChange('full_name')}
            error={!!errors.full_name}
            helperText={errors.full_name}
            fullWidth
            autoFocus
            inputProps={{ 'aria-label': 'Ad Soyad' }}
          />

          <TextField
            label="Pozisyon / Unvan"
            placeholder="Kasiyer, Reyon Görevlisi…"
            value={form.role}
            onChange={handleTextChange('role')}
            error={!!errors.role}
            helperText={errors.role ?? 'Çalışanın görev tanımı (serbest metin)'}
            fullWidth
            inputProps={{ 'aria-label': 'Pozisyon' }}
          />

          <FormControl fullWidth>
            <InputLabel id="role-select-label">Sistem Rolü</InputLabel>
            <Select
              labelId="role-select-label"
              value={form.role_id}
              label="Sistem Rolü"
              onChange={handleSelectChange}
            >
              <MenuItem value="">
                <em>Seçilmedi</em>
              </MenuItem>
              {roles.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {isEdit && (
            <FormControlLabel
              control={
                <Switch
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  color="success"
                />
              }
              label={form.active ? 'Aktif' : 'Pasif'}
            />
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={loading} color="inherit">
          İptal
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={loading}
          variant="contained"
          color="primary"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {isEdit ? 'Kaydet' : 'Ekle'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
