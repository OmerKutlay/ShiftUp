'use client'

/**
 * ChecklistRunSheet — bir listenin maddeleri (alttan açılan sayfa). Büyük dokunma alanlı
 * satırlar; işaretleme iyimser güncellenir (üst bileşen). Not alanı odak kaybında kaydedilir.
 */
import { useState } from 'react'
import { CircleCheck, Lock } from 'lucide-react'
import { toast } from 'sonner'

import type { ChecklistRun } from '@/types/checklist'
import { setChecklistRunNote } from '@/lib/api/checklists'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { clock, progress } from './format'

interface Props {
  run: ChecklistRun | null
  onClose: () => void
  canTick: boolean
  isManager: boolean
  currentEmployeeId: string
  onToggle: (runId: string, itemId: string, done: boolean) => void
}

export function ChecklistRunSheet({ run, onClose, canTick, isManager, currentEmployeeId, onToggle }: Props) {
  return (
    <Sheet open={!!run} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="bottom" className="max-h-[90dvh] rounded-t-2xl sm:mx-auto sm:max-w-lg">
        {run && (
          <RunBody
            key={run.id}
            run={run}
            canTick={canTick}
            isManager={isManager}
            currentEmployeeId={currentEmployeeId}
            onToggle={onToggle}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function RunBody({ run, canTick, isManager, currentEmployeeId, onToggle }: Omit<Props, 'run' | 'onClose'> & { run: ChecklistRun }) {
  const { done, total } = progress(run)
  const [note, setNote] = useState(run.note ?? '')

  async function saveNote() {
    const next = note.trim()
    if (next === (run.note ?? '')) return
    try {
      await setChecklistRunNote(run.id, next || null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Not kaydedilemedi.')
    }
  }

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {run.name}
          <span className="text-sm font-normal text-muted-foreground tabular-nums">{done}/{total}</span>
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {run.due_time && <span className="tabular-nums">Son saat {run.due_time}</span>}
          {run.completed_at && (
            <Badge tone="success">
              Tamamlandı {clock(run.completed_at)}{run.completed_by_name ? ` · ${run.completed_by_name}` : ''}
            </Badge>
          )}
          {run.overdue && <Badge tone="danger">Gecikti</Badge>}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {!canTick && (
          <p className="mb-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" aria-hidden />
            Bugün bu mağazada vardiyanız olmadığı için işaretleyemezsiniz.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {run.items.map((item) => {
            const checked = !!item.done_at
            // Geri alma: işareti koyan ya da yönetici; başkasının işareti kilitli
            const locked = !canTick || (checked && !isManager && item.done_by !== currentEmployeeId)
            return (
              <li key={item.id}>
                <label
                  className={cn(
                    'flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                    checked ? 'bg-success/5 border-success/30' : 'bg-card',
                    locked && 'cursor-default opacity-80'
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={locked}
                    onCheckedChange={(v) => onToggle(run.id, item.id, v === true)}
                    className="mt-0.5 size-6 rounded-md"
                    aria-label={item.text}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-base leading-snug break-words', checked && 'text-muted-foreground line-through')}>
                      {item.text}
                      {item.required && <span className="ml-1 text-destructive" title="Zorunlu" aria-label="zorunlu">*</span>}
                    </span>
                    {checked && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                        <CircleCheck className="size-3" aria-hidden />
                        {clock(item.done_at)}{item.done_by_name ? ` · ${item.done_by_name}` : ''}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        <div className="mt-4">
          <label htmlFor={`note-${run.id}`} className="mb-1.5 block text-sm font-medium">
            Not <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
          </label>
          <Textarea
            id={`note-${run.id}`}
            rows={2}
            maxLength={500}
            value={note}
            disabled={!canTick}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void saveNote()}
            placeholder="Örn: Kasa fişi bitti, yenisi istendi"
          />
        </div>
      </div>
    </>
  )
}
