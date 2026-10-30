'use client'

/**
 * useAnnouncementUnread — okunmamış duyuru sayısı (menü rozeti).
 * Hafif uç noktadan SWR ile okunur; sekme görünürken 2 dakikada bir ve odaklanınca tazelenir
 * (her açık sekmenin yoklaması Worker CPU'su harcar — ücretsiz plan, 1102).
 * Giriş yapılmamışsa istek atılmaz.
 */
import useSWR from 'swr'
import { useAuth } from '@/context/AuthContext'
import { ANNOUNCEMENTS_UNREAD_KEY } from '@/lib/api/announcements'

export function useAnnouncementUnread(): number {
  const { status } = useAuth()
  const { data } = useSWR<{ unread_count: number }>(
    status === 'authenticated' ? ANNOUNCEMENTS_UNREAD_KEY : null,
    { refreshInterval: 120_000 },
  )
  return data?.unread_count ?? 0
}
