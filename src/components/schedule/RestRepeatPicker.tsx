'use client'

/**
 * RestRepeatPicker — tekrarlayan haftalık tatilin süresi: Süresiz / 1 ay / 3 ay / 6 ay / 1 yıl ya da
 * elle hafta sayısı. startDate verilirse kaç hafta sürdüğü ve son tatil günü özetlenir.
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  MAX_REPEAT_WEEKS, MIN_REPEAT_WEEKS, REST_REPEAT_PRESETS, isValidRepeatWeeks, repeatOccurrences, repeatUntil,
  sameRepeat, type RestRepeat,
} from '@/lib/restRepeat'

const WEEKS_KEY = 'weeks'

const longDate = (d: string) =>
  new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T00:00:00`))

/** Seçili süreyi özetler: "13 hafta · son tatil 2 Şubat 2027" */
export function repeatSummary(startDate: string, repeat: RestRepeat): string {
  const until = repeatUntil(startDate, repeat)
  if (!until) return 'Bitiş yok; plan yapılmamış haftalara yazılmaya devam eder.'
  return `${repeatOccurrences(startDate, until)} hafta · son tatil ${longDate(until)}`
}

export function RestRepeatPicker({ value, onChange, startDate, idPrefix = 'repeat' }: {
  value: RestRepeat
  /** valid=false: elle girilen hafta sayısı geçersiz (seçim tamamlanamaz); repeat son geçerli değerdir */
  onChange: (repeat: RestRepeat, valid: boolean) => void
  startDate?: string
  idPrefix?: string
}) {
  const preset = REST_REPEAT_PRESETS.find((p) => sameRepeat(p.repeat, value))
  const [weeksMode, setWeeksMode] = useState(!preset)
  const [weeksText, setWeeksText] = useState(value?.unit === 'week' ? String(value.count) : '4')
  const weeks = Number(weeksText)
  const weeksValid = isValidRepeatWeeks(weeks)
  const selected = weeksMode ? WEEKS_KEY : preset?.key ?? WEEKS_KEY

  const select = (key: string) => {
    if (!key) return
    if (key === WEEKS_KEY) {
      setWeeksMode(true)
      onChange(weeksValid ? { unit: 'week', count: weeks } : value, weeksValid)
      return
    }
    setWeeksMode(false)
    onChange(REST_REPEAT_PRESETS.find((p) => p.key === key)?.repeat ?? null, true)
  }

  const changeWeeks = (text: string) => {
    setWeeksText(text)
    const n = Number(text)
    onChange(isValidRepeatWeeks(n) ? { unit: 'week', count: n } : value, isValidRepeatWeeks(n))
  }

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={1.5}
        value={selected}
        onValueChange={select}
        aria-label="Tekrar süresi"
        className="flex-wrap"
      >
        {REST_REPEAT_PRESETS.map((p) => (
          <ToggleGroupItem key={p.key} value={p.key} className="h-8 px-2.5 data-[state=on]:border-primary data-[state=on]:bg-primary/10">
            {p.label}
          </ToggleGroupItem>
        ))}
        <ToggleGroupItem value={WEEKS_KEY} className="h-8 px-2.5 data-[state=on]:border-primary data-[state=on]:bg-primary/10">
          Hafta sayısı
        </ToggleGroupItem>
      </ToggleGroup>

      {weeksMode && (
        <Field data-invalid={!weeksValid || undefined} orientation="horizontal" className="items-center gap-2">
          <FieldLabel htmlFor={`${idPrefix}-weeks`} className="sr-only">Kaç hafta</FieldLabel>
          <Input
            id={`${idPrefix}-weeks`}
            type="number"
            inputMode="numeric"
            min={MIN_REPEAT_WEEKS}
            max={MAX_REPEAT_WEEKS}
            value={weeksText}
            onChange={(e) => changeWeeks(e.target.value)}
            aria-invalid={!weeksValid || undefined}
            className="w-24 text-base tabular-nums md:text-sm"
          />
          <span className="text-sm text-muted-foreground">hafta boyunca</span>
        </Field>
      )}

      <FieldDescription aria-live="polite" className="tabular-nums">
        {weeksMode && !weeksValid
          ? `${MIN_REPEAT_WEEKS}–${MAX_REPEAT_WEEKS} arasında bir hafta sayısı girin.`
          : startDate ? repeatSummary(startDate, value) : null}
      </FieldDescription>
    </div>
  )
}

