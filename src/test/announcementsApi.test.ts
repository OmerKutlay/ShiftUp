/**
 * announcementsApi.test.ts — Duyurular API: yetki matrisi, alıcı anlık görüntüsü, mağaza izolasyonu,
 * okundu/onay idempotentliği, hatırlatma ve okunmamış sayısı.
 *
 * Route'lar, storeScope ve yetki katmanı gerçek haliyle çalışır; yalnızca oturum ve Supabase
 * (bellek içi fake) değiştirilir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS, KIOSK_ROLE_ID } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/db', () => ({
  db: { from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t) },
}))

import { GET as listGET, POST as createPOST } from '@/app/api/announcements/route'
import { GET as detailGET, PATCH as detailPATCH, DELETE as detailDELETE } from '@/app/api/announcements/[id]/route'
import { POST as readPOST } from '@/app/api/announcements/[id]/read/route'
import { POST as ackPOST } from '@/app/api/announcements/[id]/ack/route'
import { POST as remindPOST } from '@/app/api/announcements/[id]/remind/route'
import { GET as unreadGET } from '@/app/api/announcements/unread-count/route'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const STORE_A = uuid(1)
const STORE_B = uuid(2)
const ADMIN = uuid(20)
const SM_A = uuid(21)
const MGR_A = uuid(22)
const EMP_A1 = uuid(23)
const EMP_A2 = uuid(24)
const KIOSK_A = uuid(25)
const OFF_A = uuid(26)
const EMP_B1 = uuid(27)
const MGR_B = uuid(28)

const emp = (id: string, name: string, store: string, level: string, active = true) => ({
  id, full_name: name, store_id: store, active, role_id: level === ACCESS.KIOSK ? KIOSK_ROLE_ID : uuid(99),
  roles: { access_level: level },
})

/** Oturum nesnesi (getCurrentEmployee dönüşü) */
const session = (id: string, level: string, store: string) => ({
  id, full_name: id, email: null, role_id: null, role_name: null, access_level: level,
  active: true, home_store_id: store, store_id: store,
})

function seed(): FakeDb {
  return createFakeDb({
    employees: [
      emp(ADMIN, 'Admin', STORE_A, ACCESS.ADMIN),
      emp(SM_A, 'Müdür A', STORE_A, ACCESS.STORE_MANAGER),
      emp(MGR_A, 'Yönetici A', STORE_A, ACCESS.MANAGER),
      emp(EMP_A1, 'Ali', STORE_A, ACCESS.EMPLOYEE),
      emp(EMP_A2, 'Veli', STORE_A, ACCESS.EMPLOYEE),
      emp(KIOSK_A, 'Kiosk', STORE_A, ACCESS.KIOSK),
      emp(OFF_A, 'Pasif', STORE_A, ACCESS.EMPLOYEE, false),
      emp(EMP_B1, 'Berk', STORE_B, ACCESS.EMPLOYEE),
      emp(MGR_B, 'Yönetici B', STORE_B, ACCESS.MANAGER),
    ],
    announcements: [],
    announcement_recipients: [],
    notifications: [],
    audit_logs: [],
  })
}

