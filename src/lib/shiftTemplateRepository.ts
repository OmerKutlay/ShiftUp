import { db } from '@/lib/db'
import type {
  ShiftTemplate,
  CreateShiftTemplatePayload,
  UpdateShiftTemplatePayload,
} from '@/types/shiftTemplate'

// ============================================================
// Validation
// ============================================================

export class ShiftTemplateValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShiftTemplateValidationError'
  }
}

/** Şablon yok ya da başka mağazaya ait (varlığı sızdırılmaz) */
export class ShiftTemplateNotFoundError extends Error {
  constructor() {
    super('Şablon bulunamadı.')
    this.name = 'ShiftTemplateNotFoundError'
  }
}

/** HH:MM formatını doğrular */
function isValidTime(time: string): boolean {
  return /^\d{2}:\d{2}$/.test(time)
}

function validatePayload(payload: CreateShiftTemplatePayload): void {
  if (!payload.name?.trim()) {
    throw new ShiftTemplateValidationError('Şablon adı boş olamaz.')
  }
  if (!payload.start_time) {
    throw new ShiftTemplateValidationError('Başlangıç saati zorunludur.')
  }
  if (!payload.end_time) {
    throw new ShiftTemplateValidationError('Bitiş saati zorunludur.')
  }
  if (!isValidTime(payload.start_time)) {
    throw new ShiftTemplateValidationError('Geçersiz başlangıç saati formatı (HH:MM bekleniyor).')
  }
  if (!isValidTime(payload.end_time)) {
    throw new ShiftTemplateValidationError('Geçersiz bitiş saati formatı (HH:MM bekleniyor).')
  }
}

// ============================================================
// Queries
// ============================================================

/** Mağazanın tüm şablonlarını getirir */
export async function fetchShiftTemplates(storeId: string): Promise<ShiftTemplate[]> {
  const { data, error } = await db
    .from('shift_templates')
    .select('id, name, start_time, end_time, description, active, created_at, updated_at')
    .eq('store_id', storeId)
    .order('start_time', { ascending: true })

  if (error) throw new Error(`Vardiya şablonları yüklenemedi: ${error.message}`)
  return (data ?? []) as ShiftTemplate[]
}

/** Mağazanın yalnızca aktif şablonlarını getirir (vardiya atama için) */
export async function fetchActiveShiftTemplates(storeId: string): Promise<ShiftTemplate[]> {
  const { data, error } = await db
    .from('shift_templates')
    .select('id, name, start_time, end_time, description, active, created_at, updated_at')
    .eq('store_id', storeId)
    .eq('active', true)
    .order('start_time', { ascending: true })

  if (error) throw new Error(`Aktif vardiya şablonları yüklenemedi: ${error.message}`)
  return (data ?? []) as ShiftTemplate[]
}

/** Şablon bu mağazaya mı ait? (istemciden gelen shift_template_id doğrulaması) */
export async function isTemplateInStore(id: string, storeId: string): Promise<boolean> {
  const { data, error } = await db
    .from('shift_templates')
    .select('id')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw new Error(`Vardiya şablonu doğrulanamadı: ${error.message}`)
  return !!data
}

// ============================================================
// Mutations
// ============================================================

/**
 * Mağazaya yeni şablon oluşturur. İsim tekilliği mağaza başınadır:
 * DB UNIQUE (store_id, name) kısıtı + özel hata mesajı ile sağlanır.
 */
export async function createShiftTemplate(
  payload: CreateShiftTemplatePayload,
  storeId: string
): Promise<ShiftTemplate> {
  validatePayload(payload)

  const { data, error } = await db
    .from('shift_templates')
    .insert({
      store_id: storeId,
      name: payload.name.trim(),
      start_time: payload.start_time,
      end_time: payload.end_time,
      description: payload.description ?? null,
      active: payload.active ?? true,
    })
    .select()
    .single()

  if (error) {
    // Postgres UNIQUE ihlali: code 23505
    if (error.code === '23505') {
      throw new ShiftTemplateValidationError(
        `"${payload.name}" adında bir şablon zaten mevcut.`
      )
    }
    throw new Error(`Şablon oluşturulamadı: ${error.message}`)
  }

  return data as ShiftTemplate
}

/** Mağazanın mevcut şablonunu günceller (başka mağazanın şablonu → ShiftTemplateNotFoundError) */
export async function updateShiftTemplate(
  id: string,
  payload: UpdateShiftTemplatePayload,
  storeId: string
): Promise<ShiftTemplate> {
  // Güncelleme varsa validate et
  if (payload.name !== undefined || payload.start_time !== undefined || payload.end_time !== undefined) {
    const partial: CreateShiftTemplatePayload = {
      name: payload.name ?? '',
      start_time: payload.start_time ?? '',
      end_time: payload.end_time ?? '',
    }
    // Sadece gönderilen alanları doğrula
    if (payload.name !== undefined && !payload.name.trim()) {
      throw new ShiftTemplateValidationError('Şablon adı boş olamaz.')
    }
    if (payload.start_time !== undefined && !isValidTime(payload.start_time)) {
      throw new ShiftTemplateValidationError('Geçersiz başlangıç saati formatı.')
    }
    if (payload.end_time !== undefined && !isValidTime(payload.end_time)) {
      throw new ShiftTemplateValidationError('Geçersiz bitiş saati formatı.')
    }
    void partial // suppress unused warning
  }

  const { data, error } = await db
    .from('shift_templates')
    .update(payload)
    .eq('id', id)
    .eq('store_id', storeId)
    .select()
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      throw new ShiftTemplateValidationError(
        `"${payload.name}" adında bir şablon zaten mevcut.`
      )
    }
    throw new Error(`Şablon güncellenemedi: ${error.message}`)
  }
  if (!data) throw new ShiftTemplateNotFoundError()

  return data as ShiftTemplate
}

/** Şablonu pasif yapar (soft deactivate) */
export async function deactivateShiftTemplate(id: string, storeId: string): Promise<ShiftTemplate> {
  return updateShiftTemplate(id, { active: false }, storeId)
}

export async function activateShiftTemplate(id: string, storeId: string): Promise<ShiftTemplate> {
  return updateShiftTemplate(id, { active: true }, storeId)
}
