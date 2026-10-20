'use client'

/**
 * DashboardPage — Operasyon › Genel bakış.
 *
 * Selamlama + 4 KPI → saatlik kadro grafiği ve onay bekleyen izinler → bugünkü kadro (DataTable;
 * mobilde Item kartları). Ayrıntılı takip Günlük operasyon sayfasındadır.
 */
import Link from 'next/link'
import useSWR from 'swr'
import {
  ArrowRight, CalendarClock, CalendarX2, ChevronRight, Inbox, RefreshCw, TriangleAlert, UserCheck, UserX,
} from 'lucide-react'

import { useLastUpdated } from '@/hooks/useLastUpdated'
import { formatDateRangeTr, formatDateTurkish, formatDayNameTurkish } from '@/lib/dateUtils'
import { LEAVE_TYPE_LABELS } from '@/types/leave'
import { useAuth } from '@/context/AuthContext'
import {
  DataTable, Page, PageHeader, PersonAvatar, StatCard, StatCards, StatusBadge, TableSkeleton,
  type BadgeTone, type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle,
} from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ShiftTime } from '@/components/daily-attendance/ShiftTime'
import { clock, formatDelay, lateMinutes, shiftWindow, turkeyDate, useNow } from '@/components/daily-attendance/attendanceTime'
import { StaffingChart } from './StaffingChart'

// ─── Types ───────────────────────────────────────────────────

interface DashboardStats {
  active_employees: number
  today_shifts: number
  currently_working: number
  on_break: number
  clocked_out: number
  no_show: number
  pending_leaves: number
}

interface RosterEntry {
  employee_id: string
  full_name: string
  role_name: string
  start_time: string
  end_time: string
  attendance_status: string
  /** Onaylı izinli vardiya */
  is_on_leave?: boolean
  clock_in_at: string | null
  clock_out_at: string | null
}

interface PendingLeave {
  id: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employees: any
}

interface DashboardData {
  stats: DashboardStats
  today_roster: RosterEntry[]
  pending_leaves: PendingLeave[]
}

// ─── Durum ───────────────────────────────────────────────────

/** Kadro satırının durumu: izinli, başlamadı ve gelmedi Günlük operasyonla aynı tanımda */
function rosterStatus(r: RosterEntry, now: number): { label: string; tone: BadgeTone; order: number } {
  switch (r.attendance_status) {
    case 'working':
    case 'working_after_break':
      return { label: 'Çalışıyor', tone: 'success', order: 2 }
    case 'on_break':
      return { label: 'Molada', tone: 'warning', order: 1 }
    case 'clocked_out':
      return { label: 'Çıkış yaptı', tone: 'plum', order: 4 }
  }
  if (r.is_on_leave) return { label: 'İzinli', tone: 'info', order: 5 }
  const win = shiftWindow(turkeyDate(now), r.start_time, r.end_time)
  return now < win.start
    ? { label: 'Başlamadı', tone: 'neutral', order: 3 }
    : { label: 'Gelmedi', tone: 'danger', order: 0 }
}

const sentence = (s: string) => s.charAt(0) + s.slice(1).toLocaleLowerCase('tr-TR')

