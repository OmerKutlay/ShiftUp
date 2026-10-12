'use client'
/**
 * AvailabilityEditor — FAZ 11
 * Seçilen çalışanın haftalık müsaitlik kayıtlarını düzenler.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, Chip, Button, Stack,
  CircularProgress, Alert, Select, MenuItem, TextField, FormControl,
  InputLabel, Dialog, DialogTitle, DialogContent, DialogActions, Switch,
  FormControlLabel,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import BlockIcon from '@mui/icons-material/Block'
import type { EmployeeAvailability, DayOfWeek } from '@/types/workforce'
import { DAY_OF_WEEK_LABELS } from '@/types/workforce'
import type { EmployeeWithRole } from '@/types/employee'
import { DayBlocksSkeleton } from '@/components/common'
import { useLoadedKey } from '@/hooks/useLoadedKey'

const DAYS: DayOfWeek[] = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

interface Props {
  employees: EmployeeWithRole[]
}

export function AvailabilityEditor({ employees }: Props) {
  const [selectedId, setSelectedId] = useState<string>(employees[0]?.id ?? '')
  const [availability, setAvailability] = useState<EmployeeAvailability[]>([])
  const { isFirstLoad, markLoaded } = useLoadedKey(selectedId)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ day_of_week: 'monday' as DayOfWeek, start_time: '09:00', end_time: '18:00', is_available: true, note: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!selectedId) return
    setError(null)
    try {
      const res = await fetch(`/api/availability?employee_id=${selectedId}`)
      const json = await res.json() as { availability: EmployeeAvailability[] }
      setAvailability(json.availability ?? [])
    } catch { setError('Yüklenemedi.') }
    finally { markLoaded(selectedId) }
  }, [selectedId, markLoaded])

  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/availability?id=${id}`, { method: 'DELETE' })
      setAvailability((prev) => prev.filter((a) => a.id !== id))
    } catch { setError('Silinemedi.') }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, employee_id: selectedId }),
      })
      const json = await res.json() as { availability: EmployeeAvailability; error?: string }
      if (!res.ok) { setError(json.error ?? 'Hata.'); return }
      setAvailability((prev) => [...prev, json.availability])
      setDialogOpen(false)
    } catch { setError('Kaydedilemedi.') }
    finally { setSaving(false) }
  }

  // Günlere göre grupla
  const grouped = DAYS.map((day) => ({
    day,
    items: availability.filter((a) => a.day_of_week === day),
  }))

  return (
    <Box>
      {/* Çalışan seçici */}
      <FormControl size="small" sx={{ mb: 2, minWidth: 200 }}>
        <InputLabel>Çalışan</InputLabel>
        <Select value={selectedId} label="Çalışan" onChange={(e) => setSelectedId(e.target.value as string)}>
          {employees.map((e) => (
            <MenuItem key={e.id} value={e.id}>{e.full_name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}

      {isFirstLoad ? (
        <DayBlocksSkeleton count={7} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {grouped.map(({ day, items }) => (
            <Paper key={day} sx={{ p: 1.5, bgcolor: 'rgba(30,41,59,0.5)', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: items.length > 0 ? 1 : 0 }}>
                <Typography variant="body2" fontWeight={700} color={items.length > 0 ? 'text.primary' : 'text.secondary'}>
                  {DAY_OF_WEEK_LABELS[day]}
                </Typography>
                {items.length === 0 && (
                  <Typography variant="caption" color="text.secondary">Kayıt yok</Typography>
                )}
              </Box>
              <Stack direction="row" flexWrap="wrap" gap={0.75}>
                {items.map((item) => (
                  <Chip
                    key={item.id}
                    icon={item.is_available ? <CheckCircleIcon sx={{ fontSize: 14 }} /> : <BlockIcon sx={{ fontSize: 14 }} />}
                    label={`${item.start_time.slice(0,5)} – ${item.end_time.slice(0,5)}${item.note ? ` (${item.note})` : ''}`}
                    size="small"
                    onDelete={() => handleDelete(item.id)}
                    deleteIcon={<DeleteIcon />}
                    sx={{
                      bgcolor: item.is_available ? 'rgba(20,184,166,0.12)' : 'rgba(239,68,68,0.12)',
                      color: item.is_available ? 'primary.main' : 'error.main',
                      fontWeight: 600,
                    }}
                  />
                ))}
              </Stack>
            </Paper>
          ))}
        </Box>
      )}

      <Button
        startIcon={<AddIcon />}
        variant="outlined"
        size="small"
        onClick={() => setDialogOpen(true)}
        sx={{ mt: 2, borderColor: 'primary.main', color: 'primary.main' }}
      >
        Müsaitlik Ekle
      </Button>

      {/* Ekleme dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Müsaitlik Ekle</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <FormControl fullWidth size="small">
            <InputLabel>Gün</InputLabel>
            <Select value={form.day_of_week} label="Gün" onChange={(e) => setForm((f) => ({ ...f, day_of_week: e.target.value as DayOfWeek }))}>
              {DAYS.map((d) => <MenuItem key={d} value={d}>{DAY_OF_WEEK_LABELS[d]}</MenuItem>)}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField size="small" label="Başlangıç" type="time" value={form.start_time}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} inputProps={{ step: 300 }} fullWidth />
            <TextField size="small" label="Bitiş" type="time" value={form.end_time}
              onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} inputProps={{ step: 300 }} fullWidth />
          </Box>
          <FormControlLabel
            control={<Switch checked={form.is_available} onChange={(e) => setForm((f) => ({ ...f, is_available: e.target.checked }))} color="primary" />}
            label={form.is_available ? 'Müsait' : 'Müsait Değil'}
          />
          <TextField size="small" label="Not (isteğe bağlı)" value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} fullWidth />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} color="inherit">İptal</Button>
          <Button onClick={handleSave} variant="contained" disabled={saving}>
            {saving ? <CircularProgress size={18} /> : 'Kaydet'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
