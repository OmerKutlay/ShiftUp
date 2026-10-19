'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Button,
  Stack,
  Paper,
  Chip,
  Skeleton,
  Alert,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material'
import ScheduleIcon from '@mui/icons-material/Schedule'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import type { ShiftTemplate, CreateShiftTemplatePayload, UpdateShiftTemplatePayload } from '@/types/shiftTemplate'
import { formatTime } from '@/types/shiftTemplate'
import {
  fetchShiftTemplates,
  createShiftTemplate,
  updateShiftTemplate,
} from '@/lib/api/shiftTemplates'
import { ShiftTemplateFormDialog } from './ShiftTemplateFormDialog'
import { PageHeader, ListSkeleton } from '@/components/common'
import { useLoadedKey } from '@/hooks/useLoadedKey'
import { C, tint } from '@/lib/palette'

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
    <Box sx={{ p: { xs: 2, md: 3 }, minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>
      <PageHeader
        icon={ScheduleIcon}
        overline="Vardiya"
        title="Vardiya Şablonları"
        subtitle={isFirstLoad ? <Skeleton width={100} /> : `${activeCount} aktif şablon`}
        actions={
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={openCreate}
            sx={{ fontWeight: 700 }}
          >
            Yeni Şablon
          </Button>
        }
      />

      <Divider sx={{ mb: 3, borderColor: tint(C.ink, 0.08) }} />

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={4} actions={2} />}

      {error && <Alert severity="error">{error}</Alert>}

      {!isFirstLoad && !error && templates.length === 0 && (
        <Alert severity="info">Henüz vardiya şablonu eklenmemiş.</Alert>
      )}

      {!isFirstLoad && !error && templates.length > 0 && (
        <Stack spacing={1.5}>
          {templates.map((t) => (
            <ShiftTemplateCard key={t.id} template={t} onEdit={openEdit} />
          ))}
        </Stack>
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

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, md: 2 },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        opacity: template.active ? 1 : 0.55,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr auto', md: '1fr auto auto' },
        alignItems: 'center',
        gap: 2,
        '&:hover': { borderColor: 'primary.dark' },
        transition: 'border-color 0.2s, opacity 0.2s',
      }}
    >
      {/* Left: name + times */}
      <Box>
        <Typography variant="subtitle2" fontWeight={700} color="text.primary">
          {template.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
            <AccessTimeIcon sx={{ fontSize: 13, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary">
              {start} – {end}
            </Typography>
          </Box>
          <Chip
            label={durationLabel}
            size="small"
            sx={{
              height: 18,
              fontSize: '0.65rem',
              fontWeight: 600,
              bgcolor: tint(C.brand, 0.1),
              color: 'primary.main',
              border: `1px solid ${tint(C.brand, 0.25)}`,
            }}
          />
          {template.description && (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {template.description}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Status chip (desktop) */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, justifyContent: 'flex-end' }}>
        <Chip
          label={template.active ? 'Aktif' : 'Pasif'}
          size="small"
          variant="outlined"
          sx={{
            height: 22,
            fontSize: '0.7rem',
            fontWeight: 600,
            bgcolor: template.active ? tint(C.success, 0.1) : tint(C.neutral, 0.1),
            color: template.active ? C.success : C.inkMuted,
            borderColor: template.active ? tint(C.success, 0.3) : tint(C.neutral, 0.3),
          }}
        />
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
          <Chip
            label={template.active ? 'Aktif' : 'Pasif'}
            size="small"
            variant="outlined"
            sx={{
              height: 22,
              fontSize: '0.7rem',
              fontWeight: 600,
              bgcolor: template.active ? tint(C.success, 0.1) : tint(C.neutral, 0.1),
              color: template.active ? C.success : C.inkMuted,
              borderColor: template.active ? tint(C.success, 0.3) : tint(C.neutral, 0.3),
            }}
          />
        </Box>
        <Tooltip title="Düzenle">
          <IconButton
            size="small"
            onClick={() => onEdit(template)}
            aria-label={`${template.name} şablonunu düzenle`}
            sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  )
}
