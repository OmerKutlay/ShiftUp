// @vitest-environment node
/**
 * GET /api/store-location/name — aktif mağazanın adı (stores tablosundan); oturumsuz 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const EMP = { id: 'e1', full_name: 'Ayşe', email: null, role: 'Kasiyer', role_id: null, role_name: 'Çalışan', active: true, home_store_id: 'store-A', store_id: 'store-A' }

function mockDb(row: { name: string } | null) {
  const select = vi.fn()
  const chain = { select, eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }
  select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  const from = vi.fn().mockReturnValue(chain)
  vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => ({ from }) }))
  return { select, eq: chain.eq, from }
}

describe('GET /api/store-location/name', () => {
  beforeEach(() => vi.resetModules())

  it('oturum yoksa 401', async () => {
    vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(null) }))
    mockDb(null)
    const { GET } = await import('@/app/api/store-location/name/route')
    const res = await GET({} as never)
    expect(res.status).toBe(401)
  })

  it('çalışan rolü aktif mağazanın yalnızca adını alır (stores tablosundan)', async () => {
    vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(EMP) }))
    const { select, eq, from } = mockDb({ name: 'Kadıköy mağazası' })
    const { GET } = await import('@/app/api/store-location/name/route')
    const res = await GET({} as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Kadıköy mağazası' })
    expect(from).toHaveBeenCalledWith('stores')
    expect(select).toHaveBeenCalledWith('name')
    expect(eq).toHaveBeenCalledWith('id', 'store-A')
  })

  it('admin başka mağazaya geçtiyse o mağazanın adını alır', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue({ ...EMP, store_id: 'store-B' }),
    }))
    const { eq } = mockDb({ name: 'Beşiktaş mağazası' })
    const { GET } = await import('@/app/api/store-location/name/route')
    expect(await (await GET({} as never)).json()).toEqual({ name: 'Beşiktaş mağazası' })
    expect(eq).toHaveBeenCalledWith('id', 'store-B')
  })

  it('mağaza bulunamazsa name: null', async () => {
    vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(EMP) }))
    mockDb(null)
    const { GET } = await import('@/app/api/store-location/name/route')
    expect(await (await GET({} as never)).json()).toEqual({ name: null })
  })
})
