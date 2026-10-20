'use client'

/**
 * MySchedulePage — Kişisel Çalışma Özeti
 *
 * Giriş yapmış çalışanın seçili aydaki:
 *   - Toplam planlanan vardiya saati
 *   - Toplam gerçekleşen çalışma saati (mola hariç, attendance_records'dan)
 *   - Toplam mola süresi
 *   - Çalışma günü sayısı
 *   - Devamsızlık sayısı (shift_waiting)
 *   - Takvim görünümü (her günün kartı)
 *
 * Çalışan bu ekrandan maaş hesabı yapabilmek için saatlerini görebilir.
 *
 * Çevrimdışı: son başarılı aylık yanıtlar (en fazla SNAPSHOT_MONTHS ay) çalışan id'siyle
 * localStorage'a yazılır; ağ yokken bunlardan, "son güncelleme" uyarısıyla salt-okunur gösterilir.
 */
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { AlertCircle, CalendarX2, CheckCircle2, CircleX, Clock, TriangleAlert } from 'lucide-react'
import { format, startOfMonth, endOfMonth, addMonths, subMonths, getDaysInMonth, parseISO } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useAuth } from '@/context/AuthContext'
import { PageHeader, PageSkeleton, StatCardsSkeleton, DayBlocksSkeleton, StatCard, StatGrid, PeriodStepper } from '@/components/common'
import { shiftDurationMins } from '@/lib/workingTimeService'
import { apiFetch, ApiError } from '@/lib/api/http'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  getSnapshot, getSnapshotOwner, setSnapshot, formatSnapshotTime, SNAPSHOT_MAX_AGE_MS,
} from '@/lib/pwa/offlineSnapshot'
import { C, SHIFT_KIND_TONES } from '@/lib/palette'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { cn } from '@/lib/utils'

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

// ─── Yardımcılar ──────────────────────────────────────────────

