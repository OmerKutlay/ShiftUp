'use client'
/**
 * AvailabilityEditor — FAZ 11
 * Haftalık müsaitlik kayıtlarını düzenler. Çalışan yalnızca kendi müsaitliğini görür/düzenler;
 * manager+ (veri girişi için) herhangi bir çalışanı seçebilir — API de aynı kuralı uygular.
 */
import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Ban, Check, Loader2, Plus, X } from 'lucide-react'
import type { EmployeeAvailability, DayOfWeek } from '@/types/workforce'
import { DAY_OF_WEEK_LABELS } from '@/types/workforce'
import type { EmployeeWithRole } from '@/types/employee'
import { DayBlocksSkeleton, EmployeeSelect } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useLoadedKey } from '@/hooks/useLoadedKey'
import { cn } from '@/lib/utils'

const DAYS: DayOfWeek[] = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

const EMPTY_FORM = { day_of_week: 'monday' as DayOfWeek, start_time: '09:00', end_time: '18:00', is_available: true, note: '' }

interface Props {
  employees: EmployeeWithRole[]
  currentEmployeeId: string
  isManager: boolean
}

export function AvailabilityEditor({ employees, currentEmployeeId, isManager }: Props) {
  const [selectedId, setSelectedId] = useState<string>(currentEmployeeId)
  const [availability, setAvailability] = useState<EmployeeAvailability[]>([])
  const { isFirstLoad, markLoaded } = useLoadedKey(selectedId)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!selectedId) return
    setError(null)
    try {
      const res = await fetch(`/api/availability?employee_id=${selectedId}`)
      const json = await res.json() as { availability: EmployeeAvailability[] }
      setAvailability(json.availability ?? [])
    } catch { setError('Yüklenemedi.') }
    finally { markLoaded(selectedId) }
  }, [selectedId, markLoaded])

  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/availability?id=${id}`, { method: 'DELETE' })
      setAvailability((prev) => prev.filter((a) => a.id !== id))
    } catch { setError('Silinemedi.') }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, employee_id: selectedId }),
      })
      const json = await res.json() as { availability: EmployeeAvailability; error?: string }
      if (!res.ok) { setError(json.error ?? 'Hata.'); return }
      setAvailability((prev) => [...prev, json.availability])
      setDialogOpen(false)
    } catch { setError('Kaydedilemedi.') }
    finally { setSaving(false) }
  }

  // Satırdaki "+" gün seçili olarak, alttaki buton son seçimle açar
  const openDialog = (day?: DayOfWeek) => {
    if (day) setForm((f) => ({ ...f, day_of_week: day }))
    setDialogOpen(true)
  }

  // Günlere göre grupla
  const grouped = DAYS.map((day) => ({
    day,
    items: availability.filter((a) => a.day_of_week === day),
  }))

  return (
    <div>
      {/* Çalışan seçici — yalnızca yöneticiler başkası adına veri girebilir */}
      {isManager ? (
        <div className="mb-4 w-full max-w-[360px]">
          <EmployeeSelect
            employees={employees}
            value={selectedId}
            label="Çalışan"
            onChange={setSelectedId}
            fullWidth
          />
        </div>
      ) : (
        <p className="mb-4 text-sm text-ink-secondary">
          Haftalık müsaitliğinizi belirtin; vardiya planlanırken dikkate alınır.
        </p>
      )}

      {error && (
        <Alert tone="danger" className="mb-3 pr-12">
          <AlertCircle />
          <AlertDescription className="text-ink">{error}</AlertDescription>
          <Button
            variant="ghost" size="icon-sm" aria-label="Kapat" onClick={() => setError(null)}
            className="absolute top-1.5 right-1.5 text-ink-secondary"
          >
            <X />
          </Button>
        </Alert>
      )}

      {isFirstLoad ? (
        <DayBlocksSkeleton count={7} />
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-card [&>*+*]:border-t">
          {grouped.map(({ day, items }) => (
            <div key={day} className="flex min-h-14 items-start gap-3 px-4 py-2.5">
              <div className="flex min-h-9 w-24 shrink-0 items-center">
                <span className={cn('text-sm font-bold', items.length === 0 && 'text-ink-secondary')}>
                  {DAY_OF_WEEK_LABELS[day]}
                </span>
              </div>
              <div className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {items.length === 0 && <span className="text-xs text-ink-muted">Kayıt yok</span>}
                {items.map((item) => (
                  <span
                    key={item.id}
                    className={cn(
                      'inline-flex max-w-full items-center gap-1.5 rounded-[10px] py-1 pr-1 pl-2.5 text-xs font-semibold',
                      item.is_available ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
                    )}
                  >
                    {item.is_available
                      ? <Check className="size-3.5 shrink-0" aria-label="Müsait" />
                      : <Ban className="size-3.5 shrink-0" aria-label="Müsait değil" />}
                    <span className="min-w-0">
                      <span className="block tabular-nums">
                        {item.start_time.slice(0,5)} – {item.end_time.slice(0,5)}
                      </span>
                      {item.note && (
                        <span className="block font-normal whitespace-normal opacity-85 [overflow-wrap:anywhere]">{item.note}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item.id)}
                      aria-label={`${DAY_OF_WEEK_LABELS[day]} ${item.start_time.slice(0,5)}–${item.end_time.slice(0,5)} kaydını sil`}
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity outline-none hover:bg-black/5 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <Button
                variant="ghost" size="icon-sm"
                onClick={() => openDialog(day)}
                aria-label={`${DAY_OF_WEEK_LABELS[day]} için müsaitlik ekle`}
                className="shrink-0 text-ink-secondary"
              >
                <Plus />
              </Button>
            </div>
          ))}
        </section>
      )}

      <Button variant="outline" size="sm" onClick={() => openDialog()} className="mt-4">
        <Plus />
        Müsaitlik Ekle
      </Button>

      {/* Ekleme dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Müsaitlik Ekle</DialogTitle>
            <DialogDescription>Planlama bu saat aralığını dikkate alır.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="avail-day">Gün</Label>
              <Select value={form.day_of_week} onValueChange={(v) => setForm((f) => ({ ...f, day_of_week: v as DayOfWeek }))}>
                <SelectTrigger id="avail-day" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d) => <SelectItem key={d} value={d}>{DAY_OF_WEEK_LABELS[d]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="avail-start">Başlangıç</Label>
                <Input id="avail-start" type="time" step={300} value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="avail-end">Bitiş</Label>
                <Input id="avail-end" type="time" step={300} value={form.end_time}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
              </div>
            </div>
            <div className="flex min-h-10 items-center gap-3">
              <Switch id="avail-available" checked={form.is_available}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, is_available: checked }))} />
              <Label htmlFor="avail-available">{form.is_available ? 'Müsait' : 'Müsait değil'}</Label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="avail-note">Not (isteğe bağlı)</Label>
              <Input id="avail-note" value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>İptal</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-label="Kaydediliyor" /> : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