function leaveTypeLabel(type: string): string {
  const label = LEAVE_TYPE_LABELS[type as keyof typeof LEAVE_TYPE_LABELS]
  return label ? sentence(label) : type
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** Kısa aralık: "25 Eki", "23–26 Kas", "30 Eki – 2 Kas" (yıl farklıysa tam biçim) */
function shortRange(start: string, end: string): string {
  if (start.slice(0, 4) !== end.slice(0, 4)) return formatDateRangeTr(start, end)
  const d = (s: string) => Number(s.slice(8, 10))
  const m = (s: string) => MONTHS[Number(s.slice(5, 7)) - 1]
  if (start === end) return `${d(start)} ${m(start)}`
  if (start.slice(0, 7) === end.slice(0, 7)) return `${d(start)}–${d(end)} ${m(end)}`
  return `${d(start)} ${m(start)} – ${d(end)} ${m(end)}`
}

function dayCount(start: string, end: string): number {
  return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1
}

// ─── Onay bekleyenler ────────────────────────────────────────

function PendingLeavesCard({ leaves, total }: { leaves: PendingLeave[]; total: number }) {
  return (
    <Card className="h-full gap-0 py-0 shadow-xs">
      <CardHeader className="py-5">
        <CardTitle className="flex items-center gap-2">
          Onay bekleyenler
          <Badge variant="secondary" className="tabular-nums">{total}</Badge>
        </CardTitle>
        <CardDescription>En eski izin talepleri</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/leave">Tümü <ArrowRight /></Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {leaves.length === 0 ? (
          <Empty className="border-t py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Inbox /></EmptyMedia>
              <EmptyTitle>Bekleyen talep yok</EmptyTitle>
              <EmptyDescription>Yeni izin talepleri burada görünür.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="border-t">
            {leaves.map((leave, i) => {
              const emp = leave.employees as { full_name: string } | null
              const days = dayCount(leave.start_date, leave.end_date)
              return (
                <div key={leave.id} role="listitem">
                  {i > 0 && <ItemSeparator />}
                  <Item asChild size="sm" className="rounded-none px-6">
                    <Link href="/leave">
                      <ItemMedia><PersonAvatar name={emp?.full_name ?? '?'} size={32} /></ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="w-full truncate">{emp?.full_name ?? '—'}</ItemTitle>
                        <ItemDescription className="truncate">
                          {leaveTypeLabel(leave.leave_type)} · {shortRange(leave.start_date, leave.end_date)}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="text-sm text-muted-foreground tabular-nums">
                        {days} gün
                        <ChevronRight className="size-4" />
                      </ItemActions>
                    </Link>
                  </Item>
                </div>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>
      {total > leaves.length && (
        <CardFooter className="mt-auto border-t py-3! text-sm text-muted-foreground">
          {total - leaves.length} talep daha var
        </CardFooter>
      )}
    </Card>
  )
}

// ─── Sayfa ───────────────────────────────────────────────────

export function DashboardPage() {
  const today = new Date()
  const now = useNow()
  const { employee } = useAuth()

  const { data, error: loadError, isValidating: loading, mutate } = useSWR<DashboardData>('/api/dashboard')
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Yükleme hatası.') : null
  const load = () => mutate()
  // SWR yanıt zamanını tutmaz; veri her değiştiğinde "son güncelleme" anını al
  const lastRefreshed = useLastUpdated(data)

  const stats = data?.stats
  const roster = data?.today_roster ?? []
  const pendingLeaves = data?.pending_leaves ?? []
  // Sunucu (UTC) ve tarayıcı aynı selamlamayı üretsin: saat her zaman Türkiye saatinden
  const hour = Number(clock(today.getTime()).slice(0, 2))
  const firstName = employee?.full_name.split(/\s+/)[0]
  const greeting = `${hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'}${firstName ? `, ${firstName}` : ''}`

  const statuses = roster.map((r) => rosterStatus(r, now))
  const notStarted = statuses.filter((s) => s.order === 3).length
  const noClockIn = statuses.filter((s) => s.order === 0).length

  const columns: ColumnDef<RosterEntry, unknown>[] = [
    {
      id: 'employee',
      accessorKey: 'full_name',
      header: 'Çalışan',
      sortingFn: (a, b) => a.original.full_name.localeCompare(b.original.full_name, 'tr'),
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <PersonAvatar name={row.original.full_name} size={32} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.full_name}</span>
            <span className="truncate text-xs text-muted-foreground">{row.original.role_name}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'shift',
      accessorKey: 'start_time',
      header: 'Vardiya',
      cell: ({ row }) => <ShiftTime start={row.original.start_time} end={row.original.end_time} detail />,
    },
    {
      id: 'in',
      header: 'Giriş',
      enableSorting: false,
      cell: ({ row }) => {
        const late = lateMinutes(row.original.clock_in_at, shiftWindow(turkeyDate(now), row.original.start_time, row.original.end_time))
        return (
          <span className="inline-flex items-baseline gap-2 tabular-nums">
            {clock(row.original.clock_in_at)}
            {late !== null && <span className="text-xs text-warning">{formatDelay(late)} geç</span>}
          </span>
        )
      },
    },
    {
      id: 'out',
      header: 'Çıkış',
      enableSorting: false,
      meta: { className: 'tabular-nums' },
      cell: ({ row }) => clock(row.original.clock_out_at),
    },
    {
      id: 'status',
      accessorFn: (r) => rosterStatus(r, now).order,
      header: 'Durum',
      meta: { className: 'w-32' },
      cell: ({ row }) => {
        const s = rosterStatus(row.original, now)
        return <StatusBadge tone={s.tone} label={s.label} />
      },
    },
  ]

  const rosterItem = (r: RosterEntry) => {
    const s = rosterStatus(r, now)
    return (
      <Item variant="outline" size="sm">
        <ItemMedia><PersonAvatar name={r.full_name} size={32} /></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="w-full truncate">{r.full_name}</ItemTitle>
          <ItemDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ShiftTime start={r.start_time} end={r.end_time} />
            {r.clock_in_at && <span className="tabular-nums">{clock(r.clock_in_at)}–{r.clock_out_at ? clock(r.clock_out_at) : '…'}</span>}
          </ItemDescription>
        </ItemContent>
        <ItemActions><StatusBadge tone={s.tone} label={s.label} /></ItemActions>
      </Item>
    )
  }

  return (
    <Page>
      <PageHeader
        overline={greeting}
        title="Genel bakış"
        description={
          <>
            {formatDayNameTurkish(today)}, {formatDateTurkish(today)}
            {lastRefreshed && (
              <span className="tabular-nums"> · Son güncelleme {lastRefreshed.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </>
        }
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw />}
            Yenile
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Özet yüklenemedi</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {error}
            <Button variant="outline" size="sm" onClick={() => void load()}>Tekrar dene</Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !loadError && (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)}
          </div>
          <div className="grid gap-4 md:gap-6 @5xl/main:grid-cols-3">
            <Skeleton className="h-[340px] rounded-xl @5xl/main:col-span-2" />
            <Skeleton className="h-[340px] rounded-xl" />
          </div>
          <TableSkeleton rows={6} columns={5} />
        </>
      )}

      {stats && (
        <>
          <StatCards>
            <StatCard
              icon={<CalendarClock />}
              label="Bugün vardiyalı"
              value={stats.today_shifts}
              hint={`${stats.active_employees} aktif çalışan`}
              href="/"
            />
            <StatCard
              icon={<UserCheck />}
              label="Şu an çalışıyor"
              value={stats.currently_working}
              hint={`${stats.on_break} molada · ${stats.clocked_out} çıkış yaptı`}
              href="/"
            />
            <StatCard
              icon={<UserX />}
              label="Gelmedi"
              value={noClockIn}
              valueClassName={noClockIn > 0 ? 'text-destructive' : undefined}
              hint={notStarted > 0
                ? `${notStarted} vardiya henüz başlamadı`
                : noClockIn > 0 ? 'Günlük operasyondan takip edin' : 'Herkes giriş yaptı'}
              href="/"
            />
            <StatCard
              icon={<Inbox />}
              label="Onay bekleyen izin"
              value={stats.pending_leaves}
              valueClassName={stats.pending_leaves > 0 ? 'text-warning' : undefined}
              hint={stats.pending_leaves > 0 ? 'Onayınızı bekliyor' : 'Bekleyen talep yok'}
              href="/leave"
            />
          </StatCards>

          <div className="grid gap-4 md:gap-6 @5xl/main:grid-cols-3">
            <div className="flex min-w-0 flex-col @5xl/main:col-span-2">
              <StaffingChart roster={roster} now={now} />
            </div>
            <PendingLeavesCard leaves={pendingLeaves} total={stats.pending_leaves} />
          </div>

          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="roster-title">
            <div className="flex items-center justify-between gap-2">
              <h2 id="roster-title" className="flex items-center gap-2 text-base font-semibold">
                Bugünkü kadro
                <Badge variant="secondary" className="tabular-nums">{roster.length}</Badge>
              </h2>
              <Button variant="outline" size="sm" asChild>
                <Link href="/">Günlük operasyon <ArrowRight /></Link>
              </Button>
            </div>
            <DataTable
              columns={columns}
              data={roster}
              pageSize={10}
              getRowId={(r, i) => `${r.employee_id}-${r.start_time}-${i}`}
              renderMobileItem={rosterItem}
              empty={
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><CalendarX2 /></EmptyMedia>
                    <EmptyTitle>Bugün vardiya yok</EmptyTitle>
                    <EmptyDescription>Bugün için planlanmış vardiya yok.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              }
            />
          </section>
        </>
      )}
    </Page>
  )
}
