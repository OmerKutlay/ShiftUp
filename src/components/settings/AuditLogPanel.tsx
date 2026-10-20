'use client'

/**
 * AuditLogPanel — kim, neyi, ne zaman değiştirdi (salt okunur, Mağaza Müdürü+).
 *
 * Ham kayıtlar auditFormat ile okunur metne çevrilir; id / JSON gösterilmez.
 * DataTable (mobilde Item kartları) + araç çubuğu: işlem türü (sunucu filtresi), yapan kişi ve arama
 * (yüklenen kayıtlarda). Satıra tıklanınca ayrıntılar (önce → sonra, not) diyalogda açılır.
 * Sayfalama imleçli: "Daha fazla yükle" sonraki 50 kaydı getirir.
 */
import { useMemo, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import {
  ArrowLeftRight, ArrowRight, CalendarDays, CalendarRange, ChevronRight, CircleAlert, Clock, FileText, History,
  Lock, MapPin, PartyPopper, Search, TreePalm, User, type LucideIcon,
} from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import { DataTable, PersonAvatar, TableSkeleton, type ColumnDef } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  auditActionLabel, auditChanges, auditSummary, splitAuditNote, type AuditChange, type AuditRefs,
} from '@/lib/auditFormat'
import { cn } from '@/lib/utils'

interface AuditLog {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  before: unknown
  after: unknown
  note: string | null
  created_at: string
  actor: { id: string; full_name: string } | null
  subject_ids: string[]
}

interface Page { logs: AuditLog[]; refs: AuditRefs; next_before: string | null }

const GROUP_ICONS: { prefix: string; icon: LucideIcon }[] = [
  { prefix: 'attendance', icon: Clock },
  { prefix: 'time_correction', icon: Clock },
  { prefix: 'leave', icon: TreePalm },
  { prefix: 'shift_swap', icon: ArrowLeftRight },
  { prefix: 'shift', icon: CalendarDays },
  { prefix: 'employee', icon: User },
  { prefix: 'workforce', icon: CalendarRange },
  { prefix: 'store_location', icon: MapPin },
  { prefix: 'holiday', icon: PartyPopper },
  { prefix: 'report', icon: FileText },
]

function groupIcon(action: string): LucideIcon {
  return GROUP_ICONS.find((g) => action === g.prefix || action.startsWith(`${g.prefix}.`))?.icon ?? History
}

// Radix Select boş değer kabul etmez: "Tümü" için ayrı bir anahtar
const ALL = 'all'
const FILTERS = [
  { value: ALL, label: 'Tüm işlemler' },
  { value: 'attendance', label: 'Devam kayıtları' },
  { value: 'time_correction', label: 'Mesai düzeltmeleri' },
  { value: 'leave', label: 'İzinler' },
  { value: 'shift', label: 'Vardiyalar ve takaslar' },
  { value: 'workforce', label: 'Haftalık plan' },
  { value: 'employee', label: 'Çalışanlar' },
  { value: 'holiday', label: 'Resmi tatiller' },
  { value: 'store_location', label: 'Mağaza konumu' },
  { value: 'report', label: 'Raporlar' },
]

const TZ = 'Europe/Istanbul'
const fullFmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ,
})
const shortFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: TZ })
const shortYearFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
const timeFmt = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const rtf = new Intl.RelativeTimeFormat('tr-TR', { numeric: 'auto' })

/** "3 saat önce", "dün" … — bir haftadan eskiyse null (tarih yeterli) */
function relative(d: Date): string | null {
  const sec = Math.round((d.getTime() - Date.now()) / 1000)
  const abs = Math.abs(sec)
  if (sec > 60) return null // saat farkı: gelecekteki kayıt için göreli metin yok
  if (abs < 60) return 'az önce'
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 7 * 86400) return rtf.format(Math.round(sec / 86400), 'day')
  return null
}

/** Bir kaydın ekranda gösterilen, türetilmiş hali */
interface AuditView {
  log: AuditLog
  Icon: LucideIcon
  label: string
  actorName: string
  /** "20 Eki · 14:32" (başka yılsa yıl da) */
  when: string
  whenFull: string
  ago: string | null
  summary: string | null
  changes: AuditChange[]
  note: { title: string; items: string[] } | null
  subjects: string[]
  showSubjects: boolean
}

function toView(log: AuditLog, refs: AuditRefs, thisYear: number): AuditView {
  const subjects = log.subject_ids.map((id) => refs.employees[id]).filter(Boolean)
  const d = new Date(log.created_at)
  const day = (d.getFullYear() === thisYear ? shortFmt : shortYearFmt).format(d)
  return {
    log,
    Icon: groupIcon(log.action),
    label: auditActionLabel(log.action),
    actorName: log.actor?.full_name ?? 'Sistem',
    when: `${day} · ${timeFmt.format(d)}`,
    whenFull: fullFmt.format(d),
    ago: relative(d),
    summary: auditSummary(log),
    changes: auditChanges(log, refs),
    note: log.note ? splitAuditNote(log.note) : null,
    subjects,
    // Kişi kendi kaydında işlem yaptıysa "Çalışan" satırı tekrar etmesin
    showSubjects: subjects.length > 0 && !(subjects.length === 1 && subjects[0] === log.actor?.full_name),
  }
}

