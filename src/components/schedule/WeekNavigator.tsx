'use client'

import { Box, Typography, IconButton, Button, Tooltip } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import TodayIcon from '@mui/icons-material/Today'
import { format, addWeeks, subWeeks, isSameWeek } from 'date-fns'
import { tr } from 'date-fns/locale'

interface Props {
  currentWeek: Date
  onChange: (newWeek: Date) => void
}

export function WeekNavigator({ currentWeek, onChange }: Props) {
  const isThisWeek = isSameWeek(currentWeek, new Date(), { weekStartsOn: 1 })

  // Haftanın Pazartesi–Pazar etiketini oluştur
  const start = new Date(currentWeek)
  const day = start.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  start.setDate(start.getDate() + diff)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)

  const rangeLabel = `${format(start, 'd MMM', { locale: tr })} – ${format(end, 'd MMM yyyy', { locale: tr })}`

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
      }}
    >
      <IconButton
        size="small"
        onClick={() => onChange(subWeeks(currentWeek, 1))}
        sx={{ color: 'text.secondary' }}
        aria-label="Önceki hafta"
      >
        <ChevronLeftIcon />
      </IconButton>

      <Typography
        variant="subtitle2"
        fontWeight={700}
        sx={{ minWidth: 180, textAlign: 'center' }}
      >
        {rangeLabel}
      </Typography>

      <IconButton
        size="small"
        onClick={() => onChange(addWeeks(currentWeek, 1))}
        sx={{ color: 'text.secondary' }}
        aria-label="Sonraki hafta"
      >
        <ChevronRightIcon />
      </IconButton>

      {!isThisWeek && (
        <Tooltip title="Bu haftaya dön">
          <Button
            size="small"
            startIcon={<TodayIcon />}
            onClick={() => onChange(new Date())}
            sx={{ fontSize: '0.75rem', fontWeight: 600, ml: 1 }}
            color="primary"
            variant="outlined"
          >
            Bu Hafta
          </Button>
        </Tooltip>
      )}
    </Box>
  )
}
