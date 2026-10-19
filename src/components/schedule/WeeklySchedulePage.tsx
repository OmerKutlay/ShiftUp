'use client'

import { useState, useMemo } from 'react'
import {
  Box,
  Typography,
  Alert,
  Chip,
  Fab,
  Menu,
  MenuItem,
  Paper,
  TextField,
  useMediaQuery,
  useTheme,
  Button,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { EmployeeAvailability } from '@/types/workforce'
import {
  createShiftAssignment,
  updateShiftAssignment,
  deleteShiftAssignment,
} from '@/lib/api/schedule'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { useWeeklySchedule } from './useWeeklySchedule'
import { ApiError } from '@/lib/api/http'
import { ShiftAssignDialog } from './ShiftAssignDialog'
import type { ShiftSavePayload } from './ShiftAssignDialog'
import { PageHeader, PeriodStepper, PersonAvatar, ScheduleGridSkeleton, SegmentedControl, useConfirm } from '@/components/common'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'
import { addWeeks, format, subWeeks } from 'date-fns'
import { tr } from 'date-fns/locale'

import {
  getRoleSortOrder, JS_DAY_TO_KEY, EmployeeWeekStats, calcEmployeeStats, getAvailStatus,
  ROLE_GROUPS, roleGroupOf, fmtHoursTr, type RoleGroupKey,
} from './scheduleHelpers'
import { weeklyLimitMins } from './ScheduleCells'
import { MobileDayBoard } from './MobileDayBoard'
import { WeekGrid } from './WeekGrid'
import { useAuth } from '@/context/AuthContext'
import { C, SHIFT_KIND_TONES } from '@/lib/palette'
import { CalendarX2, Info, Loader2, Trash2 } from 'lucide-react'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button as UiButton } from '@/components/ui/button'

// ─── Ana bileşen ──────────────────────────────────────────────
interface WeeklySchedulePageProps {
  /** true → hücre tıklanamaz, dialog açılmaz, edit ikonları gizlenir */
  readOnly?: boolean
}