/** Arama kutusu için kaydın aranabilir metni */
function searchText(v: AuditView) {
  return [v.label, v.actorName, v.summary ?? '', ...v.subjects, v.log.note ?? ''].join(' ').toLocaleLowerCase('tr-TR')
}

// ─── Küçük parçalar ──────────────────────────────────────────

function GroupIcon({ v }: { v: AuditView }) {
  return (
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground [&_svg]:size-4">
      <v.Icon />
    </span>
  )
}

/** Kayıt notu — birden çok madde ya da özel başlık varsa uyarı tonunda */
function AuditNote({ note }: { note: NonNullable<AuditView['note']> }) {
  const important = note.items.length > 1 || note.title !== 'Not'
  return (
    <Alert tone={important ? 'warning' : undefined}>
      <FileText />
      <AlertTitle>{note.title}</AlertTitle>
      <AlertDescription className="text-foreground">
        {note.items.length === 1 ? (
          <p>{note.items[0]}</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4">
            {note.items.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  )
}

/** Önce → sonra değişiklik tablosu */
function AuditChanges({ changes }: { changes: AuditChange[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead>Alan</TableHead>
            <TableHead>Önce</TableHead>
            <TableHead className="w-6 px-0"><span className="sr-only">→</span></TableHead>
            <TableHead>Sonra</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.map((c) => (
            <TableRow key={c.label} className="hover:bg-transparent">
              <TableCell className="align-top whitespace-normal text-muted-foreground">{c.label}</TableCell>
              <TableCell className={cn('align-top whitespace-normal', c.after !== undefined && 'text-muted-foreground line-through')}>
                {c.before ?? '—'}
              </TableCell>
              <TableCell className="w-6 px-0 align-top"><ArrowRight className="size-3.5 text-muted-foreground" aria-hidden /></TableCell>
              <TableCell className="align-top font-medium whitespace-normal">{c.after ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function DetailsDialog({ v, onClose }: { v: AuditView | null; onClose: () => void }) {
  return (
    <Dialog open={!!v} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {v && (
          <>
            <DialogHeader>
              <DialogTitle>{v.label}</DialogTitle>
              <DialogDescription>{v.whenFull}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Yapan</dt>
              <dd className="flex items-center gap-2 font-medium">
                <PersonAvatar name={v.actorName} size={24} />
                {v.actorName}
              </dd>
              {v.showSubjects && (
                <>
                  <dt className="text-muted-foreground">{v.subjects.length > 1 ? 'İlgili çalışanlar' : 'İlgili çalışan'}</dt>
                  <dd className="font-medium">{v.subjects.join(' ↔ ')}</dd>
                </>
              )}
              {v.summary && (
                <>
                  <dt className="text-muted-foreground">Özet</dt>
                  <dd>{v.summary}</dd>
                </>
              )}
            </dl>
            {v.changes.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Değişiklikler</p>
                  <AuditChanges changes={v.changes} />
                </div>
              </>
            )}
            {v.note && <AuditNote note={v.note} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Panel ───────────────────────────────────────────────────

export function AuditLogPanel() {
  const [action, setAction] = useState('')
  const [actor, setActor] = useState(ALL)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AuditView | null>(null)

  const getKey = (index: number, prev: Page | null) => {
    if (prev && !prev.next_before) return null
    const params = new URLSearchParams({ limit: '50' })
    if (action) params.set('action', action)
    if (index > 0 && prev?.next_before) params.set('before', prev.next_before)
    return `/api/audit-logs?${params}`
  }
  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite(getKey, (url: string) => apiFetch<Page>(url))
  const hasMore = !!data?.[data.length - 1]?.next_before

  const allViews = useMemo(() => {
    const pages = data ?? []
    // Sayfaların isim sözlüklerini birleştir
    const refs: AuditRefs = {
      employees: Object.assign({}, ...pages.map((p) => p.refs?.employees ?? {})),
      roles: Object.assign({}, ...pages.map((p) => p.refs?.roles ?? {})),
    }
    const thisYear = new Date().getFullYear()
    return pages.flatMap((p) => p.logs).map((log) => toView(log, refs, thisYear))
  }, [data])

  // Yapan kişi seçenekleri yüklenen kayıtlardan
  const actors = useMemo(
    () => [...new Set(allViews.map((v) => v.actorName))].sort((a, b) => a.localeCompare(b, 'tr')),
    [allViews]
  )

  // Arama ve kişi filtresi yalnızca yüklenmiş kayıtlarda (istemci tarafı) çalışır
  const q = query.trim().toLocaleLowerCase('tr-TR')
  const views = allViews.filter((v) => (actor === ALL || v.actorName === actor) && (!q || searchText(v).includes(q)))

  const columns: ColumnDef<AuditView, unknown>[] = [
    {
      id: 'action',
      header: 'İşlem',
      enableSorting: false,
      meta: { className: 'whitespace-normal py-3' },
      cell: ({ row }) => {
        const v = row.original
        return (
          <span className="flex items-start gap-3">
            <GroupIcon v={v} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{v.label}</span>
              {v.summary && <span className="line-clamp-2 text-muted-foreground">{v.summary}</span>}
            </span>
          </span>
        )
      },
    },
    {
      id: 'actor',
      header: 'Yapan',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <PersonAvatar name={row.original.actorName} size={24} />
          {row.original.actorName}
        </span>
      ),
    },
    {
      id: 'subjects',
      header: 'İlgili çalışan',
      enableSorting: false,
      meta: { className: 'whitespace-normal' },
      cell: ({ row }) => row.original.showSubjects
        ? row.original.subjects.join(' ↔ ')
        : <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'when',
      header: 'Zaman',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col whitespace-nowrap" title={row.original.whenFull}>
          <span className="tabular-nums">{row.original.when}</span>
          {row.original.ago && <span className="text-muted-foreground">{row.original.ago}</span>}
        </span>
      ),
    },
    {
      id: 'details',
      header: () => <span className="sr-only">Ayrıntılar</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-24 py-0' },
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1">
          {(row.original.changes.length > 0 || row.original.note) && (
            <Badge variant="secondary" className="tabular-nums">
              {row.original.changes.length > 0 ? `${row.original.changes.length} alan` : 'Not'}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`${row.original.label} ayrıntıları`}
            onClick={(e) => { e.stopPropagation(); setSelected(row.original) }}
          >
            <ChevronRight />
          </Button>
        </span>
      ),
    },
  ]

  const mobileItem = (v: AuditView) => (
    <Item variant="outline" size="sm" asChild className="items-start">
      <button type="button" onClick={() => setSelected(v)} className="w-full text-left">
        <ItemMedia><GroupIcon v={v} /></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{v.label}</ItemTitle>
          {v.summary && <ItemDescription className="text-foreground">{v.summary}</ItemDescription>}
          <ItemDescription className="flex flex-wrap items-center gap-x-1.5">
            <span>{v.actorName}</span>
            {v.showSubjects && <span>· {v.subjects.join(' ↔ ')}</span>}
          </ItemDescription>
          <ItemDescription className="tabular-nums">{v.ago ?? v.when}</ItemDescription>
        </ItemContent>
        <ChevronRight className="mt-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </Item>
  )

  const filtered = allViews.length > 0 && views.length === 0
  const empty = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><History /></EmptyMedia>
        <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
        <EmptyDescription>
          {filtered || action
            ? 'Filtrelere uyan kayıt yok. İşlem türünü, kişiyi veya aramayı değiştirin.'
            : 'Henüz denetim kaydı oluşmadı.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  const toolbar = (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <InputGroup className="md:w-64">
        <InputGroupInput
          type="search"
          placeholder="Kişi veya açıklama ara…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Kişi veya açıklama ara"
        />
        <InputGroupAddon><Search /></InputGroupAddon>
      </InputGroup>
      <div className="grid grid-cols-2 gap-2 md:flex">
        <Select value={action || ALL} onValueChange={(v) => setAction(v === ALL ? '' : v)}>
          <SelectTrigger className="w-full md:w-52" aria-label="İşlem türü"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={actor} onValueChange={setActor}>
          <SelectTrigger className="w-full md:w-48" aria-label="Yapan kişi"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Herkes</SelectItem>
            {actors.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  )

  return (
    <Card className="gap-5 shadow-xs">
      <CardHeader className="px-4 max-sm:grid-cols-1! md:px-6">
        <CardTitle>Denetim kaydı</CardTitle>
        <CardDescription>Kim, neyi, ne zaman değiştirdi. Ayrıntılar için kayda dokunun.</CardDescription>
        <CardAction className="hidden sm:block">
          <Badge variant="outline" className="text-muted-foreground">
            <Lock />
            Değiştirilemez
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 md:px-6">
        {toolbar}
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Denetim kaydı yüklenemedi</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : 'Bilinmeyen hata'}</AlertDescription>
          </Alert>
        )}
        {isLoading && <TableSkeleton rows={8} columns={4} />}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            data={views}
            pageSize={0}
            getRowId={(v) => v.log.id}
            onRowClick={setSelected}
            renderMobileItem={mobileItem}
            empty={empty}
          />
        )}
        {!isLoading && !error && allViews.length > 0 && (
          <div className="flex flex-col items-center gap-2 pt-1 sm:flex-row sm:justify-between">
            <p className="text-sm text-muted-foreground tabular-nums">
              {views.length === allViews.length
                ? `${allViews.length} kayıt gösteriliyor`
                : `${allViews.length} kayıttan ${views.length} kayıt gösteriliyor`}
              {!hasMore && ' · tümü yüklendi'}
            </p>
            {hasMore && (
              <Button variant="outline" onClick={() => void setSize(size + 1)} disabled={isValidating} className="w-full sm:w-auto">
                {isValidating && <Spinner />}
                Daha fazla yükle
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <DetailsDialog v={selected} onClose={() => setSelected(null)} />
    </Card>
  )
}
