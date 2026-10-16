'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Divider,
  Paper,
  useMediaQuery,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import DeleteIcon from '@mui/icons-material/Delete'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { EmployeeAvailability } from '@/types/workforce'
import {
  createShiftAssignment,
  updateShiftAssignment,
  deleteShiftAssignment,
} from '@/lib/api/schedule'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { WeekNavigator } from './WeekNavigator'
import { useWeeklySchedule } from './useWeeklySchedule'
import { ApiError } from '@/lib/api/http'
import { ShiftAssignDialog } from './ShiftAssignDialog'
import type { ShiftSavePayload } from './ShiftAssignDialog'
import { PageHeader, ScheduleGridSkeleton } from '@/components/common'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

import { DAY_LABELS, getRoleSortOrder, JS_DAY_TO_KEY, EmployeeWeekStats, calcEmployeeStats, getAvailStatus } from './scheduleHelpers'
import { SummaryCell, ShiftCell } from './ScheduleCells'
import { MobileDayBoard } from './MobileDayBoard'

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
  const {
    weekDays,
    employees,
    templates,
    assignments,
    availabilityMap,
    holidayMap,
    approvedLeaveMap,
    leaveDayToId,
    restDayMap,
    isFirstLoad,
    error: loadError,
    reload: load,
  } = useWeeklySchedule(currentWeek, { readOnly })
  // Kayıt/silme işlem hataları (yükleme hataları hook'tan gelir)
  const [actionError, setError] = useState<string | null>(null)
  const error = actionError ?? loadError

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

  const handleSave = async (payload: ShiftSavePayload, acknowledge = false) => {
    if (!dialogEmployee) return
    setSaving(true)
    const options = acknowledge ? { acknowledgeViolations: true } : undefined
    try {
      if (dialogExisting) {
        await updateShiftAssignment(dialogExisting.id, dialogEmployee.id, dialogDate, {
          shift_template_id: payload.templateId ?? undefined,
          start_time: payload.startTime,
          end_time: payload.endTime,
        }, options)
      } else {
        await createShiftAssignment(
          {
            employee_id: dialogEmployee.id,
            shift_template_id: payload.templateId,
            work_date: dialogDate,
            start_time: payload.startTime,
            end_time: payload.endTime,
          },
          dialogEmployee.active,
          options
        )
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      // Sunucu İş Kanunu ihlali buldu — yönetici açıkça onaylarsa tekrar gönder
      if (!acknowledge && err instanceof ApiError && err.code === 'WORKING_TIME_VIOLATION') {
        const violations = (err.details.violations as string[] | undefined) ?? []
        const list = violations.map((v) => `• ${v}`).join('\n')
        if (window.confirm(`Bu vardiya şu kuralları ihlal ediyor:\n\n${list}\n\nYine de kaydedilsin mi?`)) {
          setSaving(false)
          return handleSave(payload, true)
        }
      }
      throw err
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

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const hasData = !isFirstLoad && !error && scheduleEntries.length > 0

  // Mobil: varsayılan "Gün" görünümü (seçili günün vardiyaları), istenirse haftalık tablo
  const [mobileView, setMobileView] = useState<'day' | 'week'>('day')
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const selectedDay = pickedDay && weekDays.includes(pickedDay)
    ? pickedDay
    : weekDays.includes(todayStr) ? todayStr : weekDays[0]
  const hasGrid = hasData && (!isMobile || mobileView === 'week')

  // Mobilde haftalık tablo açılınca bugünün sütunu görünür olsun (ad sütununun hemen yanına kaydır)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isMobile || !hasGrid) return
    const el = scrollRef.current
    const todayCol = el?.querySelector<HTMLElement>('[data-today="true"]')
    if (el) el.scrollLeft = todayCol ? todayCol.offsetLeft - 112 : 0
  }, [isMobile, hasGrid, weekDays])

  // Mobil haftalık tablo: sabit genişlikli sütunlar + yatay kaydırma, ad sütunu ve gün başlığı sabit
  const nameColW = isMobile ? 112 : 160
  const gridCols = isMobile
    ? `${nameColW}px repeat(7, minmax(76px, 1fr)) 80px`
    : `${nameColW}px repeat(7, 1fr) 130px`
  const gridMinWidth = isMobile ? nameColW + 7 * 76 + 80 : undefined
  // Paper (yarı saydam) + sayfa zemini üzerinde sabit hücrelerin arkası görünmesin diye opak renkler
  const stickyBg = '#1b2537'
  const headerBg = '#131c2f'

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      <PageHeader
        icon={CalendarMonthIcon}
        overline="Planlama"
        title="Haftalık Vardiya Planı"
        actions={<WeekNavigator currentWeek={currentWeek} onChange={handleWeekChange} />}
      />

      <Divider sx={{ mb: isMobile ? 2 : 3, borderColor: 'rgba(255,255,255,0.08)' }} />

      {isMobile && hasData && (
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={mobileView}
          onChange={(_, v: 'day' | 'week' | null) => v && setMobileView(v)}
          sx={{ mb: 2 }}
        >
          <ToggleButton value="day">Gün</ToggleButton>
          <ToggleButton value="week">Hafta</ToggleButton>
        </ToggleButtonGroup>
      )}

      {isFirstLoad && <ScheduleGridSkeleton rows={Math.min(Math.max(employees.length, 6), 12)} />}
      {error && <Alert severity="error">{error}</Alert>}
      {!isFirstLoad && !error && scheduleEntries.length === 0 && (
        <Alert severity="info">Aktif çalışan bulunamadı.</Alert>
      )}

      {isMobile && hasData && mobileView === 'day' && (
        <MobileDayBoard
          entries={scheduleEntries}
          weekDays={weekDays}
          selectedDay={selectedDay}
          onSelectDay={setPickedDay}
          holidayMap={holidayMap}
          approvedLeaveMap={approvedLeaveMap}
          restDayMap={restDayMap}
          availabilityMap={availabilityMap}
          maxDailyMins={config.maxDailyWorkHours * 60}
          onCellClick={openAssignDialog}
          readOnly={readOnly}
        />
      )}

      {/* Desktop Grid */}
      {hasGrid && (
        <Paper
          elevation={0}
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
        >
          <Box
            ref={scrollRef}
            sx={{
              overflow: 'auto',
              // Mobilde tablo kendi içinde kaysın: başlık satırı (üst) ve ad sütunu (sol) sabit kalır
              maxHeight: isMobile ? 'calc(100dvh - 190px)' : undefined,
              overscrollBehaviorX: 'contain',
            }}
          >
          <Box sx={{ minWidth: gridMinWidth }}>
          {/* Header row — 7 gün + özet sütunu */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: gridCols,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: headerBg,
              position: 'sticky', top: 0, zIndex: 3,
            }}
          >
            <Box sx={{ p: isMobile ? 1 : 1.5, position: 'sticky', left: 0, zIndex: 1, bgcolor: headerBg, borderRight: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>Çalışan</Typography>
            </Box>
            {weekDays.map((d, i) => {
              const isToday = d === todayStr
              const holiday = holidayMap.get(d)
              return (
                <Box key={d} data-today={isToday || undefined} title={holiday ? `Resmi tatil: ${holiday.name}${holiday.half_day ? ' (13:00 sonrası)' : ''}` : undefined} sx={{
                  p: isMobile ? 0.75 : 1.5, textAlign: 'center',
                  borderLeft: '1px solid', borderColor: 'divider',
                  bgcolor: holiday && !holiday.half_day ? 'rgba(234,179,8,0.10)' : isToday ? 'rgba(20,184,166,0.06)' : 'transparent',
                }}>
                  <Typography variant="caption" fontWeight={700}
                    color={isToday ? 'primary.main' : 'text.secondary'} display="block">
                    {DAY_LABELS[i]}
                  </Typography>
                  <Typography variant="caption" color={isToday ? 'primary.main' : 'text.disabled'} fontSize="0.65rem">
                    {format(new Date(d + 'T00:00:00'), 'd MMM', { locale: tr })}
                  </Typography>
                  {holiday && (
                    <Typography variant="caption" display="block" color="#eab308" fontSize="0.6rem" fontWeight={700} noWrap>
                      {holiday.half_day ? 'Arife ½' : isMobile ? 'R. tatil' : 'Resmi tatil'}
                    </Typography>
                  )}
                </Box>
              )
            })}
            {/* Özet başlık */}
            <Box sx={{
              p: isMobile ? 0.75 : 1.5, textAlign: 'center', alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderLeft: '2px solid', borderColor: 'rgba(20,184,166,0.3)',
              bgcolor: 'rgba(20,184,166,0.04)',
            }}>
              <Typography variant="caption" color="primary.main" fontWeight={700}>Özet</Typography>
            </Box>
          </Box>

          {/* Employee rows */}
          {scheduleEntries.map((entry, rowIdx) => {
            const stats = statsMap.get(entry.employee.id)

            return (
              <Box
                key={entry.employee.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: gridCols,
                  borderBottom: rowIdx < scheduleEntries.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.01)' },
                }}
              >
                {/* Çalışan adı — yatay kaydırmada sabit kalır */}
                <Box sx={{
                  p: isMobile ? 1 : 1.5, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0,
                  borderRight: '1px solid', borderColor: 'divider',
                  position: 'sticky', left: 0, zIndex: 2, bgcolor: stickyBg,
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
                  const isToday = d === todayStr
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
                      compact={isMobile}
                    />
                  )
                })}

                {/* Özet sütunu */}
                <SummaryCell stats={stats} config={config} compact={isMobile} />
              </Box>
            )
          })}
          </Box>
          </Box>
        </Paper>
      )}

      {/* Legend */}
      {hasGrid && (
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
          key={`${dialogEmployee?.id ?? ''}:${dialogDate}:${dialogExisting?.id ?? 'new'}`}
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

