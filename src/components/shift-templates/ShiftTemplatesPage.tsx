'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Button,
  Skeleton,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
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
    <Box sx={{ p: { xs: 2, md: 3 }, color: 'text.primary' }}>
      <PageHeader
        title="Vardiya şablonları"
        subtitle={isFirstLoad ? <Skeleton width={100} /> : `${activeCount} aktif şablon`}
        actions={
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={openCreate}
          >
            Yeni Şablon
          </Button>
        }
      />

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={4} actions={2} />}

      {error && <Alert severity="error">{error}</Alert>}

      {!isFirstLoad && !error && templates.length === 0 && (
        <Alert severity="info">Henüz vardiya şablonu eklenmemiş.</Alert>
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
    </Box>
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
    <SectionRow sx={{ opacity: template.active ? 1 : 0.6, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
      <Box sx={{ bgcolor: tone.soft, color: tone.text, borderRadius: '10px', px: 1.25, py: 0.75, minWidth: 124, flexShrink: 0 }}>
        <Typography fontSize="0.85rem" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {start} – {end}
        </Typography>
        <Typography fontSize="0.68rem" sx={{ opacity: 0.85 }}>{durationLabel}</Typography>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontSize="0.9rem" fontWeight={700}>{template.name}</Typography>
        {template.description && (
          <Typography fontSize="0.75rem" color="text.secondary" noWrap>{template.description}</Typography>
        )}
      </Box>
      <StatusBadge tone={template.active ? 'success' : 'neutral'} label={template.active ? 'Aktif' : 'Pasif'} />
      <Tooltip title="Düzenle">
        <IconButton
          size="small"
          onClick={() => onEdit(template)}
          aria-label={`${template.name} şablonunu düzenle`}
          sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
        >
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </SectionRow>
  )
}
