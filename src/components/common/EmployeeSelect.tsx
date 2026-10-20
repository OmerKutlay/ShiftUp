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
  /** Etiket yalnızca ekran okuyucular için (araç çubuğunda) */
  hideLabel?: boolean
}

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }

function normalize(s: string): string {
  return s.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, (c) => TR_MAP[c])
}

const optionLabel = (o: EmployeeOption) => `${o.full_name}${o.active === false ? ' (Pasif)' : ''}`

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
  hideLabel,
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
    return employees.filter((o) => normalize(`${o.full_name} ${o.roles?.name ?? ''}`).includes(q))
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
    <div className={cn('flex flex-col gap-1.5', fullWidth ? 'w-full' : 'w-full sm:w-auto', className)}>
      <Label htmlFor={inputId} className={hideLabel ? 'sr-only' : undefined}>{label}</Label>
      <Popover open={open} onOpenChange={(next) => { if (!next) closeList() }}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              'relative flex w-full items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow]',
              'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40',
              size === 'small' ? 'h-9' : 'h-10',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <input
              ref={inputRef}
              id={inputId}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              autoComplete="off"
              disabled={disabled}
              value={query ?? (selected ? optionLabel(selected) : '')}
              placeholder={emptyLabel ?? 'Ara…'}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
                if (!open) {
                  setOpen(true)
                  onOpen?.()
                }
              }}
              onClick={openList}
              onKeyDown={onKeyDown}
              className="h-full min-w-0 flex-1 bg-transparent pl-3 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
            />
            {emptyLabel && value && !disabled && (
              <button
                type="button"
                aria-label="Temizle"
                onClick={() => { onChange(''); closeList(); inputRef.current?.focus() }}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label={open ? 'Kapat' : 'Aç'}
              disabled={disabled}
              onClick={() => { if (open) { closeList() } else { openList(); inputRef.current?.focus() } }}
              className="mr-1 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
            </button>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-56 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // Giriş kutusunun kendisine tıklamak listeyi kapatmasın
            if (e.target instanceof Node && inputRef.current?.parentElement?.contains(e.target)) e.preventDefault()
          }}
        >
          <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">Çalışan bulunamadı</li>
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
                      <span className="font-semibold text-foreground">{optionLabel(o)}</span>
                      {o.roles?.name && <span className="text-xs text-muted-foreground">{o.roles.name}</span>}
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
