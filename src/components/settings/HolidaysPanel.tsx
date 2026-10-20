'use client'

/**
 * HolidaysPanel — resmi tatil takvimi yönetimi (Mağaza Müdürü+).
 * Dini bayram tarihleri her yıl değiştiği için yıllık olarak buradan güncellenir.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import type { PublicHoliday } from '@/types/holiday'
import { turkeyToday } from '@/lib/dateUtils'
import { DateField, EmptyRow, SectionCard, SectionRow, TableSkeleton, useConfirm } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SettingsAlert } from './SettingsAlert'

const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('tr-TR', { month: 'short' })
const longFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })

/** Tarih satırı: solda gün/ay kutusu, ad ve uzun tarih, tür rozeti, sil düğmesi */
function HolidayRow({ holiday: h, past, onRemove }: { holiday: PublicHoliday; past: boolean; onRemove: () => void }) {
  const d = new Date(`${h.date}T12:00:00`)
  return (
    <SectionRow className={cn(past && 'text-ink-secondary')}>
      <span
        className={cn(
          'flex size-11 shrink-0 flex-col items-center justify-center rounded-xl leading-none',
          past ? 'bg-surface-muted text-ink-muted' : 'bg-brand-soft text-brand-dark'
        )}
        aria-hidden
      >
        <span className="text-base font-bold tabular-nums">{dayFmt.format(d)}</span>
        <span className="mt-0.5 text-[0.65rem] font-semibold">{monthFmt.format(d)}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-bold', !past && 'text-ink')}>{h.name}</p>
        <p className="text-xs text-ink-secondary">{longFmt.format(d)}</p>
      </div>
      {h.half_day ? <Badge tone="info">Yarım gün</Badge> : <Badge tone="warning">Tam gün</Badge>}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${h.name} sil`} onClick={onRemove} className="-mr-2 text-ink-secondary hover:text-danger">
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Sil</TooltipContent>
      </Tooltip>
    </SectionRow>
  )
}

export function HolidaysPanel() {
  const confirm = useConfirm()
  const today = turkeyToday()
  const year = Number(today.slice(0, 4))
  const [range] = useState({ from: `${year - 1}-01-01`, to: `${year + 1}-12-31` })
  const key = `/api/holidays?from=${range.from}&to=${range.to}`
  const { data, error, mutate, isLoading } = useSWR(key, (url: string) => apiFetch<{ holidays: PublicHoliday[] }>(url))

  const [form, setForm] = useState({ date: '', name: '', half_day: false })
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const save = async () => {
    if (!form.date || !form.name.trim()) { setActionError('Tarih ve ad zorunludur.'); return }
    setSaving(true); setActionError(null)
    try {
      await apiFetch('/api/holidays', { method: 'POST', body: form })
      setForm({ date: '', name: '', half_day: false })
      await mutate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (date: string) => {
    if (!(await confirm({
      title: 'Resmi Tatili Sil',
      message: `${date} tarihli resmi tatil silinsin mi?`,
      confirmText: 'Evet, Sil',
      tone: 'error',
    }))) return
    try {
      await apiFetch(`/api/holidays?date=${date}`, { method: 'DELETE' })
      await mutate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Silinemedi.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-ink-secondary">
        Resmi tatiller planlamada işaretlenir, puantajda RT / RTÇ olarak görünür ve yıllık izinden sayılmaz.
        Dini bayram tarihlerini her yıl Diyanet takvimine göre kontrol edin. Arife günleri 13:00&apos;ten itibaren yarım gündür.
      </p>

      {/* Ekleme formu — aynı tarih varsa günceller */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <DateField
            label="Tarih" size="small" value={form.date}
            onChange={(v) => setForm((f) => ({ ...f, date: v }))}
            className="sm:min-w-[210px]"
          />
          <Label htmlFor="holiday-name" className="sr-only">Ad</Label>
          <Input
            id="holiday-name"
            placeholder="Ad (ör. Cumhuriyet Bayramı)"
            value={form.name}
            className="md:flex-1"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="flex min-h-10 items-center gap-2">
            <Checkbox
              id="holiday-half-day"
              checked={form.half_day}
              onCheckedChange={(v) => setForm((f) => ({ ...f, half_day: v === true }))}
            />
            <Label htmlFor="holiday-half-day" className="font-medium whitespace-nowrap">Yarım gün (arife)</Label>
          </div>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            Ekle / Güncelle
          </Button>
        </div>
      </Card>

      {(actionError || error) && (
        <SettingsAlert tone="danger" onClose={actionError ? () => setActionError(null) : undefined}>
          {actionError ?? (error instanceof Error ? error.message : 'Yüklenemedi.')}
        </SettingsAlert>
      )}
      {isLoading && !data && <TableSkeleton rows={6} columns={3} />}

      {data && (
        <SectionCard title="Resmi tatiller" count={data.holidays.length} subtitle={`${year - 1}–${year + 1}`}>
          {data.holidays.map((h) => (
            <HolidayRow key={h.date} holiday={h} past={h.date < today} onRemove={() => void remove(h.date)} />
          ))}
          {data.holidays.length === 0 && <EmptyRow>Kayıtlı resmi tatil yok.</EmptyRow>}
        </SectionCard>
      )}
    </div>
  )
}
