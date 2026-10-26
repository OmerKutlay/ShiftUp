import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShiftTemplate } from '@/types/shiftTemplate'

// ============================================================
// Supabase mock
// ============================================================
vi.mock('@/lib/db', () => ({
  db: { from: vi.fn() },
}))

import {
  fetchShiftTemplates,
  fetchActiveShiftTemplates,
  createShiftTemplate,
  updateShiftTemplate,
  deactivateShiftTemplate,
  ShiftTemplateValidationError,
} from '@/lib/shiftTemplateRepository'
import { db as supabase } from '@/lib/db'

// ============================================================
// Helpers
// ============================================================
const STORE = '00000000-0000-0000-0003-000000000001'

function makeTemplate(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: 'tpl-001',
    name: 'Açılış',
    start_time: '09:00:00',
    end_time: '18:00:00',
    description: 'Sabah vardiyası',
    active: true,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    ...overrides,
  }
}

function buildChain(terminal: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  ;['select', 'eq', 'order', 'insert', 'update', 'single'].forEach((m) => {
    chain[m] = vi.fn(() => ({ ...chain, ...terminal }))
  })
  return { ...chain, ...terminal }
}

// ============================================================
// fetchShiftTemplates
// ============================================================
describe('shiftTemplateRepository — fetchShiftTemplates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('şablon listesi döner', async () => {
    const templates = [makeTemplate(), makeTemplate({ id: 'tpl-002', name: 'Kapanış' })]
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: templates, error: null })
    )
    const result = await fetchShiftTemplates(STORE)
    expect(result).toHaveLength(2)
  })

  it('hata durumunda fırlatır', async () => {
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: null, error: { message: 'DB hatası' } })
    )
    await expect(fetchShiftTemplates(STORE)).rejects.toThrow('Vardiya şablonları yüklenemedi')
  })
})

// ============================================================
// fetchActiveShiftTemplates
// ============================================================
describe('shiftTemplateRepository — fetchActiveShiftTemplates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sadece aktif şablonları döner', async () => {
    const active = [makeTemplate({ active: true })]
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: active, error: null })
    )
    const result = await fetchActiveShiftTemplates(STORE)
    expect(result.every((t) => t.active)).toBe(true)
  })
})

// ============================================================
// createShiftTemplate — validation
// ============================================================
describe('shiftTemplateRepository — createShiftTemplate validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('isim boş olamaz', async () => {
    await expect(
      createShiftTemplate({ name: '', start_time: '09:00', end_time: '18:00' }, STORE)
    ).rejects.toThrow(ShiftTemplateValidationError)
    await expect(
      createShiftTemplate({ name: '   ', start_time: '09:00', end_time: '18:00' }, STORE)
    ).rejects.toThrow('Şablon adı boş olamaz.')
  })

  it('başlangıç saati zorunludur', async () => {
    await expect(
      createShiftTemplate({ name: 'Test', start_time: '', end_time: '18:00' }, STORE)
    ).rejects.toThrow('Başlangıç saati zorunludur.')
  })

  it('bitiş saati zorunludur', async () => {
    await expect(
      createShiftTemplate({ name: 'Test', start_time: '09:00', end_time: '' }, STORE)
    ).rejects.toThrow('Bitiş saati zorunludur.')
  })

  it('geçersiz saat formatı reddedilir', async () => {
    await expect(
      createShiftTemplate({ name: 'Test', start_time: '9:0', end_time: '18:00' }, STORE)
    ).rejects.toThrow('Geçersiz başlangıç saati formatı')
    await expect(
      createShiftTemplate({ name: 'Test', start_time: '09:00', end_time: 'abc' }, STORE)
    ).rejects.toThrow('Geçersiz bitiş saati formatı')
  })
})

// ============================================================
// createShiftTemplate — success
// ============================================================
describe('shiftTemplateRepository — createShiftTemplate success', () => {
  beforeEach(() => vi.clearAllMocks())

  it('şablon oluşturulabilir', async () => {
    const created = makeTemplate({ id: 'new-tpl' })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: created, error: null }),
    })
    const result = await createShiftTemplate({
      name: 'Açılış',
      start_time: '09:00',
      end_time: '18:00',
    }, STORE)
    expect(result.id).toBe('new-tpl')
    expect(result.name).toBe('Açılış')
  })

  it('duplicate isim hatası ShiftTemplateValidationError fırlatır', async () => {
    // Her çağrı için ayrı mock — test iki ayrı assert yapıyor
    ;(supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: '23505', message: 'unique violation' } }),
      })
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: '23505', message: 'unique violation' } }),
      })

    await expect(
      createShiftTemplate({ name: 'Açılış', start_time: '09:00', end_time: '18:00' }, STORE)
    ).rejects.toThrow(ShiftTemplateValidationError)

    await expect(
      createShiftTemplate({ name: 'Açılış', start_time: '09:00', end_time: '18:00' }, STORE)
    ).rejects.toThrow('"Açılış" adında bir şablon zaten mevcut.')
  })
})

// ============================================================
// updateShiftTemplate
// ============================================================
describe('shiftTemplateRepository — updateShiftTemplate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('şablon güncellenebilir', async () => {
    const updated = makeTemplate({ name: 'Yeni İsim' })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: updated, error: null }),
    })
    const result = await updateShiftTemplate('tpl-001', { name: 'Yeni İsim' }, STORE)
    expect(result.name).toBe('Yeni İsim')
  })

  it('geçersiz start_time güncellemesi reddedilir', async () => {
    await expect(
      updateShiftTemplate('tpl-001', { start_time: 'bad' }, STORE)
    ).rejects.toThrow(ShiftTemplateValidationError)
  })
})

// ============================================================
// deactivateShiftTemplate
// ============================================================
describe('shiftTemplateRepository — deactivateShiftTemplate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('şablon pasif yapılabilir', async () => {
    const deactivated = makeTemplate({ active: false })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: deactivated, error: null }),
    })
    const result = await deactivateShiftTemplate('tpl-001', STORE)
    expect(result.active).toBe(false)
  })
})
