'use client'

import { useState, useCallback } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, FormControl, InputLabel, Select, MenuItem,
  Stack, CircularProgress, Alert, Typography, Box, Chip,
  ToggleButton, ToggleButtonGroup, TextField,
  SelectChangeEvent,
} from '@mui/material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import WeekendIcon from '@mui/icons-material/Weekend'
import ViewListIcon from '@mui/icons-material/ViewList'
import EditIcon from '@mui/icons-material/Edit'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import type { EmployeeAvailability } from '@/types/workforce'
import { formatTime } from '@/types/shiftTemplate'
import { shiftDurationMins } from '@/lib/workingTimeService'
import { C, tint } from '@/lib/palette'

/** Dialog'dan dışarıya çıkan birleşik payload */
export interface ShiftSavePayload {
  templateId: string | null   // şablon modunda dolu, özel saatte null
  startTime: string           // 'HH:MM'
  endTime: string             // 'HH:MM'
}

interface Props {
  open: boolean
  onClose: () => void
  onSave: (payload: ShiftSavePayload) => Promise<void>
  onDelete?: () => Promise<void>
  /** Haftalık tatil atama callback — sadece boş günde gösterilir */
  onAssignRestDay?: () => Promise<void>
  employee: EmployeeWithRole | null
  workDate: string
  templates: ShiftTemplate[]
  existingAssignment?: ShiftAssignmentWithDetails | null
  loading: boolean
  dayAvailability?: EmployeeAvailability[]
}

// ─── Availability badge ───────────────────────────────────────
function AvailabilityBadge({ records, shiftStart, shiftEnd }: {
  records: EmployeeAvailability[]
  shiftStart?: string
  shiftEnd?: string
}) {
  if (records.length === 0) return null
  const hasOff = records.some((r) => !r.is_available)

  if (hasOff) {
    return (
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75,
        bgcolor: tint(C.danger, 0.08), borderRadius: 1.5, border: `1px solid ${tint(C.danger, 0.25)}`,
      }}>
        <EventBusyIcon sx={{ fontSize: 14, color: 'error.main' }} />
        <Typography variant="caption" color="error.main" fontWeight={600}>
          Çalışan bu gün müsait değil (off day)
        </Typography>
      </Box>
    )
  }

  const windows = records.filter((r) => r.is_available)
  let inWindow: boolean | null = null
  if (shiftStart && shiftEnd && windows.length > 0) {
    const toMins = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m }
    const ss = toMins(shiftStart); const se = toMins(shiftEnd)
    inWindow = windows.some((w) => ss >= toMins(w.start_time) && se <= toMins(w.end_time))
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary" fontSize="0.7rem">Müsait:</Typography>
        {windows.map((w, i) => (
          <Chip key={i} size="small"
            label={`${w.start_time.slice(0, 5)}–${w.end_time.slice(0, 5)}`}
            sx={{ height: 18, fontSize: '0.65rem',
              bgcolor: tint(C.brand, 0.1), color: 'primary.main',
              border: `1px solid ${tint(C.brand, 0.25)}` }} />
        ))}
      </Box>
      {inWindow === true && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <CheckCircleOutlineIcon sx={{ fontSize: 13, color: C.success }} />
          <Typography variant="caption" color={C.success} fontSize="0.7rem">Müsaitlik penceresinde ✓</Typography>
        </Box>
      )}
      {inWindow === false && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <WarningAmberIcon sx={{ fontSize: 13, color: C.warning }} />
          <Typography variant="caption" color={C.warning} fontSize="0.7rem">
            Müsaitlik penceresi dışında — devam edebilirsiniz
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Saat doğrulama ───────────────────────────────────────────
function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t) && (() => {
    const [h, m] = t.split(':').map(Number)
    return h >= 0 && h <= 23 && m >= 0 && m <= 59
  })()
}

