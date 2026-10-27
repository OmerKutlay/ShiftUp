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

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown, rateAllowed: true }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => state.db }))
// Sınır sayacı testler arasında paylaşılmasın; izin durumu teste göre ayarlanır
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: state.rateAllowed, remaining: 0, resetAt: Date.now() + 1000 })),
}))
vi.mock('@/lib/db', () => ({
  db: { from: (t: string) => (state.db as { from: (t: string) => unknown }).from(t) },
}))

import { GET as listGET, POST as createPOST } from '@/app/api/announcements/route'
import { GET as detailGET, PATCH as detailPATCH, DELETE as detailDELETE } from '@/app/api/announcements/[id]/route'
import { POST as readPOST } from '@/app/api/announcements/[id]/read/route'
import { POST as ackPOST } from '@/app/api/announcements/[id]/ack/route'
import { POST as remindPOST } from '@/app/api/announcements/[id]/remind/route'
import { GET as unreadGET } from '@/app/api/announcements/unread-count/route'
import { POST as employeesPOST } from '@/app/api/employees/route'
import { PATCH as employeePATCH } from '@/app/api/employees/[id]/route'
import { addLateJoinerRecipient } from '@/lib/announcementService'

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

/** announcement_mark RPC'sinin bellek içi karşılığı (coalesce davranışı) */
const markRpc = (args: { p_announcement: string; p_employee: string; p_ack: boolean }, fdb: FakeDb) => {
  const row = fdb.tables.announcement_recipients.find(
    (r) => r.announcement_id === args.p_announcement && r.employee_id === args.p_employee,
  )
  if (!row) return { data: [] }
  const now = new Date().toISOString()
  row.read_at = row.read_at ?? now
  if (args.p_ack) row.ack_at = row.ack_at ?? now
  return { data: [{ read_at: row.read_at, ack_at: row.ack_at ?? null }] }
}

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
    roles: [{ id: uuid(99), name: 'Çalışan', access_level: ACCESS.EMPLOYEE, planning_group: null, sort_order: 1 }],
    shift_assignments: [],
    stores: [{ id: STORE_A, name: 'A', active: true }, { id: STORE_B, name: 'B', active: true }],
  }, {
    evalOr: true,
    relations: { announcement_recipients: { announcements: { table: 'announcements', fk: 'announcement_id' } } },
    rpc: {
      announcement_mark: markRpc,
      // Transfer: yalnızca mağazayı değiştirir (vardiya silme ayrıntısı multiStorePeopleApi testinde)
      apply_employee_store_transfer: (x: { p_employee_id: string; p_to_store: string }, fdb: FakeDb) => {
        fdb.tables.employees.find((e) => e.id === x.p_employee_id)!.store_id = x.p_to_store
        return { data: { shifts_deleted: 0, open_shifts_reopened: 0, swaps: [] } }
      },
    },
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

beforeEach(() => { state.db = seed(); state.rateAllowed = true })

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
    state.rateAllowed = false
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

  it('düzenleme (onay zorunlu olmayan) okundu kayıtlarını sıfırlamaz ve yeniden bildirim göndermez', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))
    const before = db().tables.notifications.length

    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const res = await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'Güncel', body: 'Yeni metin', pinned: true }), ctx(id))
    expect(res.status).toBe(200)
    const row = db().tables.announcement_recipients.find((r) => r.employee_id === EMP_A1)!
    expect(row.read_at).toBeTruthy()
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
      // Fake DB boş kolonları hiç yazmaz; gerçek DB null döner — burada yalnızca izinli anahtarlar denetlenir
      expect(Object.keys(r).every((k) => ['ack_at', 'employee_id', 'full_name', 'read_at'].includes(k))).toBe(true)
      expect(r).not.toHaveProperty('email')
    }
  })
})

