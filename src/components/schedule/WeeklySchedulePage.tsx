'use client'

/**
 * WeeklySchedulePage — Planlama › Haftalık plan.
 *
 * DESIGN_GUIDE iskeleti: PageHeader (özet + uyarı rozeti, "Vardiya ekle") → araç çubuğu
 * (hafta gezgini, Bugün, Hafta/Gün, rol filtresi, vardiya türü lejantı) → kart içinde haftalık
 * tablo ya da günün zaman çizelgesi. Yönetici hücreye tıklayıp vardiya atar; çalışan salt okunur görür.
 *
 * Editör modu ("Vardiya ekle"): tablonun üstünde taş paleti açılır; seçili taş (Açılış, Kapanış, Full…,
 * özel saat, Tatil, Sil) tıklanan her hücreye diyalog açmadan uygulanır. Değişiklikler taslak
 * olarak birikir ve "Kaydet" ile topluca yazılır.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { addWeeks, format, subWeeks } from 'date-fns'
import { tr } from 'date-fns/locale'
import { CircleAlert, Info, Plus, Printer, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { EmployeeAvailability } from '@/types/workforce'
import { createShiftAssignment, updateShiftAssignment, deleteShiftAssignment } from '@/lib/api/schedule'
import { ApiError, apiFetch } from '@/lib/api/http'
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
import { EDITOR_BAR_COMPACT_HEIGHT, ScheduleEditorBar } from './ScheduleEditorBar'
import {
  ERASE_STONE, REST_STONE, applyDrafts, cellKey, customStone, paintCell, sameAsOriginal, saveSteps, splitKey,
  templateStones, type CellDraft, type CellOriginal, type DraftMap, type EditorStone, type SaveStep, type ShiftStone,
} from './scheduleEditor'

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

// ─── Editör yardımcıları ──────────────────────────────────────

/** Yöneticinin eklediği özel taşlar bu cihazda saklanır */
const CUSTOM_STONES_KEY = 'shiftup:plan-editor-stones'

