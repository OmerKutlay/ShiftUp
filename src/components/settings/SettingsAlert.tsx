'use client'

/**
 * SettingsAlert — Ayarlar panellerindeki hata / başarı / bilgi mesajı (isteğe bağlı kapatma düğmesi).
 */
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

const ICONS = { danger: AlertCircle, success: CheckCircle2, info: Info } as const

export function SettingsAlert({ tone, children, onClose, className }: {
  tone: keyof typeof ICONS
  children: React.ReactNode
  onClose?: () => void
  className?: string
}) {
  const Icon = ICONS[tone]
  return (
    <Alert tone={tone} className={cn(onClose && 'pr-11', className)}>
      <Icon />
      <AlertDescription className="text-ink">{children}</AlertDescription>
      {onClose && (
        <button
          type="button"
          aria-label="Kapat"
          onClick={onClose}
          className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-lg text-ink-secondary outline-none hover:bg-black/5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-4" />
        </button>
      )}
    </Alert>
  )
}
