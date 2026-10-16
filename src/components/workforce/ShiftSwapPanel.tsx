'use client'
/**
 * ShiftSwapPanel — FAZ 11
 * Vardiya takas talepleri listesi + yeni talep oluşturma + onay/red.
 *
 * Takas bir taleptir: çalışan kendi vardiyası için talep açar, vardiyalar
 * ancak bir yöneticinin (Müdür Yardımcısı+) onayıyla değişir.
 * Çalışan kendi bekleyen talebini iptal edebilir.
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
import { EmployeeSelect, ListSkeleton } from '@/components/common'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useLoadedKey } from '@/hooks/useLoadedKey'

const STATUS_META: Record<string, { label: string; color: string }> = {
  awaiting_target: { label: 'Karşı Taraf Bekleniyor', color: '#60a5fa' },
  pending:   { label: 'Yönetici Onayı Bekliyor', color: '#f59e0b' },
  approved:  { label: 'Onaylandı',     color: '#10b981' },
  rejected:  { label: 'Reddedildi',    color: '#ef4444' },
  cancelled: { label: 'İptal',         color: '#94a3b8' },
}

type ReviewStatus = 'accepted' | 'declined' | 'approved' | 'rejected' | 'cancelled'

interface Props {
  employees: EmployeeWithRole[]
  assignments: ShiftAssignmentWithDetails[]
  currentEmployeeId: string | null
  isManager: boolean
}

export function ShiftSwapPanel({ employees, assignments, currentEmployeeId, isManager }: Props) {
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([])
  const { isFirstLoad, markLoaded } = useLoadedKey()
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<Partial<CreateSwapRequestPayload>>({})
  const [saving, setSaving] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null)
  // Çalışma süresi ihlali — yönetici açıkça onaylarsa tekrar gönderilir
  const [ackPrompt, setAckPrompt] = useState<{ id: string; violations: string[] } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/shift-swap')
      const json = await res.json() as { swap_requests: ShiftSwapRequest[] }
      setSwaps(json.swap_requests ?? [])
    } catch { setError('Yüklenemedi.') }
    finally { markLoaded() }
  }, [markLoaded])

  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const closeDialog = () => { setDialogOpen(false); setForm({}) }

  const handleCreate = async () => {
    if (!form.requester_shift_id || !form.target_id) {
      setError('Vardiyanızı ve takas yapılacak çalışanı seçmelisiniz.'); return
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
      closeDialog()
      await load() // join'li (isimli) kaydı almak için
    } catch { setError('Kaydedilemedi.') }
    finally { setSaving(false) }
  }

  const handleReview = async (swapId: string, status: ReviewStatus, reviewerNote?: string, acknowledge = false) => {
    setReviewingId(swapId)
    try {
      const res = await fetch('/api/shift-swap/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swap_id: swapId, status, reviewer_note: reviewerNote || null, acknowledge_violations: acknowledge,
        }),
      })
      const json = await res.json() as { swap_request: ShiftSwapRequest; error?: string; code?: string; violations?: string[] }
      if (!res.ok) {
        if (json.code === 'WORKING_TIME_VIOLATION') {
          setAckPrompt({ id: swapId, violations: json.violations ?? [] })
          return
        }
        setError(json.error ?? 'Hata.')
        return
      }
      // Yanıt join içermez — mevcut isim/vardiya bilgilerini koru
      setSwaps((prev) => prev.map((s) => s.id === swapId ? { ...s, ...json.swap_request } : s))
    } catch { setError('İşlem başarısız.') }
    finally { setReviewingId(null) }
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  // Talep eden her zaman oturumdaki çalışandır; yalnızca bugün ve sonrasındaki vardiyalar takas edilebilir
  const myShifts = assignments.filter((a) => a.employee_id === currentEmployeeId && a.work_date >= today)
  const targetShifts = assignments.filter((a) => a.employee_id === form.target_id && a.work_date >= today)

  const fmtShift = (a: ShiftAssignmentWithDetails) =>
    `${format(new Date(a.work_date), 'd MMM', { locale: tr })} ${a.start_time.slice(0,5)}-${a.end_time.slice(0,5)}`

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          Takas, karşı taraf kabul edip bir yönetici onayladıktan sonra uygulanır. Diğer durumlarda vardiyalar değişmez.
        </Typography>
        <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => setDialogOpen(true)}
          disabled={!currentEmployeeId}
          sx={{ borderColor: 'primary.main', color: 'primary.main' }}>
          Takas Talebi Oluştur
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}

      {isFirstLoad ? (
        <ListSkeleton count={3} lines={2} actions={2} dense />
      ) : swaps.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Takas talebi bulunamadı.</Typography>
      ) : (
        <Stack gap={1}>
          {swaps.map((swap) => {
            const isPending = swap.status === 'pending'
            const awaitingTarget = isPending && !swap.target_accepted_at
            const meta = STATUS_META[awaitingTarget ? 'awaiting_target' : swap.status]
            const isParty = swap.requester_id === currentEmployeeId || swap.target_id === currentEmployeeId
            // Önce hedef çalışan kabul eder; sonra tarafı olmayan bir yönetici onaylar/reddeder
            const canRespond = awaitingTarget && swap.target_id === currentEmployeeId
            const canReview = isPending && !awaitingTarget && isManager && !isParty
            const canCancel = isPending && swap.requester_id === currentEmployeeId
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
                          {swap.target_shift ? ` · ${swap.target_shift.work_date} ${swap.target_shift.start_time.slice(0,5)}` : ' (vardiya devri)'}
                        </Typography>
                      )}
                      {swap.requester_note && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Not: {swap.requester_note}</Typography>
                      )}
                      {swap.reviewer_note && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Yönetici notu: {swap.reviewer_note}</Typography>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label={meta.label} size="small"
                      sx={{ bgcolor: `${meta.color}22`, color: meta.color, fontWeight: 700, fontSize: '0.65rem' }} />
                    {canRespond && (
                      <>
                        <Button size="small" color="success" variant="outlined" startIcon={<CheckIcon />}
                          onClick={() => handleReview(swap.id, 'accepted')}
                          disabled={reviewingId === swap.id} sx={{ fontSize: '0.7rem', py: 0.25 }}>
                          Kabul Et
                        </Button>
                        <Button size="small" color="error" variant="outlined" startIcon={<CloseIcon />}
                          onClick={() => handleReview(swap.id, 'declined')}
                          disabled={reviewingId === swap.id} sx={{ fontSize: '0.7rem', py: 0.25 }}>
                          Reddet
                        </Button>
                      </>
                    )}
                    {canReview && (
                      <>
                        <Button size="small" color="success" variant="outlined" startIcon={<CheckIcon />}
                          onClick={() => handleReview(swap.id, 'approved')}
                          disabled={reviewingId === swap.id} sx={{ fontSize: '0.7rem', py: 0.25 }}>
                          Onayla
                        </Button>
                        <Button size="small" color="error" variant="outlined" startIcon={<CloseIcon />}
                          onClick={() => setRejecting({ id: swap.id, note: '' })}
                          disabled={reviewingId === swap.id} sx={{ fontSize: '0.7rem', py: 0.25 }}>
                          Reddet
                        </Button>
                      </>
                    )}
                    {canCancel && (
                      <Button size="small" color="inherit" variant="outlined"
                        onClick={() => handleReview(swap.id, 'cancelled')}
                        disabled={reviewingId === swap.id} sx={{ fontSize: '0.7rem', py: 0.25 }}>
                        İptal Et
                      </Button>
                    )}
                  </Box>
                </Box>
              </Paper>
            )
          })}
        </Stack>
      )}

      {/* Yeni takas talebi dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Takas Talebi Oluştur</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <Alert severity="info" sx={{ py: 0 }}>
            Teklifiniz önce seçtiğiniz çalışana, o kabul ederse yönetici onayına gider. Onaylanana kadar vardiyanız değişmez.
          </Alert>
          {myShifts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Bu hafta takas edilebilecek vardiyanız yok.</Typography>
          ) : (
            <FormControl fullWidth size="small">
              <InputLabel>Vardiyanız</InputLabel>
              <Select value={form.requester_shift_id ?? ''} label="Vardiyanız"
                onChange={(e) => setForm((f) => ({ ...f, requester_shift_id: e.target.value }))}>
                {myShifts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>{fmtShift(a)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <EmployeeSelect
            employees={employees.filter((e) => e.id !== currentEmployeeId)}
            value={form.target_id ?? ''}
            label="Takas Yapılacak Çalışan"
            onChange={(id) => setForm((f) => ({ ...f, target_id: id, target_shift_id: undefined }))}
            fullWidth
          />
          {form.target_id && targetShifts.length > 0 && (
            <FormControl fullWidth size="small">
              <InputLabel>Karşılığında Alınacak Vardiya (isteğe bağlı)</InputLabel>
              <Select value={form.target_shift_id ?? ''} label="Karşılığında Alınacak Vardiya (isteğe bağlı)"
                onChange={(e) => setForm((f) => ({ ...f, target_shift_id: e.target.value || null }))}>
                <MenuItem value="">Yok — vardiyamı devret</MenuItem>
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
          <Button onClick={closeDialog} color="inherit">Vazgeç</Button>
          <Button onClick={handleCreate} variant="contained"
            disabled={saving || !form.requester_shift_id || !form.target_id}>
            {saving ? <CircularProgress size={18} /> : 'Onaya Gönder'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Red gerekçesi dialog */}
      <Dialog open={rejecting !== null} onClose={() => setRejecting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Takas Talebini Reddet</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <TextField size="small" label="Gerekçe (isteğe bağlı)" fullWidth multiline minRows={2}
            value={rejecting?.note ?? ''}
            onChange={(e) => setRejecting((r) => r && { ...r, note: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)} color="inherit">Vazgeç</Button>
          <Button color="error" variant="contained"
            onClick={() => {
              if (!rejecting) return
              void handleReview(rejecting.id, 'rejected', rejecting.note.trim())
              setRejecting(null)
            }}>
            Reddet
          </Button>
        </DialogActions>
      </Dialog>

      {/* Çalışma süresi ihlali onayı */}
      <Dialog open={ackPrompt !== null} onClose={() => setAckPrompt(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Çalışma Süresi İhlali</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <Alert severity="warning" sx={{ mb: 1 }}>
            Bu takas aşağıdaki İş Kanunu kurallarını ihlal ediyor. Yine de onaylamak istiyor musunuz?
          </Alert>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {ackPrompt?.violations.map((v) => (
              <li key={v}><Typography variant="body2">{v}</Typography></li>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAckPrompt(null)} color="inherit">Vazgeç</Button>
          <Button color="warning" variant="contained"
            onClick={() => {
              if (!ackPrompt) return
              void handleReview(ackPrompt.id, 'approved', undefined, true)
              setAckPrompt(null)
            }}>
            İhlallere Rağmen Onayla
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
