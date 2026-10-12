'use client'

/**
 * TimeCorrectionPage — Manuel Mesai Düzeltme Talebi
 * Çalışan kendi adına talep oluşturur ve geçmiş taleplerini görür.
 * Yönetici aynı sayfada review panelini de görür.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Paper, Button, Stack, Chip, CircularProgress, Alert,
  TextField, Dialog, DialogTitle, DialogContent, DialogActions, Divider,
} from '@mui/material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import AddIcon from '@mui/icons-material/Add'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { TimeCorrectionReviewPanel } from './TimeCorrectionReviewPanel'
import type { TimeCorrectionRequest } from '@/types/timeCorrection'
import { TIME_CORRECTION_STATUS_LABELS, TIME_CORRECTION_STATUS_COLORS } from '@/types/timeCorrection'

// ─── Helpers ─────────────────────────────────────────────────
function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00:00'), 'd MMMM yyyy', { locale: tr }) }
  catch { return d }
}
function fmtDateTime(iso: string) {
  try { return format(new Date(iso), 'd MMM HH:mm', { locale: tr }) } catch { return iso }
}

export function TimeCorrectionPage() {
  const { employee, status: authStatus } = useAuth()

  const [requests, setRequests] = useState<TimeCorrectionRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState({ date: '', start: '09:00', end: '18:00', reason: '' })

  // ── Yükle ───────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/time-correction', { credentials: 'same-origin' })
      if (!res.ok) { const d = await res.json() as { error?: string }; setError(d.error ?? 'Yüklenemedi.'); return }
      const d = await res.json() as { requests: TimeCorrectionRequest[] }
      setRequests(d.requests ?? [])
    } catch { setError('Bağlantı hatası.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (authStatus === 'authenticated') void load() }, [authStatus, load])

  // ── Talep oluştur ────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.date || !form.start || !form.end || !form.reason.trim()) {
      setSaveError('Tüm alanlar zorunludur.'); return
    }
    if (form.start >= form.end) {
      setSaveError('Çıkış saati giriş saatinden sonra olmalıdır.'); return
    }
    setSaving(true); setSaveError(null)
    try {
      const res = await fetch('/api/time-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          date: form.date,
          requested_start_time: form.start,
          requested_end_time: form.end,
          reason: form.reason.trim(),
        }),
      })
      const d = await res.json() as { error?: string }
      if (!res.ok) { setSaveError(d.error ?? 'Hata oluştu.'); return }
      setDialogOpen(false)
      setForm({ date: '', start: '09:00', end: '18:00', reason: '' })
      void load()
    } catch { setSaveError('Bağlantı hatası.') }
    finally { setSaving(false) }
  }

  const openDialog = () => { setSaveError(null); setDialogOpen(true) }

  // ─── Auth guard ──────────────────────────────────────────────
  if (authStatus === 'loading') return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>
  if (authStatus === 'unauthenticated' || !employee) return <Alert severity="warning" sx={{ m: 3 }}>Bu sayfayı görmek için giriş yapmanız gerekiyor.</Alert>

  const isManager = hasRole(employee.roles?.name ?? employee.role_name ?? null, MANAGER_ROLES)

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 720, mx: 'auto' }}>
      {/* Başlık */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <AccessTimeIcon sx={{ color: 'primary.main', fontSize: 28 }} />
          <Typography variant="h6" fontWeight={800}>Mesai Düzeltme Talebi</Typography>
        </Box>
        <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={openDialog}
          sx={{ borderColor: 'primary.main', color: 'primary.main' }}>
          Yeni Talep
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Liste */}
      {loading && requests.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={32} /></Box>
      ) : requests.length === 0 ? (
        <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'rgba(30,41,59,0.4)' }}>
          <AccessTimeIcon sx={{ fontSize: 40, color: 'text.disabled', opacity: 0.4, mb: 1 }} />
          <Typography color="text.secondary">Henüz mesai düzeltme talebiniz yok.</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {requests.map((r) => {
            const color = TIME_CORRECTION_STATUS_COLORS[r.status]
            return (
              <Paper key={r.id} elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'rgba(30,41,59,0.4)' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700}>{fmtDate(r.date)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.requested_start_time.slice(0, 5)} – {r.requested_end_time.slice(0, 5)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{r.reason}</Typography>
                    {r.reviewer_note && (
                      <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
                        Yönetici notu: {r.reviewer_note}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                    <Chip label={TIME_CORRECTION_STATUS_LABELS[r.status]} size="small"
                      sx={{ bgcolor: `${color}20`, color, border: '1px solid', borderColor: `${color}40`, fontWeight: 700, fontSize: '0.68rem' }} />
                    <Typography variant="caption" color="text.disabled">{fmtDateTime(r.created_at)}</Typography>
                  </Box>
                </Box>
              </Paper>
            )
          })}
        </Stack>
      )}

      {/* Yönetici: review paneli */}
      {isManager && (
        <>
          <Divider sx={{ my: 3, borderColor: 'rgba(255,255,255,0.08)' }} />
          <TimeCorrectionReviewPanel />
        </>
      )}

      {/* Talep Oluşturma Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Mesai Düzeltme Talebi Oluştur</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
            <TextField size="small" label="Tarih" type="date" value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              InputLabelProps={{ shrink: true }} fullWidth />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField size="small" label="Giriş Saati" type="time" value={form.start}
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                inputProps={{ step: 300 }} fullWidth />
              <TextField size="small" label="Çıkış Saati" type="time" value={form.end}
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                inputProps={{ step: 300 }} fullWidth />
            </Box>
            <TextField size="small" label="Açıklama / Sebep" value={form.reason} multiline rows={3}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Örn: QR ile giriş yapmayı unutttum, sistem saatleri yanlış kaydetmiş..." fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDialogOpen(false)} color="inherit" disabled={saving}>İptal</Button>
          <Button onClick={() => void handleSubmit()} variant="contained" disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>
            Gönder
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
