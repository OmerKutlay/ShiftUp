'use client'

/**
 * BottomPromptCard — alt navigasyonun üstünde yüzen kompakt öneri kartı
 * (InstallPrompt, PushPrompt). role="dialog", başlık `titleId` ile bağlanır.
 *
 * Görünüm: shadcn Card dili (kenarlık, bg-card) + açılır katman gölgesi; solda ikon kutusu,
 * başlık + açıklama, sağ üstte kapat; altta sağa yaslı eylemler.
 */
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'
import { cn } from '@/lib/utils'

interface Props {
  titleId: string
  title: React.ReactNode
  /** Sol üstteki ikon / uygulama simgesi */
  media: React.ReactNode
  children?: React.ReactNode
  /** Sağ alttaki düğmeler */
  actions: React.ReactNode
  onClose: () => void
  closeDisabled?: boolean
  className?: string
}

export function BottomPromptCard({ titleId, title, media, children, actions, onClose, closeDisabled, className }: Props) {
  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className={cn(
        'print-hide fixed right-[calc(12px+env(safe-area-inset-right))] left-[calc(12px+env(safe-area-inset-left))] z-[1399] mx-auto max-w-md',
        'flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-lg',
        'animate-in fade-in-0 slide-in-from-bottom-4 duration-300',
        className
      )}
      // Mobil alt navigasyonun üstünde kalsın
      style={{ bottom: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + var(--safe-bottom))` }}
    >
      <div className="flex items-start gap-3">
        <div className="flex shrink-0">{media}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <p id={titleId} className="text-sm leading-snug font-medium">
            {title}
          </p>
          {children}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Kapat"
          onClick={onClose}
          disabled={closeDisabled}
          className="-mt-1 -mr-1 text-muted-foreground"
        >
          <X />
        </Button>
      </div>
      <div className="flex justify-end gap-2">{actions}</div>
    </div>
  )
}

/** Öneri kartının sol üstündeki ikon kutusu */
export function PromptIcon({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="flex size-10 items-center justify-center rounded-lg border bg-muted text-foreground [&_svg]:size-5">
      {children}
    </span>
  )
}
