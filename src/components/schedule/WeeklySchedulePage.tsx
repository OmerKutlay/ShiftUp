'use client'

import { useState, useMemo } from 'react'
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
  compareRoles, JS_DAY_TO_KEY, EmployeeWeekStats, calcEmployeeStats, getAvailStatus,
  ROLE_GROUPS, roleGroupOf, fmtHoursTr, type RoleGroupKey,
} from './scheduleHelpers'
import { weeklyLimitMins } from './ScheduleCells'
import { MobileDayBoard } from './MobileDayBoard'
import { WeekGrid } from './WeekGrid'
import { useAuth } from '@/context/AuthContext'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { useIsMobile } from '@/hooks/useIsMobile'
import { AlertCircle, CalendarX2, Info, Loader2, Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

// ─── Ana bileşen ──────────────────────────────────────────────
interface WeeklySchedulePageProps {
  /** true → hücre tıklanamaz, dialog açılmaz, edit ikonları gizlenir */
  readOnly?: boolean
}


export function WeeklySchedulePage({ readOnly = false }: WeeklySchedulePageProps) {
  const isMobile = useIsMobile()
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

  // Grid entries — role sıralamasına göre: Müdür → Müdür yrd. → Reyon sorumlusu → Kasa → Satış → Görsel → Depo
  const scheduleEntries: WeeklyScheduleEntry[] = useMemo(() => {
    const entries = employees.map((emp) => ({
      employee: emp,
      dayAssignments: Object.fromEntries(
        weekDays.map((d) => [d, assignmentMap.get(`${emp.id}:${d}`) ?? null])
      ),
    }))
    entries.sort((a, b) => {
      const byRole = compareRoles(a.employee.roles, b.employee.roles)
      if (byRole !== 0) return byRole
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

  const handleLeaveDelete = async () => {
    if (!leaveDeleteDialog) return
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
  const presentGroups = ROLE_GROUPS.filter((g) => scheduleEntries.some((e) => roleGroupOf(e.employee.roles) === g.key))
  const visibleEntries = roleFilter === 'all'
    ? scheduleEntries
    : scheduleEntries.filter((e) => roleGroupOf(e.employee.roles) === roleFilter)

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
    <div className="p-4 text-ink md:p-6">
      <PageHeader
        overline={isMobile ? greeting : undefined}
        title="Haftalık plan"
        subtitle={hasData && !isMobile ? (
          <>
            {weekRange} · {scheduleEntries.length} kişi, {summary.shifts} vardiya, toplam {fmtHoursTr(summary.mins).replace(' s', ' saat')}
          </>
        ) : undefined}
        titleAdornment={hasData && summary.warnings > 0 && !isMobile ? (
          <Badge tone="danger" className="self-center">{summary.warnings} uyarı</Badge>
        ) : undefined}
        actions={!isMobile ? (
          <>
            {viewToggle}
            {weekStepper}
            <Button variant="outline" disabled={isThisWeek} onClick={() => handleWeekChange(new Date())}>
              Bugün
            </Button>
          </>
        ) : undefined}
      />

      {isMobile && (
        <div className="mb-4 flex items-center gap-2 [&>:first-child]:flex-1">
          {weekStepper}
          {hasData && viewToggle}
        </div>
      )}

      {hasData && !isMobile && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {presentGroups.length > 1 && (
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleGroupKey | 'all')}>
              <SelectTrigger size="sm" aria-label="Rol filtresi" className="min-w-[150px] text-[0.82rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm roller</SelectItem>
                {presentGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex-1" />
          {view === 'week' && <ShiftKindLegend />}
        </div>
      )}

      {isFirstLoad && <ScheduleGridSkeleton rows={Math.min(Math.max(employees.length, 6), 12)} />}
      {error && (
        <Alert tone="danger">
          <AlertCircle />
          <AlertDescription className="text-ink">{error}</AlertDescription>
        </Alert>
      )}
      {!isFirstLoad && !error && scheduleEntries.length === 0 && (
        <Alert tone="info">
          <Info />
          <AlertDescription className="text-ink">Aktif çalışan bulunamadı.</AlertDescription>
        </Alert>
      )}

      {hasData && view === 'day' && (
        // Mobilde yüzen "Vardiya ekle" butonu son satırı örtmesin
        <div className={isMobile ? (readOnly ? undefined : 'pb-16') : 'max-w-[720px]'}>
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
        </div>
      )}

      {hasData && view === 'week' && (
        isMobile ? (
          <div className="rounded-2xl border bg-card p-2">
            <WeekGrid
              compact
              entries={visibleEntries} weekDays={weekDays} todayStr={todayStr} holidayMap={holidayMap}
              statsMap={statsMap} approvedLeaveMap={approvedLeaveMap} restDayMap={restDayMap}
              availabilityMap={availabilityMap} config={config} onCellClick={openAssignDialog} readOnly={readOnly}
            />
          </div>
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="lg"
              className="fixed right-[calc(16px+env(safe-area-inset-right))] z-[1050] rounded-full px-5 shadow-[0_8px_24px_rgb(194_83_45/0.35)]"
              style={{ bottom: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + env(safe-area-inset-bottom))` }}
            >
              <Plus /> Vardiya ekle
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="max-h-[60dvh] min-w-60 overflow-y-auto">
            <DropdownMenuLabel>
              {format(new Date(`${selectedDay}T00:00:00`), 'd MMMM EEEE', { locale: tr })} için çalışan seçin
            </DropdownMenuLabel>
            {addCandidates.map(({ emp, busy }) => (
              <DropdownMenuItem key={emp.id} onSelect={() => openAssignDialog(emp, selectedDay)} className="gap-2.5">
                <PersonAvatar name={emp.full_name} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.85rem] font-semibold">{emp.full_name}</p>
                  <p className="truncate text-[0.7rem] text-ink-secondary">{busy ?? emp.roles?.name}</p>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {hasData && view === 'week' && isMobile && (
        <div className="mt-3">
          <ShiftKindLegend />
          <p className="mt-2 text-[0.7rem] text-ink-secondary">
            Kutudaki sayı başlangıç saati · kırmızı nokta: dinlenme / limit uyarısı
          </p>
        </div>
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
                <Alert tone="info">
                  <Info />
                  <AlertDescription className="text-ink">
                    İzin tüm kapsamıyla (başlangıç–bitiş aralığı) silinir, yalnızca bu gün değil.
                  </AlertDescription>
                </Alert>
              )}
              <AlertDialogFooter>
                <Button type="button" variant="ghost" onClick={() => setLeaveDeleteDialog(null)} disabled={leaveDeleting}>
                  Vazgeç
                </Button>
                <Button type="button" variant="destructive" onClick={handleLeaveDelete} disabled={leaveDeleting}>
                  {leaveDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  İzni Sil
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      })()}
    </div>
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
    <div className="flex gap-1.5">
      {items.map(({ label, tone }) => (
        <span key={label} className="rounded-md px-2 py-0.5 text-[0.7rem] font-semibold" style={{ backgroundColor: tone.soft, color: tone.text }}>
          {label}
        </span>
      ))}
    </div>
  )
}
