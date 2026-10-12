'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import WeekendIcon from '@mui/icons-material/Weekend'
import DeleteIcon from '@mui/icons-material/Delete'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { EmployeeAvailability, DayOfWeek } from '@/types/workforce'
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
import { shiftDurationMins, checkMinRest } from '@/lib/workingTimeService'
import { PART_TIME_RULES } from '@/types/employee'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { WeekNavigator } from './WeekNavigator'
import { ShiftAssignDialog } from './ShiftAssignDialog'
import type { ShiftSavePayload } from './ShiftAssignDialog'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

// ─── Sabitler ─────────────────────────────────────────────────
const DAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

// Rol pozisyonlarına göre sıralama önceliği (küçük = üstte)
const ROLE_SORT_ORDER: Array<{ keywords: string[]; order: number }> = [
  { keywords: ['yönetici', 'yonetici', 'müdür', 'mudur'], order: 0 },
  { keywords: ['görsel', 'gorsel'], order: 1 },
  { keywords: ['kasiyer'], order: 2 },
  { keywords: ['satış', 'satis'], order: 3 },
  { keywords: ['depo'], order: 4 },
]

function getRoleSortOrder(role: string): number {
  const normalized = role.toLowerCase()
  for (const { keywords, order } of ROLE_SORT_ORDER) {
    if (keywords.some((k) => normalized.includes(k))) return order
  }
  return 99 // bilinmeyen roller en sona
}

const JS_DAY_TO_KEY: Record<number, DayOfWeek> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
}

// ─── Yardımcı tipler ──────────────────────────────────────────
/** Çalışan bazında availability map: employeeId → DayOfWeek → kayıtlar */
type AvailabilityMap = Map<string, Map<DayOfWeek, EmployeeAvailability[]>>

/** Çalışan bazında haftalık özet */
interface EmployeeWeekStats {
  totalMins: number
  dailyMins: Record<string, number>      // dateStr → dakika
  restViolations: Array<{ between: string; restMins: number }> // ihlal açıklaması
  employment_type: import('@/types/employee').EmploymentType
}

// ─── Özet hesaplama ───────────────────────────────────────────
function calcEmployeeStats(
  assignments: ShiftAssignmentWithDetails[],
  weekDays: string[],
  employment_type: import('@/types/employee').EmploymentType = 'full_time'
): EmployeeWeekStats {
  const config = getWorkingTimeConfig()
  const dailyMins: Record<string, number> = {}
  let totalMins = 0

  for (const d of weekDays) {
    const dayShifts = assignments.filter((a) => a.work_date === d && !a.is_on_leave)
    const mins = dayShifts.reduce((sum, a) => sum + shiftDurationMins(a.start_time, a.end_time), 0)
    dailyMins[d] = mins
    totalMins += mins
  }

  // Min rest ihlalleri — tüm haftayı kronolojik sırala
  const allShifts = assignments
    .filter((a) => !a.is_on_leave)
    .sort((a, b) => {
      const dc = a.work_date.localeCompare(b.work_date)
      return dc !== 0 ? dc : a.start_time.localeCompare(b.start_time)
    })

  const restViolations: EmployeeWeekStats['restViolations'] = []
  for (let i = 0; i < allShifts.length - 1; i++) {
    const curr = allShifts[i]
    const next = allShifts[i + 1]
    const violation = checkMinRest(
      next.work_date, next.start_time, next.end_time,
      [{ work_date: curr.work_date, start_time: curr.start_time, end_time: curr.end_time }],
      config
    )
    if (violation) {
      // İki vardiya arası gerçek dinlenme dakikasını hesapla
      const toAbsMins = (date: string, time: string) => {
        const REF = new Date('2000-01-03')
        const d = new Date(date)
        const [h, m] = time.slice(0, 5).split(':').map(Number)
        return Math.round((d.getTime() - REF.getTime()) / 60000) + h * 60 + m
      }
      let prevEnd = toAbsMins(curr.work_date, curr.end_time)
      const nextStart = toAbsMins(next.work_date, next.start_time)
      // gece yarısını geçen
      const prevStart = toAbsMins(curr.work_date, curr.start_time)
      if (prevEnd <= prevStart) prevEnd += 24 * 60
      const gapMins = nextStart - prevEnd
      restViolations.push({
        between: `${curr.work_date.slice(5)} ${curr.end_time.slice(0, 5)} → ${next.work_date.slice(5)} ${next.start_time.slice(0, 5)}`,
        restMins: Math.max(0, gapMins),
      })
    }
  }

  return { totalMins, dailyMins, restViolations, employment_type }
}

// ─── Availability helpers ─────────────────────────────────────
/**
 * Belirli bir tarih için çalışanın availability durumunu döner.
 * Çıktı: 'off' | 'partial' | 'full' | 'none'
 * - 'off': is_available=false kayıt var
 * - 'partial': pencere dışında shift oluşturulabilir uyarısı
 * - 'full': tam olarak müsait
 * - 'none': kayıt yok
 */
type AvailStatus = 'off' | 'partial' | 'full' | 'none'

