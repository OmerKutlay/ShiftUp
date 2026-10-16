'use client'

/**
 * HolidaysPanel — resmi tatil takvimi yönetimi (Mağaza Müdürü+).
 * Dini bayram tarihleri her yıl değiştiği için yıllık olarak buradan güncellenir.
 */
import { useState } from 'react'
import useSWR from 'swr'
import {
  Alert, Box, Button, Checkbox, Chip, FormControlLabel, IconButton, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import { apiFetch } from '@/lib/api/http'
import type { PublicHoliday } from '@/types/holiday'
import { turkeyToday } from '@/lib/dateUtils'
import { DateField, TableSkeleton } from '@/components/common'

export function HolidaysPanel() {
  const year = Number(turkeyToday().slice(0, 4))
  const [range] = useState({ from: `${year - 1}-01-01`, to: `${year + 1}-12-31` })
  const key = `/api/holidays?from=${range.from}&to=${range.to}`
  const { data, error, mutate, isLoading } = useSWR(key, (url: string) => apiFetch<{ holidays: PublicHoliday[] }>(url))

  const [form, setForm] = useState({ date: '', name: '', half_day: false })
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const save = async () => {
    if (!form.date || !form.name.trim()) { setActionError('Tarih ve ad zorunludur.'); return }
    setSaving(true); setActionError(null)
    try {
      await apiFetch('/api/holidays', { method: 'POST', body: form })
      setForm({ date: '', name: '', half_day: false })
      await mutate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (date: string) => {
    if (!window.confirm(`${date} tarihli resmi tatil silinsin mi?`)) return
    try {
      await apiFetch(`/api/holidays?date=${date}`, { method: 'DELETE' })
      await mutate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Silinemedi.')
    }
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Resmi tatiller planlamada işaretlenir, puantajda RT / RTÇ olarak görünür ve yıllık izinden sayılmaz.
        Dini bayram tarihlerini her yıl Diyanet takvimine göre kontrol edin. Arife günleri 13:00&apos;ten itibaren yarım gündür.
      </Typography>

      <Paper elevation={0} sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <DateField
            label="Tarih" size="small" value={form.date}
            onChange={(v) => setForm((f) => ({ ...f, date: v }))}
            sx={{ minWidth: 210 }}
          />
          <TextField
            label="Ad" size="small" value={form.name} sx={{ flex: 1 }}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <FormControlLabel
            control={<Checkbox checked={form.half_day} onChange={(e) => setForm((f) => ({ ...f, half_day: e.target.checked }))} />}
            label="Yarım gün (arife)"
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => void save()} disabled={saving}>
            Ekle / Güncelle
          </Button>
        </Stack>
      </Paper>

      {(actionError || error) && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={actionError ? () => setActionError(null) : undefined}>
          {actionError ?? (error instanceof Error ? error.message : 'Yüklenemedi.')}
        </Alert>
      )}
      {isLoading && !data && <TableSkeleton rows={6} columns={3} />}

      {data && (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tarih</TableCell>
                <TableCell>Ad</TableCell>
                <TableCell>Tür</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.holidays.map((h) => (
                <TableRow key={h.date} hover>
                  <TableCell>{new Date(`${h.date}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short' })}</TableCell>
                  <TableCell>{h.name}</TableCell>
                  <TableCell>{h.half_day ? <Chip size="small" label="Yarım gün" /> : <Chip size="small" label="Tam gün" color="warning" variant="outlined" />}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Sil">
                      <IconButton size="small" aria-label={`${h.name} sil`} onClick={() => void remove(h.date)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {data.holidays.length === 0 && (
                <TableRow><TableCell colSpan={4}>Kayıtlı resmi tatil yok.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
