import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getSnapshot, setSnapshot, clearAllSnapshots, claimSnapshotOwner, getSnapshotOwner,
  snapshotKey, formatSnapshotTime, SNAPSHOT_MAX_AGE_MS, SNAPSHOT_MAX_CHARS, SNAPSHOT_VERSION,
} from '@/lib/pwa/offlineSnapshot'

describe('offlineSnapshot', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('kaydeder ve aynı sahip için geri okur (savedAt + sürüm ile)', () => {
    const now = new Date('2026-10-16T09:00:00Z')
    expect(setSnapshot('my-schedule', 'emp-1', { a: 1 }, now)).toBe(true)
    const raw = JSON.parse(localStorage.getItem('shiftup:offline:my-schedule:emp-1')!)
    expect(raw).toMatchObject({ v: SNAPSHOT_VERSION, ownerId: 'emp-1', savedAt: now.toISOString() })
    expect(getSnapshot('my-schedule', 'emp-1', now)).toEqual({ savedAt: now.toISOString(), data: { a: 1 } })
    expect(getSnapshotOwner()).toBe('emp-1')
  })

  it('anahtar çalışan id ile ad alanlıdır; başka çalışanın verisi okunamaz', () => {
    setSnapshot('my-schedule', 'emp-1', { a: 1 })
    expect(snapshotKey('my-schedule', 'emp-1')).toBe('shiftup:offline:my-schedule:emp-1')
    expect(getSnapshot('my-schedule', 'emp-2')).toBeNull()
    expect(getSnapshot('my-schedule', null)).toBeNull()
  })

  it('başka çalışan için yazılınca öncekinin tüm anlık görüntüleri silinir', () => {
    setSnapshot('my-schedule', 'emp-1', { a: 1 })
    setSnapshot('other', 'emp-1', { b: 2 })
    setSnapshot('my-schedule', 'emp-2', { c: 3 })
    expect(localStorage.getItem('shiftup:offline:my-schedule:emp-1')).toBeNull()
    expect(localStorage.getItem('shiftup:offline:other:emp-1')).toBeNull()
    expect(getSnapshot('my-schedule', 'emp-2')?.data).toEqual({ c: 3 })
  })

  it('sahip işareti eşleşmezse (elle kopyalanmış kayıt) gösterilmez', () => {
    setSnapshot('my-schedule', 'emp-1', { a: 1 })
    claimSnapshotOwner('emp-2')
    // Saldırganın emp-1 kaydını geri yazması: sahip emp-2 olduğu için yok sayılır
    localStorage.setItem('shiftup:offline:my-schedule:emp-1', JSON.stringify({
      v: SNAPSHOT_VERSION, ownerId: 'emp-1', savedAt: new Date().toISOString(), data: { a: 1 },
    }))
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
  })

  it('içteki ownerId anahtardan farklıysa yok sayılır', () => {
    claimSnapshotOwner('emp-1')
    localStorage.setItem('shiftup:offline:my-schedule:emp-1', JSON.stringify({
      v: SNAPSHOT_VERSION, ownerId: 'emp-9', savedAt: new Date().toISOString(), data: {},
    }))
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
  })

  it('~14 günden eski kayıtlar yok sayılır', () => {
    const saved = new Date('2026-10-01T00:00:00Z')
    setSnapshot('my-schedule', 'emp-1', { a: 1 }, saved)
    expect(getSnapshot('my-schedule', 'emp-1', new Date(saved.getTime() + SNAPSHOT_MAX_AGE_MS - 1000))).not.toBeNull()
    expect(getSnapshot('my-schedule', 'emp-1', new Date(saved.getTime() + SNAPSHOT_MAX_AGE_MS + 1000))).toBeNull()
  })

  it('farklı şema sürümü ve bozuk JSON yok sayılır', () => {
    claimSnapshotOwner('emp-1')
    localStorage.setItem('shiftup:offline:my-schedule:emp-1', JSON.stringify({
      v: SNAPSHOT_VERSION + 1, ownerId: 'emp-1', savedAt: new Date().toISOString(), data: {},
    }))
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
    localStorage.setItem('shiftup:offline:my-schedule:emp-1', '{bozuk')
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
  })

  it('boyut sınırını aşan veri kaydedilmez', () => {
    expect(setSnapshot('big', 'emp-1', 'x'.repeat(SNAPSHOT_MAX_CHARS + 1))).toBe(false)
    expect(localStorage.getItem('shiftup:offline:big:emp-1')).toBeNull()
  })

  it('clearAll yalnızca shiftup:offline: önekli anahtarları siler', () => {
    setSnapshot('my-schedule', 'emp-1', { a: 1 })
    setSnapshot('other', 'emp-1', { b: 2 })
    localStorage.setItem('baska-anahtar', 'kalsin')
    clearAllSnapshots()
    expect(localStorage.getItem('shiftup:offline:my-schedule:emp-1')).toBeNull()
    expect(localStorage.getItem('shiftup:offline:other:emp-1')).toBeNull()
    expect(getSnapshotOwner()).toBeNull()
    expect(localStorage.getItem('baska-anahtar')).toBe('kalsin')
  })

  it('depolama hata fırlatsa da patlamaz', () => {
    const err = () => { throw new Error('QuotaExceeded / SecurityError') }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(err)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(err)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(err)
    vi.spyOn(Storage.prototype, 'key').mockImplementation(err)
    expect(setSnapshot('my-schedule', 'emp-1', { a: 1 })).toBe(false)
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
    expect(getSnapshotOwner()).toBeNull()
    expect(() => clearAllSnapshots()).not.toThrow()
    expect(() => claimSnapshotOwner('emp-1')).not.toThrow()
  })

  it('localStorage erişimi fırlatırsa (engellenmiş site verisi) no-op', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('SecurityError') })
    expect(setSnapshot('my-schedule', 'emp-1', { a: 1 })).toBe(false)
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
    expect(() => clearAllSnapshots()).not.toThrow()
  })

  it('savedAt Türkiye saatiyle biçimlenir', () => {
    expect(formatSnapshotTime('2026-10-16T11:05:00Z')).toBe('16 Ekim 2026 14:05')
    expect(formatSnapshotTime('gecersiz')).toBe('—')
  })
})