function getAvailStatus(
  employeeId: string,
  dateStr: string,
  availMap: AvailabilityMap,
  shiftStart?: string,
  shiftEnd?: string
): AvailStatus {
  const dayKey = JS_DAY_TO_KEY[new Date(dateStr).getDay()]
  const empMap = availMap.get(employeeId)
  if (!empMap) return 'none'
  const records = empMap.get(dayKey)
  if (!records || records.length === 0) return 'none'

  const hasOff = records.some((r) => !r.is_available)
  if (hasOff) return 'off'

  if (!shiftStart || !shiftEnd) return 'full'

  // Shift pencere kontrolü
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const ss = toMins(shiftStart)
  const se = toMins(shiftEnd)

  const inWindow = records.some((r) => {
    const rs = toMins(r.start_time)
    const re = toMins(r.end_time)
    return ss >= rs && se <= re
  })

  return inWindow ? 'full' : 'partial'
}

// ─── Ana bileşen ──────────────────────────────────────────────
interface WeeklySchedulePageProps {
  /** true → hücre tıklanamaz, dialog açılmaz, edit ikonları gizlenir */
  readOnly?: boolean
}

export function WeeklySchedulePage({ readOnly = false }: WeeklySchedulePageProps) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const config = useMemo(() => getWorkingTimeConfig(), [])

  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignmentWithDetails[]>([])
  const [availabilityMap, setAvailabilityMap] = useState<AvailabilityMap>(new Map())
  const [approvedLeaveMap, setApprovedLeaveMap] = useState<Set<string>>(new Set())
  // key: "employee_id:YYYY-MM-DD" → leave request id (silme için)
  const [leaveDayToId, setLeaveDayToId] = useState<Map<string, string>>(new Map())
  // key: "employee_id:YYYY-MM-DD" — haftalık tatil günleri (görsel ayrım için)
  const [restDayMap, setRestDayMap] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogEmployee, setDialogEmployee] = useState<EmployeeWithRole | null>(null)
  const [dialogDate, setDialogDate] = useState('')
  const [dialogExisting, setDialogExisting] = useState<ShiftAssignmentWithDetails | null>(null)
  const [saving, setSaving] = useState(false)

  // İzin silme dialog state
  const [leaveDeleteDialog, setLeaveDeleteDialog] = useState<{
    employee: EmployeeWithRole
    date: string
    leaveId: string
  } | null>(null)
  const [leaveDeleting, setLeaveDeleting] = useState(false)

  const weekDays = getWeekDays(currentWeek)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [emps, tmpls, asgns, leavesRes, availRes] = await Promise.all([
        fetchActiveEmployees(),
        fetchActiveShiftTemplates(),
        fetchWeeklyAssignments(currentWeek),
        fetch(`/api/leave?status=approved`).then((r) =>
          r.ok ? r.json() : { requests: [] }
        ) as Promise<{ requests: Array<{ id: string; employee_id: string; start_date: string; end_date: string; leave_type: string }> }>,
        // Tüm çalışanların availability'si (manager ise all=true çalışır)
        fetch(`/api/availability?all=true`).then((r) =>
          r.ok ? r.json() : { availability: [] }
        ) as Promise<{ availability: EmployeeAvailability[] }>,
      ])

      setEmployees(emps)
      setTemplates(tmpls)
      setAssignments(asgns)

      // Onaylı izin set'i
      const leaveSet = new Set<string>()
      const leaveIdMap = new Map<string, string>()
      const restSet = new Set<string>()
      for (const lr of leavesRes.requests ?? []) {
        const startParts = lr.start_date.slice(0, 10).split('-').map(Number) as [number, number, number]
        const endParts = lr.end_date.slice(0, 10).split('-').map(Number) as [number, number, number]
        const curD = new Date(startParts[0], startParts[1] - 1, startParts[2])
        const endD = new Date(endParts[0], endParts[1] - 1, endParts[2])
        while (curD <= endD) {
          const y = curD.getFullYear()
          const m = String(curD.getMonth() + 1).padStart(2, '0')
          const d = String(curD.getDate()).padStart(2, '0')
          const key = `${lr.employee_id}:${y}-${m}-${d}`
          leaveSet.add(key)
          leaveIdMap.set(key, lr.id)
          if (lr.leave_type === 'weekly_rest') restSet.add(key)
          curD.setDate(curD.getDate() + 1)
        }
      }
      setApprovedLeaveMap(leaveSet)
      setLeaveDayToId(leaveIdMap)
      setRestDayMap(restSet)

      // Availability map: employeeId → DayOfWeek → records[]
      const aMap = new Map<string, Map<DayOfWeek, EmployeeAvailability[]>>()
      for (const av of availRes.availability ?? []) {
        if (!aMap.has(av.employee_id)) aMap.set(av.employee_id, new Map())
        const empMap = aMap.get(av.employee_id)!
        if (!empMap.has(av.day_of_week)) empMap.set(av.day_of_week, [])
        empMap.get(av.day_of_week)!.push(av)
      }
      setAvailabilityMap(aMap)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası.')
    } finally {
      setLoading(false)
    }
  }, [currentWeek])

  useEffect(() => {
    void load() // eslint-disable-line react-hooks/set-state-in-effect
  }, [load])

  // Assignment map: key = `${employee_id}:${work_date}`
  const assignmentMap = useMemo(() => {
    const m = new Map<string, ShiftAssignmentWithDetails>()
    assignments.forEach((a) => m.set(`${a.employee_id}:${a.work_date}`, a))
    return m
  }, [assignments])

  // Grid entries — role sıralamasına göre: Yöneticiler → Görsel Uzmanları → Kasiyerler → Satış Danışmanları → Depocular
  const scheduleEntries: WeeklyScheduleEntry[] = useMemo(() => {
    const entries = employees.map((emp) => ({
      employee: emp,
      dayAssignments: Object.fromEntries(
        weekDays.map((d) => [d, assignmentMap.get(`${emp.id}:${d}`) ?? null])
      ),
    }))
    entries.sort((a, b) => {
      const orderA = getRoleSortOrder(a.employee.role ?? '')
      const orderB = getRoleSortOrder(b.employee.role ?? '')
      if (orderA !== orderB) return orderA - orderB
      // Aynı roldeyse isme göre alfabetik
      return (a.employee.full_name ?? '').localeCompare(b.employee.full_name ?? '', 'tr')
    })
    return entries
  },
    [employees, weekDays, assignmentMap]
  )

  // Per-employee stats (haftalık özet)
  const statsMap = useMemo(() => {
    const m = new Map<string, EmployeeWeekStats>()
    for (const entry of scheduleEntries) {
      const empAssignments = assignments.filter((a) => a.employee_id === entry.employee.id)
      m.set(entry.employee.id, calcEmployeeStats(empAssignments, weekDays, entry.employee.employment_type ?? 'full_time'))
    }
    return m
  }, [scheduleEntries, assignments, weekDays])

  const handleWeekChange = (newWeek: Date) => setCurrentWeek(newWeek)

  const openAssignDialog = (emp: EmployeeWithRole, date: string) => {
    if (readOnly) return   // çalışan modu — sadece görüntüleme
    // İzinli gün: izin silme dialog'u aç
    const leaveKey = `${emp.id}:${date}`
    const leaveId = leaveDayToId.get(leaveKey)
    if (leaveId && approvedLeaveMap.has(leaveKey)) {
      setLeaveDeleteDialog({ employee: emp, date, leaveId })
      return
    }
    const existing = assignmentMap.get(`${emp.id}:${date}`) ?? null
    setDialogEmployee(emp)
    setDialogDate(date)
    setDialogExisting(existing)
    setDialogOpen(true)
  }

  const handleAssignRestDay = async () => {
    if (!dialogEmployee || !dialogDate) return
    setSaving(true)
    try {
      const res = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: dialogEmployee.id,
          leave_type: 'weekly_rest',
          start_date: dialogDate,
          end_date: dialogDate,
          reason: 'Haftalık tatil',
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Tatil atanamadı.')
      setDialogOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleLeaveDelete = async () => {    if (!leaveDeleteDialog) return
    setLeaveDeleting(true)
    try {
      const res = await fetch(`/api/leave?id=${leaveDeleteDialog.leaveId}`, { method: 'DELETE' })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'İzin silinemedi.')
      setLeaveDeleteDialog(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İzin silme hatası.')
      setLeaveDeleteDialog(null)
    } finally {
      setLeaveDeleting(false)
    }
  }

  const handleSave = async (payload: ShiftSavePayload) => {
    if (!dialogEmployee) return
    setSaving(true)
    try {
      if (dialogExisting) {
        await updateShiftAssignment(dialogExisting.id, dialogEmployee.id, dialogDate, {
          shift_template_id: payload.templateId ?? undefined,
          start_time: payload.startTime,
          end_time: payload.endTime,
        })
      } else {
        await createShiftAssignment(
          {
            employee_id: dialogEmployee.id,
            shift_template_id: payload.templateId,
            work_date: dialogDate,
            start_time: payload.startTime,
            end_time: payload.endTime,
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

  // Dialog'da seçilen günün availability kayıtları
  const dialogAvailability: EmployeeAvailability[] = useMemo(() => {
    if (!dialogEmployee || !dialogDate) return []
    const dayKey = JS_DAY_TO_KEY[new Date(dialogDate).getDay()]
    return availabilityMap.get(dialogEmployee.id)?.get(dayKey) ?? []
  }, [dialogEmployee, dialogDate, availabilityMap])

  if (isMobile) {
    return (
      <MobileScheduleView
        scheduleEntries={scheduleEntries}
        weekDays={weekDays}
        loading={loading}
        error={error}
        currentWeek={currentWeek}
        onWeekChange={handleWeekChange}
        onCellClick={openAssignDialog}
        approvedLeaveMap={approvedLeaveMap}
        availabilityMap={availabilityMap}
        dialogOpen={dialogOpen}
        dialogEmployee={dialogEmployee}
        dialogDate={dialogDate}
        dialogExisting={dialogExisting}
        dialogAvailability={dialogAvailability}
        templates={templates}
        saving={saving}
        onSave={handleSave}
        onDelete={handleDelete}
        onDialogClose={() => setDialogOpen(false)}
        readOnly={readOnly}
      />
    )
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
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
        >
          {/* Header row — 7 gün + özet sütunu */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '160px repeat(7, 1fr) 130px',
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: 'rgba(15,23,42,0.8)',
            }}
          >
            <Box sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Çalışan</Typography>
            </Box>
            {weekDays.map((d, i) => {
              const isToday = d === format(new Date(), 'yyyy-MM-dd')
              return (
                <Box key={d} sx={{
                  p: 1.5, textAlign: 'center',
                  borderLeft: '1px solid', borderColor: 'divider',
                  bgcolor: isToday ? 'rgba(20,184,166,0.06)' : 'transparent',
                }}>
                  <Typography variant="caption" fontWeight={700}
                    color={isToday ? 'primary.main' : 'text.secondary'} display="block">
                    {DAY_LABELS[i]}
                  </Typography>
                  <Typography variant="caption" color={isToday ? 'primary.main' : 'text.disabled'} fontSize="0.65rem">
                    {format(new Date(d + 'T00:00:00'), 'd MMM', { locale: tr })}
                  </Typography>
                </Box>
              )
            })}
            {/* Özet başlık */}
            <Box sx={{
              p: 1.5, textAlign: 'center',
              borderLeft: '2px solid', borderColor: 'rgba(20,184,166,0.3)',
              bgcolor: 'rgba(20,184,166,0.04)',
            }}>
              <Typography variant="caption" color="primary.main" fontWeight={700}>Özet</Typography>
            </Box>
          </Box>

          {/* Employee rows */}
          {scheduleEntries.map((entry, rowIdx) => {
            const stats = statsMap.get(entry.employee.id)
            const hasViolation = (stats?.restViolations.length ?? 0) > 0
            const weeklyOver = stats ? stats.totalMins > config.maxWeeklyWorkHours * 60 : false

            return (
              <Box
                key={entry.employee.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '160px repeat(7, 1fr) 130px',
                  borderBottom: rowIdx < scheduleEntries.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.01)' },
                }}
              >
                {/* Çalışan adı */}
                <Box sx={{
                  p: 1.5, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  borderRight: '1px solid', borderColor: 'divider',
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                    <Typography variant="caption" fontWeight={700} color="text.primary" noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {entry.employee.full_name}
                    </Typography>
                    {entry.employee.employment_type === 'part_time' && (
                      <Typography
                        component="span"
                        sx={{
                          fontSize: '0.55rem', fontWeight: 700, letterSpacing: 0.2,
                          color: '#818cf8', flexShrink: 0,
                          border: '1px solid rgba(129,140,248,0.4)',
                          borderRadius: '3px', px: '3px', lineHeight: '14px',
                        }}
                      >
                        PT
                      </Typography>
                    )}
                  </Box>
                  <Typography variant="caption" color="text.disabled" fontSize="0.65rem" noWrap>
                    {entry.employee.role}
                  </Typography>
                </Box>

                {/* Gün hücreleri */}
                {weekDays.map((d) => {
                  const asgn = entry.dayAssignments[d]
                  const isToday = d === format(new Date(), 'yyyy-MM-dd')
                  const cellKey = `${entry.employee.id}:${d}`
                  const isOnLeave = asgn?.is_on_leave === true || approvedLeaveMap.has(cellKey)
                  const isRestDay = restDayMap.has(cellKey)
                  const availStatus = getAvailStatus(
                    entry.employee.id, d, availabilityMap,
                    asgn?.start_time, asgn?.end_time
                  )
                  const dailyOver = stats ? (stats.dailyMins[d] ?? 0) > config.maxDailyWorkHours * 60 : false

                  return (
                    <ShiftCell
                      key={d}
                      assignment={asgn}
                      isToday={isToday}
                      isOnLeave={isOnLeave}
                      isRestDay={isRestDay}
                      availStatus={availStatus}
                      dailyOver={dailyOver}
                      dailyMins={stats?.dailyMins[d] ?? 0}
                      onClick={() => openAssignDialog(entry.employee, d)}
                      readOnly={readOnly}
                    />
                  )
                })}

                {/* Özet sütunu */}
                <SummaryCell stats={stats} config={config} />
              </Box>
            )
          })}
        </Paper>
      )}

      {/* Legend */}
      {!loading && !error && scheduleEntries.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
          {[
            { color: 'rgba(99,102,241,0.25)', label: 'Haftalık Tatil' },
            { color: 'rgba(251,191,36,0.3)', label: 'İzinli' },
            { color: 'rgba(239,68,68,0.25)', label: 'Müsait değil' },
            { color: 'rgba(234,179,8,0.2)', label: 'Müsaitlik dışı vardiya' },
            { color: 'rgba(239,68,68,0.15)', label: 'Günlük max aşıldı' },
          ].map(({ color, label }) => (
            <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color, flexShrink: 0 }} />
              <Typography variant="caption" color="text.disabled" fontSize="0.68rem">{label}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Assign Dialog — sadece manager modunda */}
      {!readOnly && (
        <ShiftAssignDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSave={handleSave}
          onDelete={dialogExisting ? handleDelete : undefined}
          onAssignRestDay={!dialogExisting ? handleAssignRestDay : undefined}
          employee={dialogEmployee}
          workDate={dialogDate}
          templates={templates}
          existingAssignment={dialogExisting}
          loading={saving}
          dayAvailability={dialogAvailability}
        />
      )}

      {/* İzin silme onay dialog'u */}
      {!readOnly && (
        <Dialog
          open={!!leaveDeleteDialog}
          onClose={() => setLeaveDeleteDialog(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <EventBusyIcon sx={{ color: 'warning.main', fontSize: 20 }} />
            {leaveDeleteDialog && restDayMap.has(`${leaveDeleteDialog.employee.id}:${leaveDeleteDialog.date}`)
              ? 'Tatili Kaldır'
              : 'İzni İptal Et'
            }
          </DialogTitle>
          <DialogContent>
            {leaveDeleteDialog && (
              <Typography variant="body2" color="text.secondary">
                {restDayMap.has(`${leaveDeleteDialog.employee.id}:${leaveDeleteDialog.date}`) ? (
                  <>
                    <strong>{leaveDeleteDialog.employee.full_name}</strong> adlı çalışanın{' '}
                    <strong>
                      {new Date(leaveDeleteDialog.date + 'T00:00:00').toLocaleDateString('tr-TR', {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })}
                    </strong>{' '}
                    tarihindeki haftalık tatili kaldırılacak. Bu gün vardiya atanabilir hale gelecektir.
                  </>
                ) : (
                  <>
                    <strong>{leaveDeleteDialog.employee.full_name}</strong> adlı çalışanın{' '}
                    <strong>
                      {new Date(leaveDeleteDialog.date + 'T00:00:00').toLocaleDateString('tr-TR', {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })}
                    </strong>{' '}
                    tarihini kapsayan onaylı izni silinecek.
                    <Typography component="span" variant="body2" color="info.main" display="block" sx={{ mt: 1 }}>
                      ℹ️ İzin tüm kapsamıyla (başlangıç–bitiş aralığı) silinir, yalnızca bu gün değil.
                    </Typography>
                  </>
                )}
              </Typography>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
            <Button onClick={() => setLeaveDeleteDialog(null)} disabled={leaveDeleting}>
              Vazgeç
            </Button>
            <Button
              variant="contained"
              color="error"
              startIcon={leaveDeleting ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
              onClick={handleLeaveDelete}
              disabled={leaveDeleting}
            >
              İzni Sil
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}

// ─── Özet sütunu hücresi ──────────────────────────────────────
interface SummaryCellProps {
  stats: EmployeeWeekStats | undefined
  config: ReturnType<typeof getWorkingTimeConfig>
}

function SummaryCell({ stats, config }: SummaryCellProps) {
  if (!stats) {
    return (
      <Box sx={{
        borderLeft: '2px solid', borderColor: 'rgba(20,184,166,0.3)',
        bgcolor: 'rgba(20,184,166,0.02)', p: 1, minHeight: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography variant="caption" color="text.disabled" fontSize="0.68rem">—</Typography>
      </Box>
    )
  }

  const totalH = Math.round(stats.totalMins / 60 * 10) / 10
  // Part-time için 30s, full-time için config'den
  const maxW = stats.employment_type === 'part_time'
    ? PART_TIME_RULES.maxWeeklyHours
    : config.maxWeeklyWorkHours
  const overWeekly = stats.totalMins > maxW * 60
  const hasRestViolation = stats.restViolations.length > 0

  const restTooltip = stats.restViolations
    .map((v) => `${v.between}\n(${Math.round(v.restMins / 60 * 10) / 10}s dinlenme)`)
    .join('\n')

  return (
    <Box sx={{
      borderLeft: '2px solid', borderColor: 'rgba(20,184,166,0.3)',
      bgcolor: 'rgba(20,184,166,0.02)', p: 1, minHeight: 64,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.5,
    }}>
      {/* Haftalık toplam */}
      <Tooltip title={`Haftalık toplam / Maks. ${maxW}s`} placement="left">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Typography
            variant="caption"
            fontWeight={700}
            fontSize="0.82rem"
            color={overWeekly ? '#ef4444' : 'primary.main'}
          >
            {totalH}s
          </Typography>
          {overWeekly && (
            <Chip label="aşıldı" size="small" color="error" variant="outlined"
              sx={{ height: 14, fontSize: '0.58rem', '& .MuiChip-label': { px: 0.5 } }} />
          )}
        </Box>
      </Tooltip>

      {/* Dinlenme ihlali */}
      {hasRestViolation && (
        <Tooltip
          title={<Box sx={{ whiteSpace: 'pre-line', fontSize: '0.72rem' }}>
            {`Min. dinlenme ihlali:\n${restTooltip}`}
          </Box>}
          placement="left"
          arrow
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, cursor: 'default' }}>
            <WarningAmberIcon sx={{ fontSize: 11, color: '#f97316' }} />
            <Typography variant="caption" color="#f97316" fontSize="0.65rem">
              {stats.restViolations.length} dinlenme ihlali
            </Typography>
          </Box>
        </Tooltip>
      )}

      {/* Haftalık progress bar */}
      <Box sx={{ width: '100%', height: 3, bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{
          height: '100%',
          width: `${Math.min(100, (stats.totalMins / (maxW * 60)) * 100)}%`,
          bgcolor: overWeekly ? '#ef4444' : '#14b8a6',
          borderRadius: 2,
          transition: 'width 0.3s',
        }} />
      </Box>
      <Typography variant="caption" color="text.disabled" fontSize="0.58rem">
        / {maxW}s maks.
      </Typography>
    </Box>
  )
}

// ─── Shift cell ───────────────────────────────────────────────
function ShiftCell({
  assignment, isToday, isOnLeave, isRestDay, availStatus, dailyOver, dailyMins, onClick, readOnly,
}: {
  assignment: ShiftAssignmentWithDetails | null
  isToday: boolean
  isOnLeave: boolean
  isRestDay: boolean
  availStatus: AvailStatus
  dailyOver: boolean
  dailyMins: number
  onClick: () => void
  readOnly?: boolean
}) {
  const cursor = readOnly ? 'default' : 'pointer'

  // ── Haftalık Tatil ──
  if (isRestDay) {
    return (
      <Tooltip title="Haftalık tatil — tıklayarak kaldırabilirsiniz" placement="top">
        <Box onClick={onClick} sx={{
          borderLeft: '2px solid rgba(99,102,241,0.5)',
          bgcolor: 'rgba(99,102,241,0.08)', p: 0.75, minHeight: 64, cursor,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.4,
          '&:hover': { bgcolor: readOnly ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.16)' },
        }}>
          <WeekendIcon sx={{ fontSize: 14, color: '#818cf8' }} />
          <Typography variant="caption" fontWeight={700} color="#818cf8" fontSize="0.7rem">Tatil</Typography>
        </Box>
      </Tooltip>
    )
  }

  // ── İzinli ──
  if (isOnLeave) {
    return (
      <Tooltip title={assignment
        ? `İzin onaylandı (${formatTime(assignment.start_time)}–${formatTime(assignment.end_time)})`
        : 'İzin onaylandı'} placement="top">
        <Box onClick={onClick} sx={{
          borderLeft: '1px solid', borderColor: 'divider',
          bgcolor: 'rgba(251,191,36,0.08)', p: 0.75, minHeight: 64, cursor,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.4,
          '&:hover': { bgcolor: readOnly ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.14)' },
        }}>
          <EventBusyIcon sx={{ fontSize: 13, color: '#fbbf24' }} />
          <Typography variant="caption" fontWeight={700} color="warning.main" fontSize="0.7rem">İzinli</Typography>
          {assignment && (
            <Typography variant="caption" color="text.disabled" fontSize="0.6rem">
              {formatTime(assignment.start_time)}–{formatTime(assignment.end_time)}
            </Typography>
          )}
        </Box>
      </Tooltip>
    )
  }

  // Müsait değil (off day) — vardiya yok
  if (availStatus === 'off' && !assignment) {
    return (
      <Tooltip title="Çalışan bu gün müsait değil (off day)" placement="top">
        <Box onClick={onClick} sx={{
          borderLeft: '1px solid', borderColor: 'divider',
          bgcolor: 'rgba(239,68,68,0.08)', p: 0.75, minHeight: 64, cursor,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.4,
          '&:hover': { bgcolor: readOnly ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.14)' },
        }}>
          <Typography variant="caption" color="error.main" fontSize="0.65rem">Off</Typography>
          {!readOnly && <AddIcon sx={{ fontSize: 13, color: 'error.main', opacity: 0.5 }} />}
        </Box>
      </Tooltip>
    )
  }

  // Boş hücre (vardiya yok)
  if (!assignment) {
    // Availability durumuna göre arkaplan
    const bgColor =
      availStatus === 'full'
        ? isToday ? 'rgba(20,184,166,0.09)' : 'rgba(20,184,166,0.05)'
        : isToday ? 'rgba(20,184,166,0.03)' : 'transparent'
    const bgHoverColor =
      availStatus === 'full'
        ? 'rgba(20,184,166,0.13)'
        : 'rgba(20,184,166,0.08)'

    const tooltipAvail =
      availStatus === 'full' ? 'Çalışan bu gün müsait (availability kaydı var)' :
      availStatus === 'none' ? 'Availability kaydı yok' : undefined

    return (
      <Tooltip title={tooltipAvail} placement="top" disableHoverListener={!tooltipAvail}>
        <Box onClick={onClick} sx={{
          borderLeft: '2px solid',
          borderColor: availStatus === 'full' ? 'rgba(20,184,166,0.35)' : 'divider',
          bgcolor: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 64, cursor, position: 'relative',
          '&:hover': { bgcolor: readOnly ? bgColor : bgHoverColor, '& .add-icon': { opacity: readOnly ? 0 : 1 } },
        }}>
          {/* Availability nokta göstergesi */}
          {availStatus === 'full' && (
            <Box sx={{
              position: 'absolute', top: 5, right: 5,
              width: 5, height: 5, borderRadius: '50%',
              bgcolor: 'rgba(20,184,166,0.5)',
            }} />
          )}
          {!readOnly && (
            <AddIcon className="add-icon"
              sx={{ fontSize: 16, color: availStatus === 'full' ? 'primary.main' : 'text.disabled', opacity: 0, transition: 'opacity 0.15s' }} />
          )}
        </Box>
      </Tooltip>
    )
  }

  // Vardiya var
  const tpl = assignment.shift_templates
  const name = tpl?.name ?? '—'
  const start = formatTime(assignment.start_time)
  const end = formatTime(assignment.end_time)
  const durationH = Math.round(shiftDurationMins(assignment.start_time, assignment.end_time) / 60 * 10) / 10

  // Renk: ihlal > partial availability > normal
  let bgBase = isToday ? 'rgba(20,184,166,0.05)' : 'rgba(99,102,241,0.05)'
  let bgHover = isToday ? 'rgba(20,184,166,0.1)' : 'rgba(99,102,241,0.12)'
  if (dailyOver) { bgBase = 'rgba(239,68,68,0.1)'; bgHover = 'rgba(239,68,68,0.16)' }
  else if (availStatus === 'off') { bgBase = 'rgba(239,68,68,0.1)'; bgHover = 'rgba(239,68,68,0.16)' }
  else if (availStatus === 'partial') { bgBase = 'rgba(234,179,8,0.08)'; bgHover = 'rgba(234,179,8,0.15)' }

  const tooltipText = [
    `${name}: ${start}–${end} (${durationH}s)`,
    dailyOver ? '⚠️ Günlük maks. aşıldı' : '',
    availStatus === 'off' ? '⚠️ Müsait değil gün' : '',
    availStatus === 'partial' ? '⚠️ Müsaitlik penceresi dışı' : '',
  ].filter(Boolean).join('\n')

  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line', fontSize: '0.75rem' }}>{tooltipText}</Box>} placement="top">
      <Box onClick={onClick} sx={{
        borderLeft: '1px solid', borderColor: 'divider',
        bgcolor: bgBase, p: 0.75, minHeight: 64, cursor,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.4,
        '&:hover': { bgcolor: readOnly ? bgBase : bgHover },
        // sol kenar rengi ihlal durumuna göre
        borderLeftColor: dailyOver || availStatus === 'off' ? 'rgba(239,68,68,0.5)'
          : availStatus === 'partial' ? 'rgba(234,179,8,0.5)'
          : 'divider',
        borderLeftWidth: (dailyOver || availStatus !== 'none') ? 2 : 1,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" fontWeight={700} color="secondary.main" fontSize="0.7rem" noWrap sx={{ flex: 1 }}>
            {name}
          </Typography>
          {(dailyOver || availStatus === 'off' || availStatus === 'partial') && (
            <WarningAmberIcon sx={{
              fontSize: 10, flexShrink: 0,
              color: dailyOver || availStatus === 'off' ? '#ef4444' : '#eab308',
            }} />
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
          <AccessTimeIcon sx={{ fontSize: 10, color: 'text.disabled' }} />
          <Typography variant="caption" color="text.disabled" fontSize="0.65rem">
            {start}–{end}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" color={dailyOver ? '#ef4444' : 'text.disabled'} fontSize="0.6rem">
            {durationH}s
          </Typography>
          {!readOnly && <EditIcon sx={{ fontSize: 10, color: 'text.disabled' }} />}
        </Box>
      </Box>
    </Tooltip>
  )
}

// ─── Mobile view ──────────────────────────────────────────────
interface MobileViewProps {
  scheduleEntries: WeeklyScheduleEntry[]
  weekDays: string[]
  loading: boolean
  error: string | null
  currentWeek: Date
  onWeekChange: (d: Date) => void
  onCellClick: (emp: EmployeeWithRole, date: string) => void
  approvedLeaveMap: Set<string>
  availabilityMap: AvailabilityMap
  dialogOpen: boolean
  dialogEmployee: EmployeeWithRole | null
  dialogDate: string
  dialogExisting: ShiftAssignmentWithDetails | null
  dialogAvailability: EmployeeAvailability[]
  templates: ShiftTemplate[]
  saving: boolean
  onSave: (payload: ShiftSavePayload) => Promise<void>
  onDelete: () => Promise<void>
  onDialogClose: () => void
  readOnly?: boolean
}

function MobileScheduleView({
  scheduleEntries, weekDays, loading, error, currentWeek, onWeekChange,
  onCellClick, approvedLeaveMap, availabilityMap,
  dialogOpen, dialogEmployee, dialogDate, dialogExisting, dialogAvailability,
  templates, saving, onSave, onDelete, onDialogClose, readOnly = false,
}: MobileViewProps) {
  const config = useMemo(() => getWorkingTimeConfig(), [])

  return (
    <Box sx={{ p: 2, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" fontWeight={800} mb={1.5}>Haftalık Plan</Typography>
        <WeekNavigator currentWeek={currentWeek} onChange={onWeekChange} />
      </Box>
      <Divider sx={{ mb: 2, borderColor: 'rgba(255,255,255,0.08)' }} />

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress color="primary" /></Box>}
      {error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && scheduleEntries.map((entry) => {
        const empAssignments = entry.employee
          ? Object.values(entry.dayAssignments).filter(Boolean) as ShiftAssignmentWithDetails[]
          : []
        const stats = calcEmployeeStats(empAssignments, weekDays, entry.employee.employment_type ?? 'full_time')
        const totalH = Math.round(stats.totalMins / 60 * 10) / 10
        const maxW = entry.employee.employment_type === 'part_time'
          ? PART_TIME_RULES.maxWeeklyHours
          : config.maxWeeklyWorkHours
        const overWeekly = stats.totalMins > maxW * 60

        return (
          <Paper key={entry.employee.id} elevation={0}
            sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'rgba(15,23,42,0.8)', borderBottom: '1px solid', borderColor: 'divider',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <Typography variant="subtitle2" fontWeight={700}>{entry.employee.full_name}</Typography>
                  {entry.employee.employment_type === 'part_time' && (
                    <Typography
                      component="span"
                      sx={{
                        fontSize: '0.55rem', fontWeight: 700,
                        color: '#818cf8', flexShrink: 0,
                        border: '1px solid rgba(129,140,248,0.4)',
                        borderRadius: '3px', px: '3px', lineHeight: '14px',
                      }}
                    >
                      PT
                    </Typography>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary">{entry.employee.role}</Typography>
              </Box>
              <Typography variant="caption" fontWeight={700} color={overWeekly ? 'error.main' : 'primary.main'}>
                {totalH}s / {maxW}s
              </Typography>
            </Box>

            <Stack spacing={0}>
              {weekDays.map((d, i) => {
                const asgn = entry.dayAssignments[d]
                const isToday = d === format(new Date(), 'yyyy-MM-dd')
                const isOnLeave = asgn?.is_on_leave === true || approvedLeaveMap.has(`${entry.employee.id}:${d}`)
                const availStatus = getAvailStatus(entry.employee.id, d, availabilityMap, asgn?.start_time, asgn?.end_time)
                const dH = asgn && !isOnLeave ? Math.round(shiftDurationMins(asgn.start_time, asgn.end_time) / 60 * 10) / 10 : 0

                return (
                  <Box key={d} onClick={() => onCellClick(entry.employee, d)}
                    sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      px: 2, py: 1.25, minHeight: 44,
                      borderBottom: i < 6 ? '1px solid' : 'none', borderColor: 'divider',
                      bgcolor: isOnLeave ? 'rgba(251,191,36,0.04)'
                        : availStatus === 'off' && !asgn ? 'rgba(239,68,68,0.06)'
                        : availStatus === 'full' && !asgn ? 'rgba(20,184,166,0.05)'
                        : isToday ? 'rgba(20,184,166,0.04)' : 'transparent',
                      cursor: readOnly ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
                      '&:active': { bgcolor: readOnly ? 'transparent' : 'rgba(255,255,255,0.06)' },
                    }}>
                    <Typography variant="caption" fontWeight={isToday ? 700 : 400}
                      color={isToday ? 'primary.main' : 'text.secondary'} sx={{ width: 32 }}>
                      {DAY_LABELS[i]}
                    </Typography>

                    {isOnLeave ? (
                      <Chip label="İzinli" size="small" sx={{ height: 18, fontSize: '0.62rem',
                        bgcolor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }} />
                    ) : asgn ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        {(availStatus === 'off' || availStatus === 'partial') && (
                          <WarningAmberIcon sx={{ fontSize: 12, color: availStatus === 'off' ? '#ef4444' : '#eab308' }} />
                        )}
                        <Chip label={asgn.shift_templates?.name ?? '—'} size="small"
                          sx={{ height: 18, fontSize: '0.62rem',
                            bgcolor: 'rgba(99,102,241,0.15)', color: '#818cf8' }} />
                        <Typography variant="caption" color="text.disabled" fontSize="0.65rem">
                          {formatTime(asgn.start_time)}–{formatTime(asgn.end_time)} ({dH}s)
                        </Typography>
                      </Box>
                    ) : availStatus === 'off' ? (
                      <Typography variant="caption" color="error.main" fontSize="0.65rem">Off gün</Typography>
                    ) : availStatus === 'full' ? (
                      <Typography variant="caption" sx={{ color: 'rgba(20,184,166,0.6)', fontSize: '0.65rem' }}>Müsait</Typography>
                    ) : (
                      <Typography variant="caption" color="text.disabled">—</Typography>
                    )}

                    {!readOnly && (asgn
                      ? <EditIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                      : <AddIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                    )}
                  </Box>
                )
              })}
            </Stack>
          </Paper>
        )
      })}

      {!readOnly && (
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
          dayAvailability={dialogAvailability}
        />
      )}
    </Box>
  )
}
