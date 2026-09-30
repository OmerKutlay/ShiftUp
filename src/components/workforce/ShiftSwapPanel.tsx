'use client'
/**
 * ShiftSwapPanel — FAZ 11
 * Vardiya takas talepleri listesi + yeni talep oluşturma + onay/red.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, Button, Chip, CircularProgress, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Stack, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import type { ShiftSwapRequest, CreateSwapRequestPayload } from '@/types/workforce'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import type { EmployeeWithRole } from '@/types/employee'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Bekliyor',    color: '#f59e0b' },
  approved:  { label: 'Onaylandı',   color: '#10b981' },
  rejected:  { label: 'Reddedildi',  color: '#ef4444' },
  cancelled: { label: 'İptal',       color: '#94a3b8' },
}

interface Props {
  employees: EmployeeWithRole[]
  assignments: ShiftAssignmentWithDetails[]
}

export function ShiftSwapPanel({ employees, assignments }: Props) {
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<Partial<CreateSwapRequestPayload>>({})
  const [saving, setSaving] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/shift-swap')
      const json = await res.json() as { swap_requests: ShiftSwapRequest[] }
      setSwaps(json.swap_requests ?? [])
    } catch { setError('Yüklenemedi.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const handleCreate = async () => {
    if (!form.requester_id || !form.requester_shift_id) {
      setError('Çalışan ve vardiya seçimi zorunludur.'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/shift-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json() as { swap_request: ShiftSwapRequest; error?: string }
      if (!res.ok) { setError(json.error ?? 'Hata.'); return }
      setSwaps((prev) => [json.swap_request, ...prev])
      setDialogOpen(false)
      setForm({})
    } catch { setError('Kaydedilemedi.') }
    finally { setSaving(false) }
  }

  const handleReview = async (swapId: string, status: 'approved' | 'rejected') => {
    setReviewingId(swapId)
    try {
      const res = await fetch('/api/shift-swap/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swap_id: swapId, status }),
      })
      const json = await res.json() as { swap_request: ShiftSwapRequest; error?: string }
      if (!res.ok) { setError(json.error ?? 'Hata.'); return }
      setSwaps((prev) => prev.map((s) => s.id === swapId ? json.swap_request : s))
    } catch { setError('İşlem başarısız.') }
    finally { setReviewingId(null) }
  }

  // Seçilen çalışanın vardiyaları
  const requesterShifts = assignments.filter((a) => a.employee_id === form.requester_id)
  const targetShifts = assignments.filter((a) => a.employee_id === form.target_id)

  const fmtShift = (a: ShiftAssignmentWithDetails) =>
    `${format(new Date(a.work_date), 'd MMM', { locale: tr })} ${a.start_time.slice(0,5)}-${a.end_time.slice(0,5)}`

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => setDialogOpen(true)}
          sx={{ borderColor: 'primary.main', color: 'primary.main' }}>
          Takas Talebi Oluştur
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={28} /></Box>
      ) : swaps.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Takas talebi bulunamadı.</Typography>
      ) : (
        <Stack gap={1}>
          {swaps.map((swap) => {
            const meta = STATUS_META[swap.status]
            return (
              <Paper key={swap.id} sx={{ p: 1.5, bgcolor: 'rgba(30,41,59,0.5)', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <SwapHorizIcon sx={{ color: meta.color, fontSize: 18 }} />
                    <Box>
                      <Typography variant="body2" fontWeight={700}>
                        {swap.requester?.full_name ?? '—'}
                        {swap.requester_shift ? ` · ${swap.requester_shift.work_date} ${swap.requester_shift.start_time.slice(0,5)}` : ''}
                      </Typography>
                      {swap.target && (
                        <Typography variant="caption" color="text.secondary">
                          ↔ {swap.target.full_name}
                          {swap.target_shift ? ` · ${swap.target_shift.work_date} ${swap.target_shift.start_time.slice(0,5)}` : ' (vardiyasız takas)'}
                        </Typography>
                      )}
                      {swap.requester_note && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Not: {swap.requester_note}</Typography>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={meta.label} size="small"
                      sx={{ bgcolor: `${meta.color}22`, color: meta.color, fontWeight: 700, fontSize: '0.65rem' }} />
                    {swap.status === 'pending' && (
                      <>
                        <Button size="small" color="success" variant="outlined" startIcon={<CheckIcon />}
                          onClick={() => handleReview(swap.id, 'approved')}
                          disabled={reviewingId === swap.id} sx={{ fontSize: '0.7rem', py: 0.25 }}>
                          Onayla
                        </Button>
                        <Button size="small" color="error" variant="outlined" startIcon={<CloseIcon />}
                          onClick={() => handleReview(swap.id, 'rejected')}
                          disabled={reviewingId === swap.id} sx={{ fontSize: '0.7rem', py: 0.25 }}>
                          Reddet
                        </Button>
                      </>
                    )}
                  </Box>
                </Box>
              </Paper>
            )
          })}
        </Stack>
      )}

      {/* Yeni takas dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Takas Talebi Oluştur</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <FormControl fullWidth size="small">
            <InputLabel>Talep Eden Çalışan</InputLabel>
            <Select value={form.requester_id ?? ''} label="Talep Eden Çalışan"
              onChange={(e) => setForm((f) => ({ ...f, requester_id: e.target.value, requester_shift_id: undefined }))}>
              {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.full_name}</MenuItem>)}
            </Select>
          </FormControl>
          {form.requester_id && (
            <FormControl fullWidth size="small">
              <InputLabel>Takas Edilecek Vardiya</InputLabel>
              <Select value={form.requester_shift_id ?? ''} label="Takas Edilecek Vardiya"
                onChange={(e) => setForm((f) => ({ ...f, requester_shift_id: e.target.value }))}>
                {requesterShifts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>{fmtShift(a)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <FormControl fullWidth size="small">
            <InputLabel>Hedef Çalışan (isteğe bağlı)</InputLabel>
            <Select value={form.target_id ?? ''} label="Hedef Çalışan (isteğe bağlı)"
              onChange={(e) => setForm((f) => ({ ...f, target_id: e.target.value || null, target_shift_id: undefined }))}>
              <MenuItem value="">Belirtme</MenuItem>
              {employees.filter((e) => e.id !== form.requester_id).map((e) => (
                <MenuItem key={e.id} value={e.id}>{e.full_name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {form.target_id && targetShifts.length > 0 && (
            <FormControl fullWidth size="small">
              <InputLabel>Hedef Vardiya (isteğe bağlı)</InputLabel>
              <Select value={form.target_shift_id ?? ''} label="Hedef Vardiya (isteğe bağlı)"
                onChange={(e) => setForm((f) => ({ ...f, target_shift_id: e.target.value || null }))}>
                <MenuItem value="">Belirtme</MenuItem>
                {targetShifts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>{fmtShift(a)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <TextField size="small" label="Not" value={form.requester_note ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, requester_note: e.target.value }))} fullWidth />
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
