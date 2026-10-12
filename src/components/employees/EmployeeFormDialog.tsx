'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, FormControl, InputLabel, Select, MenuItem,
  FormControlLabel, Switch, Stack, CircularProgress, Alert,
  SelectChangeEvent, InputAdornment, IconButton, Tooltip, Typography, Box,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import EmailIcon from '@mui/icons-material/Email'
import type { EmployeeWithRole, Role, CreateEmployeePayload, UpdateEmployeePayload, EmploymentType } from '@/types/employee'
import { EMPLOYMENT_TYPE_LABELS } from '@/types/employee'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (payload: CreateEmployeePayload | UpdateEmployeePayload) => Promise<void>
  employee?: EmployeeWithRole | null
  roles: Role[]
  loading: boolean
}

interface FormState {
  full_name: string
  email: string
  role: string
  role_id: string
  active: boolean
  employment_type: EmploymentType
}

const EMPTY_FORM: FormState = {
  full_name: '',
  email: '',
  role: '',
  role_id: '',
  active: true,
  employment_type: 'full_time',
}

function toFormState(emp: EmployeeWithRole): FormState {
  return {
    full_name: emp.full_name,
    email: emp.email ?? '',
    role: emp.role,
    role_id: emp.role_id ?? '',
    active: emp.active,
    employment_type: emp.employment_type ?? 'full_time',
  }
}

/**
 * İsimden email önerisi üretir.
 * "Ahmet Kaya" → "ahmet.kaya@shiftup.test"
 * Türkçe karakterleri normalize eder.
 */
function generateEmail(fullName: string): string {
  const normalized = fullName
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z\s]/g, '')   // yalnızca harf + boşluk
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('.')

  return normalized ? `${normalized}@shiftup.test` : ''
}

function isValidEmail(email: string): boolean {
  if (email === '') return true  // boş bırakılabilir
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
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

  // İsim değişince email henüz el ile girilmemişse otomatik güncelle
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setForm((f) => {
      const autoEmail = generateEmail(newName)
      // Mevcut email ya boşsa ya da önceki isimden türetilmişse güncelle
      const prevAuto = generateEmail(f.full_name)
      const shouldAutoUpdate = !isEdit && (f.email === '' || f.email === prevAuto)
      return { ...f, full_name: newName, email: shouldAutoUpdate ? autoEmail : f.email }
    })
    setErrors((err) => ({ ...err, full_name: undefined }))
  }, [isEdit])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, email: e.target.value }))
    setErrors((err) => ({ ...err, email: undefined }))
  }

  // Üret butonuna basılınca isimden email yeniden oluştur
  const regenerateEmail = () => {
    const generated = generateEmail(form.full_name)
    setForm((f) => ({ ...f, email: generated }))
    setErrors((err) => ({ ...err, email: undefined }))
  }

  const handleSelectChange = (e: SelectChangeEvent<string>) => {
    setForm((f) => ({ ...f, role_id: e.target.value }))
  }

  function validate(): boolean {
    const next: typeof errors = {}
    if (!form.full_name.trim()) next.full_name = 'Ad Soyad zorunludur.'
    if (!form.role.trim()) next.role = 'Pozisyon zorunludur.'
    if (form.email && !isValidEmail(form.email)) next.email = 'Geçerli bir email adresi girin.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitError(null)
    try {
      const payload = {
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        role: form.role.trim(),
        role_id: form.role_id || null,
        active: form.active,
        employment_type: form.employment_type,
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
            <Alert severity="error" onClose={() => setSubmitError(null)}>{submitError}</Alert>
          )}

          {/* Ad Soyad */}
          <TextField
            label="Ad Soyad"
            value={form.full_name}
            onChange={handleNameChange}
            error={!!errors.full_name}
            helperText={errors.full_name}
            fullWidth
            autoFocus
            inputProps={{ 'aria-label': 'Ad Soyad' }}
          />

          {/* Email */}
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={handleEmailChange}
            error={!!errors.email}
            helperText={
              errors.email ?? (
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography component="span" variant="caption" color="text.disabled">
                    Sisteme giriş için kullanılır.
                    {!isEdit && form.full_name && ' İsimden otomatik önerildi.'}
                  </Typography>
                </Box>
              )
            }
            fullWidth
            inputProps={{ 'aria-label': 'Email' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <EmailIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title="İsimden email üret">
                    <span>
                      <IconButton
                        size="small"
                        onClick={regenerateEmail}
                        disabled={!form.full_name.trim()}
                        sx={{ color: 'text.secondary' }}
                        aria-label="Email üret"
                      >
                        <AutorenewIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </InputAdornment>
              ),
            }}
          />

          {/* Pozisyon */}
          <TextField
            label="Pozisyon / Unvan"
            placeholder="Kasiyer, Reyon Görevlisi…"
            value={form.role}
            onChange={(e) => {
              setForm((f) => ({ ...f, role: e.target.value }))
              setErrors((err) => ({ ...err, role: undefined }))
            }}
            error={!!errors.role}
            helperText={errors.role ?? 'Çalışanın görev tanımı (serbest metin)'}
            fullWidth
            inputProps={{ 'aria-label': 'Pozisyon' }}
          />

          {/* Sistem Rolü */}
          <FormControl fullWidth>
            <InputLabel id="role-select-label">Sistem Rolü</InputLabel>
            <Select
              labelId="role-select-label"
              value={form.role_id}
              label="Sistem Rolü"
              onChange={handleSelectChange}
            >
              <MenuItem value=""><em>Seçilmedi</em></MenuItem>
              {roles.map((r) => (
                <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Çalışma Tipi */}
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={0.75}>
              Çalışma Tipi
            </Typography>
            <ToggleButtonGroup
              exclusive
              value={form.employment_type}
              onChange={(_, val: EmploymentType | null) => {
                if (val) setForm((f) => ({ ...f, employment_type: val }))
              }}
              size="small"
              fullWidth
            >
              {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((key) => (
                <ToggleButton
                  key={key}
                  value={key}
                  sx={{
                    fontSize: '0.8rem',
                    '&.Mui-selected': {
                      bgcolor: key === 'full_time' ? 'rgba(20,184,166,0.18)' : 'rgba(99,102,241,0.18)',
                      color: key === 'full_time' ? 'primary.main' : 'secondary.main',
                      '&:hover': {
                        bgcolor: key === 'full_time' ? 'rgba(20,184,166,0.28)' : 'rgba(99,102,241,0.28)',
                      },
                    },
                  }}
                >
                  {EMPLOYMENT_TYPE_LABELS[key]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {form.employment_type === 'part_time' && (
              <Typography variant="caption" color="text.disabled" display="block" mt={0.75}>
                Yarı zamanlı: haftada en fazla 4 gün ve 30 saat
              </Typography>
            )}
          </Box>

          {/* Aktif/Pasif — sadece düzenleme modunda */}
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
        <Button onClick={onClose} disabled={loading} color="inherit">İptal</Button>
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
