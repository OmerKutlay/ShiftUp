'use client'

/**
 * AuditLogPanel — kim, neyi, ne zaman değiştirdi (salt okunur, Mağaza Müdürü+).
 * Ham kayıtlar auditFormat ile okunur metne çevrilir; id / JSON gösterilmez.
 * Masaüstünde tablo, mobilde alt alta satırlar.
 */
import { Fragment, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import {
  ArrowRight, CalendarDays, CalendarRange, ChevronDown, Clock, FileText, History, Loader2, MapPin, PartyPopper,
  Search, TreePalm, User, ArrowLeftRight, type LucideIcon,
} from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import { EmptyRow, ListSkeleton, PersonAvatar } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  auditActionLabel, auditChanges, auditSummary, splitAuditNote, type AuditChange, type AuditRefs,
} from '@/lib/auditFormat'
import { cn } from '@/lib/utils'
import { SettingsAlert } from './SettingsAlert'

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

const GROUP_ICONS: { prefix: string; icon: LucideIcon; tone: string }[] = [
  { prefix: 'attendance', icon: Clock, tone: 'bg-brand-soft text-brand' },
  { prefix: 'time_correction', icon: Clock, tone: 'bg-brand-soft text-brand' },
  { prefix: 'leave', icon: TreePalm, tone: 'bg-warning-soft text-warning' },
  { prefix: 'shift_swap', icon: ArrowLeftRight, tone: 'bg-plum-soft text-plum' },
  { prefix: 'shift', icon: CalendarDays, tone: 'bg-info-soft text-info' },
  { prefix: 'employee', icon: User, tone: 'bg-plum-soft text-plum' },
  { prefix: 'workforce', icon: CalendarRange, tone: 'bg-info-soft text-info' },
  { prefix: 'store_location', icon: MapPin, tone: 'bg-success-soft text-success' },
  { prefix: 'holiday', icon: PartyPopper, tone: 'bg-plum-soft text-plum' },
  { prefix: 'report', icon: FileText, tone: 'bg-surface-muted text-ink-secondary' },
]

function groupOf(action: string) {
  return GROUP_ICONS.find((g) => action === g.prefix || action.startsWith(`${g.prefix}.`))
    ?? { icon: History, tone: 'bg-surface-muted text-ink-secondary' }
}

// Radix Select boş değer kabul etmez: "Tümü" için ayrı bir anahtar
const ALL = 'all'
const FILTERS = [
  { value: ALL, label: 'Tümü' },
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

const dateTimeFmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
})

/** Bir kaydın ekranda gösterilen, türetilmiş hali */
interface AuditView {
  log: AuditLog
  Icon: LucideIcon
  tone: string
  label: string
  actorName: string
  date: string
  summary: string | null
  changes: AuditChange[]
  note: { title: string; items: string[] } | null
  subjects: string[]
  showSubjects: boolean
}

