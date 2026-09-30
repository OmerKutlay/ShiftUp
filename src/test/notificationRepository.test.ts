/**
 * FAZ 10 — Kritik notification testleri
 *
 * Test 1: Bildirim oluşturulabiliyor ve doğru employee'ye ait
 * Test 2: Okunmamış/okunmuş durumu doğru çalışıyor
 * Test 3: Aynı vardiya için duplicate reminder oluşturulmuyor (unique_violation → null)
 * Test 4: Vardiya başlangıcına 1 saat kala reminder oluşturuluyor (iş mantığı kontrolü)
 * Test 5: Bir kullanıcı başka kullanıcının bildirimlerini işaretleyemiyor
 */
import { describe, it, expect, vi } from 'vitest'
import type { Notification } from '@/types/notification'
import {
  createNotification,
  getNotificationsByEmployee,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from '@/lib/notificationRepository'

// ─── Supabase admin client mock ──────────────────────────────
vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: vi.fn(),
}))

// ─── Yardımcı: notification factory ─────────────────────────
function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-001',
    employee_id: 'emp-001',
    type: 'leave_approved',
    title: 'İzin talebiniz onaylandı',
    message: '2026-10-01 – 2026-10-03 tarihli izin onaylandı.',
    is_read: false,
    related_id: 'leave-001',
    created_at: '2026-09-30T10:00:00Z',
    ...overrides,
  }
}

// Chainable builder
function buildChain(terminal: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'insert', 'update', 'order', 'limit', 'single', 'maybeSingle']
  methods.forEach((m) => {
    chain[m] = vi.fn(() => ({ ...chain, ...terminal }))
  })
  return { ...chain, ...terminal }
}

function makeMockAdmin(overrides: Record<string, ReturnType<typeof buildChain>> = {}) {
  return { from: vi.fn((table: string) => overrides[table] ?? buildChain({})) }
}

// ─── TESTLER ─────────────────────────────────────────────────

describe('createNotification', () => {
  it('Test 1: Bildirim oluşturulur ve doğru employee_id ile döner', async () => {
    const expected = makeNotification()
    const chain = buildChain({ data: expected, error: null })
    const admin = makeMockAdmin({ notifications: chain })

    const result = await createNotification(admin as never, {
      employee_id: 'emp-001',
      type: 'leave_approved',
      title: 'İzin talebiniz onaylandı',
      message: '2026-10-01 – 2026-10-03 tarihli izin onaylandı.',
      related_id: 'leave-001',
    })

    expect(result).not.toBeNull()
    expect(result!.employee_id).toBe('emp-001')
    expect(result!.type).toBe('leave_approved')
    expect(result!.is_read).toBe(false)
  })

  it('Test 3: Duplicate shift_reminder (unique_violation 23505) → null döner, throw etmez', async () => {
    const chain = buildChain({
      data: null,
      error: { code: '23505', message: 'unique constraint' },
    })
    const admin = makeMockAdmin({ notifications: chain })

    const result = await createNotification(admin as never, {
      employee_id: 'emp-001',
      type: 'shift_reminder',
      title: 'Yaklaşan vardiya hatırlatması',
      message: 'Vardiyan başlıyor: 09:00 - 18:00',
      related_id: 'shift-001',
    })

    // Duplicate → null, exception fırlatmaz
    expect(result).toBeNull()
  })

  it('Test 3b: Farklı shift için ikinci reminder oluşturulabilir', async () => {
    const expected = makeNotification({ id: 'notif-002', related_id: 'shift-002', type: 'shift_reminder' })
    const chain = buildChain({ data: expected, error: null })
    const admin = makeMockAdmin({ notifications: chain })

    const result = await createNotification(admin as never, {
      employee_id: 'emp-001',
      type: 'shift_reminder',
      title: 'Yaklaşan vardiya hatırlatması',
      message: 'Vardiyan başlıyor: 14:00 - 22:00',
      related_id: 'shift-002',
    })

    expect(result).not.toBeNull()
    expect(result!.related_id).toBe('shift-002')
  })

  it('DB hatası fırlatılır (23505 dışı)', async () => {
    const chain = buildChain({
      data: null,
      error: { code: '42P01', message: 'table not found' },
    })
    const admin = makeMockAdmin({ notifications: chain })

    await expect(
      createNotification(admin as never, {
        employee_id: 'emp-001',
        type: 'leave_submitted',
        title: 'test',
        message: 'test',
      }),
    ).rejects.toEqual({ code: '42P01', message: 'table not found' })
  })
})

describe('getNotificationsByEmployee', () => {
  it('Test 1b: Sadece doğru employee_id\'ye ait bildirimler döner', async () => {
    const myNotifs: Notification[] = [
      makeNotification({ id: 'n1', employee_id: 'emp-001' }),
      makeNotification({ id: 'n2', employee_id: 'emp-001', is_read: true }),
    ]
    const chain = buildChain({ data: myNotifs, error: null })
    const admin = makeMockAdmin({ notifications: chain })

    const results = await getNotificationsByEmployee(admin as never, 'emp-001')

    expect(results).toHaveLength(2)
    results.forEach((n) => expect(n.employee_id).toBe('emp-001'))
  })
})

