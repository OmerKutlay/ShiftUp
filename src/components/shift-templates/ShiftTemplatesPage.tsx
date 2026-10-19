'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Info, PencilLine, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ShiftTemplate, CreateShiftTemplatePayload, UpdateShiftTemplatePayload } from '@/types/shiftTemplate'
import { formatTime } from '@/types/shiftTemplate'
import {
  fetchShiftTemplates,
  createShiftTemplate,
  updateShiftTemplate,
} from '@/lib/api/shiftTemplates'
import { ShiftTemplateFormDialog } from './ShiftTemplateFormDialog'
import { PageHeader, ListSkeleton, SectionCard, SectionRow, StatusBadge } from '@/components/common'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { useLoadedKey } from '@/hooks/useLoadedKey'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { cn } from '@/lib/utils'

export function ShiftTemplatesPage() {
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const { isFirstLoad, markLoaded } = useLoadedKey()
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ShiftTemplate | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await fetchShiftTemplates()
      setTemplates(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yükleme hatası.')
    } finally {
      markLoaded()
    }
  }, [markLoaded])

  useEffect(() => {
    void load() // eslint-disable-line react-hooks/set-state-in-effect
  }, [load])

  const openCreate = () => {
    setEditTarget(null)
    setDialogOpen(true)
  }

  const openEdit = (t: ShiftTemplate) => {
    setEditTarget(t)
    setDialogOpen(true)
  }

  const handleSave = async (payload: CreateShiftTemplatePayload | UpdateShiftTemplatePayload) => {
    setSaving(true)
    try {
      if (editTarget) {
        await updateShiftTemplate(editTarget.id, payload as UpdateShiftTemplatePayload)
      } else {
        await createShiftTemplate(payload as CreateShiftTemplatePayload)
      }
      setDialogOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const activeCount = templates.filter((t) => t.active).length

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Vardiya şablonları"
        subtitle={isFirstLoad ? <Skeleton className="h-4 w-24" /> : `${activeCount} aktif şablon`}
        actions={
          <Button onClick={openCreate}>
            <Plus /> Yeni Şablon
          </Button>
        }
      />

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={4} actions={2} />}

      {error && (
        <Alert tone="danger">
          <AlertCircle />
          <AlertDescription className="text-ink">{error}</AlertDescription>
        </Alert>
      )}

      {!isFirstLoad && !error && templates.length === 0 && (
        <Alert tone="info">
          <Info />
          <AlertDescription className="text-ink">Henüz vardiya şablonu eklenmemiş.</AlertDescription>
        </Alert>
      )}

      {!isFirstLoad && !error && templates.length > 0 && (
        <SectionCard title="Şablonlar" count={templates.length} subtitle="Haftalık planda vardiya atarken seçilir">
          {templates.map((t) => (
            <ShiftTemplateCard key={t.id} template={t} onEdit={openEdit} />
          ))}
        </SectionCard>
      )}

      <ShiftTemplateFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        template={editTarget}
        loading={saving}
      />
    </div>
  )
}

// ----------------------------------------------------------------
// Template Card
// ----------------------------------------------------------------
function ShiftTemplateCard({
  template,
  onEdit,
}: {
  template: ShiftTemplate
  onEdit: (t: ShiftTemplate) => void
}) {
  const start = formatTime(template.start_time)
  const end = formatTime(template.end_time)

  // Süre hesapla
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) mins += 24 * 60
  const durationLabel =
    mins % 60 === 0 ? `${Math.floor(mins / 60)} saat` : `${Math.floor(mins / 60)}s ${mins % 60}dk`

  const tone = SHIFT_KIND_TONES[shiftKindOf(template.name, start, end)]

  return (
    <SectionRow className={cn('flex-wrap sm:flex-nowrap', !template.active && 'opacity-60')}>
      <div className="min-w-[124px] shrink-0 rounded-[10px] px-2.5 py-1.5" style={{ backgroundColor: tone.soft, color: tone.text }}>
        <p className="text-[0.85rem] font-bold tabular-nums">{start} – {end}</p>
        <p className="text-[0.68rem] opacity-85">{durationLabel}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9rem] font-bold">{template.name}</p>
        {template.description && <p className="truncate text-xs text-ink-secondary">{template.description}</p>}
      </div>
      <StatusBadge tone={template.active ? 'success' : 'neutral'} label={template.active ? 'Aktif' : 'Pasif'} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(template)}
            aria-label={`${template.name} şablonunu düzenle`}
            className="text-ink-secondary hover:text-primary"
          >
            <PencilLine />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Düzenle</TooltipContent>
      </Tooltip>
    </SectionRow>
  )
}
