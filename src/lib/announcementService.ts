/**
 * announcementService — duyuru iş mantığı (yalnızca server).
 *
 * Yetki ve mağaza kuralları:
 *   - Yayın / yönetim: Yönetici ve üstü, yalnızca aktif mağazanın duyurusu; şirket geneli
 *     (store_id NULL) duyuruyu yalnızca Admin yönetir.
 *   - Okuma: yalnızca alıcı (announcement_recipients) ya da duyuruyu yönetebilen kişi.
 *   - Alıcılar yayın anında dondurulur; okundu/onay istatistiği sonradan değişmez.
 * Tüm sorgular service role ile çalışır; mağaza sınırı burada uygulanır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ACCESS, MANAGER_ROLES, accessLevelOf, roleAtLeast, type AccessLevel } from '@/lib/auth/roles'
import type { SessionEmployee } from '@/lib/auth/session'
import { createNotifications } from '@/lib/notificationRepository'
import { previewText } from '@/lib/announcementText'
import type {
  Announcement, AnnouncementRecipient, AnnouncementStats, AnnouncementTarget,
} from '@/types/announcement'

/** Kullanıcı başına günlük yayın sınırı */
export const CREATE_RATE_LIMIT = 20
export const CREATE_RATE_WINDOW_MS = 24 * 60 * 60 * 1000
/** Hatırlatma: aynı duyuru için en fazla 6 saatte bir */
export const REMIND_INTERVAL_MS = 6 * 60 * 60 * 1000

const PAGE_SIZE = 1000
/** Liste yanıtındaki en fazla duyuru sayısı */
const LIST_LIMIT = 60

export interface AnnouncementRow {
  id: string
  store_id: string | null
  title: string
  body: string
  pinned: boolean
  requires_ack: boolean
  target_roles: AnnouncementTarget
  expires_at: string | null
  created_by: string
  last_reminded_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export const ANNOUNCEMENT_COLUMNS =
  'id, store_id, title, body, pinned, requires_ack, target_roles, expires_at, created_by, last_reminded_at, deleted_at, created_at, updated_at'

type Actor = Pick<SessionEmployee, 'id' | 'access_level' | 'store_id'>

export function isManagerLevel(level: AccessLevel | null | undefined): boolean {
  return !!level && MANAGER_ROLES.includes(level)
}

/** Yayın hedefi: şirket geneli yalnızca Admin */
export function canPublish(actor: Actor, companyWide: boolean): boolean {
  if (!roleAtLeast(actor.access_level, ACCESS.MANAGER)) return false
  return !companyWide || actor.access_level === ACCESS.ADMIN
}

/** Mağaza kapsamı + rol kontrolü (hiyerarşi kontrolü route'ta forbidIfOutranked ile) */
export function canManage(actor: Actor, a: Pick<AnnouncementRow, 'store_id'>): boolean {
  if (!roleAtLeast(actor.access_level, ACCESS.MANAGER)) return false
  if (a.store_id === null) return actor.access_level === ACCESS.ADMIN
  return a.store_id === actor.store_id
}

/** Duyuru bu oturumun aktif mağazasında görünür mü (kendi mağazası ya da şirket geneli)? */
export function inScope(actor: Actor, a: Pick<AnnouncementRow, 'store_id'>): boolean {
  return a.store_id === null || a.store_id === actor.store_id
}

export function isExpired(a: Pick<AnnouncementRow, 'expires_at'>, now = Date.now()): boolean {
  return !!a.expires_at && new Date(a.expires_at).getTime() <= now
}

/**
 * Yayın anındaki alıcılar: hedef mağazanın (ya da tüm mağazaların) aktif, kiosk olmayan çalışanları;
 * hedef "yalnızca yöneticiler" ise yetki seviyesi Yönetici ve üstü olanlar. Yayıncı hariçtir.
 */
export async function resolveRecipients(
  admin: SupabaseClient,
  { storeId, targetRoles, excludeId }: { storeId: string | null; targetRoles: AnnouncementTarget; excludeId?: string },
): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = admin.from('employees').select('id, roles(access_level)').eq('active', true)
    if (storeId) q = q.eq('store_id', storeId)
    const { data, error } = await q.order('id').range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as { id: string; roles?: unknown }[]
    for (const e of page) {
      if (e.id === excludeId) continue
      const level = accessLevelOf(e.roles)
      if (level === ACCESS.KIOSK) continue
      if (targetRoles === 'managers' && !isManagerLevel(level)) continue
      ids.push(e.id)
    }
    if (page.length < PAGE_SIZE) return ids
  }
}

/** Alıcı anlık görüntüsünü tek insert ile yazar */
export async function insertRecipients(admin: SupabaseClient, announcementId: string, employeeIds: string[]) {
  if (employeeIds.length === 0) return
  const { error } = await admin
    .from('announcement_recipients')
    .insert(employeeIds.map((employee_id) => ({ announcement_id: announcementId, employee_id })))
  if (error) throw error
}

