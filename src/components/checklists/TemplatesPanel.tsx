'use client'

/**
 * TemplatesPanel — "Şablonlar" sekmesi (Müdür Yardımcısı+): listeleri oluştur, düzenle, (de)aktive et.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { ListChecks, Plus, SquarePen, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import type { ChecklistTemplate, ChecklistTemplateInput } from '@/types/checklist'
import { CHECKLIST_KIND_LABELS } from '@/types/checklist'
import {
  CHECKLISTS_TEMPLATES_KEY, CHECKLISTS_TODAY_KEY, createChecklistTemplate, fetchChecklistTemplates, updateChecklistTemplate,
} from '@/lib/api/checklists'
import { useSWRConfig } from 'swr'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ChecklistTemplateDialog } from './ChecklistTemplateDialog'
import { weekdaysLabel } from './format'

export function TemplatesPanel() {
  const { mutate: globalMutate } = useSWRConfig()
  const { data, error, mutate } = useSWR(CHECKLISTS_TEMPLATES_KEY, fetchChecklistTemplates)
  const [dialog, setDialog] = useState<{ template: ChecklistTemplate | null; n: number } | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(input: ChecklistTemplateInput) {
    setSaving(true)
    try {
      if (dialog?.template) await updateChecklistTemplate(dialog.template.id, input)
      else await createChecklistTemplate(input)
      toast.success(dialog?.template ? 'Liste güncellendi.' : 'Liste eklendi.')
      setDialog(null)
      await mutate()
      void globalMutate(CHECKLISTS_TODAY_KEY)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(t: ChecklistTemplate, active: boolean) {
    try {
      await mutate(async (cur) => {
        const updated = await updateChecklistTemplate(t.id, { active })
        return (cur ?? []).map((x) => (x.id === t.id ? updated : x))
      }, { optimisticData: (data ?? []).map((x) => (x.id === t.id ? { ...x, active } : x)), rollbackOnError: true, revalidate: false })
      void globalMutate(CHECKLISTS_TODAY_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Güncellenemedi.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialog({ template: null, n: Date.now() })}><Plus /> Yeni liste</Button>
      </div>

      {error && !data && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Şablonlar yüklenemedi</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : 'Bir hata oluştu.'}</AlertDescription>
        </Alert>
      )}

      {!data && !error && <Skeleton className="h-28 rounded-xl" />}

      {data && data.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ListChecks /></EmptyMedia>
            <EmptyTitle>Henüz kontrol listesi yok</EmptyTitle>
            <EmptyDescription>Açılış ve kapanış listeleri ile başlayabilirsiniz.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {data && data.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{t.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {CHECKLIST_KIND_LABELS[t.kind]} · {weekdaysLabel(t.weekdays)}
                    {t.due_time && <span className="tabular-nums"> · Son saat {t.due_time}</span>}
                  </p>
                </div>
                <Switch checked={t.active} onCheckedChange={(v) => void toggleActive(t, v)} aria-label={`${t.name} aktif`} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">{t.items.length} madde</Badge>
                <Button variant="outline" size="sm" onClick={() => setDialog({ template: t, n: Date.now() })}>
                  <SquarePen /> Düzenle
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <ChecklistTemplateDialog
          key={dialog.n}
          open
          template={dialog.template}
          loading={saving}
          onClose={() => setDialog(null)}
          onSave={save}
        />
      )}
    </div>
  )
}