const as = (id: string, level: string, store: string) => { state.employee = session(id, level, store) }
const db = () => state.db as FakeDb

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function publish(body: Record<string, unknown> = {}): Promise<string> {
  const res = await createPOST(req('/api/announcements', 'POST', { title: 'Başlık', body: 'Metin', ...body }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { announcement: { id: string } }).announcement.id
}
const recipientIds = (id: string) =>
  db().tables.announcement_recipients.filter((r) => r.announcement_id === id).map((r) => r.employee_id).sort()
const notified = (id: string) =>
  db().tables.notifications.filter((n) => n.related_id === id).map((n) => n.employee_id).sort()

beforeEach(() => { state.db = seed() })

describe('POST /api/announcements — yetki matrisi', () => {
  it('çalışan duyuru yayınlayamaz (403)', async () => {
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    const res = await createPOST(req('/api/announcements', 'POST', { title: 'x', body: 'y' }))
    expect(res.status).toBe(403)
    expect(db().tables.announcements).toHaveLength(0)
  })

  it('kiosk hesabı yayınlayamaz', async () => {
    as(KIOSK_A, ACCESS.KIOSK, STORE_A)
    const res = await createPOST(req('/api/announcements', 'POST', { title: 'x', body: 'y' }))
    expect(res.status).toBe(403)
  })

  it('yönetici kendi mağazasına yayınlar; store_id oturumun aktif mağazasıdır', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    expect(db().tables.announcements.find((a) => a.id === id)).toMatchObject({ store_id: STORE_A, created_by: MGR_A })
  })

  it('yönetici tüm mağazalara yayınlayamaz; Admin yayınlar (store_id NULL)', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const denied = await createPOST(req('/api/announcements', 'POST', { title: 'x', body: 'y', all_stores: true }))
    expect(denied.status).toBe(403)
    as(SM_A, ACCESS.STORE_MANAGER, STORE_A)
    const denied2 = await createPOST(req('/api/announcements', 'POST', { title: 'x', body: 'y', all_stores: true }))
    expect(denied2.status).toBe(403)

    as(ADMIN, ACCESS.ADMIN, STORE_A)
    const id = await publish({ all_stores: true })
    expect(db().tables.announcements.find((a) => a.id === id)?.store_id).toBeNull()
  })

  it('doğrulama hataları 400 döner', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    expect((await createPOST(req('/api/announcements', 'POST', { title: '', body: 'y' }))).status).toBe(400)
    expect((await createPOST(req('/api/announcements', 'POST', { title: 'x', body: 'a'.repeat(4001) }))).status).toBe(400)
  })

  it('günlük yayın sınırı aşılınca 429 döner ve duyuru oluşmaz', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    db().options.rpc = {
      rate_limit_hit: () => ({ data: { allowed: false, remaining: 0, reset_at: new Date(Date.now() + 1000).toISOString() } }),
    }
    const res = await createPOST(req('/api/announcements', 'POST', { title: 'x', body: 'y' }))
    expect(res.status).toBe(429)
    expect(db().tables.announcements).toHaveLength(0)
  })
})

describe('alıcı anlık görüntüsü ve bildirimler', () => {
  it('mağazanın aktif, kiosk olmayan çalışanları alıcı olur; yayıncı, pasif, kiosk ve başka mağaza hariç', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    expect(recipientIds(id)).toEqual([ADMIN, SM_A, EMP_A1, EMP_A2].sort())
  })

  it('hedef "yalnızca yöneticiler": yalnızca Yönetici ve üstü', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ target_roles: 'managers' })
    expect(recipientIds(id)).toEqual([ADMIN, SM_A].sort())
  })

  it('şirket geneli: tüm mağazaların aktif çalışanları (kiosk ve pasif hariç)', async () => {
    as(ADMIN, ACCESS.ADMIN, STORE_A)
    const id = await publish({ all_stores: true })
    expect(recipientIds(id)).toEqual([SM_A, MGR_A, EMP_A1, EMP_A2, EMP_B1, MGR_B].sort())
  })

  it('her alıcıya announcement bildirimi gider (related_id = duyuru)', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ title: 'Toplantı', body: 'Yarın 10:00' })
    expect(notified(id)).toEqual(recipientIds(id))
    expect(db().tables.notifications[0]).toMatchObject({ type: 'announcement', title: 'Toplantı', message: 'Yarın 10:00', is_read: false })
  })

  it('yayın denetim kaydına yazılır', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    expect(db().tables.audit_logs.find((l) => l.action === 'announcement.create')).toMatchObject({ entity_id: id, actor_id: MGR_A })
  })

  it('yayın sonrası kadro değişse de alıcı listesi sabit kalır', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    db().tables.employees.find((e) => e.id === EMP_A2)!.active = false
    expect(recipientIds(id)).toContain(EMP_A2)
  })
})

