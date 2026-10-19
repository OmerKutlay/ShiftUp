'use client'

// Aramalı çalışan seçici — çalışan sayısı arttıkça uzun listeyi kaydırmak yerine
// isimle (Türkçe karakterden bağımsız: "omer" → "Ömer") filtrelemeye izin verir.

import { Autocomplete, Box, TextField, Typography, createFilterOptions } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

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
  sx?: SxProps<Theme>
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
  sx,
}: EmployeeSelectProps<T>) {
  const selected = employees.find((e) => e.id === value) ?? null
  const optionLabel = (o: EmployeeOption) => `${o.full_name}${o.active === false ? ' (Pasif)' : ''}`

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
        />
      )}
    />
  )
}
