'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  CircularProgress,
  Alert,
  Typography,
  Box,
  SelectChangeEvent,
} from '@mui/material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { formatTime } from '@/types/shiftTemplate'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (templateId: string) => Promise<void>
  onDelete?: () => Promise<void>
  employee: EmployeeWithRole | null
  workDate: string        // 'YYYY-MM-DD'
  templates: ShiftTemplate[]
  existingAssignment?: ShiftAssignmentWithDetails | null
  loading: boolean
}

export function ShiftAssignDialog({
  open,
  onClose,
  onSave,
  onDelete,
  employee,
  workDate,
  templates,
  existingAssignment,
  loading,
}: Props) {
  const isEdit = !!existingAssignment
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTemplateId(existingAssignment?.shift_template_id ?? '')
      setSubmitError(null)
    }
  }, [open, existingAssignment])

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null

  const handleSave = async () => {
    if (!selectedTemplateId) {
      setSubmitError('Lütfen bir vardiya şablonu seçin.')
      return
    }
    setSubmitError(null)
    try {
      await onSave(selectedTemplateId)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.')
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setSubmitError(null)
    try {
      await onDelete()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Silme hatası.')
    }
  }

  // Tarih formatlama
  const dateLabel = workDate
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }).format(
        new Date(workDate + 'T00:00:00')
      )
    : ''

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {isEdit ? 'Vardiyayı Düzenle' : 'Vardiya Ata'}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {submitError && (
            <Alert severity="error" onClose={() => setSubmitError(null)}>
              {submitError}
            </Alert>
          )}

          {/* Çalışan + tarih bilgisi */}
          <Box
            sx={{
              p: 1.5,
              bgcolor: 'rgba(20,184,166,0.06)',
              borderRadius: 1.5,
              border: '1px solid rgba(20,184,166,0.15)',
            }}
          >
            <Typography variant="subtitle2" fontWeight={700} color="text.primary">
              {employee?.full_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {dateLabel}
            </Typography>
          </Box>

          {/* Template seçimi */}
          <FormControl fullWidth>
            <InputLabel id="template-select-label">Vardiya Şablonu</InputLabel>
            <Select
              labelId="template-select-label"
              value={selectedTemplateId}
              label="Vardiya Şablonu"
              onChange={(e: SelectChangeEvent<string>) =>
                setSelectedTemplateId(e.target.value)
              }
            >
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {t.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatTime(t.start_time)} – {formatTime(t.end_time)}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Seçilen template önizleme */}
          {selectedTemplate && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                py: 0.75,
                bgcolor: 'rgba(99,102,241,0.08)',
                borderRadius: 1.5,
                border: '1px solid rgba(99,102,241,0.2)',
              }}
            >
              <AccessTimeIcon sx={{ fontSize: 14, color: 'secondary.main' }} />
              <Typography variant="caption" color="secondary.main" fontWeight={600}>
                {formatTime(selectedTemplate.start_time)} – {formatTime(selectedTemplate.end_time)}
              </Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: 'space-between' }}>
        {isEdit && onDelete ? (
          <Button
            color="error"
            onClick={handleDelete}
            disabled={loading}
            size="small"
          >
            Kaldır
          </Button>
        ) : (
          <Box />
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={loading} color="inherit">
            İptal
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading}
            variant="contained"
            color="primary"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {isEdit ? 'Güncelle' : 'Ata'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