function fmtMins(mins: number | null): string {
  if (mins === null || mins === 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (m === 0) return `${h}s`
  return `${h}s ${m}dk`
}

/** Toplam süre KPI'da tek satır: 10710 dk → "178,5 s" */
function fmtHoursTotal(mins: number | null): string {
  if (!mins) return '0 s'
  return `${(Math.round((mins / 60) * 10) / 10).toLocaleString('tr-TR')} s`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch { return '—' }
}

const STATUS_LABELS: Record<string, string> = {
  clocked_out: 'Tamamlandı',
  working: 'Devam Ediyor',
  on_break: 'Molada',
  working_after_break: 'Devam Ediyor',
  absent: 'Gelmedi',
  upcoming: 'Bekleniyor',
  planned: 'Planlandı',
}
const STATUS_TONES: Record<string, BadgeTone> = {
  clocked_out: 'success',
  working: 'brand',
  on_break: 'warning',
  working_after_break: 'brand',
  absent: 'danger',
  upcoming: 'neutral',
  planned: 'neutral',
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

// ─── Gün kartı ────────────────────────────────────────────────

function DayCard({ entry, isToday }: { entry: DayEntry; isToday: boolean }) {
  const status = displayStatus(entry, new Date())
  const plannedMins = shiftDurationMins(entry.start_time, entry.end_time)
  const workedMins = entry.worked_minutes ?? 0
  const date = parseISO(entry.work_date)
  const tone = SHIFT_KIND_TONES[shiftKindOf(undefined, entry.start_time, entry.end_time)]

  return (
    <div className={cn('flex gap-3 px-4 py-3', isToday && 'bg-accent')}>
      {/* Tarih bloğu */}
      <div className={cn('flex w-11 shrink-0 flex-col items-center rounded-xl py-1.5', isToday ? 'bg-primary text-white' : 'bg-muted')}>
        <span className="text-lg font-bold leading-none">{format(date, 'd')}</span>
        <span className={cn('mt-0.5 text-[0.65rem] capitalize', isToday ? 'text-white/85' : 'text-ink-secondary')}>
          {format(date, 'EEE', { locale: tr })}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="sr-only">{format(date, 'd MMMM EEEE', { locale: tr })}</span>
          <span className="rounded-lg px-2 py-0.5 text-[0.78rem] font-bold tabular-nums" style={{ color: tone.text, backgroundColor: tone.soft }}>
            Plan: {entry.start_time.slice(0, 5)} – {entry.end_time.slice(0, 5)}
          </span>
          <span className="text-xs text-ink-secondary">{fmtMins(plannedMins)}</span>
          <span className="flex-1" />
          {entry.is_on_leave
            ? <Badge tone="info">İzin</Badge>
            : <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</Badge>}
        </div>

        {/* Gerçekleşen — sadece clocked_out */}
        {entry.status === 'clocked_out' && (
          <>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="size-3.5 text-success" />
                Giriş: {fmtTime(entry.clock_in_at)} → Çıkış: {fmtTime(entry.clock_out_at)}
              </span>
              <span className="font-semibold text-success">Çalışma: {fmtMins(entry.worked_minutes)}</span>
              {(entry.break_minutes ?? 0) > 0 && <span className="font-semibold text-warning">Mola: {fmtMins(entry.break_minutes)}</span>}
            </p>
            {plannedMins > 0 && (
              <Progress
                value={Math.min(100, (workedMins / plannedMins) * 100)}
                className="mt-2 h-1"
                indicatorClassName="bg-success"
                aria-label="Gerçekleşen / planlanan"
              />
            )}
          </>
        )}

        {status === 'absent' && !entry.is_on_leave && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-danger">
            <CircleX className="size-3.5" /> Kayıt oluşturulmadı
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Ana Bileşen ──────────────────────────────────────────────

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

    for (const e of entries) {
      if (e.is_on_leave) { leaveDays++; continue }
      plannedMins += shiftDurationMins(e.start_time, e.end_time)
      if (e.status === 'clocked_out') {
        workedMins += e.worked_minutes ?? 0
        breakMins += e.break_minutes ?? 0
        workedDays++
      } else if (displayStatus(e, now) === 'absent') {
        noShowDays++
      }
    }

    return { plannedMins, workedMins, breakMins, workedDays, noShowDays, leaveDays }
  }, [entries])

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const daysInMonth = getDaysInMonth(currentMonth)

  // ─── Auth guard ───────────────────────────────────────────────
  if (authStatus === 'loading') {
    return <PageSkeleton stats={4} rows={6} maxWidth={900} />
  }
  const profile = employee ?? (offlineMode ? snapshot?.data.profile : null)
  const profileRoleName = employee ? employee.roles?.name : snapshot?.data.profile.role_name
  if (!profile) {
    return (
      <div className="p-4 md:p-6">
        <Alert tone="warning">
          <TriangleAlert />
          <AlertDescription className="text-ink">
            {offlineMode
              ? 'Çevrimdışısınız — bu cihazda kayıtlı çalışma özeti bulunmuyor. Bağlantı gelince tekrar deneyin.'
              : 'Bu sayfayı görmek için giriş yapmanız gerekiyor.'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const pct = summary.plannedMins > 0 ? Math.min(100, (summary.workedMins / summary.plannedMins) * 100) : 0

  return (
    <div className="mx-auto max-w-[900px] p-4 md:p-6">
      <PageHeader title="Çalışma özetim" subtitle={[profile.full_name, profileRoleName].filter(Boolean).join(' · ')} />

      {snapshotMonth && (
        <Alert tone="warning" className="mb-4">
          <TriangleAlert />
          <AlertDescription className="text-ink">Çevrimdışı — son güncelleme: {formatSnapshotTime(snapshotMonth.savedAt)}</AlertDescription>
        </Alert>
      )}

      {/* Ay navigasyonu */}
      <div className="mb-4">
        <PeriodStepper
          label={<span className="capitalize">{monthLabel}</span>}
          onPrev={() => setCurrentMonth((m) => subMonths(m, 1))}
          onNext={() => setCurrentMonth((m) => addMonths(m, 1))}
          nextDisabled={addMonths(currentMonth, 1) > new Date()}
          prevLabel="Önceki ay"
          nextLabel="Sonraki ay"
          minLabelWidth={120}
        />
      </div>

      {/* Özet */}
      {isFirstLoad ? <StatCardsSkeleton count={4} /> : (
        <StatGrid min={130}>
          <StatCard label="Planlanan" value={fmtHoursTotal(summary.plannedMins)} note={`${entries.filter(e => !e.is_on_leave).length} vardiya`} />
          <StatCard label="Çalışılan" value={fmtHoursTotal(summary.workedMins)} note={`${summary.workedDays} gün tamamlandı`} valueColor={C.success} />
          <StatCard label="Mola" value={fmtHoursTotal(summary.breakMins)} />
          <StatCard label="Devamsızlık" value={`${summary.noShowDays} gün`} valueColor={summary.noShowDays > 0 ? C.danger : undefined} />
          {summary.leaveDays > 0 && <StatCard label="İzin" value={`${summary.leaveDays} gün`} valueColor={C.info} />}
        </StatGrid>
      )}

      {/* Planlanan vs gerçekleşen */}
      {!isFirstLoad && summary.plannedMins > 0 && (
        <section className="mb-4 rounded-2xl border bg-card p-4">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1.5 font-semibold"><Clock className="size-4 text-primary" /> Aylık tamamlanma</span>
            <span className="text-xs text-ink-secondary">{fmtMins(summary.workedMins)} / {fmtMins(summary.plannedMins)}</span>
          </div>
          <Progress value={pct} indicatorClassName="bg-success" aria-label="Aylık tamamlanma" />
          <div className="mt-1.5 flex justify-between text-[0.7rem] text-ink-muted">
            <span>%{Math.round(pct)} tamamlandı</span>
            <span>{daysInMonth} günlük ay</span>
          </div>
        </section>
      )}

      {/* Günlük liste */}
      {isFirstLoad ? (
        <DayBlocksSkeleton count={7} />
      ) : error ? (
        <Alert tone="danger">
          <AlertCircle />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-ink">
            {error}
            <Button variant="ghost" size="sm" onClick={() => void reportQ.mutate()}>Tekrar Dene</Button>
          </AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card py-12 text-center">
          <CalendarX2 className="size-10 text-ink-muted/60" />
          <p className="text-sm text-ink-secondary">Bu ay için vardiya kaydı bulunmuyor.</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
            <h2 className="text-[0.95rem] font-bold">Vardiyalar</h2>
            <span className="text-[0.78rem] text-ink-secondary">{entries.length}</span>
          </div>
          <div className="[&>*]:border-t">
            {entries.map((entry) => (
              <DayCard key={entry.work_date} entry={entry} isToday={entry.work_date === todayStr} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
