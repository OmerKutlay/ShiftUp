/**
 * offlineSnapshot — Çevrimdışı görüntüleme için son başarılı API yanıtlarının localStorage kopyası.
 *
 * Güvenlik kuralları:
 *   - Her anlık görüntü sahibinin çalışan id'siyle anahtarlanır (`shiftup:offline:<ad>:<id>`)
 *     ve kaydın içinde de ownerId tutulur; okurken ikisi birden eşleşmelidir.
 *   - Cihazda tek bir "sahip" vardır (`shiftup:offline:owner`). Başka bir çalışan için kayıt
 *     yazılırsa önceki sahibin tüm anlık görüntüleri silinir — aynı cihazda başka bir kullanıcının
 *     verisi asla gösterilmez.
 *   - Çıkışta (onBeforeSignOut) ve oturum çevrimiçiyken düştüğünde tümü silinir (OfflineSessionGuard).
 *   - Yalnızca salt-okunur görüntüleme içindir; hiçbir işlem (devam kaydı vb.) buradan yapılmaz.
 *
 * Tüm depolama erişimi try/catch içindedir: gizli sekme, kota dolu veya engellenmiş depolamada
 * sessizce no-op olur.
 */
import { formatDateTurkish, formatInTimeZone } from '@/lib/dateUtils'

export const SNAPSHOT_PREFIX = 'shiftup:offline:'
const OWNER_KEY = `${SNAPSHOT_PREFIX}owner`
/** Kayıt biçimi değişirse artırılır; eski sürümdeki kayıtlar yok sayılır */
export const SNAPSHOT_VERSION = 1
/** Bundan eski anlık görüntüler gösterilmez (~14 gün) */
export const SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
/** Tek bir anlık görüntünün serileştirilmiş azami boyutu (karakter) */
export const SNAPSHOT_MAX_CHARS = 256 * 1024

interface StoredSnapshot<T> {
  v: number
  ownerId: string
  savedAt: string
  data: T
}

export interface Snapshot<T> {
  savedAt: string
  data: T
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function snapshotKey(name: string, ownerId: string): string {
  return `${SNAPSHOT_PREFIX}${name}:${ownerId}`
}

/** Cihazdaki anlık görüntülerin sahibi (son oturum açan çalışan) */
export function getSnapshotOwner(): string | null {
  try {
    return storage()?.getItem(OWNER_KEY) ?? null
  } catch {
    return null
  }
}

/**
 * Oturum açan çalışanı sahip olarak işaretler; sahip değiştiyse öncekinin tüm anlık
 * görüntülerini siler.
 */
export function claimSnapshotOwner(ownerId: string): void {
  const store = storage()
  if (!store || !ownerId) return
  try {
    const current = store.getItem(OWNER_KEY)
    if (current === ownerId) return
    clearAllSnapshots()
    store.setItem(OWNER_KEY, ownerId)
  } catch {
    // depolama kullanılamıyor — yok say
  }
}

/** Son başarılı yanıtı kaydeder. Boyut sınırını aşan veri kaydedilmez (false döner). */
export function setSnapshot<T>(name: string, ownerId: string, data: T, now: Date = new Date()): boolean {
  const store = storage()
  if (!store || !ownerId) return false
  try {
    claimSnapshotOwner(ownerId)
    const record: StoredSnapshot<T> = { v: SNAPSHOT_VERSION, ownerId, savedAt: now.toISOString(), data }
    const json = JSON.stringify(record)
    if (json.length > SNAPSHOT_MAX_CHARS) return false
    store.setItem(snapshotKey(name, ownerId), json)
    return true
  } catch {
    return false
  }
}

/** Geçerli (aynı sahip, güncel sürüm, süresi dolmamış) anlık görüntüyü döner; yoksa null. */
export function getSnapshot<T>(name: string, ownerId: string | null | undefined, now: Date = new Date()): Snapshot<T> | null {
  const store = storage()
  if (!store || !ownerId) return null
  try {
    if (store.getItem(OWNER_KEY) !== ownerId) return null
    const raw = store.getItem(snapshotKey(name, ownerId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot<T>> | null
    if (!parsed || parsed.v !== SNAPSHOT_VERSION || parsed.ownerId !== ownerId || typeof parsed.savedAt !== 'string') {
      return null
    }
    const savedMs = Date.parse(parsed.savedAt)
    if (!Number.isFinite(savedMs) || now.getTime() - savedMs > SNAPSHOT_MAX_AGE_MS) return null
    return { savedAt: parsed.savedAt, data: parsed.data as T }
  } catch {
    return null
  }
}

/** Tüm çevrimdışı anlık görüntüleri (ve sahip işaretini) siler */
export function clearAllSnapshots(): void {
  const store = storage()
  if (!store) return
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key?.startsWith(SNAPSHOT_PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch {
    // depolama kullanılamıyor — yok say
  }
}

/** "16 Ekim 2026 14:05" — Türkiye saatine göre */
export function formatSnapshotTime(savedAt: string): string {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return '—'
  return `${formatDateTurkish(date)} ${formatInTimeZone(savedAt)}`
}
