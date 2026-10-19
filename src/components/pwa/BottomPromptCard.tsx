'use client'

/**
 * BottomPromptCard — alt navigasyonun üstünde yüzen kompakt öneri kartı
 * (InstallPrompt, PushPrompt). role="dialog", başlık `titleId` ile bağlanır.
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
  /** Sağ alttaki butonlar */
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
        'fixed right-[calc(12px+env(safe-area-inset-right))] left-[calc(12px+env(safe-area-inset-left))] z-[1399] mx-auto',
        'rounded-2xl border bg-card p-4 text-ink shadow-[0_8px_24px_rgb(43_33_27/0.12)]',
        'animate-in fade-in-0 slide-in-from-bottom-4 duration-300',
        className
      )}
      // Mobil alt navigasyonun üstünde kalsın
      style={{ bottom: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + env(safe-area-inset-bottom))` }}
    >
      <div className="flex items-start gap-3">
        <div className="flex shrink-0">{media}</div>
        <div className="min-w-0 flex-1">
          <p id={titleId} className="text-sm font-bold">
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
          className="-mt-1.5 -mr-1.5 text-ink-secondary"
        >
          <X />
        </Button>
      </div>
      <div className="mt-3 flex justify-end gap-2">{actions}</div>
    </div>
  )
}
