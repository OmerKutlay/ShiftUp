'use client'

import { useState, useCallback } from 'react'
import {
  Box,
  Typography,
  Paper,
  Button,
  Stack,
  CircularProgress,
  Alert,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  useMediaQuery,
  useTheme,
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
import { tr } from 'date-fns/locale'
import { DateField, EmployeeSelect, PageHeader, TableSkeleton } from '@/components/common'
import { isKioskRole } from '@/lib/auth/roles'
import { C } from '@/lib/palette'

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
  shift_waiting: C.danger,
  working: C.success,
  on_break: C.warning,
  working_after_break: C.success,
  clocked_out: C.plum,
  on_leave: C.info,
  upcoming: C.inkMuted,
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

/** "10 Eki 2026, Cts" biçimi */
function formatDateTr(workDate: string): string {
  try {
    return format(new Date(`${workDate}T12:00:00`), 'd MMM yyyy, EEE', { locale: tr })
  } catch {
    return workDate
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

/** embedded: sekmeli Raporlar sayfasının içinde (başlık ve sayfa dolgusu olmadan) */
export function AttendanceReportsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
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
      setEmployees(emps.filter((e) => !isKioskRole(e.roles?.name)))
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
    <Box sx={embedded ? undefined : { p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>
      {!embedded && (
        <PageHeader
          icon={BarChartIcon}
          overline="Raporlama"
          title="Devam Raporları"
          subtitle="Tarih aralığı ve çalışana göre filtreleyerek rapor oluşturun"
        />
      )}

      {/* Filters */}
      <Paper
        elevation={0}
        sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 3 }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'flex-end' }}>
          <DateField
            label="Başlangıç Tarihi"
            value={dateFrom}
            onChange={setDateFrom}
            max={dateTo || undefined}
            size="small"
            sx={{ minWidth: 210 }}
          />
          <DateField
            label="Bitiş Tarihi"
            value={dateTo}
            onChange={setDateTo}
            min={dateFrom || undefined}
            size="small"
            sx={{ minWidth: 210 }}
          />
          <EmployeeSelect
            employees={employees}
            value={selectedEmployee}
            label="Çalışan (Opsiyonel)"
            emptyLabel="Tüm Çalışanlar"
            onChange={setSelectedEmployee}
            onOpen={ensureEmployees}
            sx={{ minWidth: 240 }}
          />
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
          defaultExpanded={!isMobile}
          sx={{ mb: 3, border: '1px solid', borderColor: 'divider', borderRadius: '8px !important' }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight={700}>Özet İstatistikler ({summaries.length} çalışan)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            {isMobile ? (
              // Mobil: çalışan başına yoğun tek blok (ad + satır içi istatistikler)
              <Stack spacing={1}>
                {summaries.map((s) => (
                  <Paper
                    key={s.employee_id}
                    elevation={0}
                    sx={{ px: 1.5, py: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
                      <Typography variant="body2" fontWeight={700} noWrap>{s.full_name}</Typography>
                      <Typography variant="caption" fontWeight={700} color={C.success} sx={{ flexShrink: 0 }}>
                        {formatMinutes(s.total_worked_minutes)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, mt: 0.25 }}>
                      <Typography variant="caption" color="text.secondary">
                        Katılım <b>{s.attended_shifts}/{s.expected_shifts}</b>
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Tamamlanan <b style={{ color: C.plum }}>{s.clocked_out_count}</b>
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Gelmedi <b style={{ color: C.danger }}>{s.no_show_count}</b>
                      </Typography>
                      {s.on_leave_count > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          İzinli <b style={{ color: STATUS_COLORS.on_leave }}>{s.on_leave_count}</b>
                        </Typography>
                      )}
                      {s.upcoming_count > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          Başlamadı <b style={{ color: STATUS_COLORS.upcoming }}>{s.upcoming_count}</b>
                        </Typography>
                      )}
                    </Box>
                  </Paper>
                ))}
              </Stack>
            ) : (
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
                    <SummaryRow label="Tamamlanan" value={String(s.clocked_out_count)} color={C.plum} />
                    <SummaryRow label="Gelmedi" value={String(s.no_show_count)} color={C.danger} />
                    {s.on_leave_count > 0 && (
                      <SummaryRow label="İzinli" value={String(s.on_leave_count)} color={STATUS_COLORS.on_leave} />
                    )}
                    {s.upcoming_count > 0 && (
                      <SummaryRow label="Başlamadı" value={String(s.upcoming_count)} color={STATUS_COLORS.upcoming} />
                    )}
                    <SummaryRow label="Net Çalışma" value={formatMinutes(s.total_worked_minutes)} color={C.success} />
                  </Stack>
                </Paper>
              ))}
            </Box>
            )}
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
              {isMobile ? (
                <Stack divider={<Box sx={{ height: 1, bgcolor: 'divider' }} />}>
                  {rows.map((row, i) => {
                    const color = STATUS_COLORS[row.status] ?? C.inkMuted
                    return (
                      <Box key={`${row.employee_id}-${row.work_date}-${i}`} sx={{ p: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={700}>{row.full_name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatDateTr(row.work_date)} · {row.shift_name ? `${row.shift_name} ` : ''}
                              {row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                            <Chip
                              label={STATUS_LABELS[row.status] ?? row.status}
                              size="small"
                              sx={{
                                height: 22,
                                fontSize: '0.7rem',
                                bgcolor: `${color}20`,
                                color,
                                border: `1px solid ${color}40`,
                              }}
                            />
                            {row.record_id && (
                              <IconButton
                                aria-label="Manuel düzelt"
                                onClick={() => openOverride(row)}
                                sx={{ width: 36, height: 36, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                              >
                                <EditNoteIcon fontSize="small" />
                              </IconButton>
                            )}
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.25, mt: 0.75 }}>
                          <Typography variant="caption">Giriş: {formatTime(row.clock_in_at)}</Typography>
                          <Typography variant="caption">Çıkış: {formatTime(row.clock_out_at)}</Typography>
                          <Typography variant="caption" color={row.worked_minutes ? C.success : 'text.disabled'} fontWeight={600}>
                            Net: {formatMinutes(row.worked_minutes)}
                          </Typography>
                          <Typography variant="caption" color="text.disabled">
                            Doğrulama: {row.verification_method ?? '—'}
                          </Typography>
                        </Box>
                        {row.exception_note && (
                          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                            ⚠ {row.exception_note}
                          </Typography>
                        )}
                      </Box>
                    )
                  })}
                </Stack>
              ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.75rem' }}>Çalışan</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.75rem' }}>Tarih</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.75rem' }}>Vardiya</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.75rem' }}>Durum</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.75rem' }}>Giriş</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.75rem' }}>Çıkış</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.75rem' }}>Net Çalışma</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700, fontSize: '0.75rem' }}>Doğrulama</TableCell>
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
                          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{formatDateTr(row.work_date)}</Typography>
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
                              bgcolor: `${STATUS_COLORS[row.status] ?? C.inkMuted}20`,
                              color: STATUS_COLORS[row.status] ?? C.inkMuted,
                              border: `1px solid ${STATUS_COLORS[row.status] ?? C.inkMuted}40`,
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
                          <Typography variant="caption" color={row.worked_minutes ? C.success : 'text.disabled'} fontWeight={600}>
                            {formatMinutes(row.worked_minutes)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.disabled">
                            {row.verification_method ?? '—'}
                          </Typography>
                          {row.exception_note && (
                            <Tooltip title={row.exception_note} enterTouchDelay={0} leaveTouchDelay={4000}>
                              <Typography variant="caption" color="warning.main" sx={{ ml: 0.5, cursor: 'help' }}>
                                ⚠
                              </Typography>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.record_id && (
                            <Tooltip title="Manuel Düzelt">
                              <IconButton
                                size="small"
                                aria-label="Manuel düzelt"
                                onClick={() => openOverride(row)}
                                sx={{ color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
                              >
                                <EditNoteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              )}
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