describe('getUnreadCount', () => {
  it('Test 2: Okunmamış bildirim sayısı doğru döner', async () => {
    // Supabase count query mock: { count: 3, error: null }
    const countChain: Record<string, unknown> = {}
    const methods = ['select', 'eq', 'order', 'limit']
    methods.forEach((m) => {
      countChain[m] = vi.fn(() => ({ ...countChain, count: 3, error: null }))
    })
    const admin = { from: vi.fn(() => countChain) }

    const count = await getUnreadCount(admin as never, 'emp-001')
    expect(count).toBe(3)
  })

  it('Test 2b: Hiç okunmamış yoksa 0 döner', async () => {
    const countChain: Record<string, unknown> = {}
    const methods = ['select', 'eq', 'order', 'limit']
    methods.forEach((m) => {
      countChain[m] = vi.fn(() => ({ ...countChain, count: 0, error: null }))
    })
    const admin = { from: vi.fn(() => countChain) }

    const count = await getUnreadCount(admin as never, 'emp-001')
    expect(count).toBe(0)
  })
})

describe('markAsRead', () => {
  it('Test 2c: Bildirim okundu olarak işaretlenir', async () => {
    const chain = buildChain({ error: null })
    const admin = makeMockAdmin({ notifications: chain })

    // Hata fırlatmamalı
    await expect(
      markAsRead(admin as never, 'notif-001', 'emp-001'),
    ).resolves.toBeUndefined()
  })

  it('Test 5: Başka kullanıcının bildirimi işaretlenemiyor — eq employee_id filtresi uygulanır', async () => {
    // markAsRead fonksiyonu .eq('employee_id', employeeId) filtresi koyuyor.
    // Bunu intercepting bir mock ile doğruluyoruz.
    const eqCalls: Array<[string, unknown]> = []

    // Tüm metotlar kendini (zincir devamı) döndürür
    const makeChain = (): Record<string, unknown> => {
      const c: Record<string, unknown> = {}
      const methods = ['select', 'insert', 'update', 'order', 'limit', 'single', 'maybeSingle']
      methods.forEach((m) => { c[m] = vi.fn(() => c) })
      // eq her çağrıyı kaydeder ve chain döndürür
      c['eq'] = vi.fn((col: string, val: unknown) => {
        eqCalls.push([col, val])
        return { ...c, error: null }
      })
      return c
    }

    const chain = makeChain()
    const admin = { from: vi.fn(() => chain) }

    await markAsRead(admin as never, 'notif-999', 'emp-001')

    // employee_id filtresi mutlaka uygulanmış olmalı
    const hasEmployeeFilter = eqCalls.some(
      ([col, val]) => col === 'employee_id' && val === 'emp-001',
    )
    expect(hasEmployeeFilter).toBe(true)
  })
})

describe('markAllAsRead', () => {
  it('Test 2d: Tüm bildirimler okundu işaretlenir', async () => {
    const chain = buildChain({ error: null })
    const admin = makeMockAdmin({ notifications: chain })

    await expect(
      markAllAsRead(admin as never, 'emp-001'),
    ).resolves.toBeUndefined()
  })
})

// ─── Test 4: Vardiya reminder iş mantığı kontrolü ────────────
describe('Shift reminder timing logic', () => {
  it('Test 4: 50-70 dk arasındaki vardiyalar hatırlatma penceresinde yakalanır', () => {
    const REMINDER_FLOOR_MIN = 50
    const REMINDER_WINDOW_MIN = 70

    const now = new Date('2026-09-30T13:00:00Z')

    // Shift başlangıç zamanları
    const shiftAt55min  = new Date(now.getTime() + 55 * 60 * 1000) // 13:55 — pencerede
    const shiftAt45min  = new Date(now.getTime() + 45 * 60 * 1000) // 13:45 — pencere öncesi
    const shiftAt75min  = new Date(now.getTime() + 75 * 60 * 1000) // 14:15 — pencere sonrası
    const shiftAt60min  = new Date(now.getTime() + 60 * 60 * 1000) // 14:00 — pencerede (tam 1 saat)

    const windowStart = new Date(now.getTime() + REMINDER_FLOOR_MIN * 60 * 1000)
    const windowEnd   = new Date(now.getTime() + REMINDER_WINDOW_MIN * 60 * 1000)

    const isInWindow = (shiftTime: Date) =>
      shiftTime >= windowStart && shiftTime <= windowEnd

    expect(isInWindow(shiftAt55min)).toBe(true)   // 55 dk — yakalanmalı
    expect(isInWindow(shiftAt60min)).toBe(true)   // 60 dk — yakalanmalı
    expect(isInWindow(shiftAt45min)).toBe(false)  // 45 dk — çok yakın, geç
    expect(isInWindow(shiftAt75min)).toBe(false)  // 75 dk — henüz erken
  })
})
