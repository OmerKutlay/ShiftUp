import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureAuthUserForEmployee } from '@/lib/auth/authUser'

function makeAdmin(overrides: {
  getUserById?: ReturnType<typeof vi.fn>
  updateUserById?: ReturnType<typeof vi.fn>
  createUser?: ReturnType<typeof vi.fn>
  listUsers?: ReturnType<typeof vi.fn>
  deleteUser?: ReturnType<typeof vi.fn>
  linkError?: { code: string; message: string } | null
  /** employees.auth_user_id ile bağlı çalışan (sahiplik kontrolü) */
  owner?: { id: string } | null
}) {
  const eq = vi.fn().mockResolvedValue({ error: overrides.linkError ?? null })
  const update = vi.fn().mockReturnValue({ eq })
  const maybeSingle = vi.fn().mockResolvedValue({ data: overrides.owner ?? null, error: null })
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) })
  const admin = {
    auth: {
      admin: {
        getUserById: overrides.getUserById ?? vi.fn(),
        updateUserById: overrides.updateUserById ?? vi.fn().mockResolvedValue({ error: null }),
        createUser: overrides.createUser ?? vi.fn(),
        listUsers: overrides.listUsers ?? vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        deleteUser: overrides.deleteUser ?? vi.fn().mockResolvedValue({ error: null }),
      },
    },
    from: vi.fn().mockReturnValue({ update, select }),
  }
  return { admin: admin as unknown as SupabaseClient, update, eq, raw: admin }
}

describe('ensureAuthUserForEmployee', () => {
  it('bağlı ve email eşleşiyorsa hiçbir şey değiştirmez', async () => {
    const { admin, raw } = makeAdmin({
      getUserById: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } }, error: null }),
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'A@x.com', auth_user_id: 'u1' })
    expect(res).toEqual({ ok: true, authUserId: 'u1' })
    expect(raw.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(raw.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('bağlı ama email değişmişse auth email güncellenir', async () => {
    const { admin, raw } = makeAdmin({
      getUserById: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'old@x.com' } }, error: null }),
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'new@x.com', auth_user_id: 'u1' })
    expect(res.ok).toBe(true)
    expect(raw.auth.admin.updateUserById).toHaveBeenCalledWith('u1', { email: 'new@x.com', email_confirm: true })
  })

  it('bağlı değilse auth kullanıcısı oluşturulup employee kaydına bağlanır', async () => {
    const { admin, update, eq } = makeAdmin({
      createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u2' } }, error: null }),
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'a@x.com', auth_user_id: null })
    expect(res).toEqual({ ok: true, authUserId: 'u2' })
    expect(update).toHaveBeenCalledWith({ auth_user_id: 'u2' })
    expect(eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('email zaten kayıtlı ve bu çalışan için oluşturulmuşsa mevcut kullanıcı bağlanır', async () => {
    const { admin, update, raw } = makeAdmin({
      createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'exists' } }),
      listUsers: vi.fn().mockResolvedValue({
        data: { users: [{ id: 'u3', email: 'a@x.com', app_metadata: { employee_id: 'e1' } }] }, error: null,
      }),
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'a@x.com', auth_user_id: null })
    expect(res).toEqual({ ok: true, authUserId: 'u3' })
    expect(update).toHaveBeenCalledWith({ auth_user_id: 'u3' })
    expect(raw.auth.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('kaynağı belirsiz mevcut kullanıcı benimsenmez: silinir ve temiz kullanıcı oluşturulur', async () => {
    const createUser = vi.fn()
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'exists' } })
      .mockResolvedValueOnce({ data: { user: { id: 'u-new' } }, error: null })
    const { admin, update, raw } = makeAdmin({
      createUser,
      // Dışarıdan kayıtla açılmış (işaretsiz) kullanıcı — saldırgan şifre koymuş olabilir
      listUsers: vi.fn().mockResolvedValue({ data: { users: [{ id: 'u-foreign', email: 'a@x.com', app_metadata: {} }] }, error: null }),
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'a@x.com', auth_user_id: null })
    expect(res).toEqual({ ok: true, authUserId: 'u-new' })
    expect(raw.auth.admin.deleteUser).toHaveBeenCalledWith('u-foreign')
    expect(update).toHaveBeenCalledWith({ auth_user_id: 'u-new' })
    expect(update).not.toHaveBeenCalledWith({ auth_user_id: 'u-foreign' })
  })

  it('başka çalışana ait işaretli kullanıcı silinmez, AUTH_USER_CONFLICT döner', async () => {
    const { admin, update, raw } = makeAdmin({
      createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'exists' } }),
      listUsers: vi.fn().mockResolvedValue({
        data: { users: [{ id: 'u4', email: 'a@x.com', app_metadata: { employee_id: 'e2' } }] }, error: null,
      }),
      owner: { id: 'e2' },
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'a@x.com', auth_user_id: null })
    expect(res).toEqual({ ok: false, reason: 'AUTH_USER_CONFLICT' })
    expect(raw.auth.admin.deleteUser).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('kaynağı belirsiz kullanıcı silinemezse bağlanmaz (fail-closed)', async () => {
    const { admin, update } = makeAdmin({
      createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'exists' } }),
      listUsers: vi.fn().mockResolvedValue({ data: { users: [{ id: 'u5', email: 'a@x.com' }] }, error: null }),
      deleteUser: vi.fn().mockResolvedValue({ error: { message: 'boom' } }),
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'a@x.com', auth_user_id: null })
    expect(res).toEqual({ ok: false, reason: 'AUTH_PROVISION_FAILED' })
    expect(update).not.toHaveBeenCalled()
  })

  it('auth kullanıcısı başka employee’a bağlıysa AUTH_USER_CONFLICT döner', async () => {
    const { admin } = makeAdmin({
      createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u2' } }, error: null }),
      linkError: { code: '23505', message: 'duplicate' },
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'a@x.com', auth_user_id: null })
    expect(res).toEqual({ ok: false, reason: 'AUTH_USER_CONFLICT' })
  })
})
