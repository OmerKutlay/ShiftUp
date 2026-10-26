'use client'

/**
 * useAnnouncementUnread — okunmamış duyuru sayısı (menü rozeti).
 * Hafif uç noktadan SWR ile okunur; sekme görünürken dakikada bir ve odaklanınca tazelenir.
 * Giriş yapılmamışsa istek atılmaz.
 */
import useSWR from 'swr'
import { useAuth } from '@/context/AuthContext'
import { ANNOUNCEMENTS_UNREAD_KEY } from '@/lib/api/announcements'

export function useAnnouncementUnread(): number {
  const { status } = useAuth()
  const { data } = useSWR<{ unread_count: number }>(
    status === 'authenticated' ? ANNOUNCEMENTS_UNREAD_KEY : null,
    { refreshInterval: 60_000 },
  )
  return data?.unread_count ?? 0
}