describe('onay zorunlu duyuruyu düzenleme', () => {
  async function ackedAnnouncement() {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish({ requires_ack: true })
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    await ackPOST(req(`/api/announcements/${id}/ack`, 'POST'), ctx(id))
    as(EMP_A2, ACCESS.EMPLOYEE, STORE_A)
    await readPOST(req(`/api/announcements/${id}/read`, 'POST'), ctx(id))
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    db().tables.notifications = []
    return id
  }

  it('başlık/metin değişince onaylar sıfırlanır, yalnızca onaylamış olanlara bildirim gider; okundu korunur', async () => {
    const id = await ackedAnnouncement()
    const res = await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { body: 'Yeni metin' }), ctx(id))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { reack: number }).reack).toBe(1)
    const rows = db().tables.announcement_recipients.filter((r) => r.announcement_id === id)
    expect(rows.every((r) => !r.ack_at)).toBe(true)
    expect(rows.find((r) => r.employee_id === EMP_A1)?.read_at).toBeTruthy()
    expect(notified(id)).toEqual([EMP_A1])
    expect(db().tables.notifications[0].message).toBe('Duyuru güncellendi, lütfen tekrar onaylayın.')
    expect(db().tables.announcements[0].edited_at).toBeTruthy()
  })

  it('yalnızca sabitleme/bitiş değişince onaylar korunur ve bildirim gitmez', async () => {
    const id = await ackedAnnouncement()
    await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { pinned: true }), ctx(id))
    expect(db().tables.announcement_recipients.find((r) => r.employee_id === EMP_A1)?.ack_at).toBeTruthy()
    expect(db().tables.notifications).toHaveLength(0)
  })

  it('aynı başlık/metinle PATCH onayları sıfırlamaz', async () => {
    const id = await ackedAnnouncement()
    await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'Başlık', body: 'Metin' }), ctx(id))
    expect(db().tables.announcement_recipients.find((r) => r.employee_id === EMP_A1)?.ack_at).toBeTruthy()
  })

  it('detayda edited_at döner (düzenlenmemişse null)', async () => {
    const id = await ackedAnnouncement()
    const before = (await (await detailGET(req(`/api/announcements/${id}`), ctx(id))).json()) as { announcement: { edited_at: string | null } }
    expect(before.announcement.edited_at ?? null).toBeNull()
    await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'Başka' }), ctx(id))
    const after = (await (await detailGET(req(`/api/announcements/${id}`), ctx(id))).json()) as { announcement: { edited_at: string | null } }
    expect(after.announcement.edited_at).toBeTruthy()
  })
})

describe('hatırlat: talep sonrası hata geri alma', () => {
  it('bildirim gönderimi başarısız olursa last_reminded_at eski değerine döner', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    const prev = new Date(Date.now() - 8 * 3600_000).toISOString()
    db().tables.announcements[0].last_reminded_at = prev
    db().options.failOn = { 'notifications:insert': { message: 'boom', code: '500' } }
    const res = await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))
    expect(res.status).toBe(500)
    expect(db().tables.announcements[0].last_reminded_at).toBe(prev)

    // Hata sonrası hemen yeniden denenebilir
    db().options.failOn = {}
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(200)
  })

  it('hedef kalmadıysa talep geri alınır (null\'a döner)', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    db().tables.announcement_recipients.forEach((r) => { r.read_at = new Date().toISOString() })
    const res = await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))
    expect(res.status).toBe(400)
    expect(db().tables.announcements[0].last_reminded_at ?? null).toBeNull()
  })

  it('hedefler talepten sonra okunur: başka istek talebi aldıysa (koşul tutmadı) bildirim gitmez', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const id = await publish()
    db().tables.notifications = []
    // İlk istek kazanır, aynı saniyedeki ikinci istek atomik talepte (or koşulu) elenir
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(200)
    const n = db().tables.notifications.length
    db().tables.announcements[0].last_reminded_at = new Date(Date.now() - 1000).toISOString()
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(429)
    expect(db().tables.notifications).toHaveLength(n)
  })
})

describe('şirket geneli duyuru: mağaza izolasyonu', () => {
  it('A mağazası yöneticisi şirket geneli duyuruyu PATCH/DELETE/remind edemez (403); B çalışanı görür', async () => {
    as(ADMIN, ACCESS.ADMIN, STORE_A)
    const id = await publish({ all_stores: true, title: 'Herkese' })

    as(MGR_A, ACCESS.MANAGER, STORE_A)
    expect((await detailPATCH(req(`/api/announcements/${id}`, 'PATCH', { title: 'x' }), ctx(id))).status).toBe(403)
    expect((await detailDELETE(req(`/api/announcements/${id}`, 'DELETE'), ctx(id))).status).toBe(403)
    expect((await remindPOST(req(`/api/announcements/${id}/remind`, 'POST'), ctx(id))).status).toBe(403)
    expect(db().tables.announcements[0]).toMatchObject({ title: 'Herkese' })
    expect(db().tables.announcements[0].deleted_at ?? null).toBeNull()

    as(EMP_B1, ACCESS.EMPLOYEE, STORE_B)
    const list = (await (await listGET(req('/api/announcements'))).json()) as { announcements: { id: string; can_manage: boolean }[]; unread_count: number }
    expect(list.announcements.map((a) => a.id)).toEqual([id])
    expect(list.announcements[0].can_manage).toBe(false)
    expect(list.unread_count).toBe(1)
    expect((await detailGET(req(`/api/announcements/${id}`), ctx(id))).status).toBe(200)
  })
})

