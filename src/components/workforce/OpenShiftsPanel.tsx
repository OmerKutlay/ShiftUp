'use client'
/**
 * OpenShiftsPanel — FAZ 11
 * Açık vardiyaları listeler, yeni ekler, üstlenme (claim) sağlar.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, Button, Chip, CircularProgress, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Stack, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import WorkIcon from '@mui/icons-material/Work'
import type { OpenShift } from '@/types/workforce'
import type { EmployeeWithRole } from '@/types/employee'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

const STATUS_LABELS: Record<string, string> = { open: 'Açık', filled: 'Dolduruldu', cancelled: 'İptal' }
const STATUS_COLORS: Record<string, string> = { open: '#14b8a6', filled: '#10b981', cancelled: '#94a3b8' }

interface Props {
  employees: EmployeeWithRole[]
}

export function OpenShiftsPanel({ employees }: Props) {
  const [shifts, setShifts] = useState<OpenShift[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const [form, setForm] = useState({ work_date: '', start_time: '09:00', end_time: '18:00', role_needed: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [claimEmployee, setClaimEmployee] = useState<string>(employees[0]?.id ?? '')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/open-shifts?status=${statusFilter}`)
      const json = await res.json() as { open_shifts: OpenShift[] }
      setShifts(json.open_shifts ?? [])
    } catch { setError('Yüklenemedi.') }
    finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const handleCreate = async () => {
    if (!form.work_date) { setError('Tarih zorunludur.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/open-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, role_needed: form.role_needed || null, description: form.description || null }),
      })
      const json = await res.json() as { open_shift: OpenShift; error?: string }
      if (!res.ok) { setError(json.error ?? 'Hata.'); return }
      setShifts((prev) => [json.open_shift, ...prev])
      setDialogOpen(false)
      setForm({ work_date: '', start_time: '09:00', end_time: '18:00', role_needed: '', description: '' })
    } catch { setError('Kaydedilemedi.') }
    finally { setSaving(false) }
  }

  const handleClaim = async (shiftId: string) => {
    setClaimingId(shiftId)
    try {
      const res = await fetch('/api/open-shifts/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open_shift_id: shiftId, employee_id: claimEmployee }),
      })
      const json = await res.json() as { open_shift: OpenShift; error?: string }
      if (!res.ok) { setError(json.error ?? 'Hata.'); return }
      setShifts((prev) => prev.map((s) => s.id === shiftId ? json.open_shift : s))
    } catch { setError('İşlem başarısız.') }
    finally { setClaimingId(null) }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Durum</InputLabel>
          <Select value={statusFilter} label="Durum" onChange={(e) => setStatusFilter(e.target.value)}>
            <MenuItem value="open">Açık</MenuItem>
            <MenuItem value="filled">Dolduruldu</MenuItem>
            <MenuItem value="cancelled">İptal</MenuItem>
          </Select>
        </FormControl>
        <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => setDialogOpen(true)}
          sx={{ borderColor: 'primary.main', color: 'primary.main' }}>
          Açık Vardiya Oluştur
        </Button>
      </Box>

      {/* Claim için çalışan seçici */}
      {statusFilter === 'open' && (
        <FormControl size="small" sx={{ mb: 2, minWidth: 200 }}>
          <InputLabel>Üstlenen Çalışan</InputLabel>
          <Select value={claimEmployee} label="Üstlenen Çalışan" onChange={(e) => setClaimEmployee(e.target.value)}>
            {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.full_name}</MenuItem>)}
          </Select>
        </FormControl>
      )}

      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={28} /></Box>
      ) : shifts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Açık vardiya bulunamadı.</Typography>
      ) : (
        <Stack gap={1}>
          {shifts.map((shift) => (
            <Paper key={shift.id} sx={{ p: 1.5, bgcolor: 'rgba(30,41,59,0.5)', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <WorkIcon sx={{ color: STATUS_COLORS[shift.status], fontSize: 18 }} />
                  <Box>
                    <Typography variant="body2" fontWeight={700}>
                      {format(new Date(shift.work_date), 'd MMMM yyyy', { locale: tr })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {shift.start_time.slice(0,5)} – {shift.end_time.slice(0,5)}
                      {shift.role_needed ? ` · ${shift.role_needed}` : ''}
                      {shift.description ? ` · ${shift.description}` : ''}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={STATUS_LABELS[shift.status]}
                    size="small"
                    sx={{ bgcolor: `${STATUS_COLORS[shift.status]}22`, color: STATUS_COLORS[shift.status], fontWeight: 700, fontSize: '0.65rem' }}
                  />
                  {shift.status === 'open' && (
                    <Button size="small" variant="contained" onClick={() => handleClaim(shift.id)}
                      disabled={claimingId === shift.id} sx={{ fontSize: '0.72rem', py: 0.25 }}>
                      {claimingId === shift.id ? <CircularProgress size={14} /> : 'Üstlen'}
                    </Button>
                  )}
                  {shift.status === 'filled' && shift.filled_by_employee && (
                    <Typography variant="caption" color="success.main">{shift.filled_by_employee.full_name}</Typography>
                  )}
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Oluşturma dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Açık Vardiya Oluştur</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField size="small" label="Tarih" type="date" value={form.work_date}
            onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))}
            InputLabelProps={{ shrink: true }} fullWidth />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField size="small" label="Başlangıç" type="time" value={form.start_time}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} inputProps={{ step: 300 }} fullWidth />
            <TextField size="small" label="Bitiş" type="time" value={form.end_time}
              onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} inputProps={{ step: 300 }} fullWidth />
          </Box>
          <TextField size="small" label="Gerekli Pozisyon" value={form.role_needed}
            onChange={(e) => setForm((f) => ({ ...f, role_needed: e.target.value }))} fullWidth />
          <TextField size="small" label="Açıklama" value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} fullWidth />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} color="inherit">İptal</Button>
          <Button onClick={handleCreate} variant="contained" disabled={saving}>
            {saving ? <CircularProgress size={18} /> : 'Oluştur'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
