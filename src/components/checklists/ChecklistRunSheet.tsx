'use client'

/**
 * ChecklistRunSheet — bir listenin maddeleri. shadcn Dialog: masaüstünde ortalı, telefonda alttan
 * açılan sayfa (DESIGN_GUIDE §5 "Diyaloglar"). Maddeler Field seçim kartı; işaretleme iyimser
 * güncellenir (üst bileşen). Not alanı odak kaybında kaydedilir.
 */
import { useState } from 'react'
import { CircleCheck, Lock } from 'lucide-react'
import { toast } from 'sonner'

import type { ChecklistRun } from '@/types/checklist'
import { setChecklistRunNote } from '@/lib/api/checklists'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
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
    <Dialog open={!!run} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
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
      </DialogContent>
    </Dialog>
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
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
          {run.name}
          <Badge variant="secondary" className="tabular-nums">{done}/{total}</Badge>
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {run.due_time ? <span className="tabular-nums">Son saat {run.due_time}</span> : <span>Son saat yok</span>}
          {run.completed_at && (
            <Badge tone="success">
              Tamamlandı {clock(run.completed_at)}{run.completed_by_name ? ` · ${run.completed_by_name}` : ''}
            </Badge>
          )}
          {run.overdue && <Badge tone="danger">Gecikti</Badge>}
        </DialogDescription>
      </DialogHeader>

      {!canTick && (
        <Alert>
          <Lock />
          <AlertDescription>Bugün bu mağazada vardiyanız olmadığı için işaretleyemezsiniz.</AlertDescription>
        </Alert>
      )}

      <FieldGroup className="gap-2">
        {run.items.map((item) => {
          const checked = !!item.done_at
          // Geri alma: işareti koyan ya da yönetici; başkasının işareti kilitli
          const locked = !canTick || (checked && !isManager && item.done_by !== currentEmployeeId)
          const id = `item-${item.id}`
          return (
            <FieldLabel
              key={item.id}
              htmlFor={id}
              className={cn(
                // Seçim kartı: işaretli madde marka değil durum rengiyle (tamamlandı = success)
                'has-data-[state=checked]:border-success/30 has-data-[state=checked]:bg-success/5 dark:has-data-[state=checked]:bg-success/10',
                locked ? 'cursor-default' : 'cursor-pointer'
              )}
            >
              <Field orientation="horizontal">
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={locked}
                  onCheckedChange={(v) => onToggle(run.id, item.id, v === true)}
                  className="size-5"
                />
                <FieldContent>
                  <FieldTitle className={cn('text-base leading-snug break-words', checked && 'text-muted-foreground line-through')}>
                    {item.text}
                    {item.required && <span className="text-destructive" title="Zorunlu" aria-label="zorunlu">*</span>}
                  </FieldTitle>
                  {checked && (
                    <FieldDescription className="flex items-center gap-1 text-xs tabular-nums">
                      <CircleCheck className="size-3" aria-hidden />
                      {clock(item.done_at)}{item.done_by_name ? ` · ${item.done_by_name}` : ''}
                    </FieldDescription>
                  )}
                </FieldContent>
              </Field>
            </FieldLabel>
          )
        })}
      </FieldGroup>

      <Field>
        <FieldLabel htmlFor={`note-${run.id}`}>
          Not <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
        </FieldLabel>
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
      </Field>
    </>
  )
}