function toView(log: AuditLog, refs: AuditRefs): AuditView {
  const { icon, tone } = groupOf(log.action)
  const subjects = log.subject_ids.map((id) => refs.employees[id]).filter(Boolean)
  return {
    log,
    Icon: icon,
    tone,
    label: auditActionLabel(log.action),
    actorName: log.actor?.full_name ?? 'Sistem',
    date: dateTimeFmt.format(new Date(log.created_at)),
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

function GroupIcon({ v, className }: { v: AuditView; className?: string }) {
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-4', v.tone, className)} aria-hidden>
      <v.Icon />
    </span>
  )
}

/** Kayıt notu — birden çok madde ya da özel başlık varsa uyarı çizgisiyle */
function AuditNote({ note }: { note: NonNullable<AuditView['note']> }) {
  const important = note.items.length > 1 || note.title !== 'Not'
  return (
    <div className={cn('mt-1.5 border-l-2 pl-2.5 text-xs whitespace-normal', important ? 'border-warning' : 'border-border')}>
      <p className="font-semibold text-ink-secondary">{note.title}</p>
      {note.items.length === 1 ? (
        <p className="text-ink">{note.items[0]}</p>
      ) : (
        <ul className="list-disc pl-4 text-ink">
          {note.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      )}
    </div>
  )
}

/** Önce → sonra değişiklik listesi */
function AuditChanges({ changes }: { changes: AuditChange[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-xl bg-muted/70 p-3 text-xs sm:grid-cols-[minmax(140px,auto)_1fr] sm:gap-y-1.5">
      {changes.map((c) => (
        <Fragment key={c.label}>
          <dt className="mt-1.5 text-ink-secondary first:mt-0 sm:mt-0">{c.label}</dt>
          <dd className="flex flex-wrap items-center gap-1.5 whitespace-normal">
            {c.before !== undefined && (
              <span className={cn('text-ink-secondary', c.after !== undefined && 'line-through')}>{c.before}</span>
            )}
            {c.before !== undefined && c.after !== undefined && <ArrowRight className="size-3 text-ink-muted" aria-hidden />}
            {c.after !== undefined && <span className="font-semibold text-ink">{c.after}</span>}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

function DetailsToggle({ open, onToggle, iconOnly = false }: { open: boolean; onToggle: () => void; iconOnly?: boolean }) {
  const label = open ? 'Ayrıntıları gizle' : 'Ayrıntıları göster'
  const chevron = <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon-sm" aria-label={label} aria-expanded={open} onClick={onToggle}>
        {chevron}
      </Button>
    )
  }
  return (
    <Button variant="ghost" size="sm" aria-expanded={open} onClick={onToggle} className="-ml-2.5 h-8 text-xs text-primary">
      {label}
      {chevron}
    </Button>
  )
}

function Subjects({ v }: { v: AuditView }) {
  if (!v.showSubjects) return null
  return <span className="font-semibold text-ink">{v.subjects.join(' ↔ ')}</span>
}

/** Masaüstü: tablo satırı (+ açılınca ayrıntı satırı) */
function AuditTableRow({ v }: { v: AuditView }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <TableRow className={cn(open && 'border-b-0')}>
        <TableCell className="py-3 pl-4 align-top whitespace-normal">
          <div className="flex gap-3">
            <GroupIcon v={v} />
            <div className="min-w-0">
              <p className="font-semibold text-ink">{v.label}</p>
              {v.summary && <p className="text-[0.8rem] text-ink-secondary">{v.summary}</p>}
              {v.note && <AuditNote note={v.note} />}
            </div>
          </div>
        </TableCell>
        <TableCell className="py-3 align-top">
          <div className="flex items-center gap-2">
            <PersonAvatar name={v.actorName} size={28} />
            <span className="text-ink">{v.actorName}</span>
          </div>
        </TableCell>
        <TableCell className="py-3 align-top text-[0.8rem] whitespace-normal">
          {v.showSubjects ? <Subjects v={v} /> : <span className="text-ink-muted">—</span>}
        </TableCell>
        <TableCell className="py-3 align-top text-[0.8rem] text-ink-secondary">{v.date}</TableCell>
        <TableCell className="w-12 py-2 text-right align-top">
          {v.changes.length > 0 && <DetailsToggle iconOnly open={open} onToggle={() => setOpen((o) => !o)} />}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="pt-0 pb-3 pl-15 whitespace-normal">
            <AuditChanges changes={v.changes} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

/** Mobil: alt alta satır */
function AuditStackedRow({ v }: { v: AuditView }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex gap-3 px-4 py-3">
      <GroupIcon v={v} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{v.label}</p>
        <p className="text-xs text-ink-muted">{v.date}</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-secondary">
          <PersonAvatar name={v.actorName} size={20} />
          <span className="min-w-0">
            {v.actorName} tarafından
            {v.showSubjects && (
              <> · {v.subjects.length > 1 ? 'Çalışanlar' : 'Çalışan'}: <Subjects v={v} /></>
            )}
          </span>
        </div>
        {v.summary && <p className="mt-1 text-sm text-ink">{v.summary}</p>}
        {v.note && <AuditNote note={v.note} />}
        {v.changes.length > 0 && (
          <>
            <DetailsToggle open={open} onToggle={() => setOpen((o) => !o)} />
            {open && <AuditChanges changes={v.changes} />}
          </>
        )}
      </div>
    </div>
  )
}

export function AuditLogPanel() {
  const [action, setAction] = useState('')
  const [query, setQuery] = useState('')
  const getKey = (index: number, prev: Page | null) => {
    if (prev && !prev.next_before) return null
    const params = new URLSearchParams({ limit: '50' })
    if (action) params.set('action', action)
    if (index > 0 && prev?.next_before) params.set('before', prev.next_before)
    return `/api/audit-logs?${params}`
  }
  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite(getKey, (url: string) => apiFetch<Page>(url))
  const logs = (data ?? []).flatMap((p) => p.logs)
  // Sayfaların isim sözlüklerini birleştir
  const refs: AuditRefs = {
    employees: Object.assign({}, ...(data ?? []).map((p) => p.refs?.employees ?? {})),
    roles: Object.assign({}, ...(data ?? []).map((p) => p.refs?.roles ?? {})),
  }
  const hasMore = !!data?.[data.length - 1]?.next_before

  // Arama yalnızca yüklenmiş kayıtlarda (istemci tarafı) çalışır
  const q = query.trim().toLocaleLowerCase('tr-TR')
  const views = logs.map((log) => toView(log, refs)).filter((v) => !q || searchText(v).includes(q))

  return (
    <div className="flex flex-col gap-4">
      {/* Filtre araç çubuğu */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Label htmlFor="audit-action" className="sr-only">İşlem türü</Label>
        <Select value={action || ALL} onValueChange={(v) => setAction(v === ALL ? '' : v)}>
          <SelectTrigger id="audit-action" className="w-full sm:w-56">
            <SelectValue placeholder="İşlem türü" />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Label htmlFor="audit-search" className="sr-only">Kişi veya açıklama ara</Label>
          <Input
            id="audit-search"
            type="search"
            placeholder="Kişi veya açıklama ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-ink-muted sm:ml-auto">Kayıtlar değiştirilemez ve silinemez.</p>
      </div>

      {error && <SettingsAlert tone="danger">{error instanceof Error ? error.message : 'Yüklenemedi.'}</SettingsAlert>}
      {isLoading && <ListSkeleton count={5} lines={2} />}

      {!isLoading && !error && (
        <div className="overflow-hidden rounded-2xl border bg-card">
          {views.length === 0 ? (
            <EmptyRow>Kayıt bulunamadı.</EmptyRow>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">İşlem</TableHead>
                      <TableHead>Yapan</TableHead>
                      <TableHead>İlgili çalışan</TableHead>
                      <TableHead>Tarih</TableHead>
                      <TableHead><span className="sr-only">Ayrıntılar</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {views.map((v) => <AuditTableRow key={v.log.id} v={v} />)}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y md:hidden">
                {views.map((v) => <AuditStackedRow key={v.log.id} v={v} />)}
              </div>
            </>
          )}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void setSize(size + 1)} disabled={isValidating}>
            {isValidating && <Loader2 className="animate-spin" />}
            Daha fazla yükle
          </Button>
        </div>
      )}
    </div>
  )
}