export function WeeklySchedulePage({ readOnly = false }: WeeklySchedulePageProps) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const config = useMemo(() => getWorkingTimeConfig(), [])
  const confirm = useConfirm()
  const { employee: authEmployee } = useAuth()

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
        if (await confirm({
          title: 'İş Kanunu İhlali',
          message: 'Bu vardiya şu kuralları ihlal ediyor:',
          items: violations,
          footer: 'Yine de kaydedilsin mi?',
          confirmText: 'Yine de Kaydet',
        })) {
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

  // Hafta / Gün görünümü — mobilde varsayılan "Gün", masaüstünde "Hafta"
  const [viewPick, setViewPick] = useState<'day' | 'week' | null>(null)
  const view = viewPick ?? (isMobile ? 'day' : 'week')
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const selectedDay = pickedDay && weekDays.includes(pickedDay)
    ? pickedDay
    : weekDays.includes(todayStr) ? todayStr : weekDays[0]

  // Rol filtresi (tablo ve gün görünümü)
  const [roleFilter, setRoleFilter] = useState<RoleGroupKey | 'all'>('all')
  const presentGroups = ROLE_GROUPS.filter((g) => scheduleEntries.some((e) => roleGroupOf(e.employee.role ?? '') === g.key))
  const visibleEntries = roleFilter === 'all'
    ? scheduleEntries
    : scheduleEntries.filter((e) => roleGroupOf(e.employee.role ?? '') === roleFilter)

  // Başlık özeti: kişi, vardiya, saat ve uyarı sayısı
  const summary = useMemo(() => {
    let shifts = 0
    let mins = 0
    let warnings = 0
    for (const e of scheduleEntries) {
      const st = statsMap.get(e.employee.id)
      if (st) {
        mins += st.totalMins
        warnings += st.restViolations.length
        if (st.totalMins > weeklyLimitMins(st, config)) warnings++
      }
      for (const d of weekDays) {
        const a = e.dayAssignments[d]
        const key = `${e.employee.id}:${d}`
        if (!a || a.is_on_leave || approvedLeaveMap.has(key) || restDayMap.has(key)) continue
        shifts++
        if (st && (st.dailyMins[d] ?? 0) > config.maxDailyWorkHours * 60) warnings++
        const avail = getAvailStatus(e.employee.id, d, availabilityMap, a.start_time, a.end_time)
        if (avail === 'off' || avail === 'partial') warnings++
      }
    }
    return { shifts, mins, warnings }
  }, [scheduleEntries, statsMap, weekDays, approvedLeaveMap, restDayMap, availabilityMap, config])

  // "Vardiya ekle" menüsü: seçili gün boşta olanlar önce, vardiyası / izni olanlar altta ve açıklamalı
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null)
  const addCandidates = useMemo(() => {
    const list = scheduleEntries.map((e) => {
      const key = `${e.employee.id}:${selectedDay}`
      const a = e.dayAssignments[selectedDay]
      const busy = restDayMap.has(key) ? 'Hafta tatili'
        : approvedLeaveMap.has(key) || a?.is_on_leave ? 'İzinli'
        : a ? `Vardiyası var · ${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)}`
        : null
      return { emp: e.employee, busy }
    })
    return [...list.filter((c) => !c.busy), ...list.filter((c) => c.busy)]
  }, [scheduleEntries, selectedDay, restDayMap, approvedLeaveMap])

  const weekRange = `${format(new Date(`${weekDays[0]}T00:00:00`), 'd', { locale: tr })} – ${format(new Date(`${weekDays[6]}T00:00:00`), 'd MMMM', { locale: tr })}`
  const firstName = authEmployee?.full_name.split(/\s+/)[0]
  const hour = new Date().getHours()
  const greeting = firstName ? `${hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'}, ${firstName}` : undefined
  const isThisWeek = weekDays.includes(todayStr)

  const viewToggle = (
    <SegmentedControl
      aria-label="Görünüm"
      value={view}
      onChange={setViewPick}
      options={isMobile
        ? [{ value: 'day', label: 'Gün' }, { value: 'week', label: 'Hafta' }]
        : [{ value: 'week', label: 'Hafta' }, { value: 'day', label: 'Gün' }]}
    />
  )
  const weekStepper = (
    <PeriodStepper
      label={weekRange}
      onPrev={() => handleWeekChange(subWeeks(currentWeek, 1))}
      onNext={() => handleWeekChange(addWeeks(currentWeek, 1))}
      prevLabel="Önceki hafta"
      nextLabel="Sonraki hafta"
      minLabelWidth={isMobile ? 120 : 130}
    />
  )

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: 'text.primary' }}>
      <PageHeader
        overline={isMobile ? greeting : undefined}
        title="Haftalık plan"
        subtitle={hasData && !isMobile ? (
          <>
            {weekRange} · {scheduleEntries.length} kişi, {summary.shifts} vardiya, toplam {fmtHoursTr(summary.mins).replace(' s', ' saat')}
          </>
        ) : undefined}
        titleAdornment={hasData && summary.warnings > 0 && !isMobile ? (
          <Chip size="small" label={`${summary.warnings} uyarı`} sx={{ bgcolor: C.dangerSoft, color: C.danger, fontWeight: 700, height: 22, alignSelf: 'center' }} />
        ) : undefined}
        actions={!isMobile ? (
          <>
            {viewToggle}
            {weekStepper}
            <Button variant="outlined" color="inherit" disabled={isThisWeek} onClick={() => handleWeekChange(new Date())}
              sx={{ minHeight: 40, borderColor: 'divider', bgcolor: 'background.paper' }}>
              Bugün
            </Button>
          </>
        ) : undefined}
      />

      {isMobile && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center', '& > :first-of-type': { flex: 1 } }}>
          {weekStepper}
          {hasData && viewToggle}
        </Box>
      )}

      {hasData && !isMobile && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          {presentGroups.length > 1 && (
            <TextField
              select
              size="small"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleGroupKey | 'all')}
              slotProps={{ htmlInput: { 'aria-label': 'Rol filtresi' } }}
              sx={{ minWidth: 150, '& .MuiInputBase-root': { height: 36, fontSize: '0.82rem' } }}
            >
              <MenuItem value="all">Tüm roller</MenuItem>
              {presentGroups.map((g) => <MenuItem key={g.key} value={g.key}>{g.label}</MenuItem>)}
            </TextField>
          )}
          <Box sx={{ flex: 1 }} />
          {view === 'week' && <ShiftKindLegend />}
        </Box>
      )}

      {isFirstLoad && <ScheduleGridSkeleton rows={Math.min(Math.max(employees.length, 6), 12)} />}
      {error && <Alert severity="error">{error}</Alert>}
      {!isFirstLoad && !error && scheduleEntries.length === 0 && (
        <Alert severity="info">Aktif çalışan bulunamadı.</Alert>
      )}

      {hasData && view === 'day' && (
        // Mobilde yüzen "Vardiya ekle" butonu son satırı örtmesin
        <Box sx={{ maxWidth: isMobile ? undefined : 720, pb: isMobile && !readOnly ? 8 : 0 }}>
          <MobileDayBoard
            entries={visibleEntries}
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
        </Box>
      )}

      {hasData && view === 'week' && (
        isMobile ? (
          <Paper variant="outlined" sx={{ borderRadius: '16px', p: 1 }}>
            <WeekGrid
              compact
              entries={visibleEntries} weekDays={weekDays} todayStr={todayStr} holidayMap={holidayMap}
              statsMap={statsMap} approvedLeaveMap={approvedLeaveMap} restDayMap={restDayMap}
              availabilityMap={availabilityMap} config={config} onCellClick={openAssignDialog} readOnly={readOnly}
            />
          </Paper>
        ) : (
          <WeekGrid
            entries={visibleEntries} weekDays={weekDays} todayStr={todayStr} holidayMap={holidayMap}
            statsMap={statsMap} approvedLeaveMap={approvedLeaveMap} restDayMap={restDayMap}
            availabilityMap={availabilityMap} config={config} onCellClick={openAssignDialog} readOnly={readOnly}
          />
        )
      )}

      {/* Mobil gün görünümü: seçili güne vardiya ekle — önce o gün boşta olanlar */}
      {hasData && view === 'day' && isMobile && !readOnly && (
        <>
          <Fab
            variant="extended"
            color="primary"
            onClick={(e) => setAddMenuAnchor(e.currentTarget)}
            sx={{
              position: 'fixed',
              right: 'calc(16px + env(safe-area-inset-right))',
              bottom: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + env(safe-area-inset-bottom))`,
              zIndex: theme.zIndex.speedDial,
              gap: 0.75,
            }}
          >
            <AddIcon fontSize="small" /> Vardiya ekle
          </Fab>
          <Menu
            anchorEl={addMenuAnchor}
            open={!!addMenuAnchor}
            onClose={() => setAddMenuAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            slotProps={{ paper: { sx: { maxHeight: '60dvh', minWidth: 240 } } }}
          >
            <Typography fontSize="0.75rem" color="text.secondary" sx={{ px: 2, pt: 0.5, pb: 1 }}>
              {format(new Date(`${selectedDay}T00:00:00`), 'd MMMM EEEE', { locale: tr })} için çalışan seçin
            </Typography>
            {addCandidates.map(({ emp, busy }) => (
              <MenuItem
                key={emp.id}
                onClick={() => {
                  setAddMenuAnchor(null)
                  openAssignDialog(emp, selectedDay)
                }}
                sx={{ gap: 1.25 }}
              >
                <PersonAvatar name={emp.full_name} size={28} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography fontSize="0.85rem" fontWeight={600} noWrap>{emp.full_name}</Typography>
                  <Typography fontSize="0.7rem" color="text.secondary" noWrap>{busy ?? emp.role}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Menu>
        </>
      )}

      {hasData && view === 'week' && isMobile && (
        <Box sx={{ mt: 1.5 }}>
          <ShiftKindLegend />
          <Typography fontSize="0.7rem" color="text.secondary" sx={{ mt: 1 }}>
            Kutudaki sayı başlangıç saati · kırmızı nokta: dinlenme / limit uyarısı
          </Typography>
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
      {!readOnly && (() => {
        const isRestDay = !!leaveDeleteDialog && restDayMap.has(`${leaveDeleteDialog.employee.id}:${leaveDeleteDialog.date}`)
        const dateText = leaveDeleteDialog
          ? new Date(leaveDeleteDialog.date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
          : ''
        return (
          <AlertDialog
            open={!!leaveDeleteDialog}
            onOpenChange={(next) => { if (!next && !leaveDeleting) setLeaveDeleteDialog(null) }}
          >
            <AlertDialogContent>
              <AlertDialogHeader className="flex-row items-start gap-3">
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
                  <CalendarX2 className="size-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-1.5 pt-1">
                  <AlertDialogTitle>{isRestDay ? 'Tatili Kaldır' : 'İzni İptal Et'}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {leaveDeleteDialog && (
                      <>
                        <strong className="text-ink">{leaveDeleteDialog.employee.full_name}</strong> adlı çalışanın{' '}
                        <strong className="text-ink">{dateText}</strong>{' '}
                        {isRestDay
                          ? 'tarihindeki haftalık tatili kaldırılacak. Bu gün vardiya atanabilir hale gelecektir.'
                          : 'tarihini kapsayan onaylı izni silinecek.'}
                      </>
                    )}
                  </AlertDialogDescription>
                </div>
              </AlertDialogHeader>
              {leaveDeleteDialog && !isRestDay && (
                <UiAlert tone="info">
                  <Info />
                  <AlertDescription className="text-ink">
                    İzin tüm kapsamıyla (başlangıç–bitiş aralığı) silinir, yalnızca bu gün değil.
                  </AlertDescription>
                </UiAlert>
              )}
              <AlertDialogFooter>
                <UiButton type="button" variant="ghost" onClick={() => setLeaveDeleteDialog(null)} disabled={leaveDeleting}>
                  Vazgeç
                </UiButton>
                <UiButton type="button" variant="destructive" onClick={handleLeaveDelete} disabled={leaveDeleting}>
                  {leaveDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  İzni Sil
                </UiButton>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      })()}
    </Box>
  )
}


/** Açılış / Ortacı / Kapanış renk lejantı */
function ShiftKindLegend() {
  const items = [
    { label: 'Açılış', tone: SHIFT_KIND_TONES.opening },
    { label: 'Ortacı', tone: SHIFT_KIND_TONES.mid },
    { label: 'Kapanış', tone: SHIFT_KIND_TONES.closing },
  ]
  return (
    <Box sx={{ display: 'flex', gap: 0.75 }}>
      {items.map(({ label, tone }) => (
        <Typography key={label} component="span" sx={{ fontSize: '0.7rem', fontWeight: 600, px: 1, py: 0.25, borderRadius: '6px', bgcolor: tone.soft, color: tone.text }}>
          {label}
        </Typography>
      ))}
    </Box>
  )
}