// ─── Ana bileşen ──────────────────────────────────────────────
export function ShiftAssignDialog({
  open, onClose, onSave, onDelete, onAssignRestDay,
  employee, workDate, templates, existingAssignment, loading,
  dayAvailability = [],
}: Props) {
  const isEdit = !!existingAssignment

  // Başlangıç değerleri mevcut atamadan gelir. Diyalog her hücre için ayrı `key` ile
  // açıldığından (bkz. WeeklySchedulePage) state yeniden başlatılır — effect ile senkron gerekmez.
  const existingTpl = existingAssignment?.shift_template_id ?? ''
  const [mode, setMode] = useState<'template' | 'custom'>(existingAssignment && !existingTpl ? 'custom' : 'template')
  const [selectedTemplateId, setSelectedTemplateId] = useState(existingTpl)
  const [customStart, setCustomStart] = useState(existingAssignment?.start_time.slice(0, 5) ?? '09:00')
  const [customEnd, setCustomEnd] = useState(existingAssignment?.end_time.slice(0, 5) ?? '17:00')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Şablon seçilince özel saat alanlarını da şablondan doldur (kolaylık)
  const handleTemplateChange = useCallback((e: SelectChangeEvent<string>) => {
    const id = e.target.value
    setSelectedTemplateId(id)
    const tpl = templates.find((t) => t.id === id)
    if (tpl) {
      setCustomStart(tpl.start_time.slice(0, 5))
      setCustomEnd(tpl.end_time.slice(0, 5))
    }
  }, [templates])

  // Aktif saat (önizleme ve availability kontrolü için)
  const activeStart = mode === 'template'
    ? (templates.find((t) => t.id === selectedTemplateId)?.start_time.slice(0, 5) ?? customStart)
    : customStart
  const activeEnd = mode === 'template'
    ? (templates.find((t) => t.id === selectedTemplateId)?.end_time.slice(0, 5) ?? customEnd)
    : customEnd

  const selectedTemplate = mode === 'template'
    ? (templates.find((t) => t.id === selectedTemplateId) ?? null)
    : null

  const durationMins = isValidTime(activeStart) && isValidTime(activeEnd)
    ? shiftDurationMins(activeStart, activeEnd)
    : 0
  const durationLabel = durationMins > 0
    ? `${Math.floor(durationMins / 60)}s${durationMins % 60 > 0 ? ` ${durationMins % 60}dk` : ''}`
    : null

  // Özel saatte bitiş < başlangıç (gece yarısını geçen)
  const isOvernight = isValidTime(activeStart) && isValidTime(activeEnd) && (() => {
    const [sh, sm] = activeStart.split(':').map(Number)
    const [eh, em] = activeEnd.split(':').map(Number)
    return eh * 60 + em <= sh * 60 + sm
  })()

  const handleSave = async () => {
    setSubmitError(null)

    if (mode === 'template') {
      if (!selectedTemplateId) {
        setSubmitError('Lütfen bir vardiya şablonu seçin.')
        return
      }
      const tpl = templates.find((t) => t.id === selectedTemplateId)
      if (!tpl) { setSubmitError('Şablon bulunamadı.'); return }
      try {
        await onSave({
          templateId: selectedTemplateId,
          startTime: tpl.start_time.slice(0, 5),
          endTime: tpl.end_time.slice(0, 5),
        })
      } catch (err) { setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.') }
      return
    }

    // Özel saat modu
    if (!isValidTime(customStart)) { setSubmitError('Geçerli bir başlangıç saati girin (SS:DD).'); return }
    if (!isValidTime(customEnd))   { setSubmitError('Geçerli bir bitiş saati girin (SS:DD).'); return }
    if (customStart === customEnd) { setSubmitError('Başlangıç ve bitiş saati aynı olamaz.'); return }

    try {
      await onSave({ templateId: null, startTime: customStart, endTime: customEnd })
    } catch (err) { setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.') }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setSubmitError(null)
    try { await onDelete() }
    catch (err) { setSubmitError(err instanceof Error ? err.message : 'Silme hatası.') }
  }

  const dateLabel = workDate
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
        .format(new Date(workDate + 'T00:00:00'))
    : ''

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
        {isEdit ? 'Vardiyayı Düzenle' : 'Vardiya Ata'}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={1.75} sx={{ mt: 0.5 }}>
          {submitError && (
            <Alert severity="error" onClose={() => setSubmitError(null)}>{submitError}</Alert>
          )}

          {/* Çalışan + tarih */}
          <Box sx={{
            p: 1.5, bgcolor: tint(C.brand, 0.06), borderRadius: 1.5,
            border: `1px solid ${tint(C.brand, 0.15)}`,
          }}>
            <Typography variant="subtitle2" fontWeight={700}>{employee?.full_name}</Typography>
            <Typography variant="caption" color="text.secondary">{dateLabel}</Typography>
          </Box>

          {/* Availability */}
          {dayAvailability.length > 0 && (
            <AvailabilityBadge
              records={dayAvailability}
              shiftStart={activeStart}
              shiftEnd={activeEnd}
            />
          )}

          {/* Mod toggle */}
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_, v) => { if (v) setMode(v as 'template' | 'custom') }}
            size="small"
            fullWidth
            sx={{ '& .MuiToggleButton-root': { fontSize: '0.75rem', py: 0.75, textTransform: 'none' } }}
          >
            <ToggleButton value="template">
              <ViewListIcon sx={{ fontSize: 15, mr: 0.75 }} />
              Şablon
            </ToggleButton>
            <ToggleButton value="custom">
              <EditIcon sx={{ fontSize: 15, mr: 0.75 }} />
              Özel Saat
            </ToggleButton>
          </ToggleButtonGroup>

          {/* ── Şablon modu ── */}
          {mode === 'template' && (
            <FormControl fullWidth>
              <InputLabel id="template-select-label">Vardiya Şablonu</InputLabel>
              <Select
                labelId="template-select-label"
                value={selectedTemplateId}
                label="Vardiya Şablonu"
                onChange={handleTemplateChange}
              >
                {templates.map((t) => {
                  const dur = shiftDurationMins(t.start_time.slice(0, 5), t.end_time.slice(0, 5))
                  const durH = `${Math.floor(dur / 60)}s${dur % 60 > 0 ? ` ${dur % 60}dk` : ''}`
                  return (
                    <MenuItem key={t.id} value={t.id}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body2" fontWeight={600}>{t.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatTime(t.start_time)} – {formatTime(t.end_time)}
                          </Typography>
                        </Box>
                        <Chip label={durH} size="small" variant="outlined"
                          sx={{ fontSize: '0.65rem', height: 18, ml: 1,
                            color: 'text.secondary', borderColor: 'divider' }} />
                      </Box>
                    </MenuItem>
                  )
                })}
              </Select>
            </FormControl>
          )}

          {/* ── Özel saat modu ── */}
          {mode === 'custom' && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
              <TextField
                label="Başlangıç"
                type="time"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                fullWidth
                size="small"
                inputProps={{ step: 300 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Typography variant="body1" sx={{ pt: 1, color: 'text.secondary', flexShrink: 0 }}>–</Typography>
              <TextField
                label="Bitiş"
                type="time"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                fullWidth
                size="small"
                inputProps={{ step: 300 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>
          )}

          {/* Önizleme — her iki modda da göster */}
          {durationLabel && (
            <Box sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              px: 1.5, py: 0.75,
              bgcolor: mode === 'custom' ? tint(C.brand, 0.06) : tint(C.plum, 0.08),
              borderRadius: 1.5,
              border: `1px solid ${mode === 'custom' ? tint(C.brand, 0.2) : tint(C.plum, 0.2)}`,
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <AccessTimeIcon sx={{ fontSize: 14, color: mode === 'custom' ? 'primary.main' : 'secondary.main' }} />
                <Typography variant="caption"
                  color={mode === 'custom' ? 'primary.main' : 'secondary.main'} fontWeight={600}>
                  {activeStart} – {activeEnd}
                  {mode === 'custom' && selectedTemplate && (
                    <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 0.75 }}>
                      (Şablon: {selectedTemplate.name})
                    </Typography>
                  )}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {isOvernight && (
                  <Chip label="gece geçen" size="small" variant="outlined"
                    sx={{ height: 16, fontSize: '0.6rem', color: C.plum, borderColor: tint(C.plum, 0.4) }} />
                )}
                <Chip label={durationLabel} size="small"
                  color={mode === 'custom' ? 'primary' : 'secondary'} variant="outlined"
                  sx={{ height: 18, fontSize: '0.65rem' }} />
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: 'space-between' }}>
        {isEdit && onDelete ? (
          <Button color="error" onClick={handleDelete} disabled={loading} size="small">Kaldır</Button>
        ) : <Box />}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Haftalık Tatil butonu — yalnızca yeni atama (boş gün) */}
          {!isEdit && onAssignRestDay && (
            <Button
              onClick={async () => {
                setSubmitError(null)
                try { await onAssignRestDay() }
                catch (err) { setSubmitError(err instanceof Error ? err.message : 'Tatil atanamadı.') }
              }}
              disabled={loading}
              variant="outlined"
              color="inherit"
              startIcon={<WeekendIcon sx={{ fontSize: 16 }} />}
              sx={{
                borderColor: tint(C.plum, 0.4),
                color: C.plum,
                fontSize: '0.78rem',
                '&:hover': { bgcolor: tint(C.plum, 0.08), borderColor: C.plum },
              }}
            >
              Haftalık Tatil
            </Button>
          )}
          <Button onClick={onClose} disabled={loading} color="inherit">İptal</Button>
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
