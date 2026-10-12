'use client'

import { useState, useCallback } from 'react'
import {
  Box,
  Typography,
  Paper,
  Button,
  Stack,
  Divider,
  CircularProgress,
  Alert,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Tooltip,
  SelectChangeEvent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import BarChartIcon from '@mui/icons-material/BarChart'
import DownloadIcon from '@mui/icons-material/Download'
import SearchIcon from '@mui/icons-material/Search'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import EditNoteIcon from '@mui/icons-material/EditNote'
import type { EmployeeWithRole } from '@/types/employee'
import type { AttendanceReportRow, AttendanceReportSummary, ManualAttendanceOverride } from '@/types/report'
import {
  fetchAttendanceReport,
  buildReportSummary,
  exportReportToCsv,
} from '@/lib/reportRepository'
import { fetchEmployees } from '@/lib/api/employees'
import { format, subDays } from 'date-fns'
import { PageHeader, TableSkeleton } from '@/components/common'

const STATUS_LABELS: Record<string, string> = {
  shift_waiting: 'Gelmedi',
  working: 'Çalışıyor',
  on_break: 'Molada',
  working_after_break: 'Çalışıyor',
  clocked_out: 'Çıkış Yaptı',
  on_leave: 'İzinli',
  upcoming: 'Başlamadı',
}

const STATUS_COLORS: Record<string, string> = {
  shift_waiting: '#ef4444',
  working: '#10b981',
  on_break: '#f59e0b',
  working_after_break: '#10b981',
  clocked_out: '#818cf8',
  on_leave: '#38bdf8',
  upcoming: '#94a3b8',
}

function formatMinutes(mins: number | null): string {
  if (mins === null) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}s ${m}d`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return '—'
  }
}

// ─── Override Dialog ─────────────────────────────────────────

interface OverrideDialogProps {
  open: boolean
  row: AttendanceReportRow | null
  onClose: () => void
  onSave: (override: ManualAttendanceOverride) => Promise<void>
  saving: boolean
}

function OverrideDialog({ open, row, onClose, onSave, saving }: OverrideDialogProps) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Form her açılışta sıfırlanır — üst bileşen key ile yeniden mount eder
  const recordId = row?.record_id ?? null

  const handleSave = async () => {
    if (!recordId) {
      setError('Attendance kaydı bulunamadı — yalnızca mevcut kayıtlar düzenlenebilir.')
      return
    }
    if (!note.trim()) {
      setError('Override sebebini belirtmelisiniz.')
      return
    }
    setError(null)
    try {
      await onSave({ record_id: recordId, exception_note: note })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Override başarısız.')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Manuel Düzeltme</DialogTitle>
      <DialogContent>
        {row && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              <strong>{row.full_name}</strong> — {row.work_date}
            </Typography>
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!recordId && !error && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Bu çalışanın bu tarihe ait attendance kaydı bulunamadı.
          </Alert>
        )}
        <TextField
          fullWidth
          multiline
          rows={3}
          label="Override Sebebi *"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Örn: Sistem hatası nedeniyle manuel düzeltme yapıldı."
          disabled={!recordId}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>İptal</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !recordId || !note.trim()}
        >
          {saving ? <CircularProgress size={18} /> : 'Kaydet'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ─── Main Page ───────────────────────────────────────────────

export function AttendanceReportsPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const weekAgo = format(subDays(new Date(), 6), 'yyyy-MM-dd')

  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [employeesLoaded, setEmployeesLoaded] = useState(false)

  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [dateFrom, setDateFrom] = useState(weekAgo)
  const [dateTo, setDateTo] = useState(today)

  const [rows, setRows] = useState<AttendanceReportRow[]>([])
  const [summaries, setSummaries] = useState<AttendanceReportSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  // Override dialog
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideRow, setOverrideRow] = useState<AttendanceReportRow | null>(null)
  const [overrideKey, setOverrideKey] = useState(0)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [overrideSuccess, setOverrideSuccess] = useState<string | null>(null)

  // Load employees lazily when filter is opened
  const ensureEmployees = useCallback(async () => {
    if (employeesLoaded) return
    try {
      const emps = await fetchEmployees()
      setEmployees(emps)
      setEmployeesLoaded(true)
    } catch {
      // non-critical
    }
  }, [employeesLoaded])

  const handleSearch = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      setError('Başlangıç ve bitiş tarihi zorunludur.')
      return
    }
    if (dateFrom > dateTo) {
      setError('Başlangıç tarihi bitiş tarihinden sonra olamaz.')
      return
    }

    setLoading(true)
    setError(null)
    setHasSearched(true)

    try {
      const data = await fetchAttendanceReport({
        employee_id: selectedEmployee || undefined,
        date_from: dateFrom,
        date_to: dateTo,
      })
      setRows(data)
      setSummaries(buildReportSummary(data))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rapor yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, selectedEmployee])

  const handleExport = () => {
    const csv = exportReportToCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shiftup-attendance-${dateFrom}-${dateTo}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const openOverride = (row: AttendanceReportRow) => {
    setOverrideRow(row)
    setOverrideKey((k) => k + 1)
    setOverrideOpen(true)
    setOverrideSuccess(null)
  }

  const handleOverrideSave = async (override: ManualAttendanceOverride) => {
    setOverrideSaving(true)
    try {
      const res = await fetch('/api/attendance/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        throw new Error(data.error ?? 'Override başarısız.')
      }
      setOverrideOpen(false)
      setOverrideSuccess(`${overrideRow?.full_name} kaydı güncellendi.`)
      // Raporu yenile
      await handleSearch()
    } finally {
      setOverrideSaving(false)
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      <PageHeader
        icon={BarChartIcon}
        overline="Raporlama"
        title="Devam Raporları"
        subtitle="Tarih aralığı ve çalışana göre filtreleyerek rapor oluşturun"
      />

      {/* Filters */}
      <Paper
        elevation={0}
        sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 3 }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'flex-end' }}>
          <TextField
            label="Başlangıç Tarihi"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            size="small"
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 160 }}
          />
          <TextField
            label="Bitiş Tarihi"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            size="small"
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 160 }}
          />
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Çalışan (Opsiyonel)</InputLabel>
            <Select
              value={selectedEmployee}
              label="Çalışan (Opsiyonel)"
              onChange={(e: SelectChangeEvent<string>) => setSelectedEmployee(e.target.value)}
              onOpen={ensureEmployees}
            >
              <MenuItem value="">Tüm Çalışanlar</MenuItem>
              {employees.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {e.full_name}{!e.active && ' (Pasif)'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            startIcon={<SearchIcon />}
            onClick={handleSearch}
            disabled={loading}
            sx={{ height: 40, fontWeight: 700 }}
          >
            {loading ? <CircularProgress size={18} /> : 'Rapor Getir'}
          </Button>
          {rows.length > 0 && (
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
              sx={{ height: 40 }}
            >
              CSV İndir
            </Button>
          )}
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {overrideSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setOverrideSuccess(null)}>
          {overrideSuccess}
        </Alert>
      )}

      {/* Summary Cards */}
      {summaries.length > 0 && (
        <Accordion
          elevation={0}
          defaultExpanded
          sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important' }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={700}>Özet İstatistikler ({summaries.length} çalışan)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {summaries.map((s) => (
                <Paper
                  key={s.employee_id}
                  elevation={0}
                  sx={{
                    p: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    minWidth: 200,
                    flex: '1 1 200px',
                  }}
                >
                  <Typography variant="subtitle2" fontWeight={700} mb={1}>{s.full_name}</Typography>
                  <Stack spacing={0.5}>
                    <SummaryRow label="Toplam Vardiya" value={String(s.total_shifts)} />
                    <SummaryRow label="Katılım" value={`${s.attended_shifts}/${s.expected_shifts}`} />
                    <SummaryRow label="Tamamlanan" value={String(s.clocked_out_count)} color="#818cf8" />
                    <SummaryRow label="Gelmedi" value={String(s.no_show_count)} color="#ef4444" />
                    {s.on_leave_count > 0 && (
                      <SummaryRow label="İzinli" value={String(s.on_leave_count)} color={STATUS_COLORS.on_leave} />
                    )}
                    {s.upcoming_count > 0 && (
                      <SummaryRow label="Başlamadı" value={String(s.upcoming_count)} color={STATUS_COLORS.upcoming} />
                    )}
                    <SummaryRow label="Net Çalışma" value={formatMinutes(s.total_worked_minutes)} color="#10b981" />
                  </Stack>
                </Paper>
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Detail Table */}
      {loading && <TableSkeleton rows={8} columns={8} />}
      {hasSearched && !loading && (
        <>
          {rows.length === 0 ? (
            <Alert severity="info">Seçili tarih aralığında veri bulunamadı.</Alert>
          ) : (
            <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Detay Listesi — {rows.length} kayıt
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}>ÇALIŞAN</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}>TARİH</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}>VARDİYA</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}>DURUM</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}>GİRİŞ</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}>ÇIKIŞ</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}>NET ÇALIŞMA</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}>DOĞRULAMA</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.7rem' }}></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow
                        key={`${row.employee_id}-${row.work_date}-${i}`}
                        hover
                        sx={{ '&:last-child td': { border: 0 } }}
                      >
                        <TableCell>
                          <Typography variant="caption" fontWeight={600}>{row.full_name}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">{row.work_date}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {row.shift_name ?? '—'} {row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={STATUS_LABELS[row.status] ?? row.status}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.65rem',
                              bgcolor: `${STATUS_COLORS[row.status] ?? '#94a3b8'}20`,
                              color: STATUS_COLORS[row.status] ?? '#94a3b8',
                              border: `1px solid ${STATUS_COLORS[row.status] ?? '#94a3b8'}40`,
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">{formatTime(row.clock_in_at)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">{formatTime(row.clock_out_at)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color={row.worked_minutes ? '#10b981' : 'text.disabled'} fontWeight={600}>
                            {formatMinutes(row.worked_minutes)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.disabled">
                            {row.verification_method ?? '—'}
                          </Typography>
                          {row.exception_note && (
                            <Tooltip title={row.exception_note}>
                              <Typography variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
                                ⚠
                              </Typography>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.record_id && (
                            <Tooltip title="Manuel Düzelt">
                              <Box
                                component="span"
                                onClick={() => openOverride(row)}
                                sx={{ cursor: 'pointer', color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
                              >
                                <EditNoteIcon sx={{ fontSize: 16 }} />
                              </Box>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}

      {!hasSearched && !loading && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 10,
            color: 'text.disabled',
            gap: 1,
          }}
        >
          <BarChartIcon sx={{ fontSize: 48, opacity: 0.3 }} />
          <Typography variant="body2">Rapor getirmek için filtre doldurun ve arayın.</Typography>
        </Box>
      )}

      {/* Override Dialog */}
      <OverrideDialog
        key={overrideKey}
        open={overrideOpen}
        row={overrideRow}
        onClose={() => setOverrideOpen(false)}
        onSave={handleOverrideSave}
        saving={overrideSaving}
      />
    </Box>
  )
}

function SummaryRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="caption" fontWeight={700} color={color ?? 'text.primary'}>{value}</Typography>
    </Box>
  )
}

function Divider2() {
  return <Box sx={{ height: 1, bgcolor: 'divider', my: 0.5 }} />
}

void Divider2 // suppress unused warning — kept for potential use
