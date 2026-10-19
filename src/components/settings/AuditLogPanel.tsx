'use client'

/**
 * AuditLogPanel — kim, neyi, ne zaman değiştirdi (salt okunur, Mağaza Müdürü+).
 * Ham kayıtlar auditFormat ile okunur metne çevrilir; id / JSON gösterilmez.
 */
import { useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import {
  Alert, Box, Button, Collapse, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography,
} from '@mui/material'
import type { SvgIconComponent } from '@mui/icons-material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import BeachAccessIcon from '@mui/icons-material/BeachAccess'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import EventIcon from '@mui/icons-material/Event'
import PersonIcon from '@mui/icons-material/Person'
import CalendarViewWeekIcon from '@mui/icons-material/CalendarViewWeek'
import PlaceIcon from '@mui/icons-material/Place'
import CelebrationIcon from '@mui/icons-material/Celebration'
import DescriptionIcon from '@mui/icons-material/Description'
import HistoryIcon from '@mui/icons-material/History'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { apiFetch } from '@/lib/api/http'
import { ListSkeleton } from '@/components/common'
import {
  auditActionLabel, auditChanges, auditSummary, splitAuditNote, type AuditRefs,
} from '@/lib/auditFormat'
import { C, tint } from '@/lib/palette'

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
  subject_ids: string[]
}

interface Page { logs: AuditLog[]; refs: AuditRefs; next_before: string | null }

const GROUP_ICONS: { prefix: string; icon: SvgIconComponent; color: string }[] = [
  { prefix: 'attendance', icon: AccessTimeIcon, color: C.brand },
  { prefix: 'time_correction', icon: AccessTimeIcon, color: C.brand },
  { prefix: 'leave', icon: BeachAccessIcon, color: C.warning },
  { prefix: 'shift_swap', icon: SwapHorizIcon, color: C.plum },
  { prefix: 'shift', icon: EventIcon, color: C.info },
  { prefix: 'employee', icon: PersonIcon, color: C.plum },
  { prefix: 'workforce', icon: CalendarViewWeekIcon, color: C.info },
  { prefix: 'store_location', icon: PlaceIcon, color: C.success },
  { prefix: 'holiday', icon: CelebrationIcon, color: C.plum },
  { prefix: 'report', icon: DescriptionIcon, color: C.inkMuted },
]

function groupOf(action: string) {
  return GROUP_ICONS.find((g) => action === g.prefix || action.startsWith(`${g.prefix}.`))
    ?? { icon: HistoryIcon, color: C.inkMuted }
}

const FILTERS = [
  { value: '', label: 'Tümü' },
  { value: 'attendance', label: 'Devam kayıtları' },
  { value: 'time_correction', label: 'Mesai düzeltmeleri' },
  { value: 'leave', label: 'İzinler' },
  { value: 'shift', label: 'Vardiyalar ve takaslar' },
  { value: 'workforce', label: 'Haftalık plan' },
  { value: 'employee', label: 'Çalışanlar' },
  { value: 'holiday', label: 'Resmi tatiller' },
  { value: 'store_location', label: 'Mağaza konumu' },
  { value: 'report', label: 'Raporlar' },
]

const dateTimeFmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
})

function AuditLogCard({ log, refs }: { log: AuditLog; refs: AuditRefs }) {
  const [open, setOpen] = useState(false)
  const { icon: Icon, color } = groupOf(log.action)
  const summary = auditSummary(log)
  const changes = auditChanges(log, refs)
  const note = log.note ? splitAuditNote(log.note) : null
  const subjects = log.subject_ids.map((id) => refs.employees[id]).filter(Boolean)
  // Kişi kendi kaydında işlem yaptıysa "Çalışan" satırı tekrar etmesin
  const showSubjects = subjects.length > 0 && !(subjects.length === 1 && subjects[0] === log.actor?.full_name)

  return (
    <Paper elevation={0} sx={{ p: 1.75, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <Box sx={{
          width: 34, height: 34, borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: `${color}1f`, color,
        }}>
          <Icon sx={{ fontSize: 18 }} />
        </Box>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={700}>{auditActionLabel(log.action)}</Typography>
            <Typography variant="caption" color="text.secondary">{dateTimeFmt.format(new Date(log.created_at))}</Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" component="div">
            {log.actor?.full_name ?? 'Sistem'} tarafından
            {showSubjects && (
              <> · {subjects.length > 1 ? 'Çalışanlar' : 'Çalışan'}: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{subjects.join(' ↔ ')}</Box></>
            )}
          </Typography>

          {summary && <Typography variant="body2" sx={{ mt: 0.5 }}>{summary}</Typography>}

          {note && (
            <Box sx={{ mt: 1, pl: 1.25, borderLeft: '2px solid', borderColor: note.items.length > 1 || note.title !== 'Not' ? 'warning.main' : 'divider' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600} display="block">{note.title}</Typography>
              {note.items.length === 1 ? (
                <Typography variant="caption" display="block">{note.items[0]}</Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {note.items.map((it, i) => <Typography key={i} component="li" variant="caption">{it}</Typography>)}
                </Box>
              )}
            </Box>
          )}

          {changes.length > 0 && (
            <>
              <Button
                size="small"
                onClick={() => setOpen((o) => !o)}
                endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />}
                sx={{ mt: 0.5, ml: -1, minHeight: 30, fontSize: '0.75rem' }}
              >
                {open ? 'Ayrıntıları gizle' : 'Ayrıntıları göster'}
              </Button>
              <Collapse in={open} unmountOnExit>
                <Box sx={{
                  mt: 0.5, p: 1.25, borderRadius: 1.5, bgcolor: tint(C.canvas, 0.5),
                  display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(140px, auto) 1fr' }, columnGap: 2, rowGap: { xs: 0.25, sm: 0.75 },
                }}>
                  {changes.map((c) => (
                    <Box key={c.label} sx={{ display: 'contents' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: { xs: 0.75, sm: 0 } }}>{c.label}</Typography>
                      <Typography variant="caption" component="div" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                        {c.before !== undefined && (
                          <Box component="span" sx={{ color: 'text.secondary', textDecoration: c.after !== undefined ? 'line-through' : 'none' }}>
                            {c.before}
                          </Box>
                        )}
                        {c.before !== undefined && c.after !== undefined && <ArrowForwardIcon sx={{ fontSize: 12, color: 'text.disabled' }} />}
                        {c.after !== undefined && <Box component="span" sx={{ fontWeight: 600 }}>{c.after}</Box>}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Collapse>
            </>
          )}
        </Box>
      </Box>
    </Paper>
  )
}

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
  // Sayfaların isim sözlüklerini birleştir
  const refs: AuditRefs = {
    employees: Object.assign({}, ...(data ?? []).map((p) => p.refs?.employees ?? {})),
    roles: Object.assign({}, ...(data ?? []).map((p) => p.refs?.roles ?? {})),
  }
  const hasMore = !!data?.[data.length - 1]?.next_before

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
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
        {logs.map((log) => <AuditLogCard key={log.id} log={log} refs={refs} />)}
      </Stack>

      {hasMore && (
        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Button onClick={() => void setSize(size + 1)} disabled={isValidating}>Daha fazla yükle</Button>
        </Box>
      )}
    </Box>
  )
}
