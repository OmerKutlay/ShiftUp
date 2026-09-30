'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Divider,
  Paper,
  Chip,
  Tooltip,
  useMediaQuery,
  useTheme,
  Stack,
} from '@mui/material'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import { formatTime } from '@/types/shiftTemplate'
import {
  fetchWeeklyAssignments,
  getWeekDays,
  createShiftAssignment,
  updateShiftAssignment,
  deleteShiftAssignment,
} from '@/lib/scheduleRepository'
import { fetchActiveEmployees } from '@/lib/employeeRepository'
import { fetchActiveShiftTemplates } from '@/lib/shiftTemplateRepository'
import { WeekNavigator } from './WeekNavigator'
import { ShiftAssignDialog } from './ShiftAssignDialog'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

// Türkçe kısa gün adları
const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

export function WeeklySchedulePage() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignmentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogEmployee, setDialogEmployee] = useState<EmployeeWithRole | null>(null)
  const [dialogDate, setDialogDate] = useState('')
  const [dialogExisting, setDialogExisting] = useState<ShiftAssignmentWithDetails | null>(null)
  const [saving, setSaving] = useState(false)

  const weekDays = getWeekDays(currentWeek)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [emps, tmpls, asgns] = await Promise.all([
        fetchActiveEmployees(),
        fetchActiveShiftTemplates(),
        fetchWeeklyAssignments(currentWeek),
      ])
      setEmployees(emps)
      setTemplates(tmpls)
      setAssignments(asgns)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası.')
    } finally {
      setLoading(false)
    }
  }, [currentWeek])

  useEffect(() => {
    void load() // eslint-disable-line react-hooks/set-state-in-effect
  }, [load])

  // Hafta değişince yeniden yükle
  const handleWeekChange = (newWeek: Date) => {
    setCurrentWeek(newWeek)
  }

  // Assignment map: key = `${employee_id}:${work_date}`
  const assignmentMap = new Map<string, ShiftAssignmentWithDetails>()
  assignments.forEach((a) => {
    assignmentMap.set(`${a.employee_id}:${a.work_date}`, a)
  })

  // Grid entries
  const scheduleEntries: WeeklyScheduleEntry[] = employees.map((emp) => ({
    employee: emp,
    dayAssignments: Object.fromEntries(
      weekDays.map((d) => [d, assignmentMap.get(`${emp.id}:${d}`) ?? null])
    ),
  }))

  // Dialog handlers
  const openAssignDialog = (emp: EmployeeWithRole, date: string) => {
    const existing = assignmentMap.get(`${emp.id}:${date}`) ?? null
    setDialogEmployee(emp)
    setDialogDate(date)
    setDialogExisting(existing)
    setDialogOpen(true)
  }

  const handleSave = async (templateId: string) => {
    if (!dialogEmployee) return
    setSaving(true)
    try {
      const tpl = templates.find((t) => t.id === templateId)
      if (!tpl) throw new Error('Şablon bulunamadı.')

      if (dialogExisting) {
        await updateShiftAssignment(dialogExisting.id, dialogEmployee.id, dialogDate, {
          shift_template_id: templateId,
          start_time: tpl.start_time.slice(0, 5),
          end_time: tpl.end_time.slice(0, 5),
        })
      } else {
        await createShiftAssignment(
          {
            employee_id: dialogEmployee.id,
            shift_template_id: templateId,
            work_date: dialogDate,
            start_time: tpl.start_time.slice(0, 5),
            end_time: tpl.end_time.slice(0, 5),
          },
          dialogEmployee.active
        )
      }
      setDialogOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!dialogExisting) return
    setSaving(true)
    try {
      await deleteShiftAssignment(dialogExisting.id)
      setDialogOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (isMobile) {
    return <MobileScheduleView
      scheduleEntries={scheduleEntries}
      weekDays={weekDays}
      loading={loading}
      error={error}
      currentWeek={currentWeek}
      onWeekChange={handleWeekChange}
      onCellClick={openAssignDialog}
      dialogOpen={dialogOpen}
      dialogEmployee={dialogEmployee}
      dialogDate={dialogDate}
      dialogExisting={dialogExisting}
      templates={templates}
      saving={saving}
      onSave={handleSave}
      onDelete={handleDelete}
      onDialogClose={() => setDialogOpen(false)}
    />
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <CalendarMonthIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
            Planlama
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Typography variant="h5" fontWeight={800}>
            Haftalık Vardiya Planı
          </Typography>
          <WeekNavigator currentWeek={currentWeek} onChange={handleWeekChange} />
        </Box>
      </Box>

      <Divider sx={{ mb: 3, borderColor: 'rgba(255,255,255,0.08)' }} />

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress color="primary" />
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && scheduleEntries.length === 0 && (
        <Alert severity="info">Aktif çalışan bulunamadı.</Alert>
      )}

      {/* Desktop Grid */}
      {!loading && !error && scheduleEntries.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {/* Header row */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '180px repeat(7, 1fr)',
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: 'rgba(15,23,42,0.8)',
            }}
          >
            <Box sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                Çalışan
              </Typography>
            </Box>
            {weekDays.map((d, i) => {
              const isToday = d === format(new Date(), 'yyyy-MM-dd')
              return (
                <Box
                  key={d}
                  sx={{
                    p: 1.5,
                    textAlign: 'center',
                    borderLeft: '1px solid',
                    borderColor: 'divider',
                    bgcolor: isToday ? 'rgba(20,184,166,0.06)' : 'transparent',
                  }}
                >
                  <Typography
                    variant="caption"
                    fontWeight={700}
                    color={isToday ? 'primary.main' : 'text.secondary'}
                    display="block"
                  >
                    {DAY_LABELS[i]}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={isToday ? 'primary.main' : 'text.disabled'}
                    fontSize="0.65rem"
                  >
                    {format(new Date(d + 'T00:00:00'), 'd MMM', { locale: tr })}
                  </Typography>
                </Box>
              )
            })}
          </Box>

          {/* Employee rows */}
          {scheduleEntries.map((entry, rowIdx) => (
            <Box
              key={entry.employee.id}
              sx={{
                display: 'grid',
                gridTemplateColumns: '180px repeat(7, 1fr)',
                borderBottom: rowIdx < scheduleEntries.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.01)' },
              }}
            >
              {/* Employee name cell */}
              <Box
                sx={{
                  p: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  borderRight: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" fontWeight={700} color="text.primary" noWrap>
                  {entry.employee.full_name}
                </Typography>
                <Typography variant="caption" color="text.disabled" fontSize="0.65rem" noWrap>
                  {entry.employee.role}
                </Typography>
              </Box>

              {/* Day cells */}
              {weekDays.map((d) => {
                const asgn = entry.dayAssignments[d]
                const isToday = d === format(new Date(), 'yyyy-MM-dd')
                return (
                  <ShiftCell
                    key={d}
                    assignment={asgn}
                    isToday={isToday}
                    onClick={() => openAssignDialog(entry.employee, d)}
                  />
                )
              })}
            </Box>
          ))}
        </Paper>
      )}

      {/* Assign Dialog */}
      <ShiftAssignDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        onDelete={dialogExisting ? handleDelete : undefined}
        employee={dialogEmployee}
        workDate={dialogDate}
        templates={templates}
        existingAssignment={dialogExisting}
        loading={saving}
      />
    </Box>
  )
}

