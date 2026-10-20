'use client'

// Aramalı çalışan seçici — çalışan sayısı arttıkça uzun listeyi kaydırmak yerine
// isimle (Türkçe karakterden bağımsız: "omer" → "Ömer") filtrelemeye izin verir.

import { useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface EmployeeOption {
  id: string
  full_name: string
  /** Sistem rolü (join) — yalnızca ad gösterilir */
  roles?: { name: string } | null
  active?: boolean
}

interface EmployeeSelectProps<T extends EmployeeOption> {
  employees: T[]
  /** Seçili çalışan id'si; '' = seçim yok */
  value: string
  onChange: (id: string) => void
  label: string
  /** Seçim yokken gösterilen metin (örn. "Tüm Çalışanlar"); verilirse temizleme butonu da açılır */
  emptyLabel?: string
  /** Seçenekte rol adını ikinci satırda göster */
  showRole?: boolean
  onOpen?: () => void
  size?: 'small' | 'medium'
  fullWidth?: boolean
  disabled?: boolean
  /** Kapsayıcıya eklenecek sınıflar (genişlik, boşluk) */
  className?: string
}

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }

function normalize(s: string): string {
  return s.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, (c) => TR_MAP[c])
}

const filter = createFilterOptions<EmployeeOption>({
  stringify: (o) => normalize(`${o.full_name} ${o.roles?.name ?? ''}`),
})

export function EmployeeSelect<T extends EmployeeOption>({
  employees,
  value,
  onChange,
  label,
  emptyLabel,
  showRole = false,
  onOpen,
  size = 'small',
  fullWidth,
  disabled,
  className,
}: EmployeeSelectProps<T>) {
  const id = useId()
  const inputId = `${id}-input`
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = employees.find((e) => e.id === value) ?? null
  const [open, setOpen] = useState(false)
  // null = kullanıcı yazmıyor; giriş kutusu seçili çalışanı gösterir
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const filtered = useMemo(() => {
    const q = normalize(query ?? '').trim()
    if (!q) return employees
    return employees.filter((o) => normalize(`${o.full_name} ${o.role ?? ''}`).includes(q))
  }, [employees, query])

  const openList = () => {
    if (disabled || open) return
    setOpen(true)
    setActive(Math.max(0, filtered.findIndex((o) => o.id === value)))
    onOpen?.()
  }

  const closeList = () => {
    setOpen(false)
    setQuery(null)
  }

  const pick = (o: EmployeeOption) => {
    onChange(o.id)
    closeList()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { openList(); return }
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (filtered.length ? (i + delta + filtered.length) % filtered.length : 0))
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault()
        pick(filtered[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        // Diyalog içindeyken Escape önce listeyi kapatsın, diyaloğu değil
        e.preventDefault()
        e.stopPropagation()
        closeList()
      }
    }
  }

  const activeId = open && filtered[active] ? `${id}-opt-${filtered[active].id}` : undefined

  return (
    <Autocomplete<EmployeeOption, false, boolean>
      options={employees}
      value={selected}
      onChange={(_, opt) => onChange(opt?.id ?? '')}
      onOpen={onOpen}
      getOptionLabel={optionLabel}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(options, state) => filter(options, { ...state, inputValue: normalize(state.inputValue) })}
      disableClearable={!emptyLabel}
      noOptionsText="Çalışan bulunamadı"
      openText="Aç"
      closeText="Kapat"
      clearText="Temizle"
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      sx={sx}
      renderOption={({ key, ...props }, o) => (
        <Box component="li" key={key} {...props}>
          {showRole ? (
            <Box>
              <Typography variant="body2" fontWeight={600}>{optionLabel(o)}</Typography>
              {o.roles?.name && <Typography variant="caption" color="text.secondary">{o.roles.name}</Typography>}
            </Box>
          ) : (
            optionLabel(o)
          )}
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={emptyLabel ?? 'Ara…'}
          slotProps={{
            inputLabel: emptyLabel ? { ...params.InputLabelProps, shrink: true } : params.InputLabelProps,
          }}
        >
          <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-ink-secondary">Çalışan bulunamadı</li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.id}
                  id={`${id}-opt-${o.id}`}
                  role="option"
                  aria-selected={o.id === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={cn(
                    'cursor-pointer rounded-lg px-2.5 py-2 text-sm',
                    i === active && 'bg-muted',
                    o.id === value && 'font-semibold text-primary'
                  )}
                >
                  {showRole ? (
                    <div className="flex flex-col">
                      <span className="font-semibold text-ink">{optionLabel(o)}</span>
                      {o.role && <span className="text-xs text-ink-secondary">{o.role}</span>}
                    </div>
                  ) : (
                    optionLabel(o)
                  )}
                </li>
              ))
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}