describe('liste: SQL filtreleri, pencere ve arşiv sayfalama', () => {
  it('çalışanın kendi duyuruları, başkalarının 150+ duyurusu arasında kaybolmaz', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const mineId = await publish({ title: 'Benim', target_roles: 'all' })
    // Hedefi yöneticiler olan çok sayıda yeni duyuru (EMP_A1 alıcı değil)
    for (let i = 0; i < 160; i++) {
      db().tables.announcements.push({
        id: uuid(5000 + i), store_id: STORE_A, title: `Y${i}`, body: 'b', pinned: false, requires_ack: false,
        target_roles: 'managers', expires_at: null, created_by: MGR_A, deleted_at: null,
        created_at: new Date(Date.now() + 1000 + i).toISOString(),
      })
    }
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    const list = (await (await listGET(req('/api/announcements'))).json()) as { announcements: { id: string }[] }
    expect(list.announcements.map((a) => a.id)).toEqual([mineId])
  })

  it('arşiv before imleciyle sayfalanır', async () => {
    as(MGR_A, ACCESS.MANAGER, STORE_A)
    const base = Date.now() - 100 * 86400_000
    for (let i = 0; i < 35; i++) {
      db().tables.announcements.push({
        id: uuid(6000 + i), store_id: STORE_A, title: `A${i}`, body: 'b', pinned: false, requires_ack: false,
        target_roles: 'all', expires_at: new Date(Date.now() - 1000).toISOString(), created_by: SM_A, deleted_at: null,
        created_at: new Date(base + i * 1000).toISOString(),
      })
      db().tables.announcement_recipients.push({ announcement_id: uuid(6000 + i), employee_id: EMP_A1, read_at: null, ack_at: null, created_at: new Date(base + i * 1000).toISOString() })
    }
    as(EMP_A1, ACCESS.EMPLOYEE, STORE_A)
    const p1 = (await (await listGET(req('/api/announcements?archive=1'))).json()) as { announcements: { id: string }[]; next_before: string | null }
    expect(p1.announcements).toHaveLength(30)
    expect(p1.next_before).toBeTruthy()
    const p2 = (await (await listGET(req(`/api/announcements?archive=1&before=${encodeURIComponent(p1.next_before as string)}`))).json()) as { announcements: { id: string }[]; next_before: string | null }
    expect(p2.announcements).toHaveLength(5)
    expect(p2.next_before).toBeNull()
    const ids = new Set([...p1.announcements, ...p2.announcements].map((a) => a.id))
    expect(ids.size).toBe(35)
  })
})

