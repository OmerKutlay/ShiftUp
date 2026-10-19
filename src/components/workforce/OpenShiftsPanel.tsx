'use client'
/**
 * OpenShiftsPanel — FAZ 11
 *
 * Rol bazlı görünüm:
 *   Yönetici (manager+): Açık vardiya oluşturabilir, iptal edebilir. Claim yapamaz.
 *   Çalışan:             Açık vardiyaları görür ve kendi adına üstlenebilir.
 *                        "Üstlen" butonu her zaman SESSION'daki çalışan adına işlem yapar —
 *                        UI'da çalışan seçici yoktur.
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  Box, Typography, Paper, Button, Chip, CircularProgress, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Stack, FormControl, InputLabel, Select, MenuItem, Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import WorkIcon from '@mui/icons-material/Work'
import BlockIcon from '@mui/icons-material/Block'
import type { OpenShift } from '@/types/workforce'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { DateField, ListSkeleton } from '@/components/common'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { apiFetch } from '@/lib/api/http'
import { fetchRoles } from '@/lib/api/employees'
import { ACCESS } from '@/lib/auth/roles'
import { C } from '@/lib/palette'

const STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  filled: 'Dolduruldu',
  cancelled: 'İptal',
}
const STATUS_COLORS: Record<string, string> = {
  open: C.brand,
  filled: C.success,
  cancelled: C.inkMuted,
}

export function OpenShiftsPanel() {
  const { employee: authEmployee } = useAuth()
  const isManager = hasRole(
    authEmployee?.roles?.access_level ?? null,
    MANAGER_ROLES
  )

  const [actionError, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const shiftsQ = useSWR(`/api/open-shifts?status=${statusFilter}`, (url: string) =>
    apiFetch<{ open_shifts: OpenShift[] }>(url)
  )
  const shifts = shiftsQ.data?.open_shifts ?? []
  // Gerekli rol: sistem rolü adlarından seçilir (üstlenme kontrolü rol adıyla eşleşir)
  const rolesQ = useSWR(isManager ? 'roles' : null, fetchRoles)
  const roleOptions = (rolesQ.data ?? []).filter((r) => r.access_level !== ACCESS.KIOSK)
  const isFirstLoad = !shiftsQ.data && !shiftsQ.error
  const error = actionError ?? (shiftsQ.error ? (shiftsQ.error instanceof Error ? shiftsQ.error.message : 'Yüklenemedi.') : null)
  const [form, setForm] = useState({
    work_date: '',
    start_time: '09:00',
    end_time: '18:00',
    role_needed: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null)

  // Oluşturma/iptal/üstlenme sonrası önbellekteki liste yerinde güncellenir (yeniden çekmeden)
  const setShifts = (update: (prev: OpenShift[]) => OpenShift[]) =>
    shiftsQ.mutate((d) => ({ open_shifts: update(d?.open_shifts ?? []) }), { revalidate: false })

  // ── Açık vardiya oluştur (yönetici) ─────────────────────────
  const handleCreate = async () => {
    if (!form.work_date) { setError('Tarih zorunludur.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/open-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          work_date: form.work_date,
          start_time: form.start_time,
          end_time: form.end_time,
          role_needed: form.role_needed || null,
          description: form.description || null,
        }),
      })
      const json = (await res.json()) as { open_shift: OpenShift; error?: string }
      if (!res.ok) { setError(json.error ?? 'Kaydedilemedi.'); return }
      // Yeni vardiya "open" filtresindeyse listeye ekle
      if (statusFilter === 'open') {
        setShifts((prev) => [json.open_shift, ...prev])
      }
      setDialogOpen(false)
      setForm({ work_date: '', start_time: '09:00', end_time: '18:00', role_needed: '', description: '' })
    } catch {
      setError('Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  // ── Vardiyayı iptal et (yönetici) ────────────────────────────
  const handleCancel = async (shiftId: string) => {
    setCancellingId(shiftId)
    setError(null)
    try {
      const res = await fetch('/api/open-shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: shiftId, status: 'cancelled' }),
      })
      const json = (await res.json()) as { open_shift: OpenShift; error?: string }
      if (!res.ok) { setError(json.error ?? 'İptal edilemedi.'); return }
      setShifts((prev) => prev.map((s) => (s.id === shiftId ? json.open_shift : s)))
    } catch {
      setError('İşlem başarısız.')
    } finally {
      setCancellingId(null)
    }
  }

  // ── Vardiyayı üstlen (çalışan — session üzerinden) ───────────
  const handleClaim = async (shiftId: string) => {
    setClaimingId(shiftId)
    setError(null)
    setClaimSuccess(null)
    try {
      const res = await fetch('/api/open-shifts/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ open_shift_id: shiftId }),
      })
      const json = (await res.json()) as { open_shift: OpenShift; error?: string }
      if (!res.ok) { setError(json.error ?? 'Üstlenme başarısız.'); return }
      setShifts((prev) => prev.map((s) => (s.id === shiftId ? json.open_shift : s)))
      setClaimSuccess('Vardiya başarıyla üstlenildi ve takviminize eklendi.')
    } catch {
      setError('İşlem başarısız.')
    } finally {
      setClaimingId(null)
    }
  }

  // ─── Render ──────────────────────────────────────────────────
  return (
    <Box>
      {/* Başlık satırı */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Durum</InputLabel>
          <Select
            value={statusFilter}
            label="Durum"
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <MenuItem value="open">Açık</MenuItem>
            <MenuItem value="filled">Dolduruldu</MenuItem>
            <MenuItem value="cancelled">İptal</MenuItem>
          </Select>
        </FormControl>

        {/* Oluştur butonu yalnızca yöneticilere görünür */}
        {isManager && (
          <Button
            startIcon={<AddIcon />}
            variant="outlined"
            size="small"
            onClick={() => setDialogOpen(true)}
            sx={{ borderColor: 'primary.main', color: 'primary.main' }}
          >
            Açık Vardiya Oluştur
          </Button>
        )}
      </Box>

      {/* Çalışan için bilgi notu */}
      {!isManager && statusFilter === 'open' && (
        <Alert severity="info" sx={{ mb: 2, borderRadius: 1.5 }}>
          Açık vardiyaları görerek kendi adınıza üstlenebilirsiniz.
          <Box component="span" fontWeight={700}> Üstlen</Box> butonuna basmanız yeterli.
        </Alert>
      )}

      {/* Başarı mesajı */}
      {claimSuccess && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          onClose={() => setClaimSuccess(null)}
        >
          {claimSuccess}
        </Alert>
      )}

      {/* Hata mesajı */}
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Liste */}
      {isFirstLoad ? (
        <ListSkeleton count={4} avatar={false} lines={2} actions={2} dense />
      ) : shifts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {statusFilter === 'open'
            ? 'Şu an açık vardiya bulunmuyor.'
            : 'Bu durumda vardiya bulunamadı.'}
        </Typography>
      ) : (
        <Stack gap={1}>
          {shifts.map((shift) => (
            <Paper
              key={shift.id}
              sx={{
                p: 1.5,
                bgcolor: C.surface,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 1,
                }}
              >
                {/* Sol: vardiya bilgisi */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <WorkIcon sx={{ color: STATUS_COLORS[shift.status], fontSize: 18 }} />
                  <Box>
                    <Typography variant="body2" fontWeight={700}>
                      {format(new Date(shift.work_date), 'd MMMM yyyy', { locale: tr })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                      {shift.role_needed ? ` · ${shift.role_needed}` : ''}
                      {shift.description ? ` · ${shift.description}` : ''}
                    </Typography>
                  </Box>
                </Box>

                {/* Sağ: durum + aksiyon */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={STATUS_LABELS[shift.status]}
                    size="small"
                    sx={{
                      bgcolor: `${STATUS_COLORS[shift.status]}22`,
                      color: STATUS_COLORS[shift.status],
                      fontWeight: 700,
                      fontSize: '0.65rem',
                    }}
                  />

                  {/* Açık vardiya — çalışan üstlenebilir, yönetici iptal edebilir */}
                  {shift.status === 'open' && !isManager && (
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => void handleClaim(shift.id)}
                      disabled={claimingId === shift.id}
                      sx={{ fontSize: '0.72rem', py: 0.25 }}
                    >
                      {claimingId === shift.id ? <CircularProgress size={14} /> : 'Üstlen'}
                    </Button>
                  )}

                  {shift.status === 'open' && isManager && (
                    <Tooltip title="Vardiyayı iptal et">
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => void handleCancel(shift.id)}
                        disabled={cancellingId === shift.id}
                        startIcon={
                          cancellingId === shift.id
                            ? <CircularProgress size={12} />
                            : <BlockIcon fontSize="small" />
                        }
                        sx={{ fontSize: '0.72rem', py: 0.25 }}
                      >
                        İptal
                      </Button>
                    </Tooltip>
                  )}

                  {/* Dolduruldu — kimin üstlendiği */}
                  {shift.status === 'filled' && shift.filled_by_employee && (
                    <Typography variant="caption" color="success.main" fontWeight={600}>
                      {shift.filled_by_employee.full_name}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Açık vardiya oluşturma dialog'u — yalnızca yönetici */}
      {isManager && (
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Açık Vardiya Oluştur</DialogTitle>
          <DialogContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}
          >
            <Typography variant="caption" color="text.secondary">
              Oluşturulan vardiya anonim olarak açık havuza eklenir.
              İstekli çalışanlar kendi hesaplarından üstlenebilir.
            </Typography>

            <DateField
              size="small"
              label="Tarih"
              value={form.work_date}
              onChange={(v) => setForm((f) => ({ ...f, work_date: v }))}
              fullWidth
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                size="small"
                label="Başlangıç"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                inputProps={{ step: 300 }}
                fullWidth
              />
              <TextField
                size="small"
                label="Bitiş"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                inputProps={{ step: 300 }}
                fullWidth
              />
            </Box>
            <TextField
              size="small"
              select
              label="Gerekli Rol (opsiyonel)"
              value={form.role_needed}
              onChange={(e) => setForm((f) => ({ ...f, role_needed: e.target.value }))}
              fullWidth
            >
              <MenuItem value=""><em>Herkes</em></MenuItem>
              {roleOptions.map((r) => (
                <MenuItem key={r.id} value={r.name}>{r.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Açıklama (opsiyonel)"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)} color="inherit">
              İptal
            </Button>
            <Button onClick={() => void handleCreate()} variant="contained" disabled={saving}>
              {saving ? <CircularProgress size={18} /> : 'Oluştur'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