describe('mağaza izolasyonu', () => {
  it('başka mağazanın çalışanı duyuruyu göremez, okuyamaz, onaylayamaz (404)', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ requires_ack: true })

    as(EMP_B1, ACCESS.EMPLOYEE, STORE_B)
    expect((await detailGET(req(`/api/announcements/${id}`), ctx(id))).status).toBe(404)
    expect((await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))).status).toBe(404)
    expect((await ackPOST(req(`/api/announcements/${id}/ack`, 'POST'), ctx(id))).status).toBe(404)
    const list = (await (await listGET(req('/api/announcements'))).json()) as { announcements: unknown[] }
    expect(list.announcements).toHaveLength(0)
  })

  it('başka mağazanın yöneticisi düzenleyemez, silemez, hatırlatamaz (404)', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()

    as(MGR_B, ACCESS.MANAGER, STORE_B)
    expect((await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'x' }), ctx(id))).status).toBe(404)
    expect((await detailDELETE(req(`/api/announcements/${id}`, 'DELETE'), ctx(id))).status).toBe(404)
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(404)
    expect(db().tables.announcements[0].deleted_at ?? null).toBeNull()
  })

  it('Admin başka mağazaya geçince (aktif mağaza B) A mağazasının duyurusunu yönetemez', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    as(ADMIN, ACCESS.ADMIN, STORE_B)
    expect((await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'x' }), ctx(id))).status).toBe(404)
  })

  it('hedef kitleye dahil olmayan çalışan duyurunun varlığını öğrenemez (404)', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ target_roles: 'managers' })
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    expect((await detailGET(req(`/api/announcements/${id}`), ctx(id))).status).toBe(404)
    const list = (await (await listGET(req('/api/announcements'))).json()) as { announcements: unknown[] }
    expect(list.announcements).toHaveLength(0)
  })

  it('şirket geneli duyuruyu yalnızca Admin yönetir; yönetici yalnızca alıcı olarak görür', async () => {
    as(ADMIN, ACCESS.ADMIN, STORE_A)
    const id = await publish({ all_stores: true })

    as(MGR_B, ACCESS.MANAGER, STORE_B)
    const detail = (await (await detailGET(req(`/api/announcements/${id}`), ctx(id))).json()) as {
      announcement: { can_manage: boolean; stats?: unknown }; recipients?: unknown
    }
    expect(detail.announcement.can_manage).toBe(false)
    expect(detail.announcement.stats).toBeUndefined()
    expect(detail.recipients).toBeUndefined()
    expect((await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'x' }), ctx(id))).status).toBe(403)
    expect((await detailDELETE(req(`/api/announcements/${id}`, 'DELETE'), ctx(id))).status).toBe(403)
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(403)

    // Admin her mağazadayken yönetir
    as(ADMIN, ACCESS.ADMIN, STORE_B)
    expect((await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'Yeni' }), ctx(id))).status).toBe(200)
  })

  it('çalışan düzenleyemez / silemez / hatırlatamaz (403)', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    expect((await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'x' }), ctx(id))).status).toBe(403)
    expect((await detailDELETE(req(`/api/announcements/${id}`, 'DELETE'), ctx(id))).status).toBe(403)
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(403)
  })
})

describe('hiyerarşi, düzenleme ve silme', () => {
  it('yönetici, kendinden yüksek yetkilinin duyurusunu düzenleyemez / silemez', async () => {
    as(SM_A, ACCESS.STORE_MANAGER, STORE_A)
    const id = await publish()
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    expect((await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'x' }), ctx(id))).status).toBe(403)
    expect((await detailDELETE(req(`/api/announcements/${id}`, 'DELETE'), ctx(id))).status).toBe(403)
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(403)

    // Müdür kendi, Admin herkesinkini yönetir; yönetici eşit seviyedekinin duyurusunu da
    as(ADMIN, ACCESS.ADMIN, STORE_A)
    expect((await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'Admin' }), ctx(id))).status).toBe(200)
  })

  it('düzenleme okundu/onay kayıtlarını sıfırlamaz ve yeniden bildirim göndermez', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ requires_ack: true })
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))
    await ackPOST(req(`/api/announcements/${id}/ack`, 'POST'), ctx(id))
    const before = db().tables.notifications.length

    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const res = await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'Güncel', body: 'Yeni metin', pinned: true }), ctx(id))
    expect(res.status).toBe(200)
    const row = db().tables.announcement_recipients.find((r) => r.employee_id === EMP_A1)!
    expect(row.read_at).toBeTruthy()
    expect(row.ack_at).toBeTruthy()
    expect(db().tables.notifications).toHaveLength(before)
    expect(db().tables.announcements[0]).toMatchObject({ title: 'Güncel', body: 'Yeni metin', pinned: true })
  })

  it('PATCH hedef rol / onay zorunluluğunu değiştirmez', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    const res = await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { requires_ack: true, target_roles: 'managers' }), ctx(id))
    expect(res.status).toBe(400) // değiştirilecek alan yok
    expect(db().tables.announcements[0]).toMatchObject({ requires_ack: false, target_roles: 'all' })
  })

  it('silme soft delete: kayıt kalır, listeden ve detaydan kalkar, denetim kaydı yazılır', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    expect((await detailDELETE(req(`/api/announcements/${id}`, 'DELETE'), ctx(id))).status).toBe(200)
    expect(db().tables.announcements[0].deleted_at).toBeTruthy()
    expect((await detailGET(req(`/api/announcements/${id}`), ctx(id))).status).toBe(404)
    expect(db().tables.audit_logs.some((l) => l.action === 'announcement.delete' && l.entity_id === id)).toBe(true)
    const list = (await (await listGET(req('/api/announcements'))).json()) as { announcements: unknown[] }
    expect(list.announcements).toHaveLength(0)
  })
})

