'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Switch,
  Stack,
  CircularProgress,
  Alert,
  Box,
  Typography,
} from '@mui/material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import type { ShiftTemplate, CreateShiftTemplatePayload, UpdateShiftTemplatePayload } from '@/types/shiftTemplate'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (payload: CreateShiftTemplatePayload | UpdateShiftTemplatePayload) => Promise<void>
  template?: ShiftTemplate | null
  loading: boolean
}

interface FormState {
  name: string
  start_time: string
  end_time: string
  description: string
  active: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  start_time: '',
  end_time: '',
  description: '',
  active: true,
}

function toFormState(t: ShiftTemplate): FormState {
  return {
    name: t.name,
    start_time: t.start_time.slice(0, 5),   // 'HH:MM:SS' → 'HH:MM'
    end_time: t.end_time.slice(0, 5),
    description: t.description ?? '',
    active: t.active,
  }
}

function isValidTime(val: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(val)) return false
  const [h, m] = val.split(':').map(Number)
  return h >= 0 && h <= 23 && m >= 0 && m <= 59
}

export function ShiftTemplateFormDialog({ open, onClose, onSave, template, loading }: Props) {
  const isEdit = !!template
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(template ? toFormState(template) : EMPTY_FORM)
      setErrors({})
      setSubmitError(null)
    }
  }, [open, template])

  function validate(): boolean {
    const next: typeof errors = {}
    if (!form.name.trim()) next.name = 'Şablon adı zorunludur.'
    if (!form.start_time) {
      next.start_time = 'Başlangıç saati zorunludur.'
    } else if (!isValidTime(form.start_time)) {
      next.start_time = 'Geçerli bir saat girin (ÖR: 09:00).'
    }
    if (!form.end_time) {
      next.end_time = 'Bitiş saati zorunludur.'
    } else if (!isValidTime(form.end_time)) {
      next.end_time = 'Geçerli bir saat girin (ÖR: 18:00).'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleText =
    (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
      setErrors((err) => ({ ...err, [field]: undefined }))
    }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitError(null)
    try {
      await onSave({
        name: form.name.trim(),
        start_time: form.start_time,
        end_time: form.end_time,
        description: form.description.trim() || null,
        active: form.active,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.')
    }
  }

  // Süre hesapla (preview)
  const durationLabel = (() => {
    if (!isValidTime(form.start_time) || !isValidTime(form.end_time)) return null
    const [sh, sm] = form.start_time.split(':').map(Number)
    const [eh, em] = form.end_time.split(':').map(Number)
    let mins = (eh * 60 + em) - (sh * 60 + sm)
    if (mins <= 0) mins += 24 * 60  // gece yarısı geçen vardiyalar
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h} saat ${m} dakika` : `${h} saat`
  })()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {isEdit ? 'Şablonu Düzenle' : 'Yeni Vardiya Şablonu'}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {submitError && (
            <Alert severity="error" onClose={() => setSubmitError(null)}>
              {submitError}
            </Alert>
          )}

          <TextField
            label="Şablon Adı"
            placeholder="Açılış, Kapanış, Ortacı…"
            value={form.name}
            onChange={handleText('name')}
            error={!!errors.name}
            helperText={errors.name}
            fullWidth
            autoFocus
            inputProps={{ 'aria-label': 'Şablon Adı' }}
          />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Başlangıç"
              type="time"
              value={form.start_time}
              onChange={handleText('start_time')}
              error={!!errors.start_time}
              helperText={errors.start_time}
              fullWidth
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 300, 'aria-label': 'Başlangıç saati' }}
            />
            <TextField
              label="Bitiş"
              type="time"
              value={form.end_time}
              onChange={handleText('end_time')}
              error={!!errors.end_time}
              helperText={errors.end_time}
              fullWidth
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 300, 'aria-label': 'Bitiş saati' }}
            />
          </Box>

          {durationLabel && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                py: 0.75,
                bgcolor: 'rgba(20,184,166,0.08)',
                borderRadius: 1.5,
                border: '1px solid rgba(20,184,166,0.2)',
              }}
            >
              <AccessTimeIcon sx={{ fontSize: 14, color: 'primary.main' }} />
              <Typography variant="caption" color="primary.main" fontWeight={600}>
                {durationLabel}
              </Typography>
            </Box>
          )}

          <TextField
            label="Açıklama (opsiyonel)"
            value={form.description}
            onChange={handleText('description')}
            fullWidth
            multiline
            rows={2}
            inputProps={{ 'aria-label': 'Açıklama' }}
          />

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
