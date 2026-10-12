'use client'

/**
 * AuditLogPanel — kim, neyi, ne zaman değiştirdi (salt okunur, Mağaza Müdürü+).
 */
import { useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import {
  Alert, Box, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography,
} from '@mui/material'
import { apiFetch } from '@/lib/api/http'
import { ListSkeleton } from '@/components/common'

interface AuditLog {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  before: unknown
  after: unknown
  note: string | null
  created_at: string
  actor: { id: string; full_name: string } | null
}

interface Page { logs: AuditLog[]; next_before: string | null }

const ACTION_LABELS: Record<string, string> = {
  'attendance.override': 'Devam kaydı düzeltildi',
  'attendance.manual': 'Manuel devam işlemi',
  'time_correction.direct': 'Doğrudan mesai düzeltmesi',
  'time_correction.approved': 'Mesai düzeltmesi onaylandı',
  'time_correction.rejected': 'Mesai düzeltmesi reddedildi',
  'leave.approved': 'İzin onaylandı',
  'leave.rejected': 'İzin reddedildi',
  'leave.delete': 'İzin silindi',
  'leave.weekly_rest.assign': 'Hafta tatili atandı',
  'shift_swap': 'Vardiya takası',
  'shift.create': 'Vardiya eklendi',
  'shift.update': 'Vardiya değiştirildi',
  'shift.delete': 'Vardiya silindi',
  'employee.update': 'Çalışan güncellendi',
  'employee.delete': 'Çalışan silindi',
  'workforce.apply': 'Haftalık plan aktarıldı',
  'store_location': 'Mağaza konumu',
  'holiday': 'Resmi tatil',
  'report.timesheet.export': 'Puantaj indirildi',
}

function labelOf(action: string): string {
  const key = Object.keys(ACTION_LABELS)
    .filter((k) => action === k || action.startsWith(`${k}.`))
    .sort((a, b) => b.length - a.length)[0]
  return key ? ACTION_LABELS[key] + (key !== action ? ` (${action.slice(key.length + 1)})` : '') : action
}

const FILTERS = [
  { value: '', label: 'Tümü' },
  { value: 'attendance', label: 'Devam kayıtları' },
  { value: 'time_correction', label: 'Mesai düzeltmeleri' },
  { value: 'leave', label: 'İzinler' },
  { value: 'shift', label: 'Vardiyalar / takas' },
  { value: 'employee', label: 'Çalışanlar' },
]

export function AuditLogPanel() {
  const [action, setAction] = useState('')
  const getKey = (index: number, prev: Page | null) => {
    if (prev && !prev.next_before) return null
    const params = new URLSearchParams({ limit: '50' })
    if (action) params.set('action', action)
    if (index > 0 && prev?.next_before) params.set('before', prev.next_before)
    return `/api/audit-logs?${params}`
  }
  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite(getKey, (url: string) => apiFetch<Page>(url))
  const logs = (data ?? []).flatMap((p) => p.logs)
  const hasMore = !!data?.[data.length - 1]?.next_before

  return (
    <Box>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>İşlem türü</InputLabel>
          <Select value={action} label="İşlem türü" onChange={(e) => setAction(e.target.value)}>
            {FILTERS.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary">Kayıtlar değiştirilemez ve silinemez.</Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error instanceof Error ? error.message : 'Yüklenemedi.'}</Alert>}
      {isLoading && <ListSkeleton count={5} lines={2} />}
      {!isLoading && logs.length === 0 && !error && <Alert severity="info">Kayıt bulunamadı.</Alert>}

      <Stack spacing={1}>
        {logs.map((log) => (
          <Paper key={log.id} elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" fontWeight={700}>{labelOf(log.action)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(log.created_at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block">
              {log.actor?.full_name ?? 'Sistem'} · <Chip size="small" label={log.entity_type} sx={{ height: 18, fontSize: '0.65rem' }} />
              {log.entity_id && <> · <code>{log.entity_id.slice(0, 8)}</code></>}
            </Typography>
            {log.note && <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>Not: {log.note}</Typography>}
            {(log.before != null || log.after != null) && (
              <Box component="details" sx={{ mt: 0.5, '& pre': { m: 0, fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }}>
                <Typography component="summary" variant="caption" sx={{ cursor: 'pointer', color: 'primary.main' }}>Değişiklik ayrıntısı</Typography>
                {log.before != null && <pre>Önce: {JSON.stringify(log.before, null, 2)}</pre>}
                {log.after != null && <pre>Sonra: {JSON.stringify(log.after, null, 2)}</pre>}
              </Box>
            )}
          </Paper>
        ))}
      </Stack>

      {hasMore && (
        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Button onClick={() => void setSize(size + 1)} disabled={isValidating}>Daha fazla yükle</Button>
        </Box>
      )}
    </Box>
  )
}