describe('okundu / onay', () => {
  it('okuma idempotent: ilk zaman korunur', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    const a = (await (await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))).json()) as { read_at: string }
    expect(a.read_at).toBeTruthy()
    await new Promise((r) => setTimeout(r, 5))
    const b = (await (await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))).json()) as { read_at: string }
    expect(b.read_at).toBe(a.read_at)
  })

  it('onay yalnızca onay zorunlu duyuruda; idempotent; okundu da sayılır', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const plain = await publish()
    const needAck = await publish({ requires_ack: true })

    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    expect((await ackPOST(req(`/api/announcements/${plain}/ack`, 'POST'), ctx(plain))).status).toBe(400)

    const first = (await (await ackPOST(req(`/api/announcements/${needAck}/ack`, 'POST'), ctx(needAck))).json()) as { read_at: string; ack_at: string }
    expect(first.read_at).toBeTruthy()
    expect(first.ack_at).toBeTruthy()
    await new Promise((r) => setTimeout(r, 5))
    const second = (await (await ackPOST(req(`/api/announcements/${needAck}/ack`, 'POST'), ctx(needAck))).json()) as { ack_at: string }
    expect(second.ack_at).toBe(first.ack_at)
  })

  it('alıcı olmayan yönetici kendi adına okundu/onay yazamaz (404)', async () => {
    // Yayıncı alıcı listesinde değildir
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ requires_ack: true })
    expect((await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))).status).toBe(404)
    expect((await ackPOST(req(`/api/announcements/${id}/ack`, 'POST'), ctx(id))).status).toBe(404)
  })

  it('geçersiz id 404 döner', async () => {
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    expect((await readPOST(req('/api/announcements/abc/read', 'POST'), ctx('abc'))).status).toBe(404)
  })
})

describe('hatırlat', () => {
  it('yalnızca okumayanlara bildirim gider; 6 saat içinde ikinci istek 429', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))

    as(MGR_A, ACCESS.MANAGER, STORE_A)
    db().tables.notifications = []
    const res = await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { reminded: number }).reminded).toBe(3)
    expect(notified(id)).toEqual([ADMIN, SM_A, EMP_A2].sort())
    expect(db().tables.notifications[0].title).toMatch(/^Hatırlatma: /)
    expect(db().tables.announcements[0].last_reminded_at).toBeTruthy()

    const again = await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))
    expect(again.status).toBe(429)
    expect(db().tables.notifications).toHaveLength(3)
  })

  it('6 saat geçince tekrar hatırlatılabilir', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    db().tables.announcements[0].last_reminded_at = new Date(Date.now() - 7 * 3600_000).toISOString()
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(200)
  })

  it('onay zorunluysa okuyup onaylamayanlar da hatırlatılır; herkes onayladıysa 400', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ requires_ack: true })
    for (const [uid, level] of [[EMP_A1, ACCESS.EMPLOYEE], [EMP_A2, ACCESS.EMPLOYEE]] as const) {
      as(uid, level, STORE_A)
      await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))
    }
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    await ackPOST(req(`/api/announcements/${id}/ack`, 'POST'), ctx(id))

    as(MGR_A, ACCESS.MANAGER, STORE_A)
    db().tables.notifications = []
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(200)
    expect(notified(id)).toEqual([ADMIN, SM_A, EMP_A2].sort())

    // Kalan herkes onaylayınca hatırlatılacak kimse kalmaz
    for (const [uid, level] of [[ADMIN, ACCESS.ADMIN], [SM_A, ACCESS.STORE_MANAGER], [EMP_A2, ACCESS.EMPLOYEE]] as const) {
      as(uid, level, STORE_A)
      await ackPOST(req(`/api/announcements/${id}/ack`, 'POST'), ctx(id))
    }
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    db().tables.announcements[0].last_reminded_at = null
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(400)
  })

  it('süresi dolmuş duyuru hatırlatılamaz', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    db().tables.announcements[0].expires_at = new Date(Date.now() - 1000).toISOString()
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(400)
  })
})