describe('sonradan katılanlar (addLateJoinerRecipient)', () => {
  const addAnn = (over: Record<string, unknown>) => {
    const id = uuid(7000 + db().tables.announcements.length)
    db().tables.announcements.push({
      id, store_id: STORE_A, title: 'T', body: 'B', pinned: false, requires_ack: false, target_roles: 'all',
      expires_at: null, created_by: MGR_A, deleted_at: null, created_at: new Date().toISOString(), ...over,
    })
    return id
  }
  const NEW = uuid(40)
  const addEmployee = (store: string, level: string = ACCESS.EMPLOYEE, extra: Record<string, unknown> = {}) =>
    db().tables.employees.push({ ...emp(NEW, 'Yeni', store, level), ...extra })
  const rec = () => db().tables.announcement_recipients.filter((r) => r.employee_id === NEW).map((r) => r.announcement_id).sort()
  const notes = () => db().tables.notifications.filter((n) => n.employee_id === NEW)

  it('yalnızca güncel ve (sabit veya onay zorunlu) duyurulara eklenir; tek bildirim gider', async () => {
    const pinned = addAnn({ pinned: true, title: 'Sabit' })
    addAnn({}) // sabit değil, onay yok
    addAnn({ requires_ack: true, expires_at: new Date(Date.now() - 1000).toISOString() }) // süresi dolmuş
    addAnn({ pinned: true, deleted_at: new Date().toISOString() }) // silinmiş
    addAnn({ pinned: true, store_id: STORE_B }) // başka mağaza
    addEmployee(STORE_A)
    expect(await addLateJoinerRecipient(db() as never, NEW)).toBe(1)
    expect(rec()).toEqual([pinned])
    expect(notes()).toHaveLength(1)
    expect(notes()[0]).toMatchObject({ type: 'announcement', title: 'Sabit', related_id: pinned })
  })

  it('şirket geneli ve onay zorunlu duyurular dahil; birden fazlaysa tek özet bildirim', async () => {
    const wide = addAnn({ store_id: null, requires_ack: true })
    const own = addAnn({ pinned: true })
    addEmployee(STORE_B)
    expect(await addLateJoinerRecipient(db() as never, NEW)).toBe(1) // B'de yalnızca şirket geneli
    expect(rec()).toEqual([wide])
    db().tables.announcement_recipients = []; db().tables.notifications = []
    db().tables.employees.find((e) => e.id === NEW)!.store_id = STORE_A // transfer → A
    expect(await addLateJoinerRecipient(db() as never, NEW)).toBe(2)
    expect(rec()).toEqual([wide, own].sort())
    expect(notes()).toHaveLength(1)
    expect(notes()[0].title).toBe('2 duyuru sizi bekliyor')
  })

  it('hedef roller uymuyorsa eklenmez; kiosk ve pasif eklenmez; tekrar çağrı mükerrer üretmez', async () => {
    const mgrOnly = addAnn({ pinned: true, target_roles: 'managers' })
    addEmployee(STORE_A)
    expect(await addLateJoinerRecipient(db() as never, NEW)).toBe(0)
    db().tables.employees = db().tables.employees.filter((e) => e.id !== NEW)

    addEmployee(STORE_A, ACCESS.KIOSK)
    expect(await addLateJoinerRecipient(db() as never, NEW)).toBe(0)
    db().tables.employees = db().tables.employees.filter((e) => e.id !== NEW)

    addEmployee(STORE_A, ACCESS.EMPLOYEE, { active: false })
    expect(await addLateJoinerRecipient(db() as never, NEW)).toBe(0)
    db().tables.employees = db().tables.employees.filter((e) => e.id !== NEW)

    addEmployee(STORE_A, ACCESS.MANAGER)
    expect(await addLateJoinerRecipient(db() as never, NEW)).toBe(1)
    expect(rec()).toEqual([mgrOnly])
    expect(await addLateJoinerRecipient(db() as never, NEW)).toBe(0)
    expect(notes()).toHaveLength(1)
  })

  it('POST /api/employees yeni çalışanı sabit duyurulara ekler', async () => {
    const pinned = addAnn({ pinned: true })
    as(SM_A, ACCESS.STORE_MANAGER, STORE_A)
    const res = await employeesPOST(req('/api/employees', 'POST', { full_name: 'Yeni Kişi', role_id: uuid(99), employment_type: 'full_time' }))
    expect(res.status).toBe(201)
    const created = ((await res.json()) as { employee: { id: string } }).employee.id
    expect(db().tables.announcement_recipients.some((r) => r.announcement_id === pinned && r.employee_id === created)).toBe(true)
    expect(db().tables.notifications.some((n) => n.employee_id === created && n.type === 'announcement')).toBe(true)
  })

  it('PATCH /api/employees/[id] transferi, yeni mağazanın sabit duyurularına ekler', async () => {
    const inB = addAnn({ pinned: true, store_id: STORE_B })
    as(ADMIN, ACCESS.ADMIN, STORE_A)
    const res = await employeePATCH(req(`/api/employees/${EMP_A2}`, 'PATCH', { store_id: STORE_B }), ctx(EMP_A2))
    expect(res.status).toBe(200)
    expect(db().tables.announcement_recipients.some((r) => r.announcement_id === inB && r.employee_id === EMP_A2)).toBe(true)
  })
})