// ----------------------------------------------------------------
// Shift cell component
// ----------------------------------------------------------------
function ShiftCell({
  assignment,
  isToday,
  onClick,
}: {
  assignment: ShiftAssignmentWithDetails | null
  isToday: boolean
  onClick: () => void
}) {
  if (!assignment) {
    return (
      <Box
        onClick={onClick}
        sx={{
          borderLeft: '1px solid',
          borderColor: 'divider',
          bgcolor: isToday ? 'rgba(20,184,166,0.03)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 64,
          cursor: 'pointer',
          '&:hover': {
            bgcolor: 'rgba(20,184,166,0.08)',
            '& .add-icon': { opacity: 1 },
          },
        }}
      >
        <AddIcon
          className="add-icon"
          sx={{ fontSize: 16, color: 'text.disabled', opacity: 0, transition: 'opacity 0.15s' }}
        />
      </Box>
    )
  }

  // FAZ 12: İzinli vardiya
  if (assignment.is_on_leave) {
    return (
      <Tooltip title="İzin onaylandı — bu gün için izinli" placement="top">
        <Box
          onClick={onClick}
          sx={{
            borderLeft: '1px solid',
            borderColor: 'divider',
            bgcolor: 'rgba(251,191,36,0.08)',
            p: 0.75,
            minHeight: 64,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 0.4,
            '&:hover': { bgcolor: 'rgba(251,191,36,0.14)' },
          }}
        >
          <Typography variant="caption" fontWeight={700} color="warning.main" fontSize="0.7rem">
            İzinli
          </Typography>
          <Typography variant="caption" color="text.disabled" fontSize="0.6rem">
            {formatTime(assignment.start_time)}–{formatTime(assignment.end_time)}
          </Typography>
        </Box>
      </Tooltip>
    )
  }

  const tpl = assignment.shift_templates
  const name = tpl?.name ?? '—'
  const start = formatTime(assignment.start_time)
  const end = formatTime(assignment.end_time)

  return (
    <Tooltip title={`${name}: ${start}–${end}`} placement="top">
      <Box
        onClick={onClick}
        sx={{
          borderLeft: '1px solid',
          borderColor: 'divider',
          bgcolor: isToday ? 'rgba(20,184,166,0.05)' : 'rgba(99,102,241,0.05)',
          p: 0.75,
          minHeight: 64,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 0.4,
          '&:hover': { bgcolor: 'rgba(99,102,241,0.12)' },
        }}
      >
        <Typography variant="caption" fontWeight={700} color="secondary.main" fontSize="0.7rem" noWrap>
          {name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
          <AccessTimeIcon sx={{ fontSize: 10, color: 'text.disabled' }} />
          <Typography variant="caption" color="text.disabled" fontSize="0.65rem">
            {start}–{end}
          </Typography>
        </Box>
        <EditIcon sx={{ fontSize: 10, color: 'text.disabled', alignSelf: 'flex-end' }} />
      </Box>
    </Tooltip>
  )
}

// ----------------------------------------------------------------
// Mobile view — stacked employee cards
// ----------------------------------------------------------------
interface MobileViewProps {
  scheduleEntries: WeeklyScheduleEntry[]
  weekDays: string[]
  loading: boolean
  error: string | null
  currentWeek: Date
  onWeekChange: (d: Date) => void
  onCellClick: (emp: EmployeeWithRole, date: string) => void
  dialogOpen: boolean
  dialogEmployee: EmployeeWithRole | null
  dialogDate: string
  dialogExisting: ShiftAssignmentWithDetails | null
  templates: ShiftTemplate[]
  saving: boolean
  onSave: (templateId: string) => Promise<void>
  onDelete: () => Promise<void>
  onDialogClose: () => void
}

function MobileScheduleView({
  scheduleEntries, weekDays, loading, error, currentWeek, onWeekChange,
  onCellClick, dialogOpen, dialogEmployee, dialogDate, dialogExisting,
  templates, saving, onSave, onDelete, onDialogClose,
}: MobileViewProps) {
  return (
    <Box sx={{ p: 2, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" fontWeight={800} mb={1.5}>Haftalık Plan</Typography>
        <WeekNavigator currentWeek={currentWeek} onChange={onWeekChange} />
      </Box>

      <Divider sx={{ mb: 2, borderColor: 'rgba(255,255,255,0.08)' }} />

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress color="primary" /></Box>}
      {error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && scheduleEntries.map((entry) => (
        <Paper
          key={entry.employee.id}
          elevation={0}
          sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
        >
          <Box sx={{ px: 2, py: 1.5, bgcolor: 'rgba(15,23,42,0.8)', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight={700}>{entry.employee.full_name}</Typography>
            <Typography variant="caption" color="text.secondary">{entry.employee.role}</Typography>
          </Box>
          <Stack spacing={0}>
            {weekDays.map((d, i) => {
              const asgn = entry.dayAssignments[d]
              const isToday = d === format(new Date(), 'yyyy-MM-dd')
              return (
                <Box
                  key={d}
                  onClick={() => onCellClick(entry.employee, d)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 2,
                    py: 1.5,          // py:1 → 1.5 (≈44px touch target)
                    minHeight: 44,     // WCAG touch target
                    borderBottom: i < 6 ? '1px solid' : 'none',
                    borderColor: 'divider',
                    bgcolor: isToday ? 'rgba(20,184,166,0.04)' : 'transparent',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    '&:active': { bgcolor: 'rgba(255,255,255,0.06)' },
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                  }}
                >
                  <Typography variant="caption" fontWeight={isToday ? 700 : 400} color={isToday ? 'primary.main' : 'text.secondary'} sx={{ width: 32 }}>
                    {DAY_LABELS[i]}
                  </Typography>
                  {asgn ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {asgn.is_on_leave ? (
                        <Chip
                          label="İzinli"
                          size="small"
                          sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}
                        />
                      ) : (
                        <Chip
                          label={asgn.shift_templates?.name ?? '—'}
                          size="small"
                          sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
                        />
                      )}
                      <Typography variant="caption" color="text.disabled">
                        {formatTime(asgn.start_time)}–{formatTime(asgn.end_time)}
                      </Typography>
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.disabled">—</Typography>
                  )}
                  {asgn ? (
                    <EditIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                  ) : (
                    <AddIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                  )}
                </Box>
              )
            })}
          </Stack>
        </Paper>
      ))}

      <ShiftAssignDialog
        open={dialogOpen}
        onClose={onDialogClose}
        onSave={onSave}
        onDelete={dialogExisting ? onDelete : undefined}
        employee={dialogEmployee}
        workDate={dialogDate}
        templates={templates}
        existingAssignment={dialogExisting}
        loading={saving}
      />
    </Box>
  )
}
