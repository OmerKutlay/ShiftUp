'use client'

/**
 * WeeklySchedulePage — Planlama › Haftalık plan.
 *
 * DESIGN_GUIDE iskeleti: PageHeader (özet + uyarı rozeti, "Vardiya ekle") → araç çubuğu
 * (hafta gezgini, Bugün, Hafta/Gün, rol filtresi, vardiya türü lejantı) → kart içinde haftalık
 * tablo ya da günün zaman çizelgesi. Yönetici hücreye tıklayıp vardiya atar; çalışan salt okunur görür.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { addWeeks, format, subWeeks } from 'date-fns'
import { tr } from 'date-fns/locale'
import { CircleAlert, Info, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { EmployeeAvailability } from '@/types/workforce'
import { createShiftAssignment, updateShiftAssignment, deleteShiftAssignment } from '@/lib/api/schedule'
import { ApiError } from '@/lib/api/http'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import type { ShiftKind } from '@/lib/workforcePlanner'
import { useAuth } from '@/context/AuthContext'
import { useIsMobile } from '@/hooks/useIsMobile'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'
import { Page, PageHeader, PeriodStepper, SegmentedControl, useConfirm } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { useWeeklySchedule } from './useWeeklySchedule'
import { ShiftAssignDialog, type ShiftSavePayload } from './ShiftAssignDialog'
import {
  compareRoles, JS_DAY_TO_KEY, calcEmployeeStats, fmtHoursTr, fmtRange, getAvailStatus, shiftKindOf,
  ROLE_GROUPS, roleGroupOf, type EmployeeWeekStats, type RoleGroupKey,
} from './scheduleHelpers'
import { ShiftKindLegend, weeklyLimitMins } from './ScheduleCells'
import { MobileDayBoard } from './MobileDayBoard'
import { WeekGrid, WeekGridSkeleton } from './WeekGrid'
import { AddShiftMenu } from './AddShiftMenu'

const KIND_ORDER: ShiftKind[] = ['opening', 'mid', 'closing', 'full', 'custom']

const parseDay = (d: string) => new Date(`${d}T00:00:00`)
const longDate = (d: string) => format(parseDay(d), 'd MMMM EEEE', { locale: tr })

/** "19–25 Ekim" · ay geçişinde "28 Eylül–4 Ekim" */
function weekLabel(from: string, to: string): string {
  const a = parseDay(from)
  const b = parseDay(to)
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${format(b, 'd MMMM', { locale: tr })}`
    : `${format(a, 'd MMMM', { locale: tr })}–${format(b, 'd MMMM', { locale: tr })}`
}

interface WeeklySchedulePageProps {
  /** true → hücre tıklanamaz, dialog açılmaz, düzenleme eylemleri gizlenir */
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
    error,
    reload: load,
  } = useWeeklySchedule(currentWeek, { readOnly })

  // Atama diyaloğu
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogEmployee, setDialogEmployee] = useState<EmployeeWithRole | null>(null)
  const [dialogDate, setDialogDate] = useState('')
  const [dialogExisting, setDialogExisting] = useState<ShiftAssignmentWithDetails | null>(null)
  const [saving, setSaving] = useState(false)

  // İzin / tatil silme diyaloğu
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

  // Satırlar rol sırasına göre: Müdür → Müdür yrd. → Reyon sorumlusu → Kasa → Satış → Görsel → Depo
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
      return (a.employee.full_name ?? '').localeCompare(b.employee.full_name ?? '', 'tr')
    })
    return entries
  }, [employees, weekDays, assignmentMap])

  // Çalışan bazında haftalık özet
  const statsMap = useMemo(() => {
    const m = new Map<string, EmployeeWeekStats>()
    for (const entry of scheduleEntries) {
      const empAssignments = assignments.filter((a) => a.employee_id === entry.employee.id)
      m.set(entry.employee.id, calcEmployeeStats(empAssignments, weekDays, entry.employee.employment_type ?? 'full_time'))
    }
    return m
  }, [scheduleEntries, assignments, weekDays])

  const openAssignDialog = (emp: EmployeeWithRole, date: string) => {
    if (readOnly) return   // çalışan modu — sadece görüntüleme
    // İzinli / tatil günü: silme onayı
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

  const dialogSubject = () => `${dialogEmployee?.full_name ?? ''} · ${dialogDate ? longDate(dialogDate) : ''}`

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
      toast.success('Haftalık tatil atandı', { description: dialogSubject() })
      setDialogOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleLeaveDelete = async () => {
    if (!leaveDeleteDialog) return
    const isRest = restDayMap.has(`${leaveDeleteDialog.employee.id}:${leaveDeleteDialog.date}`)
    setLeaveDeleting(true)
    try {
      const res = await fetch(`/api/leave?id=${leaveDeleteDialog.leaveId}`, { method: 'DELETE' })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'İzin silinemedi.')
      toast.success(isRest ? 'Haftalık tatil kaldırıldı' : 'İzin silindi', {
        description: `${leaveDeleteDialog.employee.full_name} · ${longDate(leaveDeleteDialog.date)}`,
      })
      setLeaveDeleteDialog(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'İzin silme hatası.')
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
      toast.success(dialogExisting ? 'Vardiya güncellendi' : 'Vardiya atandı', {
        description: `${dialogSubject()} · ${fmtRange(payload.startTime, payload.endTime)}`,
      })
      setDialogOpen(false)
      await load()
    } catch (err) {
      // Sunucu İş Kanunu ihlali buldu — yönetici açıkça onaylarsa tekrar gönder
      if (!acknowledge && err instanceof ApiError && err.code === 'WORKING_TIME_VIOLATION') {
        const violations = (err.details.violations as string[] | undefined) ?? []
        if (await confirm({
          title: 'İş Kanunu ihlali',
          message: 'Bu vardiya şu kuralları ihlal ediyor:',
          items: violations,
          footer: 'Yine de kaydedilsin mi?',
          confirmText: 'Yine de kaydet',
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
      toast.success('Vardiya kaldırıldı', { description: dialogSubject() })
      setDialogOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  // Diyalogda seçilen günün müsaitlik kayıtları
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

  // Lejant: bu hafta kullanılan vardiya türleri
  const presentKinds = useMemo(() => {
    const kinds = new Set(assignments.filter((a) => !a.is_on_leave).map((a) =>
      shiftKindOf(a.shift_templates?.name, a.start_time.slice(0, 5), a.end_time.slice(0, 5))))
    return KIND_ORDER.filter((k) => kinds.has(k))
  }, [assignments])

  const weekRange = weekLabel(weekDays[0], weekDays[6])
  const firstName = authEmployee?.full_name.split(/\s+/)[0]
  const hour = new Date().getHours()
  const greeting = firstName ? `${hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'}, ${firstName}` : undefined
  const isThisWeek = weekDays.includes(todayStr)
  const goToday = () => { setCurrentWeek(new Date()); setPickedDay(null) }

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
      label={<span className="tabular-nums">{weekRange}</span>}
      onPrev={() => setCurrentWeek(subWeeks(currentWeek, 1))}
      onNext={() => setCurrentWeek(addWeeks(currentWeek, 1))}
      prevLabel="Önceki hafta"
      nextLabel="Sonraki hafta"
      minLabelWidth={isMobile ? 120 : 136}
    />
  )
  const addMenuProps = {
    entries: scheduleEntries,
    weekDays,
    restDayMap,
    approvedLeaveMap,
    onPick: openAssignDialog,
  }

  const description = hasData && !isMobile
    ? `${weekRange} · ${scheduleEntries.length} kişi · ${summary.shifts} vardiya · ${fmtHoursTr(summary.mins).replace(' s', ' saat')}`
    : !isMobile ? 'Ekibin haftalık vardiya planı' : undefined

  const leaveIsRest = !!leaveDeleteDialog && restDayMap.has(`${leaveDeleteDialog.employee.id}:${leaveDeleteDialog.date}`)

  return (
    <Page>
      <PageHeader
        overline={isMobile ? greeting : undefined}
        title="Haftalık plan"
        description={description}
        titleAdornment={hasData && summary.warnings > 0 && !isMobile ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge tone="warning" tabIndex={0} className="cursor-default tabular-nums">{summary.warnings} uyarı</Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Limit üstü saatler, dinlenme ihlalleri ve müsaitlik dışı vardiyalar; hücrelerde uyarı simgesiyle işaretlidir.
            </TooltipContent>
          </Tooltip>
        ) : undefined}
        actions={hasData && !readOnly && !isMobile ? (
          <AddShiftMenu {...addMenuProps} day={view === 'day' ? selectedDay : undefined}>
            <Button>
              <Plus />
              Vardiya ekle
            </Button>
          </AddShiftMenu>
        ) : undefined}
      />

      {/* Araç çubuğu */}
      {isMobile ? (
        <div className="flex items-center gap-2 [&>:first-child]:flex-1">
          {weekStepper}
          {hasData && viewToggle}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {weekStepper}
          <Button variant="outline" disabled={isThisWeek} onClick={goToday}>Bugün</Button>
          {hasData && viewToggle}
          {hasData && presentGroups.length > 1 && (
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleGroupKey | 'all')}>
              <SelectTrigger aria-label="Rol filtresi" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm roller</SelectItem>
                {presentGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {hasData && view === 'week' && <ShiftKindLegend kinds={presentKinds} className="ml-auto" />}
        </div>
      )}

      {isFirstLoad && <WeekGridSkeleton rows={Math.min(Math.max(employees.length, 6), 10)} />}
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Plan yüklenemedi</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!isFirstLoad && !error && scheduleEntries.length === 0 && (
        <Card className="py-0 shadow-xs">
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Users /></EmptyMedia>
              <EmptyTitle>Aktif çalışan bulunamadı</EmptyTitle>
              <EmptyDescription>Plan oluşturmak için önce çalışan ekleyin.</EmptyDescription>
            </EmptyHeader>
            {!readOnly && (
              <EmptyContent>
                <Button asChild variant="outline"><Link href="/employees">Çalışanlara git</Link></Button>
              </EmptyContent>
            )}
          </Empty>
        </Card>
      )}

      {hasData && view === 'day' && (
        // Mobilde yüzen "Vardiya ekle" düğmesi son satırı örtmesin
        <div className={isMobile && !readOnly ? 'pb-16' : undefined}>
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
        <WeekGrid
          compact={isMobile}
          entries={visibleEntries} weekDays={weekDays} todayStr={todayStr} holidayMap={holidayMap}
          statsMap={statsMap} approvedLeaveMap={approvedLeaveMap} restDayMap={restDayMap}
          availabilityMap={availabilityMap} config={config} onCellClick={openAssignDialog} readOnly={readOnly}
          meId={readOnly ? authEmployee?.id : undefined}
        />
      )}

      {hasData && view === 'week' && isMobile && (
        <div className="flex flex-col gap-2">
          <ShiftKindLegend kinds={presentKinds} />
          <p className="text-xs text-muted-foreground">
            Kutudaki sayı başlangıç saatidir · kırmızı nokta: dinlenme / limit uyarısı
          </p>
        </div>
      )}

      {/* Mobil gün görünümü: seçili güne vardiya ekle — önce o gün boşta olanlar */}
      {hasData && view === 'day' && isMobile && !readOnly && (
        <AddShiftMenu {...addMenuProps} day={selectedDay} side="top">
          <Button
            size="lg"
            className="fixed right-[calc(1rem+env(safe-area-inset-right))] z-40 rounded-full px-5 shadow-lg"
            style={{ bottom: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + var(--safe-bottom))` }}
          >
            <Plus /> Vardiya ekle
          </Button>
        </AddShiftMenu>
      )}

      {/* Atama diyaloğu — yalnızca yönetici */}
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

      {/* İzin / tatil silme onayı */}
      {!readOnly && (
        <AlertDialog
          open={!!leaveDeleteDialog}
          onOpenChange={(next) => { if (!next && !leaveDeleting) setLeaveDeleteDialog(null) }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{leaveIsRest ? 'Haftalık tatil kaldırılsın mı?' : 'İzin iptal edilsin mi?'}</AlertDialogTitle>
              <AlertDialogDescription>
                {leaveDeleteDialog && (
                  <>
                    <span className="font-medium text-foreground">{leaveDeleteDialog.employee.full_name}</span> ·{' '}
                    <span className="font-medium text-foreground">{longDate(leaveDeleteDialog.date)}</span>.{' '}
                    {leaveIsRest
                      ? 'Haftalık tatil kaldırılır; bu güne vardiya atanabilir.'
                      : 'Bu günü kapsayan onaylı izin silinir.'}
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {leaveDeleteDialog && !leaveIsRest && (
              <Alert tone="info">
                <Info />
                <AlertDescription>İzin tüm kapsamıyla (başlangıç–bitiş aralığı) silinir, yalnızca bu gün değil.</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <Button type="button" variant="outline" onClick={() => setLeaveDeleteDialog(null)} disabled={leaveDeleting}>
                Vazgeç
              </Button>
              <Button type="button" variant="destructive" onClick={handleLeaveDelete} disabled={leaveDeleting}>
                {leaveDeleting ? <Spinner /> : <Trash2 />}
                {leaveIsRest ? 'Tatili kaldır' : 'İzni sil'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Page>
  )
}
