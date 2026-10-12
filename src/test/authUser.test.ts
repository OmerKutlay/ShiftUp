import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureAuthUserForEmployee } from '@/lib/auth/authUser'

function makeAdmin(overrides: {
  getUserById?: ReturnType<typeof vi.fn>
  updateUserById?: ReturnType<typeof vi.fn>
  createUser?: ReturnType<typeof vi.fn>
  listUsers?: ReturnType<typeof vi.fn>
  linkError?: { code: string; message: string } | null
}) {
  const eq = vi.fn().mockResolvedValue({ error: overrides.linkError ?? null })
  const update = vi.fn().mockReturnValue({ eq })
  const admin = {
    auth: {
      admin: {
        getUserById: overrides.getUserById ?? vi.fn(),
        updateUserById: overrides.updateUserById ?? vi.fn().mockResolvedValue({ error: null }),
        createUser: overrides.createUser ?? vi.fn(),
        listUsers: overrides.listUsers ?? vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      },
    },
    from: vi.fn().mockReturnValue({ update }),
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

  it('email auth.users içinde zaten varsa mevcut kullanıcı bağlanır', async () => {
    const { admin, update } = makeAdmin({
      createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'exists' } }),
      listUsers: vi.fn().mockResolvedValue({ data: { users: [{ id: 'u3', email: 'a@x.com' }] }, error: null }),
    })
    const res = await ensureAuthUserForEmployee(admin, { id: 'e1', email: 'a@x.com', auth_user_id: null })
    expect(res).toEqual({ ok: true, authUserId: 'u3' })
    expect(update).toHaveBeenCalledWith({ auth_user_id: 'u3' })
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
