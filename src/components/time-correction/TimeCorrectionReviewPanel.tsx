'use client'

/**
 * TimeCorrectionReviewPanel — Yönetici mesai düzeltme paneli
 * 1) Bekleyen çalışan taleplerini onayla/reddet
 * 2) Herhangi bir çalışan için doğrudan mesai düzeltmesi gir
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, Button, Stack, Chip, CircularProgress, Alert,
  TextField, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip,
  Divider, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent, Tab, Tabs,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { TimeCorrectionRequest } from '@/types/timeCorrection'
import { TIME_CORRECTION_STATUS_LABELS, TIME_CORRECTION_STATUS_COLORS } from '@/types/timeCorrection'
import type { EmployeeWithRole } from '@/types/employee'

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00:00'), 'd MMMM yyyy EEEE', { locale: tr }) } catch { return d }
}
function fmtTime(t: string) { return t.slice(0, 5) }
function fmtDateTime(iso: string) {
  try { return format(new Date(iso), 'd MMM HH:mm', { locale: tr }) } catch { return iso }
}

export function TimeCorrectionReviewPanel() {
  const [tab, setTab] = useState(0)

  // ── Talepler sekmesi ─────────────────────────────────────────
  const [requests, setRequests] = useState<TimeCorrectionRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending')

  const [reviewDialog, setReviewDialog] = useState<{
    open: boolean
    req: TimeCorrectionRequest | null
    action: 'approve' | 'reject'
  }>({ open: false, req: null, action: 'approve' })
  const [reviewNote, setReviewNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  // ── Doğrudan giriş sekmesi ───────────────────────────────────
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [directForm, setDirectForm] = useState({ employee_id: '', date: '', start: '09:00', end: '18:00', reason: '' })
  const [directSaving, setDirectSaving] = useState(false)
  const [directError, setDirectError] = useState<string | null>(null)
  const [directSuccess, setDirectSuccess] = useState<string | null>(null)

  const loadRequests = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = statusFilter === 'pending' ? '?status=pending' : ''
      const res = await fetch(`/api/time-correction${qs}`, { credentials: 'same-origin' })
      if (!res.ok) { const d = await res.json() as { error?: string }; setError(d.error ?? 'Yüklenemedi.'); return }
      const d = await res.json() as { requests: TimeCorrectionRequest[] }
      setRequests(d.requests ?? [])
    } catch { setError('Bağlantı hatası.') }
    finally { setLoading(false) }
  }, [statusFilter])

  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/employees?active=true', { credentials: 'same-origin' })
      if (!res.ok) return
      const d = await res.json() as { employees: EmployeeWithRole[] }
      setEmployees(d.employees ?? [])
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { void loadRequests() }, [loadRequests])
  useEffect(() => { void loadEmployees() }, [loadEmployees])

  const openReview = (req: TimeCorrectionRequest, action: 'approve' | 'reject') => {
    setReviewDialog({ open: true, req, action })
    setReviewNote('')
    setReviewError(null)
  }

  const handleReview = async () => {
    if (!reviewDialog.req) return
    setReviewing(true); setReviewError(null)
    try {
      const res = await fetch('/api/time-correction/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          request_id: reviewDialog.req.id,
          status: reviewDialog.action === 'approve' ? 'approved' : 'rejected',
          reviewer_note: reviewNote.trim() || null,
        }),
      })
      const d = await res.json() as { error?: string }
      if (!res.ok) { setReviewError(d.error ?? 'Hata.'); return }
      setReviewDialog({ open: false, req: null, action: 'approve' })
      void loadRequests()
    } catch { setReviewError('Bağlantı hatası.') }
    finally { setReviewing(false) }
  }

  const handleDirect = async () => {
    if (!directForm.date || !directForm.start || !directForm.end || !directForm.reason.trim()) {
      setDirectError('Tüm alanlar zorunludur.'); return
    }
    if (directForm.start >= directForm.end) {
      setDirectError('Çıkış saati giriş saatinden sonra olmalıdır.'); return
    }
    setDirectSaving(true); setDirectError(null); setDirectSuccess(null)
    try {
      const res = await fetch('/api/time-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          direct: true,
          employee_id:          directForm.employee_id || undefined,
          date:                 directForm.date,
          requested_start_time: directForm.start,
          requested_end_time:   directForm.end,
          reason:               directForm.reason.trim(),
        }),
      })
      const d = await res.json() as { error?: string }
      if (!res.ok) { setDirectError(d.error ?? 'Hata.'); return }
      setDirectSuccess('Mesai düzeltmesi uygulandı.')
      setDirectForm((f) => ({ ...f, date: '', start: '09:00', end: '18:00', reason: '' }))
    } catch { setDirectError('Bağlantı hatası.') }
    finally { setDirectSaving(false) }
  }

  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v as number)}
        sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Tab label="Çalışan Talepleri" sx={{ fontSize: '0.82rem', minHeight: 40 }} />
        <Tab label="Doğrudan Düzeltme" sx={{ fontSize: '0.82rem', minHeight: 40 }} />
      </Tabs>

      {/* ── Tab 0: Çalışan talepleri ── */}
      {tab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            {(['pending', 'all'] as const).map((f) => (
              <Chip key={f} label={f === 'pending' ? 'Bekleyenler' : 'Tümü'} size="small"
                onClick={() => setStatusFilter(f)}
                sx={{
                  cursor: 'pointer',
                  bgcolor: statusFilter === f ? 'primary.main' : 'rgba(255,255,255,0.06)',
                  color: statusFilter === f ? '#fff' : 'text.secondary',
                }} />
            ))}
          </Box>

          {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

          {loading && requests.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>
          ) : requests.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {statusFilter === 'pending' ? 'Bekleyen talep yok.' : 'Talep bulunamadı.'}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {requests.map((r) => {
                const color = TIME_CORRECTION_STATUS_COLORS[r.status]
                return (
                  <Paper key={r.id} elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'rgba(30,41,59,0.5)' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}>
                      <Box sx={{ flex: 1, minWidth: 200 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography variant="subtitle2" fontWeight={700}>{r.employee?.full_name ?? '—'}</Typography>
                          <Chip label={TIME_CORRECTION_STATUS_LABELS[r.status]} size="small"
                            sx={{ bgcolor: `${color}20`, color, border: '1px solid', borderColor: `${color}40`, fontWeight: 700, fontSize: '0.62rem', height: 18 }} />
                        </Box>
                        <Typography variant="caption" color="text.secondary" display="block" fontWeight={600}>{fmtDate(r.date)}</Typography>
                        <Divider sx={{ my: 0.75, borderColor: 'rgba(255,255,255,0.06)' }} />
                        <Typography variant="caption" color="text.disabled" display="block">Talep edilen</Typography>
                        <Typography variant="caption" fontWeight={700} color="primary.main">
                          {fmtTime(r.requested_start_time)} – {fmtTime(r.requested_end_time)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{r.reason}</Typography>
                        {r.reviewer_note && (
                          <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>Not: {r.reviewer_note}</Typography>
                        )}
                        <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
                          Oluşturuldu: {fmtDateTime(r.created_at)}
                          {r.reviewed_at && ` · İncelendi: ${fmtDateTime(r.reviewed_at)}`}
                        </Typography>
                      </Box>

                      {r.status === 'pending' && (
                        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, alignSelf: 'flex-start' }}>
                          <Tooltip title="Onayla">
                            <Button size="small" variant="contained" color="success" startIcon={<CheckIcon />}
                              onClick={() => openReview(r, 'approve')} sx={{ fontSize: '0.72rem', py: 0.4 }}>
                              Onayla
                            </Button>
                          </Tooltip>
                          <Tooltip title="Reddet">
                            <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon />}
                              onClick={() => openReview(r, 'reject')} sx={{ fontSize: '0.72rem', py: 0.4 }}>
                              Reddet
                            </Button>
                          </Tooltip>
                        </Box>
                      )}
                    </Box>
                  </Paper>
                )
              })}
            </Stack>
          )}
        </Box>
      )}

      {/* ── Tab 1: Doğrudan düzeltme ── */}
      {tab === 1 && (
        <Box sx={{ maxWidth: 480 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Çalışan talebi olmadan doğrudan mesai düzeltmesi girin. Anında uygulanır.
          </Typography>

          {directError && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setDirectError(null)}>{directError}</Alert>}
          {directSuccess && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setDirectSuccess(null)}>{directSuccess}</Alert>}

          <Stack spacing={2}>
            <FormControl size="small" fullWidth>
              <InputLabel>Çalışan</InputLabel>
              <Select value={directForm.employee_id} label="Çalışan"
                onChange={(e: SelectChangeEvent) => setDirectForm((f) => ({ ...f, employee_id: e.target.value }))}>
                <MenuItem value=""><em>Kendi hesabım</em></MenuItem>
                {employees.map((emp) => (
                  <MenuItem key={emp.id} value={emp.id}>{emp.full_name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField size="small" label="Tarih" type="date" value={directForm.date}
              onChange={(e) => setDirectForm((f) => ({ ...f, date: e.target.value }))}
              InputLabelProps={{ shrink: true }} fullWidth />

            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField size="small" label="Giriş Saati" type="time" value={directForm.start}
                onChange={(e) => setDirectForm((f) => ({ ...f, start: e.target.value }))}
                inputProps={{ step: 300 }} fullWidth />
              <TextField size="small" label="Çıkış Saati" type="time" value={directForm.end}
                onChange={(e) => setDirectForm((f) => ({ ...f, end: e.target.value }))}
                inputProps={{ step: 300 }} fullWidth />
            </Box>

            <TextField size="small" label="Sebep" value={directForm.reason} multiline rows={2}
              onChange={(e) => setDirectForm((f) => ({ ...f, reason: e.target.value }))} fullWidth />

            <Button variant="contained" startIcon={directSaving ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
              onClick={() => void handleDirect()} disabled={directSaving}>
              Düzeltmeyi Uygula
            </Button>
          </Stack>
        </Box>
      )}

      {/* Onay/Red Dialog */}
      <Dialog open={reviewDialog.open} onClose={() => setReviewDialog((d) => ({ ...d, open: false }))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {reviewDialog.action === 'approve' ? 'Talebi Onayla' : 'Talebi Reddet'}
        </DialogTitle>
        <DialogContent>
          {reviewDialog.req && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 1.5 }}>
              <Typography variant="body2" fontWeight={600}>{reviewDialog.req.employee?.full_name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {fmtDate(reviewDialog.req.date)} · {fmtTime(reviewDialog.req.requested_start_time)} – {fmtTime(reviewDialog.req.requested_end_time)}
              </Typography>
            </Box>
          )}
          {reviewError && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setReviewError(null)}>{reviewError}</Alert>}
          <TextField fullWidth multiline rows={2} label="Yönetici Notu (opsiyonel)" value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)} size="small"
            placeholder={reviewDialog.action === 'reject' ? 'Red sebebini belirtebilirsiniz...' : undefined} />
          {reviewDialog.action === 'approve' && (
            <Alert severity="info" sx={{ mt: 1.5 }} icon={<AccessTimeIcon fontSize="small" />}>
              Onaylandığında çalışanın takvimi ve çalışma özeti otomatik güncellenecektir.
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setReviewDialog((d) => ({ ...d, open: false }))} color="inherit" disabled={reviewing}>İptal</Button>
          <Button onClick={() => void handleReview()} variant="contained"
            color={reviewDialog.action === 'approve' ? 'success' : 'error'}
            disabled={reviewing}
            startIcon={reviewing ? <CircularProgress size={16} color="inherit" /> : reviewDialog.action === 'approve' ? <CheckIcon /> : <CloseIcon />}>
            {reviewDialog.action === 'approve' ? 'Onayla' : 'Reddet'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