describe('liste, arşiv ve okunmamış sayısı', () => {
  it('sabitlenenler önce, sonra yeniden eskiye', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const old = await publish({ title: 'Eski' })
    const pinned = await publish({ title: 'Sabit', pinned: true })
    const fresh = await publish({ title: 'Yeni' })
    db().tables.announcements.find((a) => a.id === old)!.created_at = '2026-01-01T00:00:00.000Z'
    db().tables.announcements.find((a) => a.id === pinned)!.created_at = '2026-02-01T00:00:00.000Z'
    db().tables.announcements.find((a) => a.id === fresh)!.created_at = '2026-03-01T00:00:00.000Z'

    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    const list = (await (await listGET(req('/api/announcements'))).json()) as { announcements: { title: string }[] }
    expect(list.announcements.map((a) => a.title)).toEqual(['Sabit', 'Yeni', 'Eski'])
  })

  it('süresi dolanlar varsayılan listeden kalkar, arşivde görünür', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const gone = await publish({ title: 'Bitti' })
    await publish({ title: 'Güncel' })
    db().tables.announcements.find((a) => a.id === gone)!.expires_at = new Date(Date.now() - 1000).toISOString()

    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    const active = (await (await listGET(req('/api/announcements'))).json()) as { announcements: { title: string }[] }
    expect(active.announcements.map((a) => a.title)).toEqual(['Güncel'])
    const archive = (await (await listGET(req('/api/announcements?archive=1'))).json()) as { announcements: { title: string }[] }
    expect(archive.announcements.map((a) => a.title)).toEqual(['Bitti'])
  })

  it('okunmamış sayısı: okuyunca düşer, süresi dolan ve silinen sayılmaz', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const a = await publish({ title: 'A' })
    const b = await publish({ title: 'B' })
    const c = await publish({ title: 'C' })
    const d = await publish({ title: 'D' })

    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    const count = async () => ((await (await unreadGET(req('/api/announcements/unread-count'))).json()) as { unread_count: number }).unread_count
    expect(await count()).toBe(4)
    await readPOST(req(`/api/announcements/${a}/read`, 'POST'), ctx(a))
    expect(await count()).toBe(3)
    db().tables.announcements.find((x) => x.id === b)!.expires_at = new Date(Date.now() - 1000).toISOString()
    db().tables.announcements.find((x) => x.id === c)!.deleted_at = new Date().toISOString()
    expect(await count()).toBe(1) // yalnızca D
    expect(d).toBeTruthy()

    const list = (await (await listGET(req('/api/announcements'))).json()) as { unread_count: number }
    expect(list.unread_count).toBe(1)
  })

  it('yönetici listesinde okundu / onay istatistiği vardır, çalışanın listesinde yoktur', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ requires_ack: true })
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    await ackPOST(req(`/api/announcements/${id}/ack`, 'POST'), ctx(id))
    as(EMP_A2, ACCESS.EMPLOYEE, STORE_A)
    await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))

    const empList = (await (await listGET(req('/api/announcements'))).json()) as { announcements: { stats?: unknown; can_manage: boolean }[] }
    expect(empList.announcements[0].stats).toBeUndefined()
    expect(empList.announcements[0].can_manage).toBe(false)

    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const mgrList = (await (await listGET(req('/api/announcements'))).json()) as { announcements: { stats: { recipients: number; read: number; acked: number } }[] }
    expect(mgrList.announcements[0].stats).toEqual({ recipients: 4, read: 2, acked: 1 })
  })

  it('yönetici detayında alıcı listesi yalnızca ad ve durum içerir (e-posta vb. yok)', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    const detail = (await (await detailGET(req(`/api/announcements/${id}`), ctx(id))).json()) as {
      recipients: Record<string, unknown>[]
    }
    expect(detail.recipients).toHaveLength(4)
    for (const r of detail.recipients) {
      expect(Object.keys(r).sort()).toEqual(['ack_at', 'employee_id', 'full_name', 'read_at'])
    }
  })
})
