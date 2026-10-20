'use client'

/**
 * ThemeSwitch — üst çubukta açık ↔ koyu tema anahtarı.
 * ThemeSelect — "Sistem / Açık / Koyu" seçici; "Sistem" cihaz ayarını izlemeye döner.
 */
import { Monitor, Moon, Sun } from 'lucide-react'

import { Switch } from '@/components/ui/switch'
import { SegmentedControl } from '@/components/common/SegmentedControl'
import { useTheme } from '@/hooks/useTheme'
import type { ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'

export function ThemeSwitch({ className }: { className?: string }) {
  const { resolvedTheme, setPreference } = useTheme()
  const dark = resolvedTheme === 'dark'

  return (
    <label
      className={cn(
        'flex shrink-0 cursor-pointer items-center gap-1.5 px-1 text-muted-foreground',
        className
      )}
    >
      <Sun aria-hidden className={cn('size-4', !dark && 'text-foreground')} />
      <Switch
        checked={dark}
        onCheckedChange={(c) => setPreference(c ? 'dark' : 'light')}
        aria-label="Koyu tema"
      />
      <Moon aria-hidden className={cn('size-4', dark && 'text-foreground')} />
    </label>
  )
}

export const THEME_OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'Sistem', icon: <Monitor /> },
  { value: 'light', label: 'Açık', icon: <Sun /> },
  { value: 'dark', label: 'Koyu', icon: <Moon /> },
]

export function ThemeSelect({ fullWidth }: { fullWidth?: boolean }) {
  const { preference, setPreference } = useTheme()

  return (
    <SegmentedControl
      aria-label="Tema"
      value={preference}
      onChange={setPreference}
      fullWidth={fullWidth}
      options={THEME_OPTIONS.map((o) => ({
        value: o.value,
        label: (
          <>
            {o.icon}
            {o.label}
          </>
        ),
      }))}
    />
  )
}
