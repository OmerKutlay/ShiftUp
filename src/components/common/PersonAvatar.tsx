'use client'

/**
 * PersonAvatar — baş harfli, kişiye göre sabit pastel renkli avatar (yeni UI).
 */
import { Avatar, type SxProps, type Theme } from '@mui/material'
import { avatarTone } from '@/lib/palette'

/** "Mehmet Müdür" → "MM", "Zeynep Şahin" → "ZŞ" (Türkçe büyük harf) */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0][0], parts[parts.length - 1][0]] : [parts[0]?.[0] ?? '?']
  return letters.join('').toLocaleUpperCase('tr-TR')
}

export function PersonAvatar({ name, size = 32, sx }: { name: string; size?: number; sx?: SxProps<Theme> }) {
  const tone = avatarTone(name)
  return (
    <Avatar
      aria-hidden
      sx={[
        { width: size, height: size, bgcolor: tone.bg, color: tone.fg, fontSize: size * 0.36, fontWeight: 700 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {initials(name)}
    </Avatar>
  )
}
