'use client'

/**
 * MySchedulePage — Planlama › Çalışma özetim
 *
 * Giriş yapmış çalışanın seçili aydaki planlanan / gerçekleşen saatleri (maaş kontrolü için):
 *   PageHeader (ay gezgini) → KPI kartları (planlanan, çalışılan, mola, devamsızlık)
 *   → "Aylık tamamlanma" kartı → haftalara bölünmüş günlük kayıtlar (Item satırları).
 *
 * Çevrimdışı: son başarılı aylık yanıtlar (en fazla SNAPSHOT_MONTHS ay) çalışan id'siyle
 * localStorage'a yazılır; ağ yokken bunlardan, "son güncelleme" uyarısıyla salt-okunur gösterilir.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  CalendarClock, CalendarX2, Clock3, Coffee, RotateCw, TriangleAlert, UserX, WifiOff,
} from 'lucide-react'
import {
  addMonths, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns'
import { tr } from 'date-fns/locale'

import { useAuth } from '@/context/AuthContext'
import { Page, PageHeader, PageSkeleton, PeriodStepper, StatCard, StatCards, StatusBadge, type BadgeTone } from '@/components/common'
import { shiftDurationMins } from '@/lib/workingTimeService'
import { apiFetch, ApiError } from '@/lib/api/http'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  getSnapshot, getSnapshotOwner, setSnapshot, formatSnapshotTime, SNAPSHOT_MAX_AGE_MS,
} from '@/lib/pwa/offlineSnapshot'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Types ────────────────────────────────────────────────────

interface DayEntry {
  work_date: string
  start_time: string
  end_time: string
  shift_name: string | null
  status: string
  clock_in_at: string | null
  clock_out_at: string | null
  break_start_at: string | null
  break_end_at: string | null
  worked_minutes: number | null
  break_minutes: number | null
  is_on_leave: boolean
  is_manual_correction?: boolean
}

// ─── Çevrimdışı anlık görüntü ─────────────────────────────────

const SNAPSHOT_NAME = 'my-schedule'
/** Saklanan en fazla ay sayısı (en son görüntülenenler) */
const SNAPSHOT_MONTHS = 3

interface MyScheduleSnapshot {
  profile: { full_name: string; role_name?: string | null }
  /** Her ay kendi kayıt zamanıyla tutulur (son güncelleme o aya aittir) */
  months: { month: string; savedAt: string; rows: DayEntry[] }[]
}

function readScheduleSnapshot(ownerId: string | null) {
  const snap = getSnapshot<MyScheduleSnapshot>(SNAPSHOT_NAME, ownerId)
  if (!snap || !Array.isArray(snap.data?.months)) return null
  // Süresi dolmuş aylar (SNAPSHOT_MAX_AGE_MS) gösterilmez
  const now = Date.now()
  const months = snap.data.months.filter((m) => now - Date.parse(m.savedAt) <= SNAPSHOT_MAX_AGE_MS)
  return { ...snap, data: { ...snap.data, months } }
}

/** Başarılı aylık yanıtı anlık görüntüye ekler (aynı ay varsa değiştirir, en yeni başta) */
function saveScheduleSnapshot(
  ownerId: string,
  profile: MyScheduleSnapshot['profile'],
  month: string,
  rows: DayEntry[],
) {
  const entry = { month, savedAt: new Date().toISOString(), rows }
  const prev = readScheduleSnapshot(ownerId)?.data.months ?? []
  const months = [entry, ...prev.filter((m) => m.month !== month)].slice(0, SNAPSHOT_MONTHS)
  // Boyut sınırı aşılırsa yalnızca bu ayı saklamayı dene
  if (!setSnapshot<MyScheduleSnapshot>(SNAPSHOT_NAME, ownerId, { profile, months })) {
    setSnapshot<MyScheduleSnapshot>(SNAPSHOT_NAME, ownerId, { profile, months: [entry] })
  }
}

