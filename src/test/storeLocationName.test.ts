// @vitest-environment node
/**
 * GET /api/store-location/name — yalnızca aktif mağaza adı; oturumsuz 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const EMP = { id: 'e1', full_name: 'Ayşe', email: null, role: 'Kasiyer', role_id: null, role_name: 'Çalışan', active: true }

function mockDb(row: { name: string } | null) {
  const select = vi.fn()
  const chain = { select, eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }
  select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.limit.mockReturnValue(chain)
  vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => ({ from: vi.fn().mockReturnValue(chain) }) }))
  return select
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

  it('çalışan rolü aktif mağazanın yalnızca adını alır', async () => {
    vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(EMP) }))
    const select = mockDb({ name: 'Kadıköy mağazası' })
    const { GET } = await import('@/app/api/store-location/name/route')
    const res = await GET({} as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Kadıköy mağazası' })
    expect(select).toHaveBeenCalledWith('name')
  })

  it('aktif mağaza yoksa name: null', async () => {
    vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(EMP) }))
    mockDb(null)
    const { GET } = await import('@/app/api/store-location/name/route')
    expect(await (await GET({} as never)).json()).toEqual({ name: null })
  })
})