/** Alıcılara bildirim (tek toplu insert; push DB tetikleyicisiyle gider) */
export async function notifyRecipients(
  admin: SupabaseClient,
  a: Pick<AnnouncementRow, 'id' | 'title' | 'body'>,
  employeeIds: string[],
  { reminder = false, needsAck = false }: { reminder?: boolean; needsAck?: boolean } = {},
): Promise<number> {
  const message = reminder
    ? needsAck ? 'Duyuruyu okuyup onaylamanız bekleniyor.' : 'Duyuruyu okumanız bekleniyor.'
    : previewText(a.body)
  return createNotifications(
    admin,
    employeeIds.map((employee_id) => ({
      employee_id,
      type: 'announcement' as const,
      title: reminder ? `Hatırlatma: ${a.title}` : a.title,
      message,
      related_id: a.id,
    })),
  )
}

/** Duyuru (silinmemiş) — yoksa null */
export async function loadAnnouncement(admin: SupabaseClient, id: string): Promise<AnnouncementRow | null> {
  const { data, error } = await admin
    .from('announcements')
    .select(ANNOUNCEMENT_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return (data as AnnouncementRow | null) ?? null
}

interface RecipientRow { announcement_id: string; employee_id: string; read_at: string | null; ack_at: string | null }

/** Duyuruların alıcı satırları (PostgREST satır sınırı için sayfalanır) */
async function loadRecipientRows(admin: SupabaseClient, announcementIds: string[]): Promise<RecipientRow[]> {
  if (announcementIds.length === 0) return []
  const rows: RecipientRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from('announcement_recipients')
      .select('announcement_id, employee_id, read_at, ack_at')
      .in('announcement_id', announcementIds)
      .order('employee_id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as RecipientRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

export function statsFor(rows: Pick<RecipientRow, 'read_at' | 'ack_at'>[]): AnnouncementStats {
  return {
    recipients: rows.length,
    read: rows.filter((r) => r.read_at).length,
    acked: rows.filter((r) => r.ack_at).length,
  }
}

async function employeeNames(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const { data, error } = await admin.from('employees').select('id, full_name').in('id', unique)
  if (error) throw error
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((e) => [e.id, e.full_name]))
}

function toApi(
  a: AnnouncementRow,
  actor: Actor,
  mine: RecipientRow | undefined,
  authors: Map<string, string>,
  stats: AnnouncementStats | undefined,
): Announcement {
  const manage = canManage(actor, a)
  return {
    id: a.id,
    store_id: a.store_id,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    requires_ack: a.requires_ack,
    target_roles: a.target_roles,
    expires_at: a.expires_at,
    created_at: a.created_at,
    updated_at: a.updated_at,
    author_name: authors.get(a.created_by) ?? null,
    is_recipient: !!mine,
    read_at: mine?.read_at ?? null,
    ack_at: mine?.ack_at ?? null,
    can_manage: manage,
    ...(manage ? { stats, last_reminded_at: a.last_reminded_at } : {}),
  }
}

/**
 * Oturumdaki kişinin duyuru listesi (sabitlenenler önce, sonra yeniden eskiye).
 * archive=false → süresi dolmamışlar; archive=true → yalnızca süresi dolanlar.
 * Çalışan yalnızca alıcısı olduğu duyuruları görür; yönetici ek olarak yönettiği duyuruları.
 */
export async function listAnnouncements(
  admin: SupabaseClient,
  actor: Actor,
  { archive }: { archive: boolean },
): Promise<Announcement[]> {
  const { data, error } = await admin
    .from('announcements')
    .select(ANNOUNCEMENT_COLUMNS)
    .is('deleted_at', null)
    // Başka mağazaların duyuruları sonucu doldurmasın (JS'te inScope ile ayrıca doğrulanır)
    .or(`store_id.is.null,store_id.eq.${actor.store_id}`)
    .order('created_at', { ascending: false })
    .limit(150)
  if (error) throw error
  const now = Date.now()
  const candidates = ((data ?? []) as AnnouncementRow[]).filter(
    (a) => inScope(actor, a) && isExpired(a, now) === archive,
  )
  if (candidates.length === 0) return []

  const { data: mineData, error: mineErr } = await admin
    .from('announcement_recipients')
    .select('announcement_id, employee_id, read_at, ack_at')
    .eq('employee_id', actor.id)
    .in('announcement_id', candidates.map((a) => a.id))
  if (mineErr) throw mineErr
  const mine = new Map(((mineData ?? []) as RecipientRow[]).map((r) => [r.announcement_id, r]))

  const visible = candidates
    .filter((a) => mine.has(a.id) || canManage(actor, a))
    .sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.created_at.localeCompare(x.created_at))
    .slice(0, LIST_LIMIT)

  const manageIds = visible.filter((a) => canManage(actor, a)).map((a) => a.id)
  const statRows = await loadRecipientRows(admin, manageIds)
  const byAnn = new Map<string, RecipientRow[]>()
  for (const r of statRows) byAnn.set(r.announcement_id, [...(byAnn.get(r.announcement_id) ?? []), r])

  const authors = await employeeNames(admin, visible.map((a) => a.created_by))
  return visible.map((a) =>
    toApi(a, actor, mine.get(a.id), authors, canManage(actor, a) ? statsFor(byAnn.get(a.id) ?? []) : undefined),
  )
}

/** Tek duyuru (yönetici için istatistik ve alıcı listesi dahil); erişim yoksa null */
export async function getAnnouncementForActor(
  admin: SupabaseClient,
  actor: Actor,
  id: string,
): Promise<{ announcement: Announcement; recipients?: AnnouncementRecipient[] } | null> {
  const a = await loadAnnouncement(admin, id)
  if (!a || !inScope(actor, a)) return null
  const manage = canManage(actor, a)
  const rows = await loadRecipientRows(admin, [id])
  const mine = rows.find((r) => r.employee_id === actor.id)
  if (!mine && !manage) return null

  const names = await employeeNames(admin, [a.created_by, ...(manage ? rows.map((r) => r.employee_id) : [])])
  const announcement = toApi(a, actor, mine, names, manage ? statsFor(rows) : undefined)
  if (!manage) return { announcement }

  const recipients = rows
    .map((r) => ({
      employee_id: r.employee_id,
      full_name: names.get(r.employee_id) ?? '—',
      read_at: r.read_at,
      ack_at: r.ack_at,
    }))
    .sort((x, y) => x.full_name.localeCompare(y.full_name, 'tr'))
  return { announcement, recipients }
}

/** Okunmamış (süresi dolmamış, silinmemiş, aktif mağaza kapsamındaki) duyuru sayısı */
export async function countUnread(admin: SupabaseClient, actor: Actor): Promise<number> {
  const { data, error } = await admin
    .from('announcement_recipients')
    .select('announcement_id')
    .eq('employee_id', actor.id)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(150)
  if (error) throw error
  const ids = ((data ?? []) as { announcement_id: string }[]).map((r) => r.announcement_id)
  if (ids.length === 0) return 0
  const { data: anns, error: annErr } = await admin
    .from('announcements')
    .select('id, store_id, expires_at')
    .in('id', ids)
    .is('deleted_at', null)
  if (annErr) throw annErr
  const now = Date.now()
  return ((anns ?? []) as Pick<AnnouncementRow, 'store_id' | 'expires_at'>[]).filter(
    (a) => inScope(actor, a) && !isExpired(a, now),
  ).length
}

/** İlk çağrıda zamanı yazar, sonrakilerde dokunmaz (idempotent). Alıcı değilse null. */
export async function markReadOrAck(
  admin: SupabaseClient,
  announcementId: string,
  employeeId: string,
  kind: 'read' | 'ack',
): Promise<RecipientRow | null> {
  const { data: row, error } = await admin
    .from('announcement_recipients')
    .select('announcement_id, employee_id, read_at, ack_at')
    .eq('announcement_id', announcementId)
    .eq('employee_id', employeeId)
    .maybeSingle()
  if (error) throw error
  if (!row) return null
  const now = new Date().toISOString()
  const current = row as RecipientRow
  const patch: Partial<Pick<RecipientRow, 'read_at' | 'ack_at'>> = {}
  if (!current.read_at) patch.read_at = now
  if (kind === 'ack' && !current.ack_at) patch.ack_at = now
  if (Object.keys(patch).length === 0) return current
  // Koşullu güncelleme: eşzamanlı iki istek ilk zamanın üstüne yazmaz
  for (const [col, value] of Object.entries(patch)) {
    const { error: upErr } = await admin
      .from('announcement_recipients')
      .update({ [col]: value })
      .eq('announcement_id', announcementId)
      .eq('employee_id', employeeId)
      .is(col, null)
    if (upErr) throw upErr
  }
  return { ...current, ...patch }
}

/** Hatırlatma hedefleri: onay gerekiyorsa onaylamayanlar, değilse okumayanlar (hâlâ aktif olanlar) */
export async function pendingRecipientIds(
  admin: SupabaseClient,
  a: Pick<AnnouncementRow, 'id' | 'requires_ack'>,
): Promise<string[]> {
  const rows = await loadRecipientRows(admin, [a.id])
  const pending = rows.filter((r) => (a.requires_ack ? !r.ack_at : !r.read_at)).map((r) => r.employee_id)
  if (pending.length === 0) return []
  const { data, error } = await admin.from('employees').select('id').in('id', pending).eq('active', true)
  if (error) throw error
  return ((data ?? []) as { id: string }[]).map((e) => e.id)
}
