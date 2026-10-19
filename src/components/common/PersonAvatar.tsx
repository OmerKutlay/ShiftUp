'use client'

/**
 * PersonAvatar — baş harfli, kişiye göre sabit pastel renkli avatar (yeni UI).
 */
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { avatarTone } from '@/lib/palette'
import { cn } from '@/lib/utils'

/** "Mehmet Müdür" → "MM", "Zeynep Şahin" → "ZŞ" (Türkçe büyük harf) */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0][0], parts[parts.length - 1][0]] : [parts[0]?.[0] ?? '?']
  return letters.join('').toLocaleUpperCase('tr-TR')
}

export function PersonAvatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const tone = avatarTone(name)
  return (
    <Avatar aria-hidden className={cn('shrink-0', className)} style={{ width: size, height: size }}>
      <AvatarFallback style={{ backgroundColor: tone.bg, color: tone.fg, fontSize: size * 0.36 }}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
