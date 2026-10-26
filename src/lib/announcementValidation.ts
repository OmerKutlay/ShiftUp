/**
 * announcementValidation — duyuru girdisi doğrulama (saf, server).
 */
import {
  ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, normalizeBody, normalizeTitle,
} from '@/lib/announcementText'
import type { AnnouncementTarget } from '@/types/announcement'

export interface ParsedAnnouncement {
  title?: string
  body?: string
  pinned?: boolean
  requires_ack?: boolean
  target_roles?: AnnouncementTarget
  expires_at?: string | null
  all_stores?: boolean
}

type Result = { ok: true; value: ParsedAnnouncement } | { ok: false; error: string }

/**
 * Gövdeyi doğrular. create=true: başlık ve metin zorunlu. create=false (PATCH): yalnızca gelen alanlar;
 * hedef roller / onay zorunluluğu yayından sonra değişmez (alıcı anlık görüntüsü sabit).
 */
export function parseAnnouncementInput(
  raw: Record<string, unknown>,
  { create }: { create: boolean },
  now = Date.now(),
): Result {
  const out: ParsedAnnouncement = {}

  if (create || raw.title !== undefined) {
    if (typeof raw.title !== 'string') return { ok: false, error: 'Başlık gerekli.' }
    const title = normalizeTitle(raw.title)
    if (!title) return { ok: false, error: 'Başlık gerekli.' }
    if (title.length > ANNOUNCEMENT_TITLE_MAX) {
      return { ok: false, error: `Başlık en fazla ${ANNOUNCEMENT_TITLE_MAX} karakter olabilir.` }
    }
    out.title = title
  }
  if (create || raw.body !== undefined) {
    if (typeof raw.body !== 'string') return { ok: false, error: 'Duyuru metni gerekli.' }
    const body = normalizeBody(raw.body)
    if (!body) return { ok: false, error: 'Duyuru metni gerekli.' }
    if (body.length > ANNOUNCEMENT_BODY_MAX) {
      return { ok: false, error: `Metin en fazla ${ANNOUNCEMENT_BODY_MAX} karakter olabilir.` }
    }
    out.body = body
  }
  if (raw.pinned !== undefined) {
    if (typeof raw.pinned !== 'boolean') return { ok: false, error: 'Geçersiz sabitleme değeri.' }
    out.pinned = raw.pinned
  }
  if (raw.expires_at !== undefined) {
    if (raw.expires_at === null || raw.expires_at === '') out.expires_at = null
    else {
      if (typeof raw.expires_at !== 'string') return { ok: false, error: 'Geçersiz bitiş zamanı.' }
      const t = new Date(raw.expires_at).getTime()
      if (Number.isNaN(t)) return { ok: false, error: 'Geçersiz bitiş zamanı.' }
      if (t <= now) return { ok: false, error: 'Bitiş zamanı gelecekte olmalı.' }
      out.expires_at = new Date(t).toISOString()
    }
  }
  if (create) {
    if (raw.requires_ack !== undefined) {
      if (typeof raw.requires_ack !== 'boolean') return { ok: false, error: 'Geçersiz onay değeri.' }
      out.requires_ack = raw.requires_ack
    }
    if (raw.target_roles !== undefined) {
      if (raw.target_roles !== 'all' && raw.target_roles !== 'managers') return { ok: false, error: 'Geçersiz hedef.' }
      out.target_roles = raw.target_roles
    }
    if (raw.all_stores !== undefined) {
      if (typeof raw.all_stores !== 'boolean') return { ok: false, error: 'Geçersiz mağaza hedefi.' }
      out.all_stores = raw.all_stores
    }
  }
  return { ok: true, value: out }
}
