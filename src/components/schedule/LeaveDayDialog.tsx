'use client'

/**
 * LeaveDayDialog — plandaki izinli / haftalık tatil hücresine tıklanınca açılır.
 *
 * Haftalık tatil: seçenekler alt alta, açıklamalı satırlar (uzun metin taşmaz, mobilde de sığar):
 *   - Bu gün çalışsın → tatil kalır, vardiya "hafta tatilinde çalışma" olur
 *   - Tatili kaldır (tekrarlayan tatilde: yalnızca bu gün / bu ve sonraki haftalar)
 * Diğer izinler: izni silme onayı.
 *
 * İçerik kapanış animasyonu bitene kadar son açılan kayıtla çizilir (kapanırken başlık değişmesin).
 */
import { useState, type ReactNode } from 'react'
import { BriefcaseBusiness, CalendarMinus, CalendarX2, Info, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export type LeaveDeleteScope = 'single' | 'following'

export interface LeaveDayTarget {
  employeeName: string
  /** "4 Kasım Çarşamba" */
  dateLabel: string
  /** "her çarşamba" — tekrarlayan tatilde */
  everyLabel?: string
  kind: 'rest' | 'recurringRest' | 'leave'
  /** İzin türü adı (kind = leave) */
  leaveName?: string
}

interface Props {
  target: LeaveDayTarget | null
  /** Silme sürüyor: hangi kapsam */
  deleting: LeaveDeleteScope | null
  onClose: () => void
  onWork: () => void
  onDelete: (scope: LeaveDeleteScope) => void
}

function OptionRow({
  icon, title, description, onClick, disabled, busy, destructive,
}: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
  disabled: boolean
  busy?: boolean
  destructive?: boolean
}) {
  return (
    <Item variant="outline" size="sm" asChild className="bg-card hover:bg-accent/50">
      <button type="button" onClick={onClick} disabled={disabled} className="w-full text-left disabled:opacity-60">
        <ItemMedia variant="icon" className={cn(destructive && 'border-destructive/30 bg-destructive/10 text-destructive')}>
          {busy ? <Spinner /> : icon}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className={cn('whitespace-normal', destructive && 'text-destructive')}>{title}</ItemTitle>
          <ItemDescription className="line-clamp-none">{description}</ItemDescription>
        </ItemContent>
      </button>
    </Item>
  )
}

export function LeaveDayDialog({ target, deleting, onClose, onWork, onDelete }: Props) {
  // Kapanırken son içerik kalsın (React'in "önceki prop'a göre state" kalıbı)
  const [shown, setShown] = useState(target)
  if (target && target !== shown) setShown(target)
  const t = target ?? shown
  const busy = deleting !== null
  const isRest = t?.kind === 'rest' || t?.kind === 'recurringRest'

  return (
    <AlertDialog open={!!target} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRest ? 'Haftalık tatil günü' : `${t?.leaveName ?? 'İzin'} iptal edilsin mi?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t && (
              <>
                <span className="font-medium text-foreground">{t.employeeName}</span> ·{' '}
                <span className="font-medium text-foreground">{t.dateLabel}</span>
                {t.kind === 'recurringRest'
                  ? `. Tatil ${t.everyLabel ?? 'her hafta'} tekrarlanıyor.`
                  : isRest ? ' tatilde.' : '. Bu günü kapsayan onaylı izin silinir.'}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {t && isRest && (
          <div className="flex flex-col gap-2" role="group" aria-label="Tatil günü seçenekleri">
            <OptionRow
              icon={<BriefcaseBusiness />}
              title="Bu gün çalışsın"
              description="Tatil kalır; vardiya hafta tatilinde çalışma olarak ek ücretle puantaja yazılır."
              onClick={onWork}
              disabled={busy}
            />
            {t.kind === 'recurringRest' ? (
              <>
                <OptionRow
                  icon={<CalendarMinus />}
                  title="Yalnızca bu günün tatilini kaldır"
                  description="Sonraki haftaların tatili yerinde kalır."
                  onClick={() => onDelete('single')}
                  disabled={busy}
                  busy={deleting === 'single'}
                />
                <OptionRow
                  icon={<CalendarX2 />}
                  title="Bu ve sonraki haftaların tatilini kaldır"
                  description="Tekrarlayan tatil bu günden itibaren sona erer."
                  onClick={() => onDelete('following')}
                  disabled={busy}
                  busy={deleting === 'following'}
                  destructive
                />
              </>
            ) : (
              <OptionRow
                icon={<CalendarX2 />}
                title="Tatili kaldır"
                description="Gün boşalır; tatili başka bir güne verebilirsiniz."
                onClick={() => onDelete('single')}
                disabled={busy}
                busy={deleting === 'single'}
                destructive
              />
            )}
          </div>
        )}

        {t && !isRest && (
          <Alert tone="info">
            <Info />
            <AlertDescription>İzin tüm kapsamıyla (başlangıç–bitiş aralığı) silinir, yalnızca bu gün değil.</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          {t && !isRest && (
            <Button type="button" variant="destructive" onClick={() => onDelete('single')} disabled={busy}>
              {busy ? <Spinner /> : <Trash2 />}
              İzni sil
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