// ─── Biçimlendirme ────────────────────────────────────────────

/** 428 dk → "7s 8d", 480 → "8s", 0 / null → "—" */
function fmtMins(mins: number | null): string {
  if (mins === null || mins === 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}d`
  if (m === 0) return `${h}s`
  return `${h}s ${m}d`
}

/** Toplam süre KPI'da tek satır: 10710 dk → "178,5 s" */
function fmtHoursTotal(mins: number | null): string {
  if (!mins) return '0 s'
  return `${(Math.round((mins / 60) * 10) / 10).toLocaleString('tr-TR')} s`
}

const timeFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false })
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : timeFmt.format(d)
}

const STATUS_LABELS: Record<string, string> = {
  clocked_out: 'Tamamlandı',
  working: 'Devam ediyor',
  on_break: 'Molada',
  working_after_break: 'Devam ediyor',
  absent: 'Gelmedi',
  upcoming: 'Bekleniyor',
  planned: 'Planlandı',
  leave: 'İzinli',
}
const STATUS_TONES: Record<string, BadgeTone> = {
  clocked_out: 'success',
  working: 'info',
  on_break: 'warning',
  working_after_break: 'info',
  absent: 'danger',
  upcoming: 'neutral',
  planned: 'neutral',
  leave: 'info',
}

/**
 * Kayıt yoksa (shift_waiting) vardiyanın zamanına göre anlamlı durum: ileri tarihli vardiya
 * "Planlandı", bugün bitiş saati geçmemişse "Bekleniyor", ancak vardiya geçmişte kaldıysa "Gelmedi".
 */
function displayStatus(entry: DayEntry, now: Date): string {
  if (entry.status !== 'shift_waiting') return entry.status
  const todayStr = format(now, 'yyyy-MM-dd')
  if (entry.work_date > todayStr) return 'planned'
  if (entry.work_date === todayStr) {
    const nowHm = format(now, 'HH:mm')
    const end = entry.end_time.slice(0, 5)
    // Gece yarısını geçen vardiya (bitiş ≤ başlangıç) bugün içinde bitmez
    if (end <= entry.start_time.slice(0, 5) || nowHm < end) return 'upcoming'
  }
  return 'absent'
}

const ACTIVE_STATUSES = new Set(['working', 'on_break', 'working_after_break'])

// ─── Gün satırı ───────────────────────────────────────────────

/** Masaüstü sütunları: plan · giriş–çıkış · mola · çalışma (başlık satırıyla aynı ızgara) */
const COLS = 'md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:items-center md:gap-4'

/** Tarih bloğu: gün numarası + kısa gün adı; bugün marka renginde */
function DateBlock({ date, isToday }: { date: Date; isToday: boolean }) {
  return (
    <div
      className={cn(
        'flex size-11 flex-col items-center justify-center rounded-md border',
        isToday ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
      )}
    >
      <span className="text-base leading-none font-semibold tabular-nums">{format(date, 'd')}</span>
      <span className={cn('mt-0.5 text-xs leading-none capitalize', isToday ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
        {format(date, 'EEE', { locale: tr })}
      </span>
    </div>
  )
}

/** Plan saati — vardiya türü rengiyle (Açılış amber, Ortacı mavi, Kapanış mor) */
function PlanTime({ entry }: { entry: DayEntry }) {
  const start = entry.start_time.slice(0, 5)
  const end = entry.end_time.slice(0, 5)
  const tone = SHIFT_KIND_TONES[shiftKindOf(entry.shift_name ?? undefined, start, end)]
  return (
    <span className="inline-flex items-center gap-2 font-medium whitespace-nowrap tabular-nums">
      <span aria-hidden className="h-4 w-1 rounded-full" style={{ backgroundColor: tone.fill }} />
      {start}–{end}
    </span>
  )
}

function DayRow({ entry, isToday, now }: { entry: DayEntry; isToday: boolean; now: Date }) {
  const status = entry.is_on_leave ? 'leave' : displayStatus(entry, now)
  const plannedMins = shiftDurationMins(entry.start_time, entry.end_time)
  const date = parseISO(entry.work_date)
  const done = entry.status === 'clocked_out'
  const active = ACTIVE_STATUSES.has(entry.status)
  const hasClock = done || active

  const actual = hasClock
    ? `${fmtTime(entry.clock_in_at)}–${done ? fmtTime(entry.clock_out_at) : '…'}`
    : '—'
  const breakText = done ? fmtMins(entry.break_minutes) : '—'
  const workedText = done ? fmtMins(entry.worked_minutes) : '—'

  // Mobil ikinci satır: gerçekleşen özet ya da durum açıklaması
  const mobileLine = entry.is_on_leave
    ? 'İzinli gün'
    : done
      ? actual
      : active
        ? `Giriş ${fmtTime(entry.clock_in_at)}`
        : status === 'absent'
          ? 'Giriş kaydı yok'
          : null

  return (
    <Item
      role="listitem"
      size="sm"
      aria-current={isToday ? 'date' : undefined}
      className={cn('flex-nowrap rounded-none border-0 border-b border-border px-4 last:border-b-0 md:px-6', isToday && 'bg-primary/5')}
    >
      <ItemMedia>
        <DateBlock date={date} isToday={isToday} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <span className="sr-only">{format(date, 'd MMMM EEEE', { locale: tr })}{isToday && ', bugün'}</span>
        <div className={cn('flex flex-col gap-1', COLS)}>
          <div className="flex items-center gap-2 text-sm">
            <PlanTime entry={entry} />
            <span className="text-muted-foreground tabular-nums">{fmtMins(plannedMins)}</span>
          </div>
          <span className="hidden text-sm tabular-nums md:block">{actual}</span>
          <span className="hidden text-sm text-muted-foreground tabular-nums md:block">{breakText}</span>
          <span className="hidden text-sm font-medium tabular-nums md:block">{workedText}</span>
          {mobileLine && (
            <p className={cn('truncate text-sm text-muted-foreground tabular-nums md:hidden', status === 'absent' && 'text-destructive')}>
              {mobileLine}
            </p>
          )}
        </div>
      </ItemContent>
      <ItemActions className="flex-col items-end gap-1 md:w-32 md:flex-row md:justify-end">
        <StatusBadge tone={STATUS_TONES[status] ?? 'neutral'} label={STATUS_LABELS[status] ?? status} />
        {done && <span className="text-sm font-medium tabular-nums md:hidden">{workedText}</span>}
      </ItemActions>
    </Item>
  )
}

// ─── Haftalara bölme ──────────────────────────────────────────

interface WeekGroup {
  key: string
  label: string
  entries: DayEntry[]
  workedMins: number
  plannedMins: number
}

function groupByWeek(entries: DayEntry[]): WeekGroup[] {
  const groups = new Map<string, WeekGroup>()
  for (const e of entries) {
    const d = parseISO(e.work_date)
    const ws = startOfWeek(d, { weekStartsOn: 1 })
    const key = format(ws, 'yyyy-MM-dd')
    let g = groups.get(key)
    if (!g) {
      const we = endOfWeek(d, { weekStartsOn: 1 })
      const label = isSameMonth(ws, we)
        ? `${format(ws, 'd')}–${format(we, 'd MMMM', { locale: tr })}`
        : `${format(ws, 'd MMM', { locale: tr })} – ${format(we, 'd MMM', { locale: tr })}`
      g = { key, label, entries: [], workedMins: 0, plannedMins: 0 }
      groups.set(key, g)
    }
    g.entries.push(e)
    if (!e.is_on_leave) g.plannedMins += shiftDurationMins(e.start_time, e.end_time)
    if (e.status === 'clocked_out') g.workedMins += e.worked_minutes ?? 0
  }
  return [...groups.values()]
}

// ─── Yükleniyor ───────────────────────────────────────────────

function ContentSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)}
      </div>
      <Skeleton className="h-[132px] rounded-xl" />
      <Card className="gap-0 py-0 shadow-xs">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={cn('flex items-center gap-3 px-4 py-3 md:px-6', i > 0 && 'border-t')}>
            <Skeleton className="size-11 rounded-md" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3.5 w-24 md:hidden" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </Card>
    </>
  )
}

// ─── Sayfa ────────────────────────────────────────────────────

export function MySchedulePage() {
  const { employee, status: authStatus, sessionCheck } = useAuth()
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd')
  const monthLabel = format(currentMonth, 'MMMM yyyy', { locale: tr })
  // ── Veri (SWR) — ay değişince eski ayın geç gelen yanıtı yenisinin üstüne yazamaz ──
  const reportKey = authStatus === 'authenticated' && employee
    ? `/api/reports/my?${new URLSearchParams({ date_from: monthStart, date_to: monthEnd })}`
    : null
  // Yanıt, ait olduğu URL ile birlikte tutulur: keepPreviousData önceki ayı döndürürken
  // çevrimdışı görünümde yanlış aya ait veri gösterilmesin
  const reportQ = useSWR(
    reportKey,
    async (url: string) => ({ url, ...(await apiFetch<{ rows: DayEntry[] }>(url)) }),
    {
      onSuccess: (data) => {
        if (!employee) return
        const month = new URL(data.url, 'http://x').searchParams.get('date_from')
        if (month) {
          saveScheduleSnapshot(employee.id, { full_name: employee.full_name, role_name: employee.roles?.name ?? null }, month, data.rows)
        }
      },
    },
  )

  // ── Çevrimdışı ───────────────────────────────────────────────
  // Ağ hatası (sunucuya ulaşılamadı) ya da navigator.onLine=false → anlık görüntüden göster.
  // Sunucunun döndürdüğü hata (ApiError) çevrimdışı sayılmaz; olduğu gibi gösterilir.
  const online = useOnlineStatus()
  // Çevrimdışı açılışta /api/auth/me'ye ulaşılamaz (oturum "yok" görünür) → cihazdaki sahibin
  // anlık görüntüsü kullanılır. Sahip çıkışta / başka kullanıcı girişinde silinir.
  // Oturum sunucuya ulaşılamadığı için bilinmiyorsa (ağ hatası / 5xx) da cihaz sahibinin
  // anlık görüntüsü gösterilir; sunucu oturumu kesin reddettiyse görüntüler zaten silinmiştir
  const offlineMode =
    authStatus === 'unauthenticated' && (!online || sessionCheck?.result === 'unreachable')
  const networkFailed =
    !online || offlineMode || (!!reportQ.error && !(reportQ.error instanceof ApiError))
  const ownerId = employee?.id ?? (offlineMode ? getSnapshotOwner() : null)
  const snapshot = useMemo(
    () => (networkFailed ? readScheduleSnapshot(ownerId) : null),
    [networkFailed, ownerId],
  )
  const snapshotMonth = snapshot?.data.months.find((m) => m.month === monthStart) ?? null
  const liveData = networkFailed && reportQ.data?.url !== reportKey ? undefined : reportQ.data

  const entries = useMemo(() => snapshotMonth?.rows ?? liveData?.rows ?? [], [snapshotMonth, liveData])
  const isFirstLoad = !snapshotMonth && !liveData && !reportQ.error && !networkFailed
  const error = snapshotMonth || liveData
    ? null
    : networkFailed
      ? 'Çevrimdışısınız — bu ay için kaydedilmiş veri yok. Bağlantı gelince yeniden yüklenir.'
      : reportQ.error ? (reportQ.error instanceof Error ? reportQ.error.message : 'Veriler yüklenemedi.') : null

  // ── Özet hesapla ─────────────────────────────────────────────
  const summary = useMemo(() => {
    const now = new Date()
    let plannedMins = 0
    let workedMins = 0
    let breakMins = 0
    let workedDays = 0
    let noShowDays = 0
    let leaveDays = 0
    let shifts = 0
    let remaining = 0

    for (const e of entries) {
      if (e.is_on_leave) { leaveDays++; continue }
      shifts++
      plannedMins += shiftDurationMins(e.start_time, e.end_time)
      const st = displayStatus(e, now)
      if (e.status === 'clocked_out') {
        workedMins += e.worked_minutes ?? 0
        breakMins += e.break_minutes ?? 0
        workedDays++
      } else if (st === 'absent') {
        noShowDays++
      } else {
        remaining++
      }
    }

    return { plannedMins, workedMins, breakMins, workedDays, noShowDays, leaveDays, shifts, remaining }
  }, [entries])

  const weeks = useMemo(() => groupByWeek(entries), [entries])
  const now = new Date()
  const todayStr = format(now, 'yyyy-MM-dd')
  const isCurrentMonth = isSameMonth(currentMonth, now)

  // ─── Auth guard ───────────────────────────────────────────────
  if (authStatus === 'loading') {
    return <PageSkeleton stats={4} rows={6} />
  }
  const profile = employee ?? (offlineMode ? snapshot?.data.profile : null)
  const profileRoleName = employee ? employee.roles?.name : snapshot?.data.profile.role_name
  if (!profile) {
    return (
      <Page>
        <Alert tone="warning">
          <TriangleAlert />
          <AlertDescription>
            {offlineMode
              ? 'Çevrimdışısınız — bu cihazda kayıtlı çalışma özeti bulunmuyor. Bağlantı gelince tekrar deneyin.'
              : 'Bu sayfayı görmek için giriş yapmanız gerekiyor.'}
          </AlertDescription>
        </Alert>
      </Page>
    )
  }

  const pct = summary.plannedMins > 0 ? Math.min(100, (summary.workedMins / summary.plannedMins) * 100) : 0
  const avgBreak = summary.workedDays > 0 ? Math.round(summary.breakMins / summary.workedDays) : 0

  return (
    <Page>
      <PageHeader
        title="Çalışma özetim"
        description={[profile.full_name, profileRoleName].filter(Boolean).join(' · ')}
        actions={
          <>
            {!isCurrentMonth && (
              <Button variant="outline" onClick={() => setCurrentMonth(new Date())}>Bu ay</Button>
            )}
            <PeriodStepper
              label={<span className="capitalize">{monthLabel}</span>}
              onPrev={() => setCurrentMonth((m) => subMonths(m, 1))}
              onNext={() => setCurrentMonth((m) => addMonths(m, 1))}
              nextDisabled={addMonths(currentMonth, 1) > new Date()}
              prevLabel="Önceki ay"
              nextLabel="Sonraki ay"
              minLabelWidth={128}
            />
          </>
        }
      />

      {snapshotMonth && (
        <Alert tone="warning">
          <WifiOff />
          <AlertTitle>Çevrimdışı görünüm</AlertTitle>
          <AlertDescription>Çevrimdışı — son güncelleme: {formatSnapshotTime(snapshotMonth.savedAt)}</AlertDescription>
        </Alert>
      )}

      {isFirstLoad ? <ContentSkeleton /> : error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Çalışma özeti yüklenemedi</AlertTitle>
          <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void reportQ.mutate()}>
              <RotateCw />
              Tekrar dene
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <StatCards>
            <StatCard
              icon={<CalendarClock />}
              label="Planlanan"
              value={fmtHoursTotal(summary.plannedMins)}
              hint={`${summary.shifts} vardiya`}
            />
            <StatCard
              icon={<Clock3 />}
              label="Çalışılan"
              value={fmtHoursTotal(summary.workedMins)}
              badge={summary.plannedMins > 0 && <Badge variant="outline" className="tabular-nums">%{Math.round(pct)}</Badge>}
              hint={`${summary.workedDays} gün tamamlandı`}
            />
            <StatCard
              icon={<Coffee />}
              label="Mola"
              value={fmtHoursTotal(summary.breakMins)}
              hint={avgBreak > 0 ? `Günde ort. ${fmtMins(avgBreak)}` : 'Mola kaydı yok'}
            />
            <StatCard
              icon={<UserX />}
              label="Devamsızlık"
              value={`${summary.noShowDays} gün`}
              valueClassName={summary.noShowDays > 0 ? 'text-destructive' : undefined}
              hint={summary.leaveDays > 0 ? `${summary.leaveDays} gün izinli` : summary.noShowDays > 0 ? 'Giriş kaydı olmayan vardiya' : 'Devamsızlık yok'}
            />
          </StatCards>

          {summary.plannedMins > 0 && (
            <Card className="gap-4 shadow-xs">
              <CardHeader>
                <CardTitle>Aylık tamamlanma</CardTitle>
                <CardDescription>Çalışılan sürenin planlanan süreye oranı</CardDescription>
                <CardAction className="text-2xl font-semibold tabular-nums">%{Math.round(pct)}</CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Progress value={pct} indicatorClassName="bg-success" className="bg-muted" aria-label="Aylık tamamlanma" />
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  <span className="tabular-nums">
                    <span className="font-medium text-foreground">{fmtMins(summary.workedMins)}</span> / {fmtMins(summary.plannedMins)}
                  </span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                    <span>{summary.workedDays} tamamlanan</span>
                    {summary.remaining > 0 && <span>{summary.remaining} kalan vardiya</span>}
                    {summary.noShowDays > 0 && <span className="text-destructive">{summary.noShowDays} devamsız</span>}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="gap-0 overflow-hidden py-0 shadow-xs">
            <CardHeader className="border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
              <CardTitle className="flex items-center gap-2">
                Günlük kayıtlar
                <Badge variant="secondary" className="tabular-nums">{entries.length}</Badge>
              </CardTitle>
              <CardDescription>Plan ve gerçekleşen giriş–çıkış saatleri</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {entries.length === 0 ? (
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><CalendarX2 /></EmptyMedia>
                    <EmptyTitle>Vardiya yok</EmptyTitle>
                    <EmptyDescription>Bu ay için vardiya kaydı bulunmuyor.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  {/* Masaüstü sütun başlıkları — satır ızgarasıyla hizalı */}
                  <div aria-hidden className="hidden items-center gap-2.5 border-b bg-muted px-6 py-2 text-xs font-medium text-muted-foreground md:flex">
                    <span className="w-11">Gün</span>
                    <div className={cn('flex-1', COLS)}>
                      <span>Plan</span>
                      <span>Giriş–çıkış</span>
                      <span>Mola</span>
                      <span>Çalışma</span>
                    </div>
                    <span className="w-32 text-right">Durum</span>
                  </div>
                  {weeks.map((w, wi) => (
                    <section key={w.key} aria-label={`${w.label} haftası`}>
                      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground md:px-6">
                        <span className="font-medium text-foreground">{w.label}</span>
                        <span className="tabular-nums">
                          {w.workedMins > 0 ? `${fmtMins(w.workedMins)} / ${fmtMins(w.plannedMins)}` : `${fmtMins(w.plannedMins)} planlı`}
                        </span>
                      </div>
                      <ItemGroup className={cn(wi < weeks.length - 1 && 'border-b')}>
                        {w.entries.map((entry) => (
                          <DayRow key={entry.work_date} entry={entry} isToday={entry.work_date === todayStr} now={now} />
                        ))}
                      </ItemGroup>
                    </section>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  )
}
