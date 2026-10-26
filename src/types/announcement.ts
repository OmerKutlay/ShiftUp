/**
 * Duyuru tipleri — /api/announcements
 */

export type AnnouncementTarget = 'all' | 'managers'

/** Yönetici görünümünde okundu / onay istatistiği */
export interface AnnouncementStats {
  recipients: number
  read: number
  acked: number
}

export interface Announcement {
  id: string
  /** null = tüm mağazalar (şirket geneli duyuru) */
  store_id: string | null
  title: string
  body: string
  pinned: boolean
  requires_ack: boolean
  target_roles: AnnouncementTarget
  expires_at: string | null
  created_at: string
  updated_at: string
  /** Son içerik düzenlemesi (null = hiç düzenlenmedi) */
  edited_at: string | null
  author_name: string | null
  /** Oturumdaki çalışan alıcı mı (yönetici alıcı olmadan da duyuruyu yönetebilir) */
  is_recipient: boolean
  read_at: string | null
  ack_at: string | null
  /** Düzenleme / silme / hatırlatma yetkisi */
  can_manage: boolean
  /** Yalnızca can_manage için */
  stats?: AnnouncementStats
  last_reminded_at?: string | null
}

/** Detayda yönetici için alıcı listesi — yalnızca ad ve durum */
export interface AnnouncementRecipient {
  employee_id: string
  full_name: string
  read_at: string | null
  ack_at: string | null
}

export interface AnnouncementInput {
  title: string
  body: string
  pinned?: boolean
  requires_ack?: boolean
  expires_at?: string | null
  target_roles?: AnnouncementTarget
  /** Yalnızca Admin: tüm mağazalara yayınla */
  all_stores?: boolean
}
