/**
 * Client tarafı duyuru API'si — /api/announcements
 */
import { apiFetch } from './http'
import type { Announcement, AnnouncementInput, AnnouncementRecipient } from '@/types/announcement'

export const ANNOUNCEMENTS_KEY = '/api/announcements'
export const ANNOUNCEMENTS_UNREAD_KEY = '/api/announcements/unread-count'

export interface AnnouncementsResponse {
  announcements: Announcement[]
  /** Arşivde sonraki sayfanın imleci (before) */
  next_before?: string | null
  /** Arşivin sonraki sayfalarında yoktur */
  unread_count?: number
}

export interface AnnouncementDetailResponse {
  announcement: Announcement
  recipients?: AnnouncementRecipient[]
  /** PATCH: onayı sıfırlanan kişi sayısı */
  reack?: number
}

export const archiveMoreKey = (before: string) => `${ANNOUNCEMENTS_KEY}?archive=1&before=${encodeURIComponent(before)}`
export const announcementsKey = (archive: boolean) => (archive ? `${ANNOUNCEMENTS_KEY}?archive=1` : ANNOUNCEMENTS_KEY)
export const announcementKey = (id: string) => `${ANNOUNCEMENTS_KEY}/${encodeURIComponent(id)}`

export function createAnnouncement(input: AnnouncementInput) {
  return apiFetch<{ announcement: { id: string }; recipients: number; notified: number }>(ANNOUNCEMENTS_KEY, {
    method: 'POST',
    body: input,
  })
}

export function updateAnnouncement(
  id: string,
  patch: Partial<Pick<AnnouncementInput, 'title' | 'body' | 'pinned' | 'expires_at'>>,
) {
  return apiFetch<AnnouncementDetailResponse>(announcementKey(id), { method: 'PATCH', body: patch })
}

export function deleteAnnouncement(id: string) {
  return apiFetch<{ success: true }>(announcementKey(id), { method: 'DELETE' })
}

export function markAnnouncementRead(id: string) {
  return apiFetch<{ read_at: string | null; ack_at: string | null }>(`${announcementKey(id)}/read`, { method: 'POST' })
}

export function ackAnnouncement(id: string) {
  return apiFetch<{ read_at: string | null; ack_at: string | null }>(`${announcementKey(id)}/ack`, { method: 'POST' })
}

export function remindAnnouncement(id: string) {
  return apiFetch<{ reminded: number }>(`${announcementKey(id)}/remind`, { method: 'POST' })
}