function loadCustomStones(): ShiftStone[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = JSON.parse(window.localStorage.getItem(CUSTOM_STONES_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((s): s is { label: string; start: string; end: string } =>
        typeof s?.label === 'string' && typeof s?.start === 'string' && typeof s?.end === 'string')
      .map((s) => customStone(s.label, s.start, s.end))
  } catch {
    return []
  }
}

function storeCustomStones(stones: ShiftStone[]) {
  try {
    window.localStorage.setItem(
      CUSTOM_STONES_KEY,
      JSON.stringify(stones.map(({ label, start, end }) => ({ label, start, end })))
    )
  } catch { /* depolama kapalı: taşlar bu oturumla sınırlı kalır */ }
}

async function runSaveStep(step: SaveStep, acknowledge: boolean): Promise<void> {
  const options = acknowledge ? { acknowledgeViolations: true } : undefined
  switch (step.op) {
    case 'createShift':
      await createShiftAssignment(step.payload, undefined, options)
      return
    case 'updateShift':
      await updateShiftAssignment(step.id, step.employeeId, step.date, step.payload, options)
      return
    case 'deleteShift':
      await deleteShiftAssignment(step.id)
      return
    case 'deleteLeave':
      await apiFetch(`/api/leave?id=${encodeURIComponent(step.leaveId)}`, { method: 'DELETE' })
      return
    case 'createRest':
      await apiFetch('/api/leave', {
        method: 'POST',
        body: {
          employee_id: step.employeeId,
          leave_type: 'weekly_rest',
          start_date: step.date,
          end_date: step.date,
          reason: 'Haftalık tatil',
        },
      })
      return
  }
}

/** Görevleri en fazla `limit` tanesi aynı anda çalışacak şekilde yürütür */
async function runLimited(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  const queue = [...tasks]
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) await task()
  }))
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
    assignments: savedAssignments,
    availabilityMap,
    holidayMap,
    approvedLeaveMap: savedLeaveMap,
    leaveDayToId,
    restDayMap: savedRestDayMap,
    multiDayLeaveIds,
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

  // ── Editör modu ──
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<DraftMap>(() => new Map())
  const [customStones, setCustomStones] = useState<ShiftStone[]>(loadCustomStones)
  const [stonePick, setStonePick] = useState<string | null>(null)
  const [editorSaving, setEditorSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null)

  const shiftStones = useMemo(() => [...templateStones(templates), ...customStones], [templates, customStones])
  const customIds = useMemo(() => new Set(customStones.map((s) => s.id)), [customStones])
  const allStones: EditorStone[] = [...shiftStones, REST_STONE, ERASE_STONE]
  const selectedStone = allStones.find((s) => s.id === stonePick) ?? shiftStones[0] ?? ERASE_STONE

  const savedAssignmentMap = useMemo(
    () => new Map(savedAssignments.map((a) => [cellKey(a.employee_id, a.work_date), a])),
    [savedAssignments]
  )

  /** Hücrenin kayıtlı durumu; izinli, çok günlü tatil ve çalışılmış hücreler kilitli */
  const originalOf = useCallback((key: string): CellOriginal => {
    const assignment = savedAssignmentMap.get(key) ?? null
    const leaveId = leaveDayToId.get(key) ?? null
    const isRest = savedRestDayMap.has(key)
    let locked: string | null = null
    if ((savedLeaveMap.has(key) && !isRest) || assignment?.is_on_leave) locked = 'İzinli günler editörde değiştirilemez.'
    else if (isRest && leaveId && multiDayLeaveIds.has(leaveId)) locked = 'Birden fazla günü kapsayan tatil editörde değiştirilemez.'
    else if (assignment?.worked_minutes != null) locked = 'Çalışılmış vardiya değiştirilemez.'
    return { assignment, restLeaveId: isRest ? leaveId : null, locked }
  }, [savedAssignmentMap, leaveDayToId, savedRestDayMap, savedLeaveMap, multiDayLeaveIds])

  // Kaydedilecek taslaklar: veri yenilenip kayıtlı hale gelenler ya da kilitlenenler düşer
  const pendingDrafts: DraftMap = useMemo(() => {
    if (!editing) return new Map()
    return new Map([...drafts].filter(([key, draft]) => {
      const orig = originalOf(key)
      return !orig.locked && !sameAsOriginal(draft, orig)
    }))
  }, [editing, drafts, originalOf])
  const pendingKeys = useMemo(() => new Set(pendingDrafts.keys()), [pendingDrafts])

  // Tablo, özetler ve uyarılar taslaklar uygulanmış haliyle hesaplanır
  const { assignments, restDayMap, approvedLeaveMap } = useMemo(
    () => applyDrafts(
      { assignments: savedAssignments, restDayMap: savedRestDayMap, approvedLeaveMap: savedLeaveMap },
      pendingDrafts,
      templates
    ),
    [savedAssignments, savedRestDayMap, savedLeaveMap, pendingDrafts, templates]
  )

  // Kaydedilmemiş değişiklik varken sayfadan ayrılmadan önce tarayıcı uyarır
  const dirty = pendingDrafts.size > 0
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

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

  // ── Editör eylemleri ──

  const paintCellWithStone = (emp: EmployeeWithRole, date: string) => {
    if (editorSaving) return
    const key = cellKey(emp.id, date)
    const orig = originalOf(key)
    if (orig.locked) {
      toast.info(orig.locked, { id: 'plan-editor-locked', description: `${emp.full_name} · ${longDate(date)}` })
      return
    }
    setDrafts((prev) => paintCell(prev, key, selectedStone, orig))
  }

  const startEditing = () => {
    setDrafts(new Map())
    setEditing(true)
  }

  const closeEditor = () => {
    setEditing(false)
    setDrafts(new Map())
  }

  /** Kaydedilmemiş değişiklikler varsa silinmeden önce onay ister */
  const confirmDiscard = async () =>
    pendingDrafts.size === 0 || confirm({
      title: 'Değişiklikler silinsin mi?',
      message: `Kaydedilmemiş ${pendingDrafts.size} değişiklik kaybolacak.`,
      confirmText: 'Değişiklikleri sil',
      cancelText: 'Düzenlemeye dön',
      tone: 'error',
    })

  const cancelEditing = async () => {
    if (await confirmDiscard()) closeEditor()
  }

  /** Hafta değişince taslaklar geçerliliğini yitirir (yalnızca görüntülenen hafta yüklü) */
  const changeWeek = async (next: Date, resetDay = false) => {
    if (editing && !(await confirmDiscard())) return
    setDrafts(new Map())
    setCurrentWeek(next)
    if (resetDay) setPickedDay(null)
  }

  const addCustomStone = (label: string, start: string, end: string) => {
    const stone = customStone(label, start, end)
    const next = [...customStones.filter((s) => s.id !== stone.id), stone]
    setCustomStones(next)
    storeCustomStones(next)
    setStonePick(stone.id)
  }

  const removeCustomStone = (id: string) => {
    const next = customStones.filter((s) => s.id !== id)
    setCustomStones(next)
    storeCustomStones(next)
  }

  const saveEditor = async () => {
    const cells = [...pendingDrafts].sort(([a], [b]) => splitKey(a).date.localeCompare(splitKey(b).date))
    if (cells.length === 0) { closeEditor(); return }

    setEditorSaving(true)
    const failed = new Map<string, string>()        // hücre → hata
    const declined = new Set<string>()              // ihlal onaylanmadı, taslak kalır
    const needsAck: Array<{ key: string; steps: SaveStep[]; violations: string[] }> = []
    const cellLabel = (key: string) => {
      const { employeeId, date } = splitKey(key)
      const name = employees.find((e) => e.id === employeeId)?.full_name ?? ''
      return `${name} · ${format(parseDay(date), 'd MMM EEE', { locale: tr })}`
    }

    const runCell = async (key: string, steps: SaveStep[], acknowledge: boolean) => {
      for (let i = 0; i < steps.length; i++) {
        try {
          await runSaveStep(steps[i], acknowledge)
        } catch (err) {
          if (!acknowledge && err instanceof ApiError && err.code === 'WORKING_TIME_VIOLATION') {
            const violations = (err.details.violations as string[] | undefined) ?? [err.message]
            needsAck.push({ key, steps: steps.slice(i), violations })
          } else {
            failed.set(key, err instanceof Error ? err.message : 'Kaydedilemedi.')
          }
          return
        }
      }
    }

    // Aynı çalışanın günleri tarih sırasıyla (kurallar önceki günü görsün), çalışanlar paralel
    const runAll = async (jobs: Array<{ key: string; steps: SaveStep[] }>, acknowledge: boolean) => {
      let done = 0
      setSaveProgress({ done, total: jobs.length })
      const byEmployee = new Map<string, typeof jobs>()
      for (const job of jobs) {
        const id = splitKey(job.key).employeeId
        byEmployee.set(id, [...(byEmployee.get(id) ?? []), job])
      }
      await runLimited([...byEmployee.values()].map((list) => async () => {
        for (const job of list) {
          await runCell(job.key, job.steps, acknowledge)
          setSaveProgress({ done: ++done, total: jobs.length })
        }
      }), 4)
    }

    try {
      await runAll(cells.map(([key, draft]: [string, CellDraft]) => ({ key, steps: saveSteps(key, draft, originalOf(key)) })), false)

      if (needsAck.length > 0) {
        const ok = await confirm({
          title: 'İş Kanunu ihlali',
          message: 'Bazı değişiklikler şu kuralları ihlal ediyor:',
          items: needsAck.flatMap((n) => n.violations.map((v) => `${cellLabel(n.key)}: ${v}`)),
          footer: 'Yine de kaydedilsin mi? Vazgeçerseniz bu hücreler kaydedilmemiş olarak kalır.',
          confirmText: 'Yine de kaydet',
        })
        if (ok) await runAll(needsAck, true)
        else needsAck.forEach((n) => declined.add(n.key))
      }
    } finally {
      try { await load() } catch { /* tablo bir sonraki yenilemede güncellenir */ }
      setSaveProgress(null)
      setEditorSaving(false)
    }

    const kept = new Set([...failed.keys(), ...declined])
    const saved = cells.length - kept.size
    if (saved > 0) toast.success(`${saved} değişiklik kaydedildi`)
    if (failed.size > 0) {
      const [key, message] = [...failed][0]
      toast.error(`${failed.size} değişiklik kaydedilemedi`, { description: `${cellLabel(key)}: ${message}` })
    }
    if (kept.size === 0) closeEditor()
    else setDrafts((prev) => new Map([...prev].filter(([key]) => kept.has(key))))
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
  const view = editing ? 'week' : viewPick ?? (isMobile ? 'day' : 'week')
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
  const goToday = () => changeWeek(new Date(), true)

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
      onPrev={() => changeWeek(subWeeks(currentWeek, 1))}
      onNext={() => changeWeek(addWeeks(currentWeek, 1))}
      prevLabel="Önceki hafta"
      nextLabel="Sonraki hafta"
      minLabelWidth={isMobile ? 120 : 136}
    />
  )

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
        actions={hasData && !editing ? (
          <>
            {/* Aynı sekmede açılır: iOS ana ekran uygulamasında target=_blank tarayıcıya atar */}
            <Button asChild variant="outline" size={isMobile ? 'icon' : 'default'}>
              <Link href={`/schedule/print?week=${weekDays[0]}`} aria-label="Yazdır">
                <Printer />
                {!isMobile && 'Yazdır'}
              </Link>
            </Button>
            {!readOnly && !isMobile && (
              <Button onClick={startEditing}>
                <Plus />
                Vardiya ekle
              </Button>
            )}
          </>
        ) : undefined}
      />

      {/* Araç çubuğu */}
      {isMobile ? (
        <div className="flex items-center gap-2 [&>:first-child]:flex-1">
          {weekStepper}
          {hasData && !editing && viewToggle}
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

      {/* Editör modu: taş paleti */}
      {hasData && editing && (
        <ScheduleEditorBar
          compact={isMobile}
          stones={shiftStones}
          customIds={customIds}
          selectedId={selectedStone.id}
          onSelect={setStonePick}
          onAddCustom={addCustomStone}
          onRemoveCustom={removeCustomStone}
          pendingCount={pendingDrafts.size}
          saving={editorSaving}
          progress={saveProgress}
          onCancel={cancelEditing}
          onSave={saveEditor}
        />
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
          onCellPaint={editing ? paintCellWithStone : undefined}
          pendingKeys={editing ? pendingKeys : undefined}
        />
      )}

      {hasData && editing && !isMobile && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Vardiya seçin, ardından kutulara tıklayın; basılı tutup sürükleyerek birden çok kutuyu boyayabilirsiniz.
          Kesikli çerçeveli kutular henüz kaydedilmedi.
        </p>
      )}

      {hasData && view === 'week' && isMobile && (
        // Yüzen "Vardiya ekle" düğmesi lejantı örtmesin
        <div className={`flex flex-col gap-2${!readOnly && !editing ? ' pb-16' : ''}`}>
          <ShiftKindLegend kinds={presentKinds} />
          <p className="text-xs text-muted-foreground">
            {editing
              ? 'Vardiya seçip kutulara dokunun · kesikli çerçeve: kaydedilmedi'
              : 'Kutudaki sayı başlangıç saatidir · kırmızı nokta: dinlenme / limit uyarısı'}
          </p>
          {/* Sabit editör çubuğu son satırları örtmesin */}
          {editing && <div aria-hidden style={{ height: EDITOR_BAR_COMPACT_HEIGHT }} />}
        </div>
      )}

      {/* Mobil: yüzen "Vardiya ekle" editör modunu açar */}
      {hasData && isMobile && !readOnly && !editing && (
        <Button
          size="lg"
          className="fixed right-[calc(1rem+env(safe-area-inset-right))] z-40 rounded-full px-5 shadow-lg"
          style={{ bottom: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + var(--safe-bottom))` }}
          onClick={startEditing}
        >
          <Plus /> Vardiya ekle
        </Button>
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
